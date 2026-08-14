import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for the clap/tap-back drill (roadmap 3.21/5.21, REQ-3.6.2).
 *
 * The task's own proof statement is two assertions, and the first one is the
 * one that quietly fails if done wrong: "never shown" has to mean the
 * notation is genuinely ABSENT from the DOM, not merely hidden by CSS — so
 * this asserts on presence (`toHaveCount(0)` / `queryByTestId` style
 * absence), never on visibility or opacity, through every phase of the run:
 * idle, listening, tapping, and graded. `RhythmClapback.test.tsx` already
 * covers this at the unit level with `happy-dom`; this is the same guarantee
 * proven against the real dev server and the real OSMD/Web Audio stack (a
 * unit test mocking `ScoreViewer` cannot prove OSMD itself never mounts).
 *
 * The second half — "the tapped answer is graded" — is proven by tapping a
 * KNOWN number of times and asserting `matched + extra` equals exactly that
 * count, the same technique `rhythm.spec.ts` uses for the sight-reading
 * drill, which a stub grader (fixed 0/1, or one that ignores the taps
 * entirely) cannot satisfy.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** No score container, no SVG, no OSMD-authored note element — anywhere in
 *  the screen's own content, not just inside some presumed "notation
 *  sub-region". Checked by COUNT, never by visibility, per the module doc.
 *
 *  Scoped to `<main>` (roadmap UI-04a, 2026-08-12 UI audit): nav items now
 *  carry their own decorative `<svg>` icon beside their label, and the
 *  topbar's input-status chip and Reference button do too — real chrome that
 *  has nothing to do with notation. A bare `page.locator('svg')` would count
 *  those and fail this assertion on every screen, defeating its own purpose;
 *  `<main>` is exactly the region `Shell.tsx` renders the active screen into,
 *  so this still proves the same thing the un-scoped check proved before
 *  icons existed — the RHYTHM SCREEN ITSELF never engraves anything.
 *
 *  Roadmap UI-14: the redesigned Rhythm/clap-back stage itself now uses the
 *  shared `Icon` component too (the stepper's +/− glyphs, Start/Again's play
 *  glyph) — plain decorative svgs living INSIDE `<main>`, not just in chrome
 *  outside it. `Icon.tsx`'s own accessibility contract is what tells the two
 *  kinds of svg apart: every decorative icon it renders is `aria-hidden`
 *  ("Icons are ALWAYS decorative here" — see that file's module doc), while a
 *  real OSMD engraving is perceivable content and is never `aria-hidden`. So
 *  excluding `[aria-hidden="true"]` still proves the same thing this
 *  assertion always proved — no notation SVG anywhere in the screen's own
 *  content — without failing on the redesign's own decorative chrome. */
async function expectNoNotationAnywhere(page: Page): Promise<void> {
  const main = page.locator('main')
  await expect(main.getByTestId('score-container')).toHaveCount(0)
  await expect(main.locator('svg:not([aria-hidden="true"])')).toHaveCount(0)
  await expect(main.locator('[data-note-id]')).toHaveCount(0)
}

test('the clap-back mode plays the phrase audibly, never engraves it, and grades the real tapped answer (roadmap 3.21)', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Rhythm' })
    .click()

  await expect(page.getByRole('heading', { name: 'Rhythm' })).toBeVisible()
  await expectNoNotationAnywhere(page)

  await page.getByRole('button', { name: 'Clap-back mode' }).click()
  // Roadmap UI-14: the stepper's testid holds only the bare numeral now — the
  // "Level" label moved out into its own `.field` label. Assert both halves.
  await expect(page.getByText('Level', { exact: true })).toBeVisible()
  await expect(page.getByTestId('clapback-level')).toHaveText('1')
  await expectNoNotationAnywhere(page)

  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('clapback-listening-status')).toBeVisible()
  await expectNoNotationAnywhere(page)

  // Listening auto-advances to tapping once the phrase finishes playing —
  // `RhythmClapback`'s own `BARS = 2` at the 120bpm default is 4s, generous
  // real-time margin either side.
  await expect(page.getByTestId('clapback-tapping-status')).toBeVisible({ timeout: 15_000 })
  await expectNoNotationAnywhere(page)

  // Roadmap UI-14: the pad's accessible name while tapping is "Now clap it
  // back — or press Space" — it no longer contains the word "Tap" at all (the
  // shared tap-pad visual language `RhythmScreen.tsx`'s sight-tap mode also
  // uses), so a name-based lookup can no longer find it. `.rhythm-tap-pad` is
  // the one pad on screen in this mode (RhythmClapback.tsx never renders
  // notation, see the module doc above) — a stable, deliberate structural hook
  // the redesign itself names, not a CSS incidental.
  const tapButton = page.locator('.rhythm-tap-pad')
  await expect(tapButton).toBeEnabled()

  const TAP_COUNT = 5
  for (let i = 0; i < TAP_COUNT; i++) {
    await tapButton.click()
    await page.waitForTimeout(150)
  }
  // Roadmap UI-14: the count span holds a bare numeral now (see `rhythm.spec.ts`'s
  // matching fix for the sight-tap pad).
  await expect(page.getByTestId('clapback-tap-count')).toHaveText(`${TAP_COUNT}`)
  await expectNoNotationAnywhere(page)

  await expect(page.getByTestId('clapback-accuracy')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Again' })).toBeVisible()
  await expectNoNotationAnywhere(page)

  const matched = Number(await page.getByTestId('clapback-matched').textContent())
  const missed = Number(await page.getByTestId('clapback-missed').textContent())
  const extra = Number(await page.getByTestId('clapback-extra').textContent())
  const accuracyText = (await page.getByTestId('clapback-accuracy').textContent()) ?? ''
  const accuracy = Number(accuracyText.replace('%', '')) / 100

  // Every one of the 5 real taps is accounted for as either matched or extra
  // — the real invariant `gradeClapback` keeps — which a stub returning a
  // fixed grade regardless of input cannot satisfy.
  expect(matched + extra).toBe(TAP_COUNT)
  expect(missed).toBeGreaterThanOrEqual(0)
  expect(accuracy).toBeGreaterThanOrEqual(0)
  expect(accuracy).toBeLessThanOrEqual(1)

  // The sight-reading mode is still reachable and unaffected — switching
  // back shows its own (SIGHT-READING, notation-visible) drill, proving the
  // mode switch is real navigation between two different drills, not a
  // relabelled one.
  await page.getByRole('button', { name: 'Sight-reading mode' }).click()
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible()

  expect(errors).toEqual([])
})
