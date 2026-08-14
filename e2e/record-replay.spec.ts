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

/**
 * E2E proof for roadmap 2.14 (REQ-3.9.2): record a short performance, replay
 * it with NO further MIDI input, and check the score colours the same notes
 * it coloured live. `feedback-correct` / `feedback-wrong-pitch` /
 * `feedback-missed` / `feedback-extra` come straight out of the same
 * `NoteMatcher` that colours the score (`src/app/practice/useNoteFeedback.ts`)
 * — so equal counters before and after a silent replay is the proof that
 * replay drove the SAME matcher through the SAME judging, not a re-render
 * with nothing behind it. See `e2e/assessment.spec.ts` for the harness this
 * reuses (fake MIDI keyboard, six-bar fixture) and its own module comment for
 * why e2e stays a thin smoke layer everywhere except here.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

/** 120bpm (the fixture's own tempo) — one quarter note is exactly this many ms. */
const QUARTER_MS = 500
/** How long each correctly-played note is held before release. */
const NOTE_HOLD_MS = 400

/**
 * Measure 1 of the fixture is C4 D4 E4 F4 (see
 * e2e/fixtures/assessment-six-bars.musicxml). The first three are played
 * correctly, on time; F4 (index 3) is deliberately never played, so it
 * becomes `missed` once its matching window closes — giving the live take
 * BOTH a nonzero correct count and a nonzero missed count, so neither side of
 * the comparison below could pass by being empty.
 */
const PLAYED_PITCHES: readonly number[] = [60, 62, 64] // C4 D4 E4

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/**
 * UI-09 (2026-08-12 UI audit): file import moved behind a "Change piece…"
 * button that opens a modal `<dialog>` — closes it again once the new
 * score's title is confirmed, so the rest of the screen is interactable.
 */
async function importScore(page: Page, fixturePath: string, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Change piece…' }).click()
  await page.getByLabel(/Import a score/i).setInputFiles(fixturePath)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('dialog', { name: 'Change piece' }).getByRole('button', { name: 'Close' }).click()
}

/**
 * UI-04b: the MIDI status line moved into the shell topbar's input-status
 * chip popover — open it, check the text, then Escape closes it again.
 */
async function expectMidiStatusText(page: Page, pattern: RegExp): Promise<void> {
  const chip = page.getByRole('button', { name: /MIDI connected|No MIDI/ })
  await chip.click()
  await expect(page.getByText(pattern)).toBeVisible()
  await page.keyboard.press('Escape')
}

type FeedbackCounts = {
  readonly correct: number
  readonly wrongPitch: number
  readonly missed: number
  readonly extra: number
}

async function readFeedback(page: Page): Promise<FeedbackCounts> {
  return {
    correct: Number(await page.getByTestId('feedback-correct').textContent()),
    wrongPitch: Number(await page.getByTestId('feedback-wrong-pitch').textContent()),
    missed: Number(await page.getByTestId('feedback-missed').textContent()),
    extra: Number(await page.getByTestId('feedback-extra').textContent()),
  }
}

test('record a live take, replay it with no further input, and the note feedback ends at the same counts (roadmap 2.14)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  // Must be installed before the first navigation — the app requests MIDI
  // access on mount.
  await installFakeMidi(page)
  await page.goto('/')

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  await importScore(page, FIXTURE_PATH, FIXTURE_TITLE)

  // The harness is live and the app adopted it as the connected device — same
  // settle-and-check as e2e/assessment.spec.ts.
  await expectMidiStatusText(page, new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`))
  const loopRangeSettle = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRangeSettle.getByLabel('to measure')).toHaveValue('6')
  await page.waitForTimeout(300)

  // UI-10: Replay/Stop replay share ONE toggle button whose accessible name
  // swaps in place (same shape as Record/Stop recording) — it is absent
  // entirely until a take exists, never merely disabled.
  const recordPanel = page.getByRole('group', { name: 'Record and replay' })
  const recordButton = recordPanel.getByRole('button', { name: 'Record', exact: true })
  const stopRecordingButton = recordPanel.getByRole('button', { name: 'Stop recording' })
  const replayButton = recordPanel.getByRole('button', { name: 'Replay', exact: true })
  const stopReplayButton = recordPanel.getByRole('button', { name: 'Stop replay' })

  await expect(recordButton).toBeEnabled()

  // Play C4, D4, E4 correctly, on time; F4 is deliberately skipped — see
  // PLAYED_PITCHES above. Anchor and schedule are armed together on the same
  // synchronous click turn (see armFakeMidiOnClick), exactly as
  // e2e/assessment.spec.ts does for "Start assessment".
  const events: RelativeFakeMidiEvent[] = []
  for (const [k, note] of PLAYED_PITCHES.entries()) {
    const onOffset = k * QUARTER_MS
    events.push({ type: 'on', note, offsetMs: onOffset })
    events.push({ type: 'off', note, offsetMs: onOffset + NOTE_HOLD_MS })
  }
  await armFakeMidiOnClick(page, 'Record', events)
  await recordButton.click()
  await waitForArmedFakeMidiSchedule(page)

  // F4 (measure 1, index 3) is due at 1500ms and its matching window
  // (±150ms, `MATCHER_DEFAULTS.toleranceMs`) closes at 1650ms — this margin
  // guarantees the transport's own frame pump has crossed that tick, so F4
  // has actually been judged `missed`, before Stop recording is pressed.
  await page.waitForTimeout(700)

  await stopRecordingButton.click()
  const liveCounts = await readFeedback(page)

  // Non-vacuous: some notes matched, one was missed — neither side of the
  // comparison below could pass by both reading zero.
  expect(liveCounts.correct).toBeGreaterThan(0)
  expect(liveCounts.missed).toBeGreaterThan(0)

  await expect(replayButton).toBeEnabled()
  await replayButton.click()
  await expect(stopReplayButton).toBeEnabled()

  // No further fake MIDI input at all from here — every note colour change
  // from here on must come from the recorder replaying its own capture.
  // Replay ends itself once every recorded event has been re-emitted (see
  // useRecorder.ts). UI-10 collapsed the old separate Stop replay button
  // into the SAME toggle as Replay, whose accessible name swaps back once
  // the phase leaves 'replaying' — it is never merely disabled, so the
  // transition to look for is "Stop replay" disappearing and "Replay"
  // (enabled) taking its place.
  await expect(stopReplayButton).toBeHidden({ timeout: 15_000 })
  await expect(replayButton).toBeEnabled()

  const replayedCounts = await readFeedback(page)
  expect(replayedCounts).toEqual(liveCounts)

  expect(errors).toEqual([])
})
