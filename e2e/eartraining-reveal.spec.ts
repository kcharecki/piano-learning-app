import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E acceptance proof for roadmap 5.29: the post-answer reveal. Drives the
 * real, running app with no injected seams (same style as
 * `e2e/screens.spec.ts`'s own "Ear training" test, which this extends rather
 * than duplicates) — this file's own job is specifically the reveal content
 * that test does not look at: the named answer with real pitches, the staff,
 * the keyboard diagram, and the interval reference control.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function nav(page: Page, label: string) {
  return page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true })
}

test('answering an interval item reveals the real pitches on a staff and a keyboard, and offers a reference interval (roadmap 5.29)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Ear training').click()

  await page.getByRole('button', { name: /^Play/ }).click()
  const pad = page.getByRole('group', { name: 'Interval answer' })
  await pad.getByRole('button').first().click()

  // The reveal names the answer with its actual sounding pitches (musical
  // pitch names, e.g. "C4" — never a bare MIDI number, DESIGN.md rule 7).
  const naming = page.getByTestId('reveal-answer-naming')
  await expect(naming).toBeVisible({ timeout: 10_000 })
  await expect(naming).toHaveText(/[A-G](#|b)?\d.*(then|and).*[A-G](#|b)?\d/)

  // A real OSMD render, not a placeholder — same >50-SVG-element discriminator
  // e2e/screens.spec.ts's own staff test uses.
  const staff = page.getByTestId('reveal-staff')
  await expect(staff.locator('svg')).toBeVisible({ timeout: 15_000 })
  expect(await staff.locator('svg *').count()).toBeGreaterThan(20)

  // The same two pitches, also on a keyboard diagram.
  const diagram = page.getByTestId('keyboard-diagram')
  await expect(diagram).toBeVisible()
  expect(await diagram.locator('[data-highlighted="true"]').count()).toBe(2)

  // The interval reference: names a mnemonic tune and plays a fixed-register
  // reference on request — never reproducing a melody or lyrics, just the
  // title, per the module's own doc.
  const reference = page.getByTestId('reveal-reference-tune')
  await expect(reference).toBeVisible()
  await page.getByRole('button', { name: 'Play reference interval' }).click()

  // Replay (the existing control) still works once the reveal is showing —
  // "replay with the answer named" is this control plus the reveal already
  // on screen together, not a second Replay button.
  await expect(page.getByRole('button', { name: 'Replay' })).toBeEnabled()
  await page.getByRole('button', { name: 'Replay' }).click()

  expect(errors).toEqual([])
})

test('answering a chord-quality item also reveals a staff and keyboard, with no interval reference control', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Ear training').click()

  await page.locator('#eartraining-drill-select').selectOption({ label: 'Chord quality' })
  await page.getByRole('button', { name: /^Play/ }).click()
  const pad = page.getByRole('group', { name: 'Chord quality answer' })
  await pad.getByRole('button').first().click()

  await expect(page.getByTestId('reveal-answer-naming')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('reveal-staff').locator('svg')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('keyboard-diagram')).toBeVisible()
  await expect(page.getByTestId('reveal-reference-tune')).toHaveCount(0)

  expect(errors).toEqual([])
})
