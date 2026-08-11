import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  installFakeMidi,
  armFakeMidiOnClick,
  waitForArmedFakeMidiSchedule,
  FAKE_MIDI_DEVICE_NAME,
  type RelativeFakeMidiEvent,
} from './fake-midi.ts'
import { seedPlayingLevel } from './seedLevel.ts'

/**
 * E2E proof for roadmap 4.7c (REQ-3.3.4/REQ-3.10.1): a repertoire assessment
 * run through `AssessmentPanel` writes `useProgressStore.assessments`
 * (roadmap 2.24), but until this task nothing on the dashboard ever read
 * that store — the "Sight-reading accuracy trend" section reads
 * `useSightReadingStore.history` instead, a completely separate source that
 * only generated sight-reading EXERCISE runs write (see
 * e2e/dashboard-populated.spec.ts's own contract-gap note, which this spec
 * closes).
 *
 * This drives an assessment through the real UI (reusing e2e/assessment.spec.ts's
 * fake-MIDI flow so the run lands on 9/24 = 37.5% -> rounds to 38%, an
 * asymmetric figure a dashboard hardcoding a round constant like 50% could
 * not accidentally satisfy),
 * reloads the page so the only route to what is displayed is IndexedDB
 * restoration, then reads the assessment's own accuracy off the Progress
 * screen's new "Assessment accuracy" section and cross-checks it against the
 * exact `AssessmentResult.accuracy` persisted under `COLLECTIONS.progress`
 * (`'progress'`) / `PROGRESS_KEY` (`'assessments'`) — see
 * `src/app/state/persistence.ts`. A screen re-deriving a plausible number
 * from memory, or one rendering a fixed placeholder, cannot pass this.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

const DB_NAME = 'piano-learning-app'

/** 120bpm (the fixture's own tempo) — one quarter note is exactly this many ms. */
const QUARTER_MS = 500
/** How long each correctly-played note is held before release. */
const NOTE_HOLD_MS = 400

/**
 * The fixture's own pitches for measure 1, measure 2, and one note of
 * measure 3 only (see e2e/fixtures/assessment-six-bars.musicxml and
 * e2e/assessment.spec.ts) — the remaining 15 of the fixture's 24 notes are
 * deliberately never played, so the run finalises at exactly 9/24 = 37.5%,
 * rounding to 38% — not a round number like 50% that a constant-rendering
 * dashboard could accidentally satisfy.
 */
const CORRECT_PITCHES: readonly number[] = [
  60, 62, 64, 65, // measure 1: C4 D4 E4 F4
  67, 69, 71, 72, // measure 2: G4 A4 B4 C5
  60, // measure 3, first note: C4
]

type PersistedAssessment = {
  readonly scoreId: string
  readonly scoreTitle: string
  readonly at: number
  readonly result: { readonly accuracy: number }
}

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
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

test('a repertoire assessment run through the UI is surfaced on the dashboard after reload, matching what IndexedDB actually holds (roadmap 4.7c)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  // Must be installed before the first navigation — the app requests MIDI
  // access on mount.
  await installFakeMidi(page)
  await page.goto('/')
  // Roadmap 5.17 gates "Start assessment" behind the `playing` track's level
  // — a fresh app starts every track at level 1. Seeded once, it survives
  // this test's own later reload the same way the real assessment result does.
  await seedPlayingLevel(page, 3)
  await page.reload()
  await nav(page, 'Practice').click()

  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  await expect(
    page.getByText(new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`)),
  ).toBeVisible()

  // Settle point (see e2e/assessment.spec.ts): only the newly-imported 6-bar
  // fixture clamps "to measure" to 6, proving the async score load finished.
  const loopRangeSettle = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRangeSettle.getByLabel('to measure')).toHaveValue('6')
  await page.waitForTimeout(300)

  // "Start assessment" lives behind the collapsed "More tools" disclosure
  // (roadmap 5.17) — open it before reaching for the button inside.
  await page.getByText('More tools').click()

  // Play measures 1-3 correctly; say nothing for measures 4-6, so the run
  // finalises strictly between 0% and 100% (see e2e/assessment.spec.ts).
  const events: RelativeFakeMidiEvent[] = []
  for (const [k, note] of CORRECT_PITCHES.entries()) {
    const onOffset = k * QUARTER_MS
    events.push({ type: 'on', note, offsetMs: onOffset })
    events.push({ type: 'off', note, offsetMs: onOffset + NOTE_HOLD_MS })
  }
  await armFakeMidiOnClick(page, 'Start assessment', events)
  await page.getByRole('button', { name: 'Start assessment' }).click()
  await waitForArmedFakeMidiSchedule(page)

  const accuracy = page.getByTestId('assessment-accuracy')
  await expect(accuracy).toBeVisible({ timeout: 20_000 })
  const accuracyValue = Number((await accuracy.textContent())?.replace('%', ''))
  expect(accuracyValue).toBeGreaterThan(0)
  expect(accuracyValue).toBeLessThan(100)

  // Reload: the only way anything below can be on screen afterward is
  // IndexedDB restoration, not in-memory state carried over from the run.
  await page.reload()
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  // The empty state must be gone — proves the new section's chart/readout
  // branch is actually taken, not just present in the DOM unconditionally.
  await expect(page.getByTestId('dashboard-assessment-empty')).toHaveCount(0, { timeout: 10_000 })

  // Read the persisted record straight out of IndexedDB — `COLLECTIONS.progress`
  // (`'progress'`) / `PROGRESS_KEY` (`'assessments'`), see
  // src/app/state/persistence.ts — rather than trusting the screen to
  // redisplay a number it may have recomputed or hardcoded.
  const progress = (await readStored(page, 'progress', 'assessments')) as
    | { readonly assessments?: readonly PersistedAssessment[] }
    | undefined
  const stored = progress?.assessments ?? []
  expect(stored.length, 'no assessment was persisted').toBeGreaterThan(0)
  // Newest first (useProgressStore.addAssessment prepends) — the run just
  // driven above is at index 0.
  const latest = stored[0]
  expect(latest, 'no assessment record at index 0').toBeDefined()
  const scoreId = latest?.scoreId ?? ''
  const scoreTitle = latest?.scoreTitle ?? ''
  const storedAccuracy = latest?.result.accuracy
  expect(typeof storedAccuracy).toBe('number')
  // The panel's own run-time readout and the persisted record must agree —
  // both describe the same run.
  expect(Math.round((storedAccuracy ?? 0) * 100)).toBe(accuracyValue)

  const bestEl = page.getByTestId(`dashboard-assessment-best-${scoreId}`)
  await expect(bestEl).toBeVisible()
  const expectedPercent = Math.round((storedAccuracy ?? 0) * 100)
  await expect(bestEl).toHaveText(`${scoreTitle}: ${expectedPercent}%`)

  // Cross-check the chart's own point label too, the same way
  // e2e/dashboard-populated.spec.ts does for the sight-reading trend. Scoped
  // to the assessment section specifically — the sight-reading chart uses
  // the identical `<title> run N` label scheme, so an unscoped page-global
  // locator would pass even if the assessment chart rendered nothing.
  const chartTitles = await page
    .getByRole('region', { name: 'Assessment accuracy' })
    .locator('circle title')
    .allTextContents()
  expect(chartTitles).toContain(`${scoreTitle} run 1: ${expectedPercent}%`)

  expect(errors).toEqual([])
})
