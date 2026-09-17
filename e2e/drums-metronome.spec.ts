import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap DR-12 — the drums metronome at `/drums/metronome`.
 * Written against the contract this slice shipped against; if the shell has
 * not wired the route yet, `goto` never reaches the heading below and the
 * runner should report that as "unrun (route pending)", not as a broken
 * feature (see `e2e/drums-reading.spec.ts`, the same situation on DR-11).
 */

/** Console/page errors, collected from the moment the page is created (see e2e/screens.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('the drums metronome clicks 2 & 4, starts, reports a running bar/beat, and stops cleanly (roadmap DR-12)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/drums/metronome')
  await expect(page.getByRole('heading', { name: 'Metronome' })).toBeVisible()

  await page.getByRole('radio', { name: '2 & 4' }).click()
  await expect(page.getByRole('radio', { name: '2 & 4' })).toHaveAttribute('aria-checked', 'true')

  const beatStatus = page.getByRole('status', { name: 'Beat' })
  await expect(beatStatus).toHaveText('Stopped')

  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()

  // Give the transport a couple of bars to run at the default tempo.
  await page.waitForTimeout(2500)
  await expect(beatStatus).toHaveText(/Bar \d+ · beat \d+/)

  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible()
  await expect(beatStatus).toHaveText('Stopped')

  expect(errors).toEqual([])
})
