import { expect, test } from '@playwright/test'

/**
 * E2E proof for roadmap UI-36: the desktop (>1024px) shell has no topbar —
 * the rail is the whole left edge of the viewport, and the action cluster
 * (input-status chip + Reference toggle) lives in the rail's own footer
 * instead. Unit coverage for the conditional-mount mechanics already lives in
 * `src/app/shell/Shell.test.tsx` and `NavGroups.test.tsx`; this spec proves
 * the three things that only mean something in a real, composited browser:
 * the topbar is genuinely gone (not just visually hidden), the rail's box
 * really does span the full viewport, and the popover — now anchored to a
 * narrow rail footer near the BOTTOM of the screen instead of a topbar near
 * the top — opens upward and unclipped rather than running off-screen.
 *
 * Deliberately does no `elementFromPoint` hit-testing (that style belongs to
 * `nav-drawer-tablet.spec.ts`'s off-canvas-drawer geometry, a different
 * problem): every assertion here is a `getBoundingClientRect`/`toHaveCount`
 * check, which is what a "does X exist/overlap Y" claim about a static
 * sidebar actually needs.
 */

const CHIP = /MIDI connected|No MIDI — using on-screen keys/

test('at desktop widths there is no .app-topbar, the rail spans the full viewport, the popover opens unclipped, and Escape returns focus to the visible Reference toggle at both widths', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  // The topbar does not exist in the DOM at all above 1024px — not merely
  // `display: none` — so a stray selector reaching for it elsewhere in the
  // app finds nothing to accidentally style or query.
  await expect(page.locator('.app-topbar')).toHaveCount(0)

  // The rail is a full-height sidebar, not a column that happens to be tall:
  // its own box starts at the viewport top and runs the full viewport height
  // (domain.css's `.app-nav { height: 100vh }`, unscrolled here so `y` is 0).
  const nav = page.locator('nav.app-nav')
  const navBox = await nav.boundingBox()
  expect(navBox).not.toBeNull()
  expect(navBox?.y).toBe(0)
  expect(navBox?.height).toBe(800)

  // Exactly one Reference toggle exists at this width — the one-instance
  // rule (Shell.tsx's own comment) rendered into the rail footer, not the
  // (nonexistent) topbar.
  const reference = page.getByRole('button', { name: 'Reference' })
  await expect(reference).toHaveCount(1)
  await expect(reference).toBeVisible()

  // Opening the chip's popover from the rail footer — near the BOTTOM of a
  // tall viewport — must flip upward and stay fully inside the viewport,
  // never clipped by the bottom edge the way a naive downward-opening
  // popover anchored this low would be.
  const chip = page.getByRole('button', { name: CHIP })
  await chip.click()
  const popover = page.locator('#input-status-popover')
  await expect(popover).toBeVisible()

  const [popoverBox, chipBox, railBox] = await Promise.all([
    popover.boundingBox(),
    chip.boundingBox(),
    nav.boundingBox(),
  ])
  expect(popoverBox).not.toBeNull()
  expect(chipBox).not.toBeNull()
  expect(railBox).not.toBeNull()
  if (popoverBox === null || chipBox === null || railBox === null) throw new Error('unreachable')

  // Upward flip: the popover's bottom edge sits above the chip's top edge
  // (feature-bluetooth-midi.css's `.nav-actions .input-status-popover {
  // bottom: calc(100% + var(--space-2)) }`), not below it.
  expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(chipBox.y)
  // Fully inside the viewport — the flip actually avoided clipping, not just
  // moved the clip to a different edge.
  expect(popoverBox.y).toBeGreaterThanOrEqual(0)
  expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(800)
  expect(popoverBox.x).toBeGreaterThanOrEqual(0)
  expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(1280)
  // Wider than the narrow rail it grows out of — the popover is real content
  // (explanatory text, device status, buttons), not squeezed to the rail's
  // own width, which is the whole reason it floats rather than growing the
  // rail footer's own box.
  expect(popoverBox.x + popoverBox.width).toBeGreaterThan(railBox.x + railBox.width)

  // Escape closes the popover and returns focus to the chip that opened it —
  // same contract as every other overlay in this app.
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(chip).toBeFocused()

  // The same proof holds again once the shell drops to the >1024px floor
  // (1024x800 itself is compact — see Shell.tsx's `(max-width: 1024px)`
  // query — so this checks the desktop side of that exact boundary at
  // 1025px, still using the rail-footer home).
  await page.setViewportSize({ width: 1025, height: 800 })
  await expect(page.locator('.app-topbar')).toHaveCount(0)
  const referenceAgain = page.getByRole('button', { name: 'Reference' })
  await expect(referenceAgain).toHaveCount(1)

  const chipAgain = page.getByRole('button', { name: CHIP })
  await chipAgain.click()
  await expect(page.locator('#input-status-popover')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#input-status-popover')).toHaveCount(0)
  await expect(chipAgain).toBeFocused()
})
