import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 2.28a (REQ-3.9.1): "the metronome is available
 * standalone and inside every practice screen". Rhythm and Sight-reading used
 * to hard-code the click permanently ON with no way to turn it off, and
 * Flashcards had no metronome at all.
 *
 * What only a real browser proves here: the Rhythm screen, reached through the
 * shell's own nav, still runs a full tapping drill through to a real grade
 * with the click switched off (a screen that crashes, or a drill that never
 * starts, with the click off would fail this) — and the Flashcards screen's
 * new standalone metronome group actually advances its beat readout under a
 * real `requestAnimationFrame` loop, not a fake one.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/round6.spec.ts). */
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

test('Rhythm still reaches a real grade with the metronome click switched off (roadmap 2.28a)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Rhythm').click()

  await expect(page.getByRole('heading', { name: 'Rhythm' })).toBeVisible()

  const metronomeClick = page.getByRole('checkbox', { name: 'Metronome click' })
  await expect(metronomeClick).toBeChecked()
  await metronomeClick.uncheck()
  await expect(metronomeClick).not.toBeChecked()

  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()

  const tapButton = page.getByRole('button', { name: 'Tap' })
  await expect(tapButton).toBeEnabled()
  // A handful of taps across the run — this test only needs the drill to
  // reach a real grade with the click off, not an exact score.
  for (let i = 0; i < 4; i++) {
    await tapButton.click()
    await page.waitForTimeout(1000)
  }

  // Complexity 1, 4 bars, 120bpm default tempo: 4 * 2000ms = 8000ms total —
  // wait out the rest of the run.
  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Again' })).toBeVisible()

  expect(errors).toEqual([])
})

test('Flashcards has a standalone metronome that runs under a real animation-frame loop (roadmap 2.28a)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Flashcards').click()

  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()

  const metronome = page.getByRole('group', { name: 'Metronome' })
  await expect(metronome).toBeVisible()

  const readout = metronome.getByTestId('flashcard-metronome-beat')
  await expect(readout).toHaveText('—')

  await metronome.getByRole('button', { name: 'Start' }).click()

  // A real rAF loop against a real clock: the readout must actually leave the
  // em dash, not just render a static "beat 1" once.
  await expect(readout).toHaveText(/^beat \d+$/, { timeout: 10_000 })
  const firstText = await readout.textContent()

  // ...and it must keep advancing — a metronome that clicks once and then
  // wedges would still satisfy the regex above forever.
  await expect(readout).not.toHaveText(firstText ?? '', { timeout: 5_000 })

  const stopButton = metronome.getByRole('button', { name: 'Stop' })
  await expect(stopButton).toBeVisible()
  await stopButton.click()
  await expect(metronome.getByRole('button', { name: 'Start' })).toBeVisible()

  expect(errors).toEqual([])
})
