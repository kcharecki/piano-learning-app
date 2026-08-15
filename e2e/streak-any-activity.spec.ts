import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.15: the practice streak counts ANY logged
 * activity, not only repertoire.
 *
 * `core/progress/log.ts`'s `currentStreakDays`/`longestStreakDays` never read
 * `PracticeEntry.kind` at all (confirmed in `log.test.ts`, including a new
 * "every ActivityKind independently extends a streak" property test), and
 * `useDashboard.ts` already passes the FULL, unfiltered `practiceEntries`
 * array through to them — both were already correct. What was missing is the
 * browser-driven proof the 4.7b pattern demands: a screen re-deriving a
 * plausible number from the wrong data cannot pass a UI check alone, so this
 * seeds real `PracticeEntry` rows straight into IndexedDB (the same
 * `mergePracticeEntries` shape `e2e/dashboard-populated.spec.ts` uses) and
 * reads the rendered streak, cross-checked against what was actually stored.
 */

const DB_NAME = 'piano-learning-app'
const DAY_MS = 24 * 60 * 60 * 1000

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function nav(page: Page, label: string) {
  return page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true })
}

type SyntheticPracticeEntry = {
  readonly id: string
  readonly startedAt: number
  readonly endedAt: number
  readonly kind: string
  readonly itemName: string
}

/** Overwrites the app's practiceLog record — this spec wants full control over exactly what days are practiced. */
async function setPracticeEntries(page: Page, entries: readonly SyntheticPracticeEntry[]): Promise<void> {
  await page.evaluate(
    ({ dbName, newEntries }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('practiceLog', 'readwrite')
          const putReq = tx.objectStore('practiceLog').put({ practiceEntries: newEntries }, 'practiceLog')
          putReq.onerror = () => reject(putReq.error)
          putReq.onsuccess = () => resolve()
        }
      }),
    { dbName: DB_NAME, newEntries: entries },
  )
}

async function readPracticeEntries(page: Page): Promise<readonly SyntheticPracticeEntry[]> {
  return page.evaluate(
    (dbName) =>
      new Promise<readonly SyntheticPracticeEntry[]>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction('practiceLog', 'readonly').objectStore('practiceLog').get('practiceLog')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            const record = req.result as { practiceEntries?: SyntheticPracticeEntry[] } | undefined
            resolve(record?.practiceEntries ?? [])
          }
        }
      }),
    DB_NAME,
  )
}

test('a day containing only an ear-training session extends the streak; a day with no activity breaks it (roadmap 5.15)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  // Visit once first so the app creates its IndexedDB database and stores.
  await page.goto('/')
  await page.waitForTimeout(200)

  // `core/progress/log.ts` buckets by LOCAL midnight (its own module doc), and
  // `Shell.tsx` feeds it the real `-new Date().getTimezoneOffset()` — so the
  // seeded timestamps must land in "today" and "yesterday" by the same local
  // calendar, not a fixed UTC-hour anchor. A UTC-anchored anchor (the
  // previous approach here) drifts onto the wrong local day whenever the
  // test happens to run close to local midnight in a timezone ahead of UTC,
  // which is exactly the kind of environment-dependent flake this rewrite
  // removes: `setHours` below is local-time by definition, so it is always
  // "today, 09:00" in whatever timezone the browser and this test process
  // both already share (see e2e/screens.spec.ts's own TodayLabel comment for
  // the same local/UTC distinction elsewhere in this suite).
  const todayLocalNine = new Date()
  todayLocalNine.setHours(9, 0, 0, 0)
  const todayStart = todayLocalNine.getTime()
  const yesterdayStart = todayStart - DAY_MS

  // Two consecutive days, NEITHER of them repertoire — proves the streak is
  // not secretly gated on that one kind.
  const entries: SyntheticPracticeEntry[] = [
    {
      id: 'e-yesterday',
      startedAt: yesterdayStart,
      endedAt: yesterdayStart + 10 * 60_000,
      kind: 'technique',
      itemName: 'C major scale',
    },
    {
      id: 'e-today',
      startedAt: todayStart,
      endedAt: todayStart + 10 * 60_000,
      kind: 'eartraining',
      itemName: 'Interval drill',
    },
  ]
  await setPracticeEntries(page, entries)

  await page.reload()
  await nav(page, 'Progress').click()

  const currentStreak = page.getByTestId('dashboard-streak-current')
  await expect(currentStreak).toHaveText('2 days')

  const stored = await readPracticeEntries(page)
  expect(stored).toHaveLength(2)
  expect(stored.every((e) => e.kind !== 'repertoire')).toBe(true)

  // Now knock out yesterday, leaving a gap immediately before today — the
  // "no activity breaks it" half. Today's own eartraining entry still counts
  // (a streak of exactly 1, not 0), since a streak counts backward from
  // today and stops at the first missing day.
  await setPracticeEntries(page, [entries[1]!])
  await page.reload()
  await nav(page, 'Progress').click()
  await expect(currentStreak).toHaveText('1 day')

  expect(errors).toEqual([])
})
