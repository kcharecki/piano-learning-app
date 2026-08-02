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
  const tempoAndMetre = page.getByRole('group', { name: 'Tempo and metre' })
  await tempoAndMetre.getByLabel('BPM').fill('100')
  await tempoAndMetre.getByLabel('BPM').blur()
  await tempoAndMetre.getByLabel('Beats').fill('7')
  await tempoAndMetre.getByLabel('Beat unit').selectOption('8')

  const accents = page.getByRole('group', { name: 'Accent pattern' })
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
