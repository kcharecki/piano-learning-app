import type { Page } from '@playwright/test'

/**
 * Wait for the page to reach its RESTING layout before measuring any box.
 *
 * Roadmap UI-22 gave the app real motion — the nav drawer slides, a
 * `<details>` reveal rises, buttons press. `getBoundingClientRect()` on an
 * element inside an actively transformed ancestor comes back sub-pixel: a
 * control whose `min-height` is exactly `--touch-min` reads 43.9921875 and
 * fails a `< 44` test. `tablet-touch-targets.spec.ts` hit that first and grew
 * this settle inline; `responsive-drawers.spec.ts` did not, and failed the
 * same way on 2026-08-25 with "Open navigation — 44x44" — a control reported
 * as under 44px whose printed size IS 44, which is the signature of the class.
 * So it lives here now: one settle, both callers, and the next spec that
 * measures a box imports it instead of rediscovering the sub-pixel read.
 *
 * Three steps, each covering a gap the previous one leaves:
 *  1. await every animation the document currently has running;
 *  2. two `requestAnimationFrame`s, so a style change committed by step 1 has
 *     actually been laid out before anything reads a rect;
 *  3. a fixed 400ms — a transition that has not STARTED when step 1 samples is
 *     not in `getAnimations()`, and the drawer begins sliding a tick after the
 *     click that dismisses it. 400ms clears the longest motion token in the
 *     system (`--dur-3`, 320ms) with margin.
 *
 * Deliberately a settle, not a retry-until-green loop: retrying until the
 * numbers agree would hide a control that is genuinely undersized at rest.
 * This is the same fixed-settle approach `scripts/visual-pass.mjs` already
 * uses before it screenshots.
 */
export async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const running = document.getAnimations()
    await Promise.all(running.map((a) => a.finished.catch(() => undefined)))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))))
  })
  await page.waitForTimeout(SETTLE_MS)
}

/** Longest motion token in the design system (`--dur-3`, 320ms), plus margin. */
export const SETTLE_MS = 400
