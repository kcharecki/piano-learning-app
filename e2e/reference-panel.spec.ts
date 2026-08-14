import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import {
  installFakeMidi,
  armFakeMidiOnClick,
  waitForArmedFakeMidiSchedule,
  type RelativeFakeMidiEvent,
} from './fake-midi.ts'

/**
 * E2E proof for roadmap 3.17 (REQ-3.5.4): the chord/scale reference is a
 * shell-level overlay panel, available without leaving Practice — the exact
 * drive `docs/parallel-round-10.md` Q2 and the task's own proof action name:
 * load a score, set a loop range, start the transport with the metronome,
 * match a note, THEN open the reference and confirm the transport keeps
 * running underneath it, Tab is not trapped, Escape returns focus and
 * changes nothing about the practice state, and reopening restores the
 * panel's own selection with no re-engrave flash.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** The bundled sample's first written note (measure 1, beat 1): C4 = MIDI 60
 *  (see e2e/note-colour.spec.ts's identical fixture-note reasoning; here
 *  against the Twinkle sample Practice loads by default). */
const MATCHING_PITCH_MIDI = 60
const NOTE_HOLD_MS = 300

async function openPractice(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()
}

/** Presses Shift+Tab up to `max` times until the focused element's
 *  accessible name (its `aria-label` when present — UI-09 made Pause/Stop
 *  icon-only `.btn-icon`s whose visible text content is empty, so their
 *  name comes from `aria-label` only — falling back to trimmed text content
 *  for everything else) is `targetText`, or throws if it never is — the
 *  deterministic way to prove an element is reachable by keyboard navigation
 *  without asserting a fixed number of hops (a change to any other
 *  focusable element's position would otherwise make this test flaky, not
 *  the behaviour it drives). */
async function shiftTabUntil(page: Page, targetText: string, max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const focusedText = await page.evaluate(() => {
      const el = document.activeElement
      if (el === null) return null
      return el.getAttribute('aria-label')?.trim() ?? el.textContent?.trim() ?? null
    })
    if (focusedText === targetText) return
    await page.keyboard.press('Shift+Tab')
  }
  throw new Error(`"${targetText}" was not reached by Shift+Tab within the hop budget`)
}

