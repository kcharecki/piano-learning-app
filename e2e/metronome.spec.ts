import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 2.28 (REQ-3.9.1): a standalone metronome that runs
 * with NO score loaded. Absolute BPM, time signature and accents were
 * configurable nowhere in the app, and the metronome could not run at all
 * without a score — so it was unusable for scales and technique, which is most
 * of what a metronome is for.
 *
 * The click GAPS and accent flags are asserted exactly, against a recording
 * audio output and a fake clock, in `src/app/metronome/useMetronome.test.ts`
 * (7/8 at 100bpm with accents on 1 and 4 — the requirement's own worked
 * example). What only a real browser can prove is what this asserts: the
 * screen is reachable through the shell's own nav, and a real
 * `requestAnimationFrame` loop against a real clock actually advances it.
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

test('the standalone metronome runs with no score and advances in real time (roadmap 2.28)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Metronome', exact: true })
    .click()

  await expect(page.getByRole('heading', { name: 'Metronome' })).toBeVisible()

  const readout = page.getByTestId('metronome-beat-readout')
  await expect(readout).toHaveText('Stopped')

  // 7/8 at 100bpm with an accent on beat 4 as well as beat 1 — the metre and
  // the accent pattern the requirement's own example asks for, neither of
  // which was expressible anywhere in this app before.
  //
  // Roadmap UI-16: there is no longer a single "Tempo and metre" group; BPM
  // lives in its own stage card while Beats/Beat unit moved into the "Meter"
  // region alongside Subdivision/Accents. `useMetronome.ts`'s own DEFAULT_BPM
  // is already 100 — exactly this worked example's tempo — but the control
  // must still be proven live, not just defaulted right, so this nudges it up
  // and back down with the stepper and reads the displayed number back each
  // time, landing back on 100 for the rest of the run.
  // Roadmap UI-24 restored typed entry: the glance cell is an
  // `<input type="number">` carrying the same `.stepper-value` class, so its
  // value is read with `toHaveValue`, not `toHaveText`. Typing an exact tempo
  // is asserted below, because 32 clicks to reach 132 was the defect.
  const bpmValue = page.locator('.metronome-bpm-stepper .stepper-value')
  await expect(bpmValue).toHaveValue('100')
  await page.getByRole('button', { name: 'Increase BPM' }).click()
  await expect(bpmValue).toHaveValue('101')
  await page.getByRole('button', { name: 'Decrease BPM' }).click()
  await expect(bpmValue).toHaveValue('100')

  // Roadmap UI-24: an exact tempo is typeable, in one interaction rather than
  // 32. Committed on blur, and the slider — the other way into the same
  // number — must follow it.
  await bpmValue.fill('132')
  await bpmValue.blur()
  await expect(bpmValue).toHaveValue('132')
  await expect(page.getByLabel('BPM slider')).toHaveValue('132')
  await bpmValue.fill('100')
  await bpmValue.blur()
  await expect(bpmValue).toHaveValue('100')

  const meter = page.getByRole('region', { name: 'Meter' })
  await meter.getByLabel('Beats').fill('7')
  await meter.getByLabel('Beat unit').selectOption('8')

  // Roadmap UI-16: the accent group's accessible name shortened from "Accent
  // pattern" to "Accents" (AccentEditor.tsx's redesign into a `.seg-control`
  // row of per-beat chips) — the per-beat `aria-label` still starts "Beat N".
  const accents = page.getByRole('group', { name: 'Accents' })
  const beatFour = accents.getByRole('button', { name: /^Beat 4/ })
  await expect(beatFour).toHaveAttribute('aria-pressed', 'false')
  await beatFour.click()
  await expect(beatFour).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Start' }).click()

  // A real clock is driving it: the readout must reach a beat, and then a
  // LATER beat. Asserting only that it left "Stopped" would pass against a
  // scheduler that fires once and dies.
  await expect(readout).toContainText(/Bar \d+, beat \d+/, { timeout: 10_000 })
  const firstBeat = await readout.textContent()
  await expect(async () => {
    expect(await readout.textContent()).not.toBe(firstBeat)
  }).toPass({ timeout: 10_000 })

  // The accent on beat 4 is real, not decorative: over a bar of 7/8 at 100bpm
  // (~4.2s) the readout must show an accented beat that is not beat 1.
  await expect(readout).toContainText(/beat 4 \(accent\)/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(readout).toHaveText('Stopped')

  expect(errors).toEqual([])
})
