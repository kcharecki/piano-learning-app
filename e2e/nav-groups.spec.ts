import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.43: the shell's 12 nav destinations are grouped
 * into Practice / Learn / Drills / Progress, with Today standing alone as
 * the visually primary entry point — not 12 flat, equal buttons. Unit
 * coverage for the grouping and click wiring already lives in
 * `src/app/shell/NavGroups.test.tsx`; this spec proves the three things
 * that only mean something in a real browser: landmark roles an assistive
 * tech user would actually land on, Today's visual weight relative to a
 * grouped item, and that Tab moves through the nav in the same order it's
 * drawn.
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

test('the nav exposes Practice / Learn / Drills / Progress as labelled group landmarks, distinct from the Main navigation landmark (roadmap 5.43)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')

  const main = page.getByRole('navigation', { name: 'Main' })
  await expect(main).toBeVisible()

  const practice = main.getByRole('group', { name: 'Practice', exact: true })
  const learn = main.getByRole('group', { name: 'Learn', exact: true })
  const drills = main.getByRole('group', { name: 'Drills', exact: true })
  const progress = main.getByRole('group', { name: 'Progress', exact: true })

  // Each group actually contains the destinations the roadmap names —
  // proving the landmark is labelled AND groups the right buttons, not
  // just that four empty groups with the right names exist.
  await expect(practice.getByRole('button', { name: 'Practice', exact: true })).toBeVisible()
  await expect(practice.getByRole('button', { name: 'Sight reading' })).toBeVisible()
  await expect(practice.getByRole('button', { name: 'Repertoire' })).toBeVisible()
  await expect(practice.getByRole('button', { name: 'Metronome' })).toBeVisible()

  await expect(learn.getByRole('button', { name: 'Lessons' })).toBeVisible()

  await expect(drills.getByRole('button', { name: 'Flashcards' })).toBeVisible()
  await expect(drills.getByRole('button', { name: 'Ear training' })).toBeVisible()
  await expect(drills.getByRole('button', { name: 'Rhythm' })).toBeVisible()
  await expect(drills.getByRole('button', { name: 'Technique' })).toBeVisible()
  await expect(drills.getByRole('button', { name: 'Theory' })).toBeVisible()

  await expect(progress.getByRole('button', { name: 'Progress', exact: true })).toBeVisible()

  // Today is the entry point, not inside any of the four groups.
  const today = main.getByRole('button', { name: 'Today', exact: true })
  await expect(today).toBeVisible()
  for (const group of [practice, learn, drills, progress]) {
    await expect(group.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0)
  }

  expect(errors).toEqual([])
})

test('Today is styled as the visually primary destination — heavier weight and the accent colour, unlike a grouped item (roadmap 5.43)', async ({
  page,
}) => {
  await page.goto('/')

  const today = page.getByRole('navigation', { name: 'Main' }).getByRole('button', {
    name: 'Today',
    exact: true,
  })
  const lessons = page.getByRole('navigation', { name: 'Main' }).getByRole('button', {
    name: 'Lessons',
    exact: true,
  })

  const [todayStyle, lessonsStyle] = await Promise.all([
    today.evaluate((el) => {
      const s = getComputedStyle(el)
      return { color: s.color, fontWeight: s.fontWeight, fontSize: s.fontSize }
    }),
    lessons.evaluate((el) => {
      const s = getComputedStyle(el)
      return { color: s.color, fontWeight: s.fontWeight, fontSize: s.fontSize }
    }),
  ])

  // Today reads distinctly from an ordinary grouped destination: its own
  // accent-coloured text (never active/aria-current here — this is the
  // UNVISITED state) and a heavier weight, not merely "looks the same".
  expect(todayStyle.color).not.toBe(lessonsStyle.color)
  expect(Number(todayStyle.fontWeight)).toBeGreaterThan(Number(lessonsStyle.fontWeight))
})

test('Tab order through the nav follows the visual order: Today, then each group top to bottom (roadmap 5.43)', async ({
  page,
}) => {
  await page.goto('/')

  // Start from a known point: focus the document body and Tab in.
  //
  // Roadmap UI-36: `.app-nav` IS the first focusable landmark on the page at
  // this (desktop) width again — the topbar (and the action cluster that
  // used to precede the nav inside it, UI-04a/UI-04b) no longer renders here
  // at all; that cluster now lives at the nav's own TRAILING edge instead
  // (`.nav-rail-footer`), after every real destination, not before them. No
  // skip link exists in this app, so the very first Tab from body should
  // land directly inside the nav. The loop (rather than a hardcoded single
  // Tab) stays as the honest bound: a regression that never reaches the nav
  // at all fails with a clear assertion instead of hanging the run.
  //
  // Roadmap DR-01: that first stop is now the Piano/Drums switcher, not
  // Today — `NavGroups.tsx` renders it FIRST inside `.nav-scroll`, ahead of
  // even the primary button (it names which nav table is showing, so it has
  // to be the first thing a learner tabbing into the rail reaches).
  await page.locator('body').click({ position: { x: 1, y: 1 } })

  const MAX_STOPS_BEFORE_NAV = 1
  let enteredNav = false
  for (let i = 0; i < MAX_STOPS_BEFORE_NAV; i++) {
    await page.keyboard.press('Tab')
    enteredNav = await page.evaluate(() => document.activeElement?.closest('.app-nav') !== null)
    if (enteredNav) break
  }
  expect(enteredNav, 'tabbing from the top of the page reaches the nav').toBe(true)

  const expectedOrder = [
    'Piano',
    'Drums',
    'Today',
    'Practice',
    'Sight reading',
    'Repertoire',
    'Metronome',
    'Lessons',
    'Flashcards',
    'Ear training',
    'Rhythm',
    'Technique',
    'Theory',
    'Progress',
  ]

  // Focus is already ON the first nav item, so record it before tabbing again.
  const seen: string[] = []
  for (let i = 0; i < expectedOrder.length; i++) {
    if (i > 0) await page.keyboard.press('Tab')
    const label = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
    seen.push(label)
  }

  expect(seen).toEqual(expectedOrder)
})