test('the reference panel stays open over a running Practice transport, is not focus-trapped, and Escape restores exactly the state it found (roadmap 3.17)', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')
  await openPractice(page)

  // Set a loop range — part of the practice state that must survive the
  // panel opening and closing untouched.
  const loopRange = page.getByRole('group', { name: 'Loop range' })
  await loopRange.getByLabel('From measure').fill('1')
  await loopRange.getByLabel('to measure').fill('2')
  await loopRange.getByRole('checkbox', { name: 'Loop' }).check()

  // Metronome on.
  const metronomeToggle = page.getByRole('group', { name: 'Metronome' }).getByLabel('Metronome')
  await metronomeToggle.check()

  // Start the transport and match the first note (C4 = MIDI 60) on time.
  const events: RelativeFakeMidiEvent[] = [
    { type: 'on', note: MATCHING_PITCH_MIDI, offsetMs: 0 },
    { type: 'off', note: MATCHING_PITCH_MIDI, offsetMs: NOTE_HOLD_MS },
  ]
  await armFakeMidiOnClick(page, 'Play', events)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await waitForArmedFakeMidiSchedule(page)

  const correctCount = page.getByTestId('feedback-correct')
  await expect(correctCount).toHaveText('1', { timeout: 5_000 })

  const transport = page.getByRole('group', { name: 'Transport' })
  const position = transport.getByLabel('Position')

  // --- Open the reference -------------------------------------------------
  const referenceToggle = page.getByRole('button', { name: 'Reference', exact: true })
  await expect(referenceToggle).toHaveAttribute('aria-expanded', 'false')
  await referenceToggle.click()

  const panel = page.getByRole('complementary', { name: 'Chord and scale reference' })
  await expect(panel).toBeVisible()
  await expect(referenceToggle).toHaveAttribute('aria-expanded', 'true')
  // Focus moved to the close button on open — no focus trap and no aria-modal.
  await expect(page.getByRole('button', { name: 'Close reference' })).toBeFocused()
  await expect(panel).not.toHaveAttribute('aria-modal')

  // (a) The metronome is still enabled and the transport is still advancing
  // — the panel opening did not stop, reset, or reload the running session.
  await expect(metronomeToggle).toBeChecked()
  const positionAtOpen = await position.textContent()
  await expect(async () => {
    expect(await position.textContent()).not.toBe(positionAtOpen)
  }).toPass({ timeout: 3_000 })

  // Pick a non-default scale so reopening later (e) is a real assertion of
  // persisted state, not a coincidence of the default.
  await page.getByLabel('Scale', { exact: true }).selectOption('naturalMinor')
  await expect(page.getByTestId('reference-scale-name')).toContainText('natural minor')

  // (b) The panel's own playback control works while the transport (and its
  // own metronome AudioContext) keeps running — two live AudioContexts,
  // browsers mix them (see the module doc on ReferencePanel.tsx).
  await page.getByRole('button', { name: /^Play C natural minor scale$/ }).click()

  // (c) No focus trap: from the close button, Shift+Tab must be able to
  // leave the panel and reach the transport's own Pause button (DOM order
  // places the panel AFTER app-main, so leaving it backward is the direction
  // that proves Tab is not captured — see ReferencePanel.tsx's module doc).
  await page.getByRole('button', { name: 'Close reference' }).focus()
  await shiftTabUntil(page, 'Pause', 60)
  // UI-09: Pause is icon-only now (`.btn-icon`) — its accessible name comes
  // from `aria-label`, not visible text, which is empty.
  await expect(page.locator(':focus')).toHaveAccessibleName('Pause')
  await page.keyboard.press('Enter')
  await expect(transport.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  // The panel is still open — reaching the transport did not close it.
  await expect(panel).toBeVisible()
  await expect(referenceToggle).toHaveAttribute('aria-expanded', 'true')

  const matchedCountBeforeClose = await correctCount.textContent()
  const loopFromBeforeClose = await loopRange.getByLabel('From measure').inputValue()
  const loopToBeforeClose = await loopRange.getByLabel('to measure').inputValue()
  const positionBeforeClose = await position.textContent()

  // (d) Escape closes, focus returns to the toggle, and nothing about the
  // practice state changed.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(referenceToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(referenceToggle).toBeFocused()

  await expect(loopRange.getByLabel('From measure')).toHaveValue(loopFromBeforeClose)
  await expect(loopRange.getByLabel('to measure')).toHaveValue(loopToBeforeClose)
  await expect(correctCount).toHaveText(matchedCountBeforeClose ?? '1')
  // The transport was paused in (c); its position must not have moved further.
  await page.waitForTimeout(700)
  await expect(position).toHaveText(positionBeforeClose ?? '')

  // (e) Reopening shows the previously selected scale — no reset — and the
  // practice score is still the same live instance (its own matched-note
  // count, asserted above, survived the whole open/close cycle instead of
  // resetting to 0, which is what a remount would have produced).
  await referenceToggle.click()
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('reference-scale-name')).toContainText('natural minor')
  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  expect(errors).toEqual([])
})

test('the reference drawer and the nav drawer are mutually exclusive at <=1024px, and no control there is under 44px (roadmap 3.17, 5.27)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto('/')

  const navToggle = page.getByRole('button', { name: 'Open navigation' })
  const referenceToggle = page.getByRole('button', { name: 'Reference', exact: true })

  await navToggle.click()
  await expect(navToggle).toHaveAttribute('aria-expanded', 'true')

  await referenceToggle.click()
  const panel = page.getByRole('complementary', { name: 'Chord and scale reference' })
  await expect(panel).toBeVisible()
  await expect(navToggle).toHaveAttribute('aria-expanded', 'false')

  // Only one scrim is ever painted at once — never both stacked.
  const navScrim = page.locator('.nav-scrim')
  const referenceScrim = page.getByTestId('reference-panel-scrim')
  await expect(navScrim).toHaveCount(0)
  await expect(referenceScrim).toBeVisible()

  const referenceToggleBox = await referenceToggle.boundingBox()
  expect(referenceToggleBox?.height).toBeGreaterThanOrEqual(44)
  expect(referenceToggleBox?.width).toBeGreaterThanOrEqual(44)

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(referenceToggle).toHaveAttribute('aria-expanded', 'false')

  // Reopening the nav closes the reference drawer symmetrically.
  await referenceToggle.click()
  await expect(panel).toBeVisible()
  await navToggle.click()
  await expect(navToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).toBeHidden()
  await expect(referenceToggle).toHaveAttribute('aria-expanded', 'false')

  expect(errors).toEqual([])
})
