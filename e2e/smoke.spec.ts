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

test('the Practice nav destination actually renders the practice screen — score and transport together', async ({
  page,
}) => {
  // This is the regression test for a real defect: the practice screen was
  // built, unit-tested and committed while nothing in the shell rendered it,
  // so it was unreachable from the running app. Asserting on the score AND
  // the transport controls appearing together, reached the way a user
  // reaches them (through the shell's own nav button, not a direct mount),
  // fails loudly if that screen is ever unwired again.
  await page.goto('/')

  await page.getByRole('button', { name: 'Practice', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()
  await expect(page.getByTestId('score-container').locator('svg')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Transport' })).toBeVisible()
})

test('the bundled sample score loads and OSMD renders real notation', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  // OSMD draws the score as SVG. A real render of this piece produces ~700
  // nested elements (staff lines, noteheads, stems, beams, ...) — happy-dom
  // can't run OSMD at all, so this element count is the actual proof the
  // viewer works, not just that it was asked to. 50 is a real discriminator,
  // not an arbitrary one: checked directly against OSMD, a degenerate render
  // (e.g. a score whose notes were all silently dropped and rendered as
  // rests) produces ~25-35 elements, and a hard failure (malformed input OSMD
  // refuses to load) produces no <svg> at all, which fails the visibility
  // assertion below before the count is even reached.
  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible()
  const renderedElementCount = await container.locator('svg *').count()
  expect(renderedElementCount).toBeGreaterThan(50)
})

test('pressing play advances the position readout, and pause stops it', async ({ page }) => {
  await page.goto('/')

  const transport = page.getByRole('group', { name: 'Transport' })
  const position = transport.getByLabel('Position')

  // The readout already reads "Measure 1, beat 1 of 4" — not the em dash —
  // the instant the transport is built, before Play is ever pressed (mount
  // effects call setDisplay against the stopped transport at tick 0). So the
  // only real proof of a running transport is that the text CHANGES after
  // Play, not that it differs from some assumed idle placeholder.
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  const justAfterPlay = await position.textContent()

  // The bundled sample is 100bpm (600ms/beat). Give it more than a full beat
  // so this can't pass on a dead pump that never advances.
  await expect(async () => {
    expect(await position.textContent()).not.toBe(justAfterPlay)
  }).toPass({ timeout: 5_000 })

  await transport.getByRole('button', { name: 'Pause', exact: true }).click()
  const afterPause = await position.textContent()
  // Wait more than a full beat (600ms) before asserting it froze — anything
  // shorter has a real chance of landing inside the same beat even when
  // pause is a complete no-op, which is exactly how this assertion used to
  // pass against a broken pause roughly half the time.
  await page.waitForTimeout(1_000)
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
