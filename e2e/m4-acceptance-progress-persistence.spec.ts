import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { seedPlayingLevel } from './seedLevel.ts'

/**
 * roadmap 4.10 (M4 acceptance pass) — independent re-check of REQ-3.3.4/
 * REQ-3.9.5 ("an assessment result and a practice-log entry survive a
 * reload").
 *
 * `e2e/progress-persistence.spec.ts` already covers this, but it currently
 * TIMES OUT on this worktree — not because persistence regressed, but because
 * two behaviour changes shipped after that spec was written and it was never
 * updated to match:
 *
 *   1. roadmap 5.17 gates "Start assessment" behind the `playing` track's
 *      level. A fresh app starts every track at level 1, below the gate, so
 *      the button the old spec waits for never renders at all.
 *   2. roadmap 5.17 also moved "Start assessment" behind the collapsed
 *      "More tools" disclosure (see `e2e/assessment.spec.ts`, which does
 *      both `seedPlayingLevel` and `page.getByText('More tools').click()`
 *      before reaching for it).
 *
 * The old spec does neither, so `getByRole('group', { name: 'Assessment' })`
 * never appears and the click hangs for the full 90s timeout. See the M4
 * acceptance report for the proposed fix to the existing spec.
 *
 * This spec re-drives the same claim — assessment result + practice-log
 * entry both survive a reload, read straight out of IndexedDB — with the
 * level seeded and "More tools" opened first.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

const DB_NAME = 'piano-learning-app'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

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

test('an assessment result and a practice-log entry survive a reload, read straight out of IndexedDB (REQ-3.3.4/REQ-3.9.5, re-checked past roadmap 5.17s gating)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await seedPlayingLevel(page, 3)
  await page.reload()

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(1_200)
  await transport.getByRole('button', { name: 'Stop', exact: true }).click()

  // "Start assessment" lives behind the collapsed "More tools" disclosure
  // (roadmap 5.17) — the fix the old spec is missing.
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
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  const assessments = (await readStored(page, 'progress', 'assessments')) as
    | { readonly assessments?: readonly { readonly scoreTitle?: string }[] }
    | readonly unknown[]
    | undefined
  const assessmentList = Array.isArray(assessments)
    ? assessments
    : ((assessments?.assessments ?? []) as readonly unknown[])
  expect(assessmentList.length, 'no assessment result was persisted').toBeGreaterThan(0)

  const practiceLog = (await readStored(page, 'practiceLog', 'practiceLog')) as
    | { readonly practiceEntries?: readonly { readonly itemName?: string }[] }
    | undefined
  const entries = practiceLog?.practiceEntries ?? []
  expect(entries.length, 'no practice-log entry was persisted').toBeGreaterThan(0)
  expect(entries[0]?.itemName).toBe(FIXTURE_TITLE)

  expect(errors).toEqual([])
})
