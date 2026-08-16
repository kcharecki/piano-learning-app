import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap DR-01: the Piano/Drums instrument switcher —
 * `src/app/shell/route.ts`'s `AppRoute`, `routing.ts`'s hint-driven bare-root
 * default, and `Shell.tsx`'s per-instrument nav tables. `e2e/routing.spec.ts`
 * (untouched by this task) is the proof that every existing piano route still
 * resolves; this spec covers only what DR-01 actually added — behavioural
 * assertions (nav contents, URL, persistence), never mere presence.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

function switcher(page: Page) {
  return page.getByRole('radiogroup', { name: 'Instrument' })
}

function pathOf(page: Page): string {
  return new URL(page.url()).pathname
}

test('clicking Drums swaps the entire nav to drums’ own table and lands on /drums/today; clicking Piano swaps it back (roadmap DR-01)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()
  expect(pathOf(page)).toBe('/today')
  // Piano's own nav table is showing — pick two items from two different
  // groups, not just the standalone Today button.
  await expect(mainNav(page).getByRole('button', { name: 'Practice', exact: true })).toBeVisible()
  await expect(mainNav(page).getByRole('button', { name: 'Flashcards', exact: true })).toBeVisible()
  await expect(switcher(page).getByRole('radio', { name: 'Piano' })).toHaveAttribute('aria-checked', 'true')
  await expect(switcher(page).getByRole('radio', { name: 'Drums' })).toHaveAttribute('aria-checked', 'false')

  await switcher(page).getByRole('radio', { name: 'Drums' }).click()

  expect(pathOf(page)).toBe('/drums/today')
  await expect(page.getByRole('heading', { name: 'Drums — start here' })).toBeVisible()
  // The swap is total: not one piano nav button survives in the rail, and
  // the only item left is drums' own Today.
  await expect(mainNav(page).getByRole('button', { name: 'Practice', exact: true })).toHaveCount(0)
  await expect(mainNav(page).getByRole('button', { name: 'Flashcards', exact: true })).toHaveCount(0)
  await expect(mainNav(page).getByRole('button', { name: 'Today', exact: true })).toBeVisible()
  await expect(switcher(page).getByRole('radio', { name: 'Drums' })).toHaveAttribute('aria-checked', 'true')
  await expect(switcher(page).getByRole('radio', { name: 'Piano' })).toHaveAttribute('aria-checked', 'false')

  // And back: the swap runs both directions, not just piano -> drums.
  await switcher(page).getByRole('radio', { name: 'Piano' }).click()

  expect(pathOf(page)).toBe('/today')
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()
  await expect(mainNav(page).getByRole('button', { name: 'Practice', exact: true })).toBeVisible()

  expect(errors).toEqual([])
})

test('a cold deep-link to /drums/today loads directly into drums with drums’ own nav, no piano flash (roadmap DR-01)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  // A fresh navigation straight to the drums URL — not a click-through from
  // piano — proves the instrument is read from the URL itself, not carried
  // over from wherever the app last was.
  await page.goto('/drums/today')

  await expect(page.getByRole('heading', { name: 'Drums — start here' })).toBeVisible()
  expect(pathOf(page)).toBe('/drums/today')
  await expect(mainNav(page).getByRole('button', { name: 'Practice', exact: true })).toHaveCount(0)
  await expect(switcher(page).getByRole('radio', { name: 'Drums' })).toHaveAttribute('aria-checked', 'true')

  expect(errors).toEqual([])
})

test('the last-used instrument persists across a reload, including a bare / reopen (roadmap DR-01)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()

  await switcher(page).getByRole('radio', { name: 'Drums' }).click()
  await expect(page.getByRole('heading', { name: 'Drums — start here' })).toBeVisible()
  expect(pathOf(page)).toBe('/drums/today')

  // A literal reload of the explicit /drums/today URL: trivially still
  // drums (the URL alone already says so) — but it also proves the reload
  // doesn't regress to the piano default some other way.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Drums — start here' })).toBeVisible()
  expect(pathOf(page)).toBe('/drums/today')

  // The real persistence proof: a fresh navigation to the bare, instrument-less
  // root — as if the learner reopened the app from scratch — still lands in
  // drums, because the choice was remembered, not because the URL said so.
  // The `/` -> `/drums/today` normalization happens in a post-mount effect
  // (routing.ts's `useRoute`, same as `/` -> `/today` in e2e/routing.spec.ts),
  // a moment after the `load` event `goto` itself waits for — so wait for
  // the drums heading before reading the URL.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Drums — start here' })).toBeVisible()
  expect(pathOf(page)).toBe('/drums/today')
  await expect(switcher(page).getByRole('radio', { name: 'Drums' })).toHaveAttribute('aria-checked', 'true')

  // And it isn't a one-way ratchet: switching back to piano and reopening
  // bare-root honours THAT choice too.
  await switcher(page).getByRole('radio', { name: 'Piano' }).click()
  expect(pathOf(page)).toBe('/today')

  await page.goto('/')
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()
  expect(pathOf(page)).toBe('/today')

  expect(errors).toEqual([])
})
