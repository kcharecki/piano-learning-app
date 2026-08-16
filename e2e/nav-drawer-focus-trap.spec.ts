import { expect, test } from '@playwright/test'

/**
 * The nav drawer's Tab-cycling focus trap (a11y sweep, 2026-08 UI audit
 * follow-up). `Shell.tsx` already had Escape-close and focus-return
 * (roadmap UI-04a) but no trap — deliberately held back because it needs
 * viewport awareness: `.app-nav` is a genuine off-canvas DRAWER over content
 * only at <=1024px (responsive.css); at every wider viewport the identical
 * markup is a static sidebar next to `<main>`, and trapping Tab there would
 * strand a keyboard user inside the rail.
 *
 * Decision (this task): BUILD the trap, scoped live to the same
 * `(max-width: 1024px)` query responsive.css itself uses, re-checked on every
 * Tab press rather than cached at open — see `Shell.tsx`'s own comment on the
 * effect for the full reasoning. Without it, Tab from the drawer's last item
 * left the viewport at <=1024px (main is covered by the scrim there, so its
 * controls are invisible while still receiving focus) — a real trap gap the
 * Reference panel and every `<dialog>`-based overlay in this app already
 * close for their own overlay, just not this one until now.
 *
 * Both widths are proven in the SAME `navOpen` state — this file resizes the
 * viewport mid-test (drawer opened at <=1024px, then widened past 1024px)
 * rather than closing and reopening, so it is the live media-query check
 * inside the handler being exercised, not merely two independent opens that
 * happen to land on either side of the breakpoint.
 */

test('at <=1024px, Tab from the drawer\'s last item wraps to its first, and Shift+Tab from the first wraps to its last', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto('/')

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('nav')!).transform))
    .toBe('none')

  // Roadmap DR-01: the drawer's first focusable control is now the Piano/
  // Drums switcher, not Today — `NavGroups.tsx` renders it first inside
  // `.nav-scroll`, ahead of even the primary button.
  const first = page.locator('nav.app-nav').getByRole('radio', { name: 'Piano' })
  const settings = page.locator('nav.app-nav').getByRole('button', { name: 'Settings', exact: true })
  await expect(first).toBeVisible()
  await expect(settings).toBeVisible()

  // Forward wrap: focus the drawer's last real control, Tab once, land back
  // on its first (the switcher's Piano segment) — never escaping into the
  // scrim-covered page behind it.
  await settings.focus()
  await page.keyboard.press('Tab')
  await expect(first).toBeFocused()

  // Backward wrap: from the first, Shift+Tab lands on the last.
  await page.keyboard.press('Shift+Tab')
  await expect(settings).toBeFocused()

  // The trap does not swallow navigation itself — activating an item still
  // closes the drawer and navigates, exactly as before this task.
  await settings.press('Enter')
  await expect(page.locator('nav.app-nav')).toHaveAttribute('data-open', 'false')
})

test('at desktop width, the SAME navOpen state does not trap Tab — it leaves the drawer into <main>', async ({
  page,
}) => {
  // Open the drawer while it is genuinely a drawer…
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('nav')!).transform))
    .toBe('none')

  // …then widen past the breakpoint WITHOUT closing it — `navOpen` is React
  // state and survives a resize; only the CSS media query changes. This is
  // the scenario that actually exercises the live matchMedia check inside
  // Shell.tsx's Tab handler, not just "the trap was never wired at this
  // width to begin with".
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('nav.app-nav')).toHaveAttribute('data-open', 'true')

  const settings = page.locator('nav.app-nav').getByRole('button', { name: 'Settings', exact: true })
  await settings.focus()
  await expect(settings).toBeFocused()

  // At this width `.app-nav` is a static sidebar and `<main>` sits right
  // after it in DOM order — Tab must eventually leave the drawer into the
  // page, not wrap back to Today. Roadmap UI-36: Settings is no longer the
  // LAST focusable control inside `.app-nav` at this width — the rail
  // footer's action cluster (input-status chip, then Reference) sits after
  // `.nav-scroll` as `.app-nav`'s own trailing content, so two more Tab
  // stops land inside the nav before focus actually reaches `<main>`.
  await page.keyboard.press('Tab')
  const today = page.locator('nav.app-nav .nav-primary')
  await expect(today).not.toBeFocused()
  const chip = page.locator('nav.app-nav .nav-actions .input-status-chip')
  await expect(chip).toBeFocused()

  await page.keyboard.press('Tab')
  const reference = page.locator('nav.app-nav').getByRole('button', { name: 'Reference' })
  await expect(reference).toBeFocused()

  await page.keyboard.press('Tab')
  const focusedInMain = await page.evaluate(() => {
    const el = document.activeElement
    return el !== null && document.querySelector('main')?.contains(el) === true
  })
  expect(focusedInMain).toBe(true)
})
