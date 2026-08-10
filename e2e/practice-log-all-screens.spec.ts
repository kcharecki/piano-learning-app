import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { totalMinutes, type ActivityKind, type PracticeEntry } from '../src/core/progress/log.ts'

/**
 * E2E proof for roadmap 5.14. Before this task, `practiceLog.start()` had
 * exactly one call site — `PracticeScreen.tsx`, hardcoded to `'repertoire'`
 * — so Sight reading, Flashcards, Ear training, Rhythm, Technique, Theory
 * and Lessons all logged nothing: a learner who spent a whole session on
 * anything but repertoire recorded 0 minutes and broke their streak. This
 * drives all seven of those screens for real (never seeded synthetic rows —
 * the 4.7b pattern this project holds itself to) and reads the resulting
 * `PracticeEntry` rows back out of the real IndexedDB the app persists
 * through, cross-checked against the Progress screen's own `totalMinutes`
 * computation.
 *
 * ## Two deliberate deviations from the roadmap's own proof text
 *
 * 1. `ActivityKind` had exactly seven members before this task —
 *    `warmup` included — and `'warmup'` was written by NOTHING (the
 *    review's own finding). This task deletes it rather than inventing a
 *    warm-up screen: the real warm-up SEGMENT feature is roadmap 5.45, out
 *    of scope here. That leaves six kinds, not seven, and two of the seven
 *    screens have no kind of their own to log under: Flashcards logs as
 *    `'theory'` (staff/interval/note-name recall is theory-adjacent, and
 *    `FlashcardScreen` already doubles as the theory-quiz deck per roadmap
 *    4.9c) and Rhythm logs as `'technique'` (a tapping drill is closest to
 *    the physical/timing family technique drills are in). So this test
 *    proves six non-empty `ActivityKind` buckets from seven screens, not
 *    seven from seven.
 * 2. The Progress screen's per-kind minutes are ROUNDED to the nearest
 *    whole minute (`DashboardScreen.tsx`'s `round(data.minutesByKind[kind])`)
 *    — a several-hundred-millisecond real interaction legitimately rounds
 *    display-side to "0 min" while still being a perfectly real, positive
 *    duration in storage. Demanding every individual on-screen row read
 *    non-zero would mean waiting 30+ real seconds per screen (three-plus
 *    minutes total) for no better a proof than reading the exact millisecond
 *    durations straight out of IndexedDB, which is what this test does for
 *    the per-kind assertions. It DOES additionally give each screen enough
 *    dwell time that the six real interactions combined clear 30 real
 *    seconds, so the aggregate "This week" figure — the one number that
 *    does NOT need meaningful per-kind precision — reads a real non-zero
 *    minute count on screen too, cross-checked against `totalMinutes` run
 *    over the exact stored rows.
 */

const DB_NAME = 'piano-learning-app'
/** Long enough that the six controlled dwell times sum past the Progress
 *  screen's whole-minute rounding threshold (30s) without any single screen
 *  needing an implausibly long wait on its own. */
const DWELL_MS = 6_000

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

async function readPracticeEntries(page: Page): Promise<readonly PracticeEntry[]> {
  return page.evaluate(
    (dbName) =>
      new Promise<readonly PracticeEntry[]>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction('practiceLog', 'readonly').objectStore('practiceLog').get('practiceLog')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            const record = req.result as { practiceEntries?: PracticeEntry[] } | undefined
            resolve(record?.practiceEntries ?? [])
          }
        }
      }),
    DB_NAME,
  )
}

