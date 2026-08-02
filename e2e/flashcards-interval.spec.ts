import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 2.25 (REQ-3.4.5): the interval-recognition flashcard
 * drill, reached the way a learner reaches it. `buildIntervalDeck` and the
 * `interval-on-staff` grading were complete and fully tested for two rounds
 * while `useFlashcardDrill` hardcoded `buildDeck('staff-to-key', …)` and
 * filtered every interval card out — the drill existed and could not be
 * played. This asserts it can.
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

test('the interval flashcard drill renders two unlabelled noteheads and grades an answer (roadmap 2.25)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Flashcards', exact: true })
    .click()

  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()
  await page.getByLabel('Drill').selectOption('interval-on-staff')

  // Two noteheads on ONE staff, computed — and unlabelled, which is the whole
  // point of a reading drill: a letter name anywhere in the SVG hands the
  // learner the answer.
  const staff = page.getByTestId('staff-note')
  await expect(staff).toBeVisible()
  await expect(page.getByTestId('staff-note-low')).toBeVisible()
  await expect(page.getByTestId('staff-note-high')).toBeVisible()
  await expect(staff).not.toContainText(/[A-G]/)

  const pad = page.getByRole('group', { name: 'Interval answer' })
  await expect(pad.getByRole('button', { name: 'Major 3rd' })).toBeVisible()

  // Answer it. Whether this particular card is a major 3rd is not the point —
  // that it is GRADED is, and the stats counter moving proves the answer
  // reached the SRS scheduler rather than a dead handler.
  await expect(page.getByTestId('flashcard-stats-total')).toHaveText('0')
  await pad.getByRole('button', { name: 'Perfect 5th' }).click()

  await expect(page.getByTestId('flashcard-feedback')).toBeVisible()
  await expect(page.getByTestId('flashcard-stats-total')).toHaveText('1')

  expect(errors).toEqual([])
})
