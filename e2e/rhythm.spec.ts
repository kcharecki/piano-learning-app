import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for the rhythm tapping drill (roadmap 2.13, REQ-3.9.1-adjacent).
 * Regression test for the same class of defect `smoke.spec.ts` already guards
 * against for Practice/Sight reading/Flashcards: a screen built and unit
 * tested in isolation but never mounted by the shell is unreachable. This
 * drives the whole discipline for real — start, tap (deliberately
 * imperfectly), let it finish, grade — through the shell's own nav button,
 * not a direct mount.
 *
 * ## Why tapping every 500ms is a real, deterministic proof
 *
 * `RhythmScreen` starts at complexity 1 and a fixed 4 bars, and never offers
 * a way to change either before Start is pressed here — so this always runs
 * `generateRhythm({ bars: 4, timeSignature: 4/4, complexity: 1, ... })`.
 * Complexity 1's floor is a quarter note and its ceiling is a half note
 * (`MIN_DURATION_BY_COMPLEXITY`/`MAX_DURATION_BY_COMPLEXITY`,
 * `core/generator/rhythm.ts`, roadmap 5.20), and complexity 1 never qualifies
 * for a dotted split (needs complexity >= 3) or a ternary one (4/4 is not
 * compound) — so every bar's own onset(s) are some mix of quarter (500ms) and
 * half (1000ms) notes, always starting on a multiple of 500ms from the top of
 * the piece, and complexity 1 never emits a rest at all — every onset is a
 * real, tappable note. Tapping at every 500ms mark across all 4 bars (0, 500,
 * …, 7500) therefore always lands ON every position the generator could
 * possibly have started a note, so no real onset can ever go missed by this
 * schedule: a mark that turns out to be mid-note (the second half of a half
 * note, not a new onset) simply grades as an extra tap instead, which is
 * exactly what proves this isn't a fixed 0/1 stub.
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

test('the Rhythm nav destination renders the real drill, taps a pattern imperfectly, and grades it for real (roadmap 2.13)', async ({
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
  await expect(page.getByTestId('rhythm-complexity')).toHaveText('Complexity 1')

  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()
  // The pattern is engraved for real (roadmap 5.19) — a real OSMD render is
  // well past the 50-element discriminator this suite uses (see
  // round6.spec.ts); the old text stand-in ("Bar 1: half, half…") is gone.
  const scoreContainer = page.getByTestId('score-container')
  await expect(scoreContainer.locator('svg')).toBeVisible()
  expect(await scoreContainer.locator('svg *').count()).toBeGreaterThan(50)
  const patternRegionText = (await scoreContainer.innerText()).toLowerCase()
  expect(patternRegionText).not.toContain('half')
  expect(patternRegionText).not.toContain('whole')

  const tapButton = page.getByRole('button', { name: 'Tap' })
  await expect(tapButton).toBeEnabled()

  // Tap at 0ms and every 500ms mark through 7500ms — every position a
  // complexity-1, 4-bar, 4/4 pattern could possibly have a real onset on
  // (roadmap 5.20's quarter-note floor) — PLUS one deliberate off-grid tap
  // at 250ms, which is exactly 250ms from its nearest possible onset (0 or
  // 500) either way, outside `TAPPING_DEFAULTS.toleranceMs` of 150ms, and so
  // is always graded extra.
  const scheduleMs = [
    0, 250, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000,
    7500,
  ]
  // Anchor the schedule to wall clock, not to the previous tap's nominal
  // offset: `tapButton.click()` round-trips real time, and the gap between
  // the Start click (which anchors the transport) and the first tap here
  // (several `expect(...).toBeVisible/toBeEnabled` awaits sit in between) is
  // itself unmeasured. Accumulating nominal offsets would let every click's
  // latency compound onto every later tap; waiting out the remaining time to
  // each absolute target keeps the drift bounded instead.
  const t0 = Date.now()
  for (const at of scheduleMs) {
    const remaining = at - (Date.now() - t0)
    if (remaining > 0) await page.waitForTimeout(remaining)
    await tapButton.click()
  }
  await expect(page.getByTestId('rhythm-tap-count')).toHaveText(`Taps: ${scheduleMs.length}`)

  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Again' })).toBeVisible()

  const matched = Number(await page.getByTestId('rhythm-matched').textContent())
  const missed = Number(await page.getByTestId('rhythm-missed').textContent())
  const extra = Number(await page.getByTestId('rhythm-extra').textContent())
  const accuracyText = (await page.getByTestId('rhythm-accuracy').textContent()) ?? ''
  const accuracy = Number(accuracyText.replace('%', '')) / 100

  // The 250ms off-grid tap alone guarantees at least one extra; a stub
  // grader (always 0, or always "perfect") fails these.
  expect(extra).toBeGreaterThan(0)
  expect(matched).toBeGreaterThan(0)
  expect(accuracy).toBeGreaterThan(0)
  expect(accuracy).toBeLessThan(1)
  // Every real (non-rest) onset the generator drew is accounted for as
  // either matched or missed — true for every draw, unlike a bare
  // `matched > 0`, which an unlucky all-rest pattern could fail. Read off the
  // engraving, not the model: `rhythmToScore` emits one real `Score` note per
  // non-rest onset and none for a rest, and the engraver stamps `data-note-id`
  // only on real, mapped notes (roadmap 4.8a) — so this count is exactly the
  // real-onset count `gradeTapping` graded against.
  const realOnsetCount = await scoreContainer.locator('[data-note-id]').count()
  expect(matched + missed).toBe(realOnsetCount)

  expect(errors).toEqual([])
})
