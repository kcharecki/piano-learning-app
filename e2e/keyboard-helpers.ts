import type { Locator, Page } from '@playwright/test'

/**
 * Shared driving helper for the keyboard-only accessibility sweep (a11y
 * sweep, 2026-08). Every "keyboard-only flow" spec in this suite needs the
 * same primitive: reach a specific control by REAL Tab presses (never
 * `locator.focus()`, which silently proves nothing about Tab order — a
 * control could be reachable only via `.focus()` and totally unreachable by
 * keyboard, and a test built on `.focus()` would still pass).
 *
 * Deliberately keyed on an existing Playwright `Locator` (built the normal
 * way, via `getByRole`/`getByLabel`/etc.) rather than re-deriving an
 * accessible name from raw DOM text: Playwright's own locators already do
 * correct ARIA name computation (aria-label, aria-labelledby, associated
 * `<label for>`, …), which a `textContent`/`aria-label` heuristic — the
 * technique `e2e/reference-panel.spec.ts`'s own `shiftTabUntil` uses — gets
 * wrong for a `<select>` (whose `textContent` concatenates every `<option>`,
 * not its label).
 */
export async function tabTo(
  page: Page,
  target: Locator,
  options?: { readonly max?: number; readonly shift?: boolean },
): Promise<void> {
  const max = options?.max ?? 200
  const key = options?.shift === true ? 'Shift+Tab' : 'Tab'
  for (let i = 0; i < max; i += 1) {
    const isFocused = await target
      .evaluate((el) => el === document.activeElement)
      .catch(() => false)
    if (isFocused) return
    await page.keyboard.press(key)
  }
  throw new Error(`target locator was not reached by ${key} within ${max} hops`)
}

/** The shell's top nav, scoped exactly like every other spec's own `nav()` helper. */
export function navButton(page: Page, label: string): Locator {
  return page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
}

/** Tabs to the named nav destination and activates it with Enter — the
 *  keyboard-only equivalent of every other spec's `nav(page, label).click()`. */
export async function goToViaKeyboard(page: Page, label: string): Promise<void> {
  await tabTo(page, navButton(page, label))
  await page.keyboard.press('Enter')
}
