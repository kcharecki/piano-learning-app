import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { seedPlayingLevel } from './seedLevel.ts'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * E2E proof for roadmap 2.24 (REQ-3.3.4 / REQ-3.9.5): assessment results and
 * the practice log are written to IndexedDB and survive a reload.
 *
 * Before this, `src/core/ports/store.ts` declared `practiceLog`, `progress`
 * and `recordings` and `persistence.ts` held the app's only `store.put` call,
 * for the loaded score — every one of those three collections was written by
 * nothing, so an assessment result died with the component and
 * `core/progress/log.ts` was 317 tested lines no production code imported.
 *
 * The assertions read the database directly rather than trusting a screen to
 * redisplay the value: the claim being proved is "it is on disk", and a UI
 * that re-derives the number from memory would satisfy a screen-level check
 * while the database stayed empty.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

const DB_NAME = 'piano-learning-app'

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** Read one key out of one object store of the app's real IndexedDB database. */
async function readStored(page: Page, collection: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, storeName, storeKey }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains(storeName)) {
            resolve(undefined)
            return
          }
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(storeKey)
          request.onerror = () => reject(request.error)
          request.onsuccess = () => resolve(request.result as unknown)
        }
      }),
    { dbName: DB_NAME, storeName: collection, storeKey: key },
  )
}

test('an assessment result and a practice-log entry survive a reload, read straight out of IndexedDB (roadmap 2.24)', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors = collectErrors(page)

  await page.goto('/')
  // Roadmap 5.17 gated Assessment behind the `playing` track reaching level 3
  // and moved it inside the collapsed "More tools" disclosure, so a fresh
  // level-1 profile never renders the button this spec waits for. Seed the
  // level first and open the disclosure below, the same two steps
  // `assessment.spec.ts` takes.
  await seedPlayingLevel(page, 3)
  await page.reload()
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  // An ordinary practice run first: press Play, let it run, press Stop. That
  // start/stop edge is what opens and closes a practice-log session
  // (REQ-3.9.5), and it is deliberately proved separately from the assessment
  // below so a failure names which half broke.
  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(1_200)
  await transport.getByRole('button', { name: 'Stop', exact: true }).click()

  // Run the assessment with no keyboard attached: every note goes unplayed and
  // the run finalises at 0% when the transport plays off the end. A finished
  // run is a finished run — what is being proved here is that its RESULT is
  // stored, not what the result says.
  await page.getByText('More tools').click()
  await page
    .getByRole('group', { name: 'Assessment' })
    .getByRole('button', { name: /assessment/i })
    .click()
  await expect(page.getByTestId('assessment-accuracy')).toBeVisible({ timeout: 45_000 })

  await page.reload()
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()
  // The restored score proves the persistence layer is up on this page life.
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  const assessments = (await readStored(page, 'progress', 'assessments')) as
    | { readonly assessments?: readonly { readonly scoreTitle?: string }[] }
    | readonly unknown[]
    | undefined
  const assessmentList = Array.isArray(assessments)
    ? assessments
    : ((assessments?.assessments ?? []) as readonly unknown[])
  expect(assessmentList.length, 'no assessment result was persisted').toBeGreaterThan(0)

  // The practice log: the transport ran and stopped, so a session was timed
  // and stored (REQ-3.9.5 — what was practised and for how long).
  const practiceLog = (await readStored(page, 'practiceLog', 'practiceLog')) as
    | { readonly practiceEntries?: readonly { readonly itemName?: string }[] }
    | undefined
  const entries = practiceLog?.practiceEntries ?? []
  expect(entries.length, 'no practice-log entry was persisted').toBeGreaterThan(0)
  // It names what was practised — an entry with a blank label would satisfy a
  // length check while recording nothing useful.
  expect(entries[0]?.itemName).toBe(FIXTURE_TITLE)

  expect(errors).toEqual([])
})
