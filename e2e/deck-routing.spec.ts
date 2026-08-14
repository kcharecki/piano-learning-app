import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 4.9c (REQ-3.5.2 / REQ-3.1.4). Until just now,
 * `FlashcardScreen` kept its deck kind in private `useState` initialised to
 * `'staff-to-key'`, with no prop the shell could pass — so every planned
 * `theory-quiz` item opened the note-naming deck no matter what its title
 * promised. `FlashcardScreen` now takes an optional `initialKind` prop, and
 * `Shell.tsx`'s flashcards case reads `exercise.params.drillKind` (via
 * `openedDeckOf`) and passes it through.
 *
 * `e2e/flashcards-interval.spec.ts` already proves the interval deck WORKS —
 * but it selects it by hand from the "Drill" picker. That is not what this
 * proves. This drives the real "Today" plan, opens the item titled "Interval
 * flashcards" WITHOUT ever touching the picker, and checks the deck that
 * actually renders is the interval deck — not merely that the screen opened.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/screens.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function nav(page: Page, label: string) {
  return page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true })
}

test('opening the planned "Interval flashcards" item opens the interval deck, not the default note-naming one (roadmap 4.9c)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Today').click()
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()

  // The interval candidate only becomes reachable once the theory-ear segment
  // exceeds ~10 minutes (`fillSegment` allocates min(remaining,
  // FLASHCARD_DECK_MINUTES) per item — see candidates.ts's `theoryEarCandidates`
  // comment), which the default 30-minute budget never clears. 60 minutes does.
  await page
    .getByRole('radiogroup', { name: 'Session length' })
    .getByRole('radio', { name: '60 min', exact: true })
    .click()

  const items = page.getByRole('list', { name: 'Session items' }).getByRole('listitem')
  // candidates.ts titles the interval deck's item exactly "Interval flashcards"
  // — read it off the plan rather than hardcoding its exercise id.
  const intervalItem = items.filter({ hasText: 'Interval flashcards' })
  await expect(
    intervalItem,
    'the plan must contain the "Interval flashcards" item at the 60-minute budget for this test to open it',
  ).toHaveCount(1)

  const openButton = intervalItem.getByRole('button', { name: /^Open/ })
  const ariaLabel = await openButton.getAttribute('aria-label')
  const match = ariaLabel === null ? null : /^Open (.+)$/.exec(ariaLabel)
  if (match?.[1] === undefined) {
    throw new Error(`could not read a planned item title out of Open button aria-label "${ariaLabel}"`)
  }
  // Confirms the title read off the button matches what candidates.ts names
  // the interval deck's exercise — not some other item that merely mentions
  // "Interval flashcards" in passing.
  expect(match[1]).toBe('Interval flashcards')

  // The learner never touches the "Drill" picker before this click — the
  // whole point is that the plan routes the deck on its own.
  await openButton.click()

  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()
  await expect(nav(page, 'Flashcards')).toHaveAttribute('aria-current', 'page')

  // THE KILLER ASSERTIONS. A Shell reverted to bare `<FlashcardScreen />`
  // drops `initialKind`, so `useState<DrillKind>` seeds `'staff-to-key'`
  // regardless of which deck the plan named — the picker would show
  // 'staff-to-key' and the on-screen keyboard would render instead of the
  // interval prompt.
  // `exact: true` (roadmap 5.43): the shell nav now groups its Drills
  // destinations under a `role="group"` labelled "Drills", which a
  // non-exact `getByLabel('Drill')` also matches as a substring — see
  // `e2e/routing.spec.ts`'s module comment for the same disambiguation.
  await expect(page.getByLabel('Drill', { exact: true })).toHaveValue('interval-on-staff')

  // The interval deck's own prompt — two unlabelled noteheads on one staff —
  // proves the screen really opened that deck, not just that the select's
  // value looks right while the wrong card renders underneath.
  const staff = page.getByTestId('staff-note')
  await expect(staff).toBeVisible()
  await expect(page.getByTestId('staff-note-low')).toBeVisible()
  await expect(page.getByTestId('staff-note-high')).toBeVisible()
  await expect(staff).not.toContainText(/[A-G]/)
  await expect(page.getByRole('group', { name: 'Interval answer' })).toBeVisible()

  // And the note-naming deck's on-screen keyboard must NOT be showing.
  await expect(page.getByRole('group', { name: 'On-screen keyboard' })).toHaveCount(0)

  expect(errors).toEqual([])
})
