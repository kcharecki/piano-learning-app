import { expect, test, type Page } from '@playwright/test'

/**
 * Roadmap DR-10 — the rudiment trainer screen at `/drums/rudiments`.
 *
 * What is asserted here is exactly what a unit/component test cannot see:
 * the whole page wired together in a real browser — all 40 rudiments really
 * render, choosing one really redraws the staff with its own sticking
 * letters (drawn automatically once the notes carry `sticking` — see
 * `rudimentToScore`), and the ladder status is present and sane. Grading
 * rules live in `rudimentRun.test.ts`; ladder/persistence timing lives in
 * `useRudimentTrainer.test.ts`. This spec never asserts on those.
 */

function ladderStatus(page: Page) {
  return page.getByRole('status', { name: 'Ladder' })
}

test('lists all 40 rudiments across four tiers, and Practise loads one onto the staff with a live ladder (roadmap DR-10)', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await page.goto('/drums/rudiments')
  await expect(page.getByRole('heading', { level: 1, name: 'Rudiments' })).toBeVisible()

  // The four Wooton tiers, all present.
  for (const tier of [1, 2, 3, 4]) {
    await expect(page.getByRole('region', { name: `Tier ${tier}` })).toBeVisible()
  }

  // 40 PAS rudiments, one Practise button each.
  const practiseButtons = page.getByRole('button', { name: /^Practise /u })
  expect(await practiseButtons.count()).toBe(40)

  // Opens on the Single Stroke Roll by default, ladder already reporting a bpm.
  await expect(ladderStatus(page)).toContainText(/at \d+ bpm/)

  // Choosing a different rudiment redraws the staff with ITS sticking.
  await page.getByRole('button', { name: 'Practise Single Paradiddle', exact: true }).click()
  await expect(page.locator('.rudiment-title')).toHaveText('Single Paradiddle')
  await expect(ladderStatus(page)).toContainText(/at \d+ bpm/)

  const stickings = page.locator('.groove-sticking')
  await expect(stickings.first()).toBeVisible()
  const cells = await stickings.evaluateAll((nodes) =>
    nodes.map((node) => ({
      x: Number(node.getAttribute('x')),
      letter: node.textContent ?? '',
    })),
  )
  const firstEight = cells
    .sort((a, b) => a.x - b.x)
    .slice(0, 8)
    .map((cell) => cell.letter)
    .join(' ')
  expect(firstEight).toBe('R L R R L R L L')

  expect(consoleErrors).toEqual([])
})
