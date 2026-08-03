import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * E2E proof for roadmap 4.7b: the dashboard's POPULATED state, not just its
 * honest-zeros empty state (e2e/screens.spec.ts). The dashboard reads from
 * IndexedDB through several stores (`useProgressStore`, `useSightReadingStore`,
 * `useFlashcardStore`) and, before this, nothing had ever driven real practice
 * data all the way onto that screen in a browser — a break in any one of
 * those wires would show up as a zero where a real number belongs, and
 * nothing before this caught that.
 *
 * The streak and weekly-minutes figures get their entropy from two synthetic
 * `PracticeEntry` records merged directly into IndexedDB (13 min today, 7 min
 * yesterday, after one short real Play/Stop cycle proves the real write path
 * still works) rather than from repeating short cycles until `Math.round`
 * clears a boundary — a distinctive, asymmetric total is something a
 * constant-rendering dashboard cannot accidentally satisfy.
 *
 * CONTRACT GAP found while writing this (reported, not silently resolved):
 * the repertoire assessment's own accuracy (`AssessmentPanel`'s
 * `assessment-accuracy` testid, backed by `useProgressStore.assessments`) has
 * no home anywhere on the dashboard. `useDashboard`'s "Sight-reading accuracy
 * trend" section reads `useSightReadingStore`'s `history` instead, which only
 * generated sight-reading EXERCISE runs write — a repertoire assessment run
 * through `AssessmentPanel` never touches that store, so this spec drives a
 * sight-reading exercise (the accuracy path the dashboard DOES render) rather
 * than a repertoire assessment (whose persistence is already proved by
 * e2e/progress-persistence.spec.ts and would add nothing here).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

const DB_NAME = 'piano-learning-app'
const DAY_MS = 24 * 60 * 60 * 1000

/** Console/page errors, collected from the moment the page is created (see e2e/round6.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function nav(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
}

/** Read one key out of one object store of the app's real IndexedDB database (see e2e/progress-persistence.spec.ts). */
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

type SyntheticPracticeEntry = {
  readonly id: string
  readonly startedAt: number
  readonly endedAt: number
  readonly kind: string
  readonly itemName: string
}

/**
 * Merges synthetic entries into the real `practiceLog` record already written
 * by the app (rather than overwriting it), so the entries this spec injects
 * for entropy sit alongside whatever the real Play/Stop cycle above wrote.
 */
async function mergePracticeEntries(page: Page, entries: readonly SyntheticPracticeEntry[]): Promise<void> {
  await page.evaluate(
    ({ dbName, storeName, storeKey, newEntries }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(storeName, 'readwrite')
          const store = tx.objectStore(storeName)
          const getReq = store.get(storeKey)
          getReq.onerror = () => reject(getReq.error)
          getReq.onsuccess = () => {
            const current = (getReq.result as { practiceEntries?: unknown[] } | undefined) ?? {
              practiceEntries: [],
            }
            const existing = Array.isArray(current.practiceEntries) ? current.practiceEntries : []
            const putReq = store.put(
              { practiceEntries: [...newEntries, ...existing] },
              storeKey,
            )
            putReq.onerror = () => reject(putReq.error)
            putReq.onsuccess = () => resolve()
          }
        }
      }),
    { dbName: DB_NAME, storeName: 'practiceLog', storeKey: 'practiceLog', newEntries: entries },
  )
}

