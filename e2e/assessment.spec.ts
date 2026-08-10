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
 * E2E proof for roadmap 2.11 (REQ-3.3.4/3.3.5): an assessment run driven end
 * to end through a fake MIDI keyboard — start it, play part of the piece,
 * let it finish, and check the review overlay's problem-measure list and its
 * one-click loop button both do real work, not just render.
 *
 * See `docs/ARCHITECTURE.md` / `e2e/smoke.spec.ts` for why e2e here stays a
 * thin smoke layer — this is the one exception the roadmap calls for because
 * an assessment run has never once been driven for real (see the roadmap
 * task and its own comment on the app having no MIDI simulation at all).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

/** 120bpm (the fixture's own tempo) — one quarter note is exactly this many ms. */
const QUARTER_MS = 500
/** How long each correctly-played note is held before release. */
const NOTE_HOLD_MS = 400

/**
 * The fixture's own pitches for measures 1-3 (see
 * e2e/fixtures/assessment-six-bars.musicxml), in written order — what gets
 * played correctly. Measures 4-6 are deliberately never played at all.
 */
const CORRECT_PITCHES: readonly number[] = [
  60, 62, 64, 65, // measure 1: C4 D4 E4 F4
  67, 69, 71, 72, // measure 2: G4 A4 B4 C5
  60, 64, 67, 71, // measure 3: C4 E4 G4 B4
]

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('assessment run driven end to end: play it, review lists problem measures, one-click loop sets the range (roadmap 2.11)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  // Must be installed before the first navigation — the app requests MIDI
  // access on mount.
  await installFakeMidi(page)
  await page.goto('/')
  // Roadmap 5.17 gates "Start assessment" behind the `playing` track's level
  // — a fresh app starts every track at level 1.
  await seedPlayingLevel(page, 3)
  await page.reload()

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  // Import the six-bar fixture through the real file input, and wait for the
  // score title to reflect it — the direct, reliable proof the new score
  // (not the bundled Twinkle sample) is what is now loaded.
  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  // The harness is live and the app adopted it as the connected device —
  // proves the fake isn't just installed but actually wired through
  // useMidiConnection's auto-select.
  await expect(
    page.getByText(new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`)),
  ).toBeVisible()

  // Settle point: only the newly-imported 6-bar fixture clamps "to measure"
  // to 6 (LoopRangeControl clamps endMeasure to the score's lastMeasure), so
  // this proves ScoreViewer's async `engraver.load(...)` for the NEW score
  // has actually finished, not just that the store updated. A short
  // additional wait absorbs whatever main-thread work OSMD does right after
  // that value is set, before the anchor below is taken.
  const loopRangeSettle = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRangeSettle.getByLabel('to measure')).toHaveValue('6')
  await page.waitForTimeout(300)

  // "Start assessment" lives behind the collapsed "More tools" disclosure
  // (roadmap 5.17) — open it before reaching for the button inside.
  await page.getByText('More tools').click()

  // Play measures 1-3 correctly; say nothing for measures 4-6 (indices 3-5) —
  // their notes close as `missed` when the transport plays off the end and
  // `finalizeRun` closes every still-open matcher window.
  //
  // The anchor and the schedule are armed together, in the page, on the SAME
  // synchronous click turn (see armFakeMidiOnClick) — there is no Node<->CDP
  // round trip between taking the anchor and installing event k=0, so it
  // cannot already be in the past when it fires.
  const events: RelativeFakeMidiEvent[] = []
  for (const [k, note] of CORRECT_PITCHES.entries()) {
    const onOffset = k * QUARTER_MS
    events.push({ type: 'on', note, offsetMs: onOffset })
    events.push({ type: 'off', note, offsetMs: onOffset + NOTE_HOLD_MS })
  }
  await armFakeMidiOnClick(page, 'Start assessment', events)
  await page.getByRole('button', { name: 'Start assessment' }).click()
  await waitForArmedFakeMidiSchedule(page)

  // The run lasts exactly 6 measures * 4 beats * 500ms = 12s from the anchor;
  // the review overlay only renders once `useAssessment`'s phase reaches
  // 'complete', which only happens when the transport plays off the end.
  const accuracy = page.getByTestId('assessment-accuracy')
  await expect(accuracy).toBeVisible({ timeout: 20_000 })

  // Some notes matched (measures 1-3), some were missed (measures 4-6): a run
  // that never received MIDI would read 0%, one that was never driven at all
  // would never reach 'complete' and this element would not exist.
  const accuracyValue = Number((await accuracy.textContent())?.replace('%', ''))
  expect(accuracyValue).toBeGreaterThan(0)
  expect(accuracyValue).toBeLessThan(100)

  // Per-measure breakdown really rendered: one row per one of the fixture's
  // six measures, not a placeholder.
  await expect(page.locator('.assessment-result tbody tr')).toHaveCount(6)

  const review = page.getByRole('group', { name: 'Review' })
  const problems = review.getByRole('list', { name: 'Problem measures' })
  // `measureIndex` is 0-based (`core/notation/score.ts`), but `ReviewOverlay`
  // prints `measureIndex + 1` (see that component's own module comment) —
  // everything a human reads is 1-based. So the last three measures
  // (0-based indices 3-5) read "Measure 4/5/6", and the first measure
  // (0-based index 0) reads "Measure 1" and must be ABSENT — it was played
  // correctly.
  await expect(problems).toContainText('Measure 4')
  await expect(problems).toContainText('Measure 5')
  await expect(problems).toContainText('Measure 6')
  await expect(problems).not.toContainText('Measure 1')

  const loops = review.getByRole('list', { name: 'Suggested loops' })
  const loopButton = loops.getByRole('button')
  await expect(loopButton).toHaveCount(1)
  // Deterministic, not just bounded: contextBars (default 1) pads the
  // problem measures [3,4,5] to [2,4], which merges with 4 and 5 (adjacent
  // problem measures) into one group {start:2, end:5} (0-based) — the
  // review.ts merge rule `start <= open.end + 1`, end clamped to the
  // fixture's lastIndex 5. The label is "Practice measures {start+1}–{end+1}"
  // — 1-based to match the printed score, an EN DASH, not a hyphen.
  await expect(loopButton).toHaveText('Practice measures 3–6')
  const startMeasureIndex = 2
  const endMeasureIndex = 5

  const loopRange = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRange.getByLabel('From measure')).toHaveValue('1')

  await loopButton.click()

  // This is the assertion the whole test exists for: the one-click loop must
  // actually set the transport's loop, not just render a button.
  await expect(loopRange.getByRole('checkbox', { name: 'Loop' })).toBeChecked()
  await expect(loopRange.getByLabel('From measure')).not.toHaveValue('1')
  await expect(loopRange.getByLabel('From measure')).toHaveValue(String(startMeasureIndex + 1))
  await expect(loopRange.getByLabel('to measure')).toHaveValue(String(endMeasureIndex + 1))

  // roadmap 2.11a: the one-click loop must START at its first measure, not
  // merely end up there after a wrap. `practiceLoop` used to set the loop
  // through React state and call `play()` in the same handler, so the
  // transport played on from wherever the playhead sat — measure 1 — until the
  // loop end wrapped it. `playLoop` sets the loop and seeks to its start
  // atomically on the transport instance, so the playhead is inside the looped
  // bars on the very first beat. Sampling repeatedly (rather than once) is what
  // makes this catch the old behaviour: a single late read would find the
  // position inside the loop either way.
  const position = page.getByRole('group', { name: 'Transport' }).getByLabel('Position')
  const sampled: number[] = []
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const measure = /Measure (\d+)/.exec((await position.textContent()) ?? '')?.[1]
    if (measure !== undefined) sampled.push(Number(measure))
    await page.waitForTimeout(50)
  }
  expect(sampled.length).toBeGreaterThan(5)
  expect(Math.min(...sampled)).toBeGreaterThanOrEqual(startMeasureIndex + 1)
  expect(Math.max(...sampled)).toBeLessThanOrEqual(endMeasureIndex + 1)

  expect(errors).toEqual([])
})
