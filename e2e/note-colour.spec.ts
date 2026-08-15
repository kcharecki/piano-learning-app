import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  installFakeMidi,
  armFakeMidiOnClick,
  waitForArmedFakeMidiSchedule,
  FAKE_MIDI_DEVICE_NAME,
  type RelativeFakeMidiEvent,
} from './fake-midi.ts'
import { openPracticeSetup } from './practice-setup.ts'

/**
 * E2E proof for roadmap 2.22 (REQ-3.3.2): note colouring has never once been
 * proven end to end — no e2e ever asserted a notehead colour, so a
 * completely inert `setNoteColor` (or a broken id mapping — see
 * `osmdEngraver.test.ts`'s "leaves a measure with a mismatched note count
 * UNMAPPED" case) could ship unnoticed. This drives the six-bar fixture
 * through the same fake-MIDI harness as `e2e/assessment.spec.ts`, plays ONE
 * wrong pitch against the first written note, and asserts a `fill` attribute
 * matching the app's own "wrong pitch" colour appears inside the score's SVG
 * — absent beforehand, present afterwards, so this cannot pass against a
 * score that already happened to use that colour.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

/** How long the wrong note is held before release — mirrors assessment.spec.ts's NOTE_HOLD_MS. */
const NOTE_HOLD_MS = 400

/**
 * The fixture's first written note (measure 1, beat 1) is C4 = MIDI 60 (see
 * e2e/fixtures/assessment-six-bars.musicxml). MIDI 61 (C#4) is never written
 * anywhere in the fixture (natural pitches only, no accidentals — see that
 * file's own comment), so playing it against the expected C4 is unambiguously
 * a wrong pitch, not a coincidental match to some other expected note.
 */
const WRONG_PITCH_MIDI = 61

/**
 * Reads `WRONG_PITCH_COLOR` straight out of `useNoteFeedback.ts`'s source text
 * — the colour `colorForVerdict` hands `setNoteColor` for a `wrongPitch`
 * verdict — rather than hardcoding a hex guessed from reading the file once.
 * A plain text scrape (not an import): the module pulls in React hooks and
 * core practice/timing modules that have no reason to run under Node here.
 */
function readWrongPitchColorFromSource(): string {
  const sourcePath = path.join(__dirname, '..', 'src', 'app', 'practice', 'useNoteFeedback.ts')
  const source = readFileSync(sourcePath, 'utf8')
  const match = /const WRONG_PITCH_COLOR = '(#[0-9a-fA-F]{3,8})'/.exec(source)
  if (match?.[1] === undefined) {
    throw new Error("could not find WRONG_PITCH_COLOR in useNoteFeedback.ts's source")
  }
  return match[1]
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

test('playing a wrong pitch colours the expected note the wrong-pitch colour (roadmap 2.22)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  const wrongPitchColor = readWrongPitchColorFromSource()

  // Must be installed before the first navigation — the app requests MIDI
  // access on mount.
  await installFakeMidi(page)
  await page.goto('/')

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  // Import the six-bar fixture through the real file input (behind the
  // "Change piece…" dialog, UI-09), and wait for the score title to reflect
  // it — the direct, reliable proof the new score (not the bundled Twinkle
  // sample) is what is now loaded.
  await importScore(page, FIXTURE_PATH, FIXTURE_TITLE)

  // The harness is live and the app adopted it as the connected device —
  // proves the fake isn't just installed but actually wired through
  // useMidiConnection's auto-select. UI-04b: this now lives behind the
  // topbar's input-status chip, not in the screen's own content flow.
  await expectMidiStatusText(page, new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`))

  // Settle point: only the newly-imported 6-bar fixture clamps "to measure"
  // to 6 (LoopRangeControl clamps endMeasure to the score's lastMeasure), so
  // this proves ScoreViewer's async `engraver.load(...)` for the NEW score
  // has actually finished, not just that the store updated. A short
  // additional wait absorbs whatever main-thread work OSMD does right after
  // that value is set, before the anchor below is taken.
  await openPracticeSetup(page)
  const loopRangeSettle = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRangeSettle.getByLabel('to measure')).toHaveValue('6')
  await page.waitForTimeout(300)

  const scoreSvg = page.locator('[data-testid="score-container"] svg')
  await expect(scoreSvg).toBeVisible()
  const wrongColorNotes = scoreSvg.locator(`[fill="${wrongPitchColor}"]`)

  // Before anything is played, nothing in the score is coloured the
  // "wrong pitch" colour — this is what stops the later assertion from
  // passing against a score that was already that colour for some
  // unrelated reason (e.g. a colour constant collision).
  await expect(wrongColorNotes).toHaveCount(0)

  // Play ONE wrong pitch (MIDI 61) against the first written note
  // (measure 1, beat 1: C4 = MIDI 60, at transport tick 0) — armed on the
  // SAME synchronous click turn as "Play" (see armFakeMidiOnClick), so the
  // anchor cannot already be stale by the time the event fires at offset 0.
  const events: RelativeFakeMidiEvent[] = [
    { type: 'on', note: WRONG_PITCH_MIDI, offsetMs: 0 },
    { type: 'off', note: WRONG_PITCH_MIDI, offsetMs: NOTE_HOLD_MS },
  ]
  await armFakeMidiOnClick(page, 'Play', events)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await waitForArmedFakeMidiSchedule(page)

  // The matcher judges the press, `useNoteFeedback` colours the expected
  // note's id `wrongPitch`, and the batched render (roadmap 2.21) flushes on
  // the next animation frame — this is the assertion the whole test exists
  // for: a real notehead in the real SVG actually changed colour.
  await expect(wrongColorNotes).toHaveCount(1, { timeout: 5_000 })

  // Stop the transport so the run doesn't keep playing past the end of the
  // fixture for the rest of the test's lifetime.
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  // Sanity-check on the constant itself: never green/amber (the correct/
  // missed colours) and never the score's default ink — otherwise this test
  // could pass for the wrong reason.
  expect(wrongPitchColor).not.toBe('#4caf50')
  expect(wrongPitchColor).not.toBe('#ffb300')
  expect(wrongPitchColor).not.toBe('#e8e6e3')

  expect(errors).toEqual([])
})