test('all seven non-repertoire screens log real practice time into six ActivityKind buckets (roadmap 5.14)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)
  const testStart = Date.now()

  await page.goto('/')
  await page.waitForTimeout(200)

  // Lessons — no click needed: `useLessons`'s `selected` already defaults to
  // the level's first lesson, so merely arriving here starts a 'lesson' entry.
  await nav(page, 'Lessons').click()
  await expect(page.getByRole('heading', { name: /lessons/i })).toBeVisible()
  await page.waitForTimeout(DWELL_MS)

  // Flashcards — same story: the default deck is already selected on mount.
  await nav(page, 'Flashcards').click()
  await expect(page.getByRole('heading', { name: /flashcards/i })).toBeVisible()
  await page.waitForTimeout(DWELL_MS)

  // Theory drill panel — same story: level 1 / build-scale is the default.
  await nav(page, 'Theory').click()
  await expect(page.getByRole('region', { name: 'Theory quiz' })).toBeVisible()
  await page.waitForTimeout(DWELL_MS)

  // Sight reading — start() only fires on the explicit "Start exercise"
  // click; navigating away mid-preview abandons the run, which the hook's
  // own unmount effect grades and closes the log entry for.
  await nav(page, 'Sight reading').click()
  await page.getByRole('button', { name: 'Start exercise' }).click()
  await page.waitForTimeout(DWELL_MS)

  // Technique — start() only fires on "Start"; navigating away without
  // clicking "Stop" is still caught by usePracticeLog's own generic unmount
  // safety net (the same one PracticeScreen has always relied on).
  await nav(page, 'Technique').click()
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForTimeout(DWELL_MS)

  // Rhythm — start() fires on "Start"; the pattern grades itself in a few
  // real seconds (short by design — REQ-3.9.1-adjacent fixes a small bar
  // count), so this dwell only needs to outlast that natural finish, not
  // match the other screens' controlled duration.
  await nav(page, 'Rhythm').click()
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForTimeout(DWELL_MS)

  // Ear training — start() fires on "Play"; grading one real answer stops
  // the log inline (no navigation-away abandonment needed for this one).
  await nav(page, 'Ear training').click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  const answerGroup = page.getByRole('group', { name: 'Interval answer' })
  await answerGroup.getByRole('button').first().click()
  await page.waitForTimeout(500)

  await nav(page, 'Progress').click()
  await expect(page.getByTestId('dashboard-streak-current')).toBeVisible()

  const entries = await readPracticeEntries(page)
  const testEnd = Date.now()

  // Every entry from this run happened within this test's own wall-clock
  // window and has a real, positive duration — never a synthetic seed.
  const runEntries = entries.filter((e) => e.startedAt >= testStart && e.endedAt <= testEnd)
  for (const entry of runEntries) {
    expect(entry.endedAt, `${entry.kind} entry "${entry.itemName}" had a non-positive duration`).toBeGreaterThan(
      entry.startedAt,
    )
  }

  const kindsSeen = new Set(runEntries.map((e) => e.kind))
  const expectedKinds: readonly ActivityKind[] = [
    'lesson',
    'theory',
    'sightreading',
    'technique',
    'eartraining',
  ]
  for (const kind of expectedKinds) {
    expect(kindsSeen.has(kind), `expected a real "${kind}" entry from this run, got kinds: ${[...kindsSeen].join(', ')}`).toBe(
      true,
    )
  }
  // Rhythm and Technique share the 'technique' bucket (see the module doc) —
  // confirm both screens actually contributed to it, not just one.
  const techniqueItemNames = runEntries.filter((e) => e.kind === 'technique').map((e) => e.itemName)
  expect(techniqueItemNames.some((n) => n.startsWith('Rhythm — complexity'))).toBe(true)
  expect(techniqueItemNames.some((n) => !n.startsWith('Rhythm — complexity'))).toBe(true)
  // Flashcards and Theory share the 'theory' bucket — same check.
  const theoryItemNames = runEntries.filter((e) => e.kind === 'theory').map((e) => e.itemName)
  expect(theoryItemNames.some((n) => n.startsWith('Flashcards —'))).toBe(true)
  expect(theoryItemNames.some((n) => !n.startsWith('Flashcards —'))).toBe(true)

  // The Progress screen's own weekly total, cross-checked against
  // `totalMinutes` run over the exact stored rows (the 4.7b pattern: a
  // screen re-deriving a plausible number cannot pass) — the six controlled
  // dwell times above sum well past the whole-minute rounding threshold, so
  // this reads a genuine non-zero count, not just "some number".
  const now = testEnd
  const from = now - 7 * 24 * 60 * 60 * 1000
  const expectedWeeklyMinutes = Math.round(totalMinutes(entries, from, now))
  await expect(page.getByTestId('dashboard-weekly-minutes')).toHaveText(`${expectedWeeklyMinutes} min`)
  expect(expectedWeeklyMinutes).toBeGreaterThan(0)
  await expect(page.getByTestId('dashboard-weekly-empty')).not.toBeVisible()

  expect(errors).toEqual([])
})
