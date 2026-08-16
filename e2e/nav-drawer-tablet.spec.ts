/**
 * Roadmap 5.27 — the ≤1024px nav drawer, asserted rather than eyeballed.
 *
 * This is the claim the 2026-08-06 UX review could not verify at all: the
 * automation pane does not composite frames, so the drawer's
 * `translateX(-100%)` transition sits frozen at t=0 and `elementFromPoint`
 * reports the CLOSED geometry no matter what `data-open` says. Playwright does
 * composite, which is the only reason these assertions mean anything — if this
 * spec is ever ported back to the pane it will silently start testing nothing.
 *
 * Two real defects have already been found here, both of them pointer-event
 * collisions rather than anything visible in a screenshot:
 *
 * 1. The hamburger became unusable the instant the drawer opened — equal
 *    z-index let the drawer paint over `.app-topbar` and swallow taps meant for
 *    `.nav-toggle`, so only the scrim could dismiss it. Fixed by putting the
 *    topbar one tier above the drawer.
 * 2. That fix then hid the drawer's FIRST item under the 56px topbar, because
 *    the drawer still started at `inset: 0`. `elementFromPoint` at Today's
 *    centre returned `.app-topbar`. Exactly one of thirteen items was affected
 *    and it was Today — the default destination and the only item styled as
 *    primary. Fixed by starting the drawer at `--topbar-h` instead.
 *
 * The two fixes pull in opposite directions on the same z-order, which is why
 * this asserts BOTH that every nav item is hittable AND that the hamburger
 * still is: fixing either one alone re-breaks the other.
 */
import { expect, test } from '@playwright/test'

const TABLET_SIZES = [
  { width: 1024, height: 800, label: 'tablet landscape' },
  { width: 768, height: 1024, label: 'tablet portrait' },
] as const

/** Apple's minimum touch target, the bar roadmap B.6 measured against. */
const TOUCH_MIN_PX = 44

for (const size of TABLET_SIZES) {
  test(`the nav drawer is fully operable at ${size.width}x${size.height} (${size.label}) — roadmap 5.27`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.goto('/')

    await page.getByRole('button', { name: /open navigation/i }).click()
    // The transform transition must actually finish: asserting mid-flight is
    // how this reads the closed geometry and passes for the wrong reason.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('nav')!).transform))
      .toBe('none')

    const geometry = await page.evaluate(() => {
      const items = [...document.querySelectorAll('nav button')].map((btn) => {
        // Roadmap DR-01: the Piano/Drums switcher permanently added ~50px of
        // its own chrome (a real 44px touch target plus margin — not
        // reclaimable from padding trims without shrinking something else
        // below the touch minimum) ahead of the 13 piano destinations this
        // spec already found to be an exact fit at 1024x800 (see
        // `.nav-scroll`'s own overflow-fix comment, feature-nav-groups.css).
        // `.nav-scroll` has always been `overflow-y: auto`; the drawer no
        // longer fits everything in one screenful at this breakpoint, so a
        // real user reaches a below-the-fold item by scrolling the drawer —
        // this scrolls each item into view before hit-testing it, the same
        // thing that scroll affordance is for. `blocked` below still catches
        // a genuine regression (something painted permanently on top of an
        // item, unscrollable-into-view or not); it just no longer requires
        // every item to be reachable without scrolling at all.
        btn.scrollIntoView({ block: 'nearest' })
        const r = btn.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return {
          label: (btn.textContent ?? '').trim(),
          height: r.height,
          blocked: hit !== btn && !btn.contains(hit),
          blockedBy: hit instanceof Element ? hit.className || hit.tagName : null,
        }
      })
      const toggle = document.querySelector('.nav-toggle')!
      const t = toggle.getBoundingClientRect()
      const toggleHit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2)
      return {
        items,
        hamburgerHittable: toggleHit instanceof Element && toggleHit.closest('.nav-toggle') !== null,
        horizontalScroll:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }
    })

    // Named, not counted: a regression that hides one item should say which.
    expect(geometry.items.filter((i) => i.blocked)).toEqual([])
    expect(geometry.items.length).toBeGreaterThan(0)
    expect(geometry.hamburgerHittable).toBe(true)
    expect(geometry.horizontalScroll).toBe(false)
    for (const item of geometry.items) {
      expect(item.height, `"${item.label}" is under the ${TOUCH_MIN_PX}px touch minimum`).toBeGreaterThanOrEqual(
        TOUCH_MIN_PX,
      )
    }

    // The scrim still dismisses — the escape hatch that masked defect 1.
    await page.mouse.click(size.width - 20, size.height / 2)
    await expect
      .poll(() => page.evaluate(() => document.querySelector('nav')!.getAttribute('data-open')))
      .not.toBe('true')
  })
}
