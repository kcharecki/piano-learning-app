import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.56: the Rhythm screen's engraved pattern must carry
 * a real title naming the drill and its complexity, never "Untitled Score".
 *
 * This is verbatim the defect the 2026-08-06 UX/pedagogy review named and
 * roadmap 5.13 is ticked as having fixed — 5.13 titled `generateMelody` and
 * `techniqueScore` (both confirmed still fixed) and never touched
 * `rhythmToScore`, which is what `RhythmScreen`'s sight-reading-style tap
 * drill calls (`useRhythmDrill.ts`). `rhythm.spec.ts` already proves the
 * pattern engraves for real (a genuine OSMD render, not a text stand-in);
 * this file's one load-bearing job is the title, read off that same real
 * engraving, not off the model.
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

test('a driven complexity-1 rhythm drill engraves a real title naming the drill and complexity (roadmap 5.56)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Rhythm' })
    .click()

  await expect(page.getByRole('heading', { name: 'Rhythm' })).toBeVisible()
  // `RhythmScreen` starts at complexity 1 and never offers a way to change it
  // before Start is pressed — the same fixed starting point `rhythm.spec.ts`
  // relies on.
  await expect(page.getByTestId('rhythm-complexity')).toHaveText('Complexity 1')

  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()

  const scoreContainer = page.getByTestId('score-container')
  await expect(scoreContainer.locator('svg')).toBeVisible()
  // A real engraving, not a stub — same discriminator `rhythm.spec.ts` uses.
  expect(await scoreContainer.locator('svg *').count()).toBeGreaterThan(50)

  const engravedText = await scoreContainer.innerText()
  expect(engravedText).toContain('Rhythm — complexity 1')
  expect(engravedText).not.toContain('Untitled Score')

  expect(errors).toEqual([])
})
