import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for the M2 persistence fixes (roadmap 1.24, REQ-3.9.4): answering
 * a flashcard schedules its SRS card, and that card survives a real reload
 * through IndexedDB — the one thing a green vitest suite cannot prove, since
 * `persistence.ts` and `useFlashcardStore` are exercised there with an
 * in-memory `Store` fake, never a browser database, and `useFlashcardDrill`'s
 * defect-1 bug (scheduling against a page-load-relative Clock instead of a
 * wall-clock DateSource) was specifically invisible within a single page
 * life. Thin on purpose, matching `smoke.spec.ts`'s own note: behavioural
 * depth belongs in the fast suites; this only proves the wiring survives a
 * real reload in a real browser.
 */

/** Console/page errors, collected from the moment the page is created. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('answering a flashcard survives a reload — the SRS stats are restored from IndexedDB', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click()

  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
  await keyboard.getByRole('button').first().click()

  await expect(page.getByTestId('flashcard-feedback')).toBeVisible()
  await expect(page.getByTestId('flashcard-stats-total')).toHaveText('1')

  // Read every stat back before the reload — these are what must survive,
  // untouched, once the same slice is restored from IndexedDB.
  const dueBefore = await page.getByTestId('flashcard-stats-due').textContent()
  const youngBefore = await page.getByTestId('flashcard-stats-young').textContent()
  const matureBefore = await page.getByTestId('flashcard-stats-mature').textContent()
  const easeBefore = await page.getByTestId('flashcard-stats-ease').textContent()

  await page.reload()
  // The nav resets to its default tab on reload — the saved SESSION does not
  // include which tab was open, only the score/settings/sight-reading/SRS
  // state — so the Flashcards screen has to be reached again the same way a
  // learner would.
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click()

  await expect(page.getByTestId('flashcard-stats-total')).toHaveText('1')
  await expect(page.getByTestId('flashcard-stats-due')).toHaveText(dueBefore ?? '')
  await expect(page.getByTestId('flashcard-stats-young')).toHaveText(youngBefore ?? '')
  await expect(page.getByTestId('flashcard-stats-mature')).toHaveText(matureBefore ?? '')
  await expect(page.getByTestId('flashcard-stats-ease')).toHaveText(easeBefore ?? '')

  expect(errors).toEqual([])
})
