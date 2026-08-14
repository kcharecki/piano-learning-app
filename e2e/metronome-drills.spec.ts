import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 2.28a (REQ-3.9.1): "the metronome is available
 * standalone and inside every practice screen". Rhythm and Sight-reading used
 * to hard-code the click permanently ON with no way to turn it off.
 *
 * What only a real browser proves here: the Rhythm screen, reached through the
 * shell's own nav, still runs a full tapping drill through to a real grade
 * with the click switched off (a screen that crashes, or a drill that never
 * starts, with the click off would fail this).
 *
 * REMOVED (roadmap UI-12, 2026-08-12 UI audit): this file used to also prove
 * a standalone metronome group on the Flashcards screen. UI-12 deleted that
 * control outright, not just moved it — a metronome has its own screen
 * (`@app/metronome/MetronomeScreen.tsx`), and the flashcard drill grades
 * single answers with no tempo involved, so the control never earned its
 * place there. That test is gone with the feature it proved; it is not
 * resurrected here. The real Metronome screen has no e2e coverage in this
 * file — it never did, this file only ever covered the (now-deleted)
 * Flashcards copy plus the Rhythm screen's own click toggle, which the test
 * below still covers.
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
