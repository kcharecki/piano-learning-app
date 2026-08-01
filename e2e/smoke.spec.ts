import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E smoke suite (roadmap 1.19). Thin on purpose: this only proves the app
 * boots in a real browser and the pieces built in 1.17/1.18 are wired
 * together. All behavioural depth (matching, SRS, generation, timing math)
 * lives in the fast `core`/`ui` vitest suites — see docs/ARCHITECTURE.md.
 */

/** Console/page errors, collected from the moment the page is created. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('the app boots with no console errors and renders the shell', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/')

  await expect(page.getByRole('navigation', { name: /main/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Practice', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('button', { name: 'Sight reading' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Theory' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Progress' })).toBeVisible()

  expect(errors).toEqual([])
})

test('the bundled sample score loads and OSMD renders real notation', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  // OSMD draws the score as SVG. A real render produces hundreds of nested
  // elements (staff lines, noteheads, stems, beams, ...) — happy-dom can't
  // run OSMD at all, so this element count is the actual proof the viewer
  // works, not just that it was asked to.
  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible()
  const renderedElementCount = await container.locator('svg *').count()
  expect(renderedElementCount).toBeGreaterThan(50)
})

test('pressing play advances the position readout, and pause stops it', async ({ page }) => {
  await page.goto('/')

  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  const position = transport.getByLabel('Position')
  await expect(async () => {
    expect(await position.textContent()).not.toBe('—')
  }).toPass({ timeout: 5_000 })

  await transport.getByRole('button', { name: 'Pause', exact: true }).click()
  const afterPause = await position.textContent()
  // If pause didn't actually stop the transport, the readout keeps moving —
  // give it a real beat to prove it, rather than trusting a single read.
  await page.waitForTimeout(300)
  await expect(position).toHaveText(afterPause ?? '')
})

test('setting a loop range and enabling looping is reflected in the UI', async ({ page }) => {
  await page.goto('/')

  const loopRange = page.getByRole('group', { name: 'Loop range' })
  await loopRange.getByLabel('From measure').fill('2')
  await loopRange.getByLabel('to measure').fill('4')
  const loopToggle = loopRange.getByRole('checkbox', { name: 'Loop' })
  await loopToggle.check()

  await expect(loopRange.getByLabel('From measure')).toHaveValue('2')
  await expect(loopRange.getByLabel('to measure')).toHaveValue('4')
  await expect(loopToggle).toBeChecked()
})

test('the app stays usable with no MIDI keyboard connected', async ({ page }) => {
  // Playwright's Chromium has no MIDI device attached, so the app's own
  // "no hardware" fallback is exactly what a real, honest run exercises —
  // there is nothing to grant permission to and nothing to fake.
  const errors = collectErrors(page)

  await page.goto('/')

  await expect(page.getByText(/no midi keyboard connected/i)).toBeVisible()
  await expect(page.getByRole('group', { name: 'Transport' })).toBeVisible()

  expect(errors).toEqual([])
})