test('the populated dashboard shows a non-zero streak, weekly minutes and sight-reading trend, cross-checked against IndexedDB (roadmap 4.7b)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Practice').click()

  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  // One short real Play -> wait -> Stop cycle, just to prove the real
  // practice-log write path still works end to end. The entropy the
  // assertions below need comes from the synthetic entries merged in after
  // this, not from stacking cycles or racing the transport's own auto-stop.
  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(3_000)
  // Explicit short timeout: the transport auto-stops at the fixture's own
  // ~12s end and disables this button once stopped, so if our manual click
  // ever loses that race it fails fast and legibly instead of hanging on an
  // unactionable element until the test's own 120s timeout.
  await transport
    .getByRole('button', { name: 'Stop', exact: true })
    .click({ timeout: 5_000 })

  // Drive a real sight-reading exercise to completion — this is the accuracy
  // path the dashboard actually renders (see the module comment above).
  await nav(page, 'Sight reading').click()
  await expect(page.getByRole('heading', { name: 'Sight reading' })).toBeVisible()
  await page.getByRole('button', { name: 'Start exercise' }).click()
  await expect(page.getByTestId('preview-countdown')).toBeVisible()
  await page.getByRole('button', { name: 'Begin now' }).click()
  await expect(page.getByTestId('sight-reading-accuracy')).toBeVisible({ timeout: 15_000 })

  // Merge two distinctive, asymmetric synthetic practice entries directly
  // into IndexedDB: 13 minutes today, 7 minutes yesterday. A dashboard that
  // rendered a hardcoded "1 day(s)" / "1 min" (satisfying the previous
  // version of this spec, whose real totals rounded to exactly 1) cannot
  // satisfy the exact assertions below.
  const now = Date.now()
  await mergePracticeEntries(page, [
    {
      id: 'synthetic-today',
      startedAt: now - 13 * 60_000,
      endedAt: now,
      kind: 'technique',
      itemName: 'Synthetic today',
    },
    {
      id: 'synthetic-yesterday',
      startedAt: now - DAY_MS - 7 * 60_000,
      endedAt: now - DAY_MS,
      kind: 'sightreading',
      itemName: 'Synthetic yesterday',
    },
  ])

  await page.reload()
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  // The streak: read straight off the screen, after waiting out hydration
  // (the store restores asynchronously after reload — see persistence.ts's
  // module comment on restore/persist call order). The positive form both
  // waits for hydration AND reports the actual offending text on failure —
  // unlike `not.toHaveText(/^0 day/)`, which passes just as well against an
  // empty, "NaN day(s)" or "undefined day(s)" render.
  const streakEl = page.getByTestId('dashboard-streak-current')
  await expect(streakEl).toHaveText(/^[1-9]\d* day/, { timeout: 10_000 })
  // The synthetic entries span exactly today + yesterday, so the streak is
  // exactly 2 regardless of what the real cycle above additionally wrote.
  await expect(streakEl).toHaveText('2 day(s)')

  // The weekly minutes: same positive-regex hydration wait, then cross-check
  // against the real total in IndexedDB (now dominated by the 20 synthetic
  // minutes, not the ~1 real minute).
  const minutesEl = page.getByTestId('dashboard-weekly-minutes')
  await expect(minutesEl).toHaveText(/^[1-9]\d* min/, { timeout: 10_000 })
  const minutesText = await minutesEl.innerText()
  const displayedMinutes = Number(minutesText.match(/(\d+)\s*min/)?.[1] ?? '0')

  const practiceLog = (await readStored(page, 'practiceLog', 'practiceLog')) as
    | {
        readonly practiceEntries?: readonly {
          readonly startedAt: number
          readonly endedAt: number
        }[]
      }
    | undefined
  const entries = practiceLog?.practiceEntries ?? []
  expect(entries.length, 'no practice-log entries were persisted').toBeGreaterThan(0)
  const storedMinutes = entries.reduce((sum, e) => sum + (e.endedAt - e.startedAt) / 60_000, 0)
  expect(Math.round(storedMinutes)).toBe(displayedMinutes)

  // The sight-reading accuracy trend: the dashboard's only rendered accuracy
  // figure. Assert BOTH halves — the empty-state paragraph is gone (proves
  // the chart branch is taken at all) AND the chart's own point label matches
  // the accuracy actually persisted (proves it is the real number, not a
  // fixed placeholder).
  await expect(page.getByTestId('dashboard-sightreading-empty')).toHaveCount(0)
  const sightReadingHistory = (await readStored(page, 'sightReadingHistory', 'sightReadingHistory')) as
    | { readonly history?: readonly { readonly accuracy?: number }[] }
    | undefined
  const history = sightReadingHistory?.history ?? []
  expect(history.length, 'no sight-reading history was persisted').toBeGreaterThan(0)
  const storedAccuracy = history[0]?.accuracy
  expect(typeof storedAccuracy).toBe('number')
  const chartTitles = await page.locator('circle title').allTextContents()
  expect(chartTitles).toContain(`Run 1: ${Math.round((storedAccuracy ?? 0) * 100)}%`)

  expect(errors).toEqual([])
})

test('a manual level override moves the track and survives a reload (roadmap 4.3, REQ-2.3)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  const playingSelect = page.getByTestId('dashboard-level-select-playing')
  await playingSelect.selectOption('4')
  await expect(page.getByTestId('dashboard-level-playing')).toContainText('level 4')
  await expect(page.getByTestId('dashboard-level-playing')).toContainText('(overridden)')

  await page.reload()
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  await expect(page.getByTestId('dashboard-level-playing')).toContainText('level 4', {
    timeout: 10_000,
  })
  await expect(page.getByTestId('dashboard-level-playing')).toContainText('(overridden)')

  expect(errors).toEqual([])
})
