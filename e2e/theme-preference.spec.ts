import { expect, test } from '@playwright/test'

/**
 * Proof for roadmap UI-05: the theme a learner chooses in Settings survives a
 * reload, AND is already correct on the first paint.
 *
 * The second half is the interesting one. IndexedDB holds the preference but
 * cannot be read synchronously, and `App.tsx` calls `restoreSession` from a
 * `useEffect` — which runs after React's first paint. Restoring the theme
 * first among the twelve slices narrows the flash window but cannot close it.
 * `index.html` therefore carries a blocking inline script that reads a
 * localStorage paint hint (written through by `themeStore.ts` on every theme
 * change) before the module bundle is fetched.
 *
 * "Before first paint" is asserted rather than assumed: an init script — which
 * runs before ANY page script — installs a MutationObserver that records
 * `document.readyState` at the moment `data-theme` first appears. If the
 * inline script is doing the work, that readyState is 'loading', because the
 * document is still being parsed. If the attribute only arrived from React's
 * restore effect, readyState would be 'complete' (or at least 'interactive'),
 * which is exactly the flash this guards against.
 */

const OBSERVE_FIRST_THEME_WRITE = () => {
  const w = window as unknown as { __themeSetAt?: string }
  // Playwright re-runs init scripts per navigation; never clobber a record
  // that a previous run already captured, or the observation is lost.
  if (w.__themeSetAt !== undefined) return

  // If the attribute is somehow already there before any observer could see
  // it, that is still a pass for what this test cares about — record it as
  // such rather than reporting a misleading "never set".
  if (document.documentElement?.getAttribute('data-theme') != null) {
    w.__themeSetAt = `already-set-at-${document.readyState}`
    return
  }

  w.__themeSetAt = 'never-set'
  // Observe `document`, not `document.documentElement`: an init script runs at
  // document_start, where documentElement is still NULL and touching it throws
  // before the observer is ever installed — which reads back as "the attribute
  // was never set" and looks exactly like a real failure. Observing the
  // document with subtree catches the same attribute change on <html> once it
  // exists.
  new MutationObserver((records, observer) => {
    for (const r of records) {
      if (r.attributeName !== 'data-theme') continue
      if (document.documentElement?.getAttribute('data-theme') == null) continue
      w.__themeSetAt = document.readyState
      observer.disconnect()
      return
    }
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] })
}

test('a chosen theme persists across a reload and is applied before the first paint', async ({
  page,
}) => {
  await page.addInitScript(OBSERVE_FIRST_THEME_WRITE)
  await page.goto('/')

  // Choose Light through the real Settings UI, not by seeding storage.
  await page
    .getByRole('link', { name: 'Settings' })
    .or(page.getByRole('button', { name: 'Settings' }))
    .first()
    .click()

  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // Reload: the choice must survive, and must land before the document has
  // finished parsing — i.e. from the inline script, not from React's restore.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  const setAt = await page.evaluate(
    () => (window as unknown as { __themeSetAt?: string }).__themeSetAt ?? 'observer-never-ran',
  )
  // 'loading' = the blocking inline script did it mid-parse. 'already-set-at-*'
  // = even earlier. Anything else ('interactive'/'complete') means the
  // attribute only arrived once React's restore effect ran, which IS the flash.
  expect(
    setAt,
    'data-theme must be set while the document is still parsing (no flash of the wrong theme)',
  ).toMatch(/^(loading|already-set-at-)/)
})

test('System removes the attribute rather than hardcoding a palette', async ({ page }) => {
  await page.goto('/')
  await page
    .getByRole('link', { name: 'Settings' })
    .or(page.getByRole('button', { name: 'Settings' }))
    .first()
    .click()

  await page.getByRole('radio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  // 'System' must hand control back to prefers-color-scheme. Hardcoding dark
  // here would be indistinguishable from a real choice of Dark, and would stop
  // the learner's OS light mode from ever taking effect.
  await page.getByRole('radio', { name: 'System' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/)
})
