import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.12 (REQ-3.4.2): the sight-reading screen exposes
 * the generator parameters `core/generator/melody.ts` already supports —
 * key, hands, rhythm, accidentals, hand independence and range — so a
 * learner can drill a specific weak spot instead of only ever getting a
 * level's canonical shape. Every assertion here reads the rendered SVG, not
 * the request: `.vf-keysignature`/`.vf-clef`/`.vf-modifiers` are VexFlow's
 * own groups (the same discriminators `e2e/screens.spec.ts` and
 * `e2e/graded-scores.spec.ts` already use for key-signature and staff
 * assertions).
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

test('setting key = G, hands = left only, no accidentals engraves exactly that (roadmap 5.12, REQ-3.4.2)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Sight reading').click()

  await page.getByText('Customize exercise').click()
  await page.getByLabel('Key tonic').selectOption({ label: 'G major' })
  await page.getByLabel('Hands').selectOption({ label: 'Left hand only' })
  await page.getByRole('checkbox', { name: 'No accidentals' }).check()

  await page.getByRole('button', { name: 'Start exercise' }).click()

  const score = page.getByTestId('score-container')
  await expect(score.locator('svg')).toBeVisible({ timeout: 15_000 })
  expect(await score.locator('svg *').count()).toBeGreaterThan(50)

  // One sharp — G major, read off the key signature glyph itself.
  const keySignature = score.locator('svg .vf-keysignature')
  await expect(keySignature).toHaveCount(1)
  expect(await keySignature.locator('path').count()).toBe(1)

  // One staff of notes — "left hand only" leaves no right-hand notes behind,
  // and `buildStaves` (core/notation/score.ts) derives the staff list from
  // the notes actually present, so a single-hand score writes ONE staff/clef,
  // never a grand staff with an empty treble half.
  const clefs = score.locator('svg .vf-clef')
  await expect(clefs).toHaveCount(1)

  // No accidental glyphs — every note-level modifier group is empty, because
  // `noAccidentals` zeroes `accidentalDensity` and G major's own diatonic
  // scale needs no note spelled outside its one-sharp key signature.
  const modifierGroups = score.locator('svg .vf-modifiers')
  expect(await modifierGroups.count()).toBeGreaterThan(0)
  for (const group of await modifierGroups.all()) {
    expect(await group.locator('*').count()).toBe(0)
  }

  expect(errors).toEqual([])
})

test('leaving every field at "level\'s default" behaves exactly as before (no regression)', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Sight reading').click()

  await expect(page.getByText('Customize exercise')).toBeVisible()
  // The panel starts closed — the ordinary Start path is unchanged for a
  // learner who never opens it.
  await expect(page.getByLabel('Hands')).toBeHidden()

  await page.getByRole('button', { name: 'Start exercise' }).click()
  await expect(page.getByTestId('score-container').locator('svg')).toBeVisible({ timeout: 15_000 })

  expect(errors).toEqual([])
})
