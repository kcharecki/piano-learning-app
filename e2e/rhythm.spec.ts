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
 * ## Why tapping every 1000ms is a real, deterministic proof
 *
 * `RhythmScreen` starts at complexity 1 and a fixed 4 bars, and never offers
 * a way to change either before Start is pressed here — so this always runs
 * `generateRhythm({ bars: 4, timeSignature: 4/4, complexity: 1, ... })`.
 * Complexity 1's floor duration is a half note (`MIN_DURATION_BY_COMPLEXITY`,
 * `core/generator/rhythm.ts`), and complexity 1 never qualifies for a dotted
 * split (that needs complexity >= 3) or a ternary one (4/4 is not compound)
 * — so every bar's own onset(s) are EITHER one whole note (2000ms) or two
 * half notes (1000ms apart), always starting on a multiple of 1000ms from
 * the top of the piece. Tapping at every 1000ms mark across all 4 bars (0,
 * 1000, …, 7000) therefore always lands ON every position the generator
 * could possibly have put a real onset — whether or not that spot is
 * actually a note or a rest is left to chance (REQ real, not stubbed,
 * grading), which is exactly what proves this isn't a fixed 0/1 stub: a
 * whole-note bar's "half" mark (1000ms into it) can never be a real onset,
 * so it always grades as an extra tap, and a real onset can only be missing
 * from the matched count if the generator happened to draw a rest there.
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
  // Real, generated notation-as-text — a pattern actually exists to tap.
  await expect(page.getByTestId('pattern-bar-0')).toBeVisible()

  const tapButton = page.getByRole('button', { name: 'Tap' })
  await expect(tapButton).toBeEnabled()

  // Tap at 0ms and every 1000ms mark through 7000ms — every position a
  // complexity-1, 4-bar, 4/4 pattern could possibly have a real onset on —
  // PLUS one deliberate off-grid tap at 250ms, which can never land near a
  // real onset (the nearest possible one is 750ms away, far outside
  // `TAPPING_DEFAULTS.toleranceMs` of 150ms) and so is always graded extra.
  const scheduleMs = [0, 250, 1000, 2000, 3000, 4000, 5000, 6000, 7000]
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
  // `matched > 0`, which an unlucky all-rest pattern could fail.
  const realOnsetCount = await page.locator('[data-testid="pattern-onset"][data-rest="false"]').count()
  expect(matched + missed).toBe(realOnsetCount)

  expect(errors).toEqual([])
})
