import { expect, test } from '@playwright/test'

/**
 * E2E proof for roadmap 5.48 (REQ-3.3.2): the matcher (`@core/practice/
 * matcher.ts`) judges onset pitch and timing only — its own module comment
 * says plainly that `durationTicks` is never read — so a note released the
 * instant it is struck scores identically to one held for its full written
 * value. The Practice screen's bare accuracy percentage would otherwise
 * imply a more complete judgement than the app actually makes. This proves
 * the statement is reachable from Practice in exactly one click (closed by
 * default, so it costs the screen nothing until asked for — see roadmap
 * 5.18, which this same screen also declutters) and that its text is the
 * real limitation, not a vague disclaimer.
 */

test('the accuracy caveat is reachable from Practice in one click and states the real limitation (roadmap 5.48)', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Practice', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  const summary = page.getByText("What this screen doesn't check")
  await expect(summary).toBeVisible()

  // Closed by default: the limitation text is not permanent prose competing
  // with Play for the learner's attention.
  const caveatText = page.getByText(/not how long you held them/i)
  await expect(caveatText).toBeHidden()

  // One click reveals it.
  await summary.click()
  await expect(caveatText).toBeVisible()
  await expect(
    page.getByText(/not your hand position, wrist, or posture/i),
  ).toBeVisible()
  await expect(
    page.getByText(/supplement to practicing with a teacher, not a replacement/i),
  ).toBeVisible()
})
