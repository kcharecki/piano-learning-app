import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { settleLayout } from './settle-layout.ts'

/**
 * E2E proof for roadmap 5.27: the ≤1024px responsive drawer, verified by
 * hand in a real (Playwright-driven, Chromium) browser at tablet width —
 * the one claim the 2026-08-06 review flagged as never actually verified,
 * because the interactive automation pane used for manual driving does not
 * composite CSS transition frames (`translateX` sits frozen at t=0 there).
 * Playwright does not share that dependency: it runs a real, compositing
 * Chromium, so the screenshots this spec writes are real end states, not a
 * frozen frame.
 *
 * Covers BOTH drawers this app now has at ≤1024px: the pre-existing nav
 * drawer (roadmap 5.43) and the reference drawer this round's 3.17 added —
 * the task brief explicitly asks for both once a second one exists.
 *
 * Proof per the roadmap text: at 768×1024, each drawer opens and closes on
 * tap, its scrim dismisses it, no control there is under 44px, and the page
 * never scrolls horizontally.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCREENSHOT_DIR = path.join(__dirname, '..', 'visual-pass', '5-27-responsive-drawers')

// A real tablet has touch — `.tap()` needs the context to say so explicitly,
// or Playwright refuses to synthesize touch events at all.
test.use({ hasTouch: true })

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** No horizontal overflow — the page's own scrollable width never exceeds its visible width. */
async function hasNoHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
}

/** The drawer's `translateX` transition is 200ms (`--dur-2`, tokens/motion.css)
 *  — a screenshot taken right after the aria/visibility assertions settle
 *  (which do not wait for the animation, only for the DOM/attribute state)
 *  can catch a genuinely mid-slide frame. This is exactly the failure mode
 *  the roadmap item is about — an un-composited or mid-transition capture
 *  reading as "working" when it is really a frozen or transitional frame —
 *  so every screenshot below waits out the transition first. */
async function settleTransition(page: Page): Promise<void> {
  await page.waitForTimeout(350)
}

test.beforeAll(() => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
})

