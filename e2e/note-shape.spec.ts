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
import { openPracticeSetup } from './practice-setup.ts'

/**
 * E2E proof for roadmap 5.24 (REQ accessibility, `colors.css`'s own header
 * comment: "Color is NEVER the only signal"). `e2e/note-colour.spec.ts`
 * already proves a wrong pitch recolours the expected note; this spec proves
 * the SEPARATE, previously-missing half: that the note ALSO carries a
 * non-colour cue. Before roadmap 5.24, `.note-correct`/`.note-wrong`/
 * `.note-missed` existed in `domain.css` but nothing in the app ever applied
 * them (`grep -rn "note-wrong" src/app` returned nothing) — correct
 * (`#1c7c3c`) and wrong (`#c22f2c`) were distinguished by hue alone, the
 * worst possible pair for red-green colour vision deficiency (~8% of men).
 *
 * The whole point of asserting `stroke-dasharray` rather than colour: a
 * colour-only assertion would have passed against the PRE-fix code too (it
 * already coloured the note red), so it would prove nothing about this
 * defect. `stroke-dasharray` is a genuinely different signal, so this can
 * only pass once shape actually carries information colour used to carry
 * alone. The greyscale filter applied below is not needed to make the
 * property computable (a CSS filter does not touch `stroke-dasharray`) — it
 * is applied anyway so the whole flow is driven exactly as a colour-blind
 * learner would see it, and the assertion is taken from that view.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

/** How long the wrong note is held before release — mirrors note-colour.spec.ts. */
const NOTE_HOLD_MS = 400

/**
 * The fixture's first written note (measure 1, beat 1) is C4 = MIDI 60 (see
 * e2e/fixtures/assessment-six-bars.musicxml). MIDI 61 (C#4) is never written
 * anywhere in the fixture (natural pitches only), so playing it against the
 * expected C4 is unambiguously a wrong pitch — same setup as note-colour.spec.ts.
 */
const WRONG_PITCH_MIDI = 61

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

test('a wrong note carries a shape cue (stroke-dasharray), not colour alone, even under a simulated greyscale view (roadmap 5.24)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')

  // Simulate a colour-blind / achromatopsia view for the rest of the test —
  // every later query and assertion runs against this desaturated page, not
  // just the final read, so nothing here relies on hue being visible.
  await page.addStyleTag({ content: 'html { filter: grayscale(100%) !important; }' })

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  await importScore(page, FIXTURE_PATH, FIXTURE_TITLE)

  await expectMidiStatusText(page, new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`))

  await openPracticeSetup(page)
  const loopRangeSettle = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRangeSettle.getByLabel('to measure')).toHaveValue('6')
  await page.waitForTimeout(300)

  const scoreSvg = page.locator('[data-testid="score-container"] svg')
  await expect(scoreSvg).toBeVisible()

  // Nothing carries the wrong-note shape class before anything is played —
  // the same "absent beforehand, present afterwards" guard note-colour.spec.ts
  // uses, so this cannot pass against a score that already happened to have it.
  const wrongShapeNotes = scoreSvg.locator('.note-wrong')
  await expect(wrongShapeNotes).toHaveCount(0)

  const events: RelativeFakeMidiEvent[] = [
    { type: 'on', note: WRONG_PITCH_MIDI, offsetMs: 0 },
    { type: 'off', note: WRONG_PITCH_MIDI, offsetMs: NOTE_HOLD_MS },
  ]
  await armFakeMidiOnClick(page, 'Play', events)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await waitForArmedFakeMidiSchedule(page)

  // The class itself: exactly one notehead now carries `.note-wrong`.
  await expect(wrongShapeNotes).toHaveCount(1, { timeout: 5_000 })
  await expect(wrongShapeNotes).toHaveAttribute('class', /note-wrong/)

  // The non-colour cue: `stroke-dasharray` on that element computes to a
  // real dash pattern, not "none"/empty — read from the live greyscale view,
  // and off the element itself (getComputedStyle), not off a colour value.
  const dasharray = await wrongShapeNotes.evaluate((el) => getComputedStyle(el).strokeDasharray)
  expect(dasharray).not.toBe('')
  expect(dasharray).not.toBe('none')
  expect(dasharray).not.toBe('0px')

  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  expect(errors).toEqual([])
})
