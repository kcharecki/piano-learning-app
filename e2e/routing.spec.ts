import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.42: real URL routing (`@app/shell/route.ts` +
 * `@app/shell/routing.ts`) replaces the old bare `useState<ScreenId>` — a
 * URL per destination, deep links carrying identity (not just which screen),
 * Back/Forward doing what they say, and a reload landing where the address
 * bar already says.
 *
 * DEEP-LINK SCOPE, STATED HONESTLY: the roadmap's proof text names "Practice
 * → Lessons → a named lesson" as the click path. `LessonsScreen` itself
 * (`src/app/lessons/LessonsScreen.tsx`, not owned by this task — see
 * `docs/agent-brief.md`'s file boundary) keeps which lesson is selected in
 * `useLessons.ts`'s own private `useState`, with no prop or external store
 * to seed it from outside, so the lesson BODY selection itself is not
 * deep-linkable without editing that screen (see the shell task's final
 * report for the exact prop this would need: `initialLessonId` +
 * `onSelectLesson`, mirroring `TechniqueScreen`'s existing
 * `initialDrillId` pattern). What IS fully deep-linkable today, because
 * `Shell.tsx` already owns this state (`OpenedDeck`/`OpenedTechnique`/
 * `OpenedTheoryDrill`, used by the pre-existing Today-plan routing), is
 * OPENING one of that lesson's own exercises — which is exactly what a
 * learner does next after finding "a named lesson". This spec drives that
 * real path: Practice → Lessons → Level 3 → "The Circle of Fifths" → its
 * quiz exercise, landing on the flashcard deck/level THAT LESSON names
 * (`key-signature` / level 7 — the same real exercise
 * `src/app/shell/Shell.test.tsx`'s "opens a lesson quiz on the deck and
 * level that lesson named" test already proves opens correctly; this spec
 * additionally proves the URL, Back/Forward and reload around it).
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

function nav(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
}

function pathOf(page: Page): string {
  return new URL(page.url()).pathname
}

test('Practice → Lessons → a lesson exercise changes the URL at each step, Back twice returns to Practice, Forward twice replays it, and the deep-link URL reloads to the same exercise (roadmap 5.42)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  // The `/` -> `/today` normalization happens in a post-mount effect
  // (`routing.ts`'s `useRoute`), a moment after the `load` event `goto`
  // itself waits for — so wait for Today's own content before reading the
  // URL, the same way every assertion below waits for a heading first.
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()
  expect(pathOf(page)).toBe('/today') // roadmap 5.39's default, not asserted again below

  await nav(page, 'Practice').click()
  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()
  expect(pathOf(page)).toBe('/practice')

  await nav(page, 'Lessons').click()
  await expect(page.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible()
  expect(pathOf(page)).toBe('/lessons')

  await page.getByRole('button', { name: 'Level 3', exact: true }).click()
  await page.getByRole('button', { name: 'The Circle of Fifths', exact: true }).click()
  await page
    .getByRole('button', { name: 'Open Quiz: the circle of fifths and key signatures' })
    .click()

  // The deep link: screen + deck kind + level, all three carried in the URL,
  // not just "which screen".
  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()
  await expect(page.getByLabel('Drill', { exact: true })).toHaveValue('key-signature')
  // Roadmap UI-12: `flashcard-level` holds only the number now — the "Level"
  // label moved outside the stepper into its own `.field` label.
  await expect(page.getByTestId('flashcard-level')).toHaveText('7')
  expect(pathOf(page)).toBe('/flashcards/key-signature/7')
  const deepLinkUrl = page.url()

  // Back twice: flashcards deep link -> Lessons -> Practice.
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible()
  expect(pathOf(page)).toBe('/lessons')

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()
  expect(pathOf(page)).toBe('/practice')
  await expect(nav(page, 'Practice')).toHaveAttribute('aria-current', 'page')

  // Forward twice: Practice -> Lessons -> the SAME deep-linked flashcard deck
  // and level, restored from the URL alone (no re-click through Lessons).
  await page.goForward()
  await expect(page.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible()
  expect(pathOf(page)).toBe('/lessons')

  await page.goForward()
  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()
  await expect(page.getByLabel('Drill', { exact: true })).toHaveValue('key-signature')
  // Roadmap UI-12: `flashcard-level` holds only the number now — the "Level"
  // label moved outside the stepper into its own `.field` label.
  await expect(page.getByTestId('flashcard-level')).toHaveText('7')
  expect(pathOf(page)).toBe('/flashcards/key-signature/7')

  // Reload proof: loading the deep-link URL directly (a fresh navigation,
  // not history traversal) reproduces the exact same destination.
  await page.goto(deepLinkUrl)
  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()
  await expect(page.getByLabel('Drill', { exact: true })).toHaveValue('key-signature')
  // Roadmap UI-12: `flashcard-level` holds only the number now — the "Level"
  // label moved outside the stepper into its own `.field` label.
  await expect(page.getByTestId('flashcard-level')).toHaveText('7')
  await expect(nav(page, 'Flashcards')).toHaveAttribute('aria-current', 'page')

  expect(errors).toEqual([])
})

test('a technique deep link (screen + drill id + level) survives a direct reload (roadmap 5.42)', async ({
  page,
}) => {
  // A second, independently-owned deep-link kind (not routed through
  // Lessons at all) — the technique screen — proving the reload behaviour
  // generalises rather than being special-cased for flashcards.
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Today').click()
  await page
    .getByRole('button', { name: 'Open C major five-finger pattern, right hand' })
    .click()

  await expect(page.getByRole('heading', { name: /technique/i })).toBeVisible()
  const path = pathOf(page)
  // `OpenedTechnique.level` is non-optional (see Shell.tsx), so a technique
  // deep link always carries both the drill id and its level.
  expect(path).toMatch(/^\/technique\/[^/]+\/\d+$/)

  await page.reload()
  await expect(page.getByRole('heading', { name: /technique/i })).toBeVisible()
  expect(pathOf(page)).toBe(path)
  await expect(nav(page, 'Technique')).toHaveAttribute('aria-current', 'page')

  expect(errors).toEqual([])
})

test('an unknown path falls back to Today instead of a blank or broken screen (roadmap 5.42)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/this-is-not-a-real-route')

  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()
  await expect(nav(page, 'Today')).toHaveAttribute('aria-current', 'page')
  expect(pathOf(page)).toBe('/today')

  expect(errors).toEqual([])
})