test('the nav drawer opens and closes on tap, its scrim dismisses it, and nothing scrolls horizontally at 768x1024 (roadmap 5.27)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/')

  expect(await hasNoHorizontalScroll(page)).toBe(true)
  await settleTransition(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'nav-closed-768x1024.png') })

  const navToggle = page.getByRole('button', { name: 'Open navigation' })
  const nav = page.getByRole('navigation', { name: /main/i })

  // Closed: off-canvas (not the tap target itself, which stays visible/fixed).
  await expect(navToggle).toHaveAttribute('aria-expanded', 'false')

  await navToggle.tap()
  await expect(navToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(nav.getByRole('button', { name: 'Practice', exact: true })).toBeVisible()
  const navScrim = page.locator('.nav-scrim')
  await expect(navScrim).toBeVisible()
  expect(await hasNoHorizontalScroll(page)).toBe(true)
  await settleTransition(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'nav-open-768x1024.png') })

  // The scrim itself dismisses the drawer.
  await navScrim.tap()
  await expect(navToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navScrim).toHaveCount(0)
  await settleTransition(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'nav-closed-after-scrim-768x1024.png') })

  // Reopen and close via the toggle itself (not just the scrim).
  await navToggle.tap()
  await expect(navToggle).toHaveAttribute('aria-expanded', 'true')
  await navToggle.tap()
  await expect(navToggle).toHaveAttribute('aria-expanded', 'false')

  // No visible, enabled control anywhere on the page is under the 44px touch
  // minimum — measured on the RESTING layout.
  //
  // This assertion failed once, on 2026-08-25, inside a full 6-worker
  // `test:e2e` run: "controls under 44px: Open navigation — 44x44". It has not
  // been reproduced since — not alone, and not with the CPU throttled 20x
  // while sampling that button's box on every frame of the drawer's close
  // (min 44.000 x 44.000 over 32 frames, 0 samples under 44). So the settle
  // below is the sibling spec's fix applied to the same symptom, NOT a proven
  // cause: `tablet-touch-targets.spec.ts` met an identical self-contradictory
  // failure, traced it to a box read inside a still-transforming ancestor
  // (43.9921875 for a control whose `min-height` is exactly `--touch-min`),
  // and grew the settle now shared in `settle-layout.ts`. The two taps above
  // leave this page mid-close, which is exactly the state that spec describes,
  // so the same settle belongs here whether or not it explains that one run.
  //
  // It cannot mask a real defect: it is a fixed wait, not a retry-until-green
  // loop, so a control genuinely undersized at rest still fails. The raw-size
  // print below is the other half — if this recurs, the message will say what
  // the number actually was instead of rounding the evidence away.
  await settleLayout(page)
  const controls = page.locator('button:visible, a:visible, input:visible, select:visible')
  const count = await controls.count()
  const tooSmall: string[] = []
  for (let i = 0; i < count; i += 1) {
    const el = controls.nth(i)
    if (await el.isDisabled().catch(() => false)) continue
    const box = await el.boundingBox()
    if (box === null) continue
    if (box.width < 44 || box.height < 44) {
      const label = (await el.getAttribute('aria-label')) ?? (await el.textContent()) ?? '(unlabelled)'
      // RAW, not rounded. The 2026-08-25 failure printed "Open navigation —
      // 44x44" as a control under 44px, which is self-contradictory and told
      // the next reader nothing: the real value was somewhere in [43.5, 44)
      // and `Math.round` erased the only digit that mattered. Three decimals
      // is enough to see a sub-pixel read and short enough to stay readable.
      tooSmall.push(`${label.trim()} — ${box.width.toFixed(3)}x${box.height.toFixed(3)}`)
    }
  }
  expect(tooSmall, `controls under 44px: ${tooSmall.join(', ')}`).toEqual([])

  expect(errors).toEqual([])
})

test('the reference drawer opens and closes on tap, its scrim dismisses it, and it is mutually exclusive with the nav drawer at 768x1024 (roadmap 5.27, 3.17)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/')

  const referenceToggle = page.getByRole('button', { name: 'Reference', exact: true })
  const panel = page.getByRole('complementary', { name: 'Chord and scale reference' })
  const referenceScrim = page.getByTestId('reference-panel-scrim')

  await expect(referenceToggle).toHaveAttribute('aria-expanded', 'false')
  await referenceToggle.tap()
  await expect(referenceToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).toBeVisible()
  await expect(referenceScrim).toBeVisible()
  expect(await hasNoHorizontalScroll(page)).toBe(true)
  await settleTransition(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'reference-open-768x1024.png') })

  // The scrim spans the full viewport, but the panel itself (higher
  // z-index) covers its right portion, and the topbar (also higher
  // z-index, see responsive.css's roadmap-5.27 fix) covers its top 56px
  // band — tap the dimmed strip actually visible below the topbar and to
  // the LEFT of the panel, not the scrim locator's default (geometric
  // centre) position, which at this viewport width falls under the panel.
  await referenceScrim.tap({ position: { x: 20, y: 200 } })
  await expect(referenceToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(panel).toBeHidden()
  await settleTransition(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'reference-closed-after-scrim-768x1024.png') })

  // Mutual exclusion, both directions, at this exact viewport.
  const navToggle = page.getByRole('button', { name: 'Open navigation' })
  await navToggle.tap()
  await expect(navToggle).toHaveAttribute('aria-expanded', 'true')
  await referenceToggle.tap()
  await expect(referenceToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(navToggle).toHaveAttribute('aria-expanded', 'false')
  // Only one scrim ever painted.
  await expect(page.locator('.nav-scrim')).toHaveCount(0)
  await expect(referenceScrim).toBeVisible()

  expect(errors).toEqual([])
})
