import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { installFakeMidi, FAKE_MIDI_DEVICE_NAME } from './fake-midi.ts'

/**
 * E2E proof for REQ-3.3.4 (M2 acceptance audit): while an assessment run is
 * in progress, every control that could invalidate its fixed-tempo anchor
 * arithmetic — tempo, loop range, and the Pause/Stop transport buttons —
 * must be visibly DISABLED, not merely wired to a handler that silently does
 * nothing. See PracticeScreen.tsx's `assessmentRunning` wiring, TempoControl,
 * TransportControls and the `<fieldset disabled>` wrapper around
 * LoopRangeControl.
 *
 * Modelled closely on e2e/assessment.spec.ts's setup (fake MIDI harness,
 * fixture import, settle point) — this spec sends no MIDI at all: the fixed
 * six-bar/120bpm fixture finishes a run in exactly 12s purely by the
 * transport playing off the end (every note simply closes as `missed`),
 * which is all this spec needs to observe the run start and finish.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('tempo, loop range and Pause/Stop are disabled while an assessment runs, and re-enabled once it finishes (REQ-3.3.4)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  // Must be installed before the first navigation — the app requests MIDI
  // access on mount. Not actually driven with any events here (see the
  // module comment above), but the app still probes for a device on mount,
  // and installing it keeps this spec's setup identical to assessment.spec.ts.
  await installFakeMidi(page)
  await page.goto('/')

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  await expect(
    page.getByText(new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`)),
  ).toBeVisible()

  // Settle point: only the newly-imported 6-bar fixture clamps "to measure"
  // to 6 (LoopRangeControl clamps endMeasure to the score's lastMeasure), so
  // this proves ScoreViewer's async `engraver.load(...)` for the NEW score
  // has actually finished, not just that the store updated.
  const loopRange = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRange.getByLabel('to measure')).toHaveValue('6')
  await page.waitForTimeout(300)

  const tempoSlider = page.getByLabel('Tempo')
  const fromMeasure = loopRange.getByLabel('From measure')
  const toMeasure = loopRange.getByLabel('to measure')
  const transport = page.getByRole('group', { name: 'Transport' })
  const pauseButton = transport.getByRole('button', { name: 'Pause' })
  const stopButton = transport.getByRole('button', { name: 'Stop' })

  // Not running yet: every control this spec cares about is enabled.
  await expect(tempoSlider).toBeEnabled()
  await expect(fromMeasure).toBeEnabled()
  await expect(toMeasure).toBeEnabled()

  await page.getByRole('button', { name: 'Start assessment' }).click()
  await expect(page.getByText(/assessment running/i)).toBeVisible()

  // While running: the fix under test. All disabled, not just unresponsive —
  // `toBeDisabled` checks the real `disabled` attribute the browser honours.
  await expect(tempoSlider).toBeDisabled()
  await expect(fromMeasure).toBeDisabled()
  await expect(toMeasure).toBeDisabled()
  await expect(pauseButton).toBeDisabled()
  await expect(stopButton).toBeDisabled()

  // Let the run finish for real: 6 measures * 4 beats * 500ms = 12s from the
  // start, at which point the transport plays off the end and `useAssessment`
  // reaches 'complete' — the review panel only renders once that happens.
  const accuracy = page.getByTestId('assessment-accuracy')
  await expect(accuracy).toBeVisible({ timeout: 20_000 })

  // No MIDI was ever sent, so every note closed as missed — a real,
  // non-degenerate 0% run, not a stuck one (a run that never reached
  // 'complete' would never render this element at all).
  await expect(accuracy).toHaveText('0%')

  // Finished: every control is enabled again, proving none of them are stuck
  // — the whole point of REQ-3.3.4's "no pausing/stopping" being enforced via
  // `disabled`, not a silent no-op, is that it must release control back once
  // the run legitimately ends.
  await expect(tempoSlider).toBeEnabled()
  await expect(fromMeasure).toBeEnabled()
  await expect(toMeasure).toBeEnabled()

  expect(errors).toEqual([])
})
