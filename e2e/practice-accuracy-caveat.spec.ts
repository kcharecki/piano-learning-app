import { expect, test } from '@playwright/test'

/**
 * E2E proof for roadmap 5.48 (REQ-3.3.2): the matcher (`@core/practice/
 * matcher.ts`) judges onset pitch and timing only — its own module comment
 * says plainly that `durationTicks` is never read — so a note released the
 * instant it is struck scores identically to one held for its full written
 * value. The Practice screen's bare accuracy percentage would otherwise
 * imply a more complete judgement than the app actually makes. This proves
 * the statement is reachable from Practice in exactly one click and that its
 * text is the real limitation, not a vague disclaimer.
 *
 * Rewritten for UI-09 (2026-08-12 UI audit): the caveat used to live behind
 * an always-present `<details>`/`<summary>` disclosure, reachable the instant
 * Practice loaded. It is now a `<button aria-label="What this screen doesn't
 * check">` opening a `<dialog>`, and it lives INSIDE the honest feedback
 * strip (`TimingFeedback`), which is itself absent entirely until a run has
 * started (`hasStartedRun` in `PracticeScreen.tsx`) — never a permanent
 * block of prose competing with Play, and never a fake-accuracy strip before
 * a single note has been judged. So this spec now presses Play first: that
 * is the same edge that makes the strip (and the info button inside it)
 * exist at all, and the button is still reachable in exactly one click once
 * it does.
 */

test('the accuracy caveat is reachable from Practice in one click and states the real limitation (roadmap 5.48)', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Practice', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  // UI-09: absent before a run starts — the strip (and this button inside
  // it) do not exist yet, not merely hidden.
  const infoButton = page.getByRole('button', { name: "What this screen doesn't check" })
  await expect(infoButton).toHaveCount(0)

  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  await expect(infoButton).toBeVisible()

  // Closed by default: the limitation text is not permanent prose competing
  // with Play for the learner's attention.
  const caveatText = page.getByText(/not how long you held them/i)
  await expect(caveatText).toBeHidden()

  // One click reveals it.
  await infoButton.click()
  const infoDialog = page.getByRole('dialog', { name: "What this screen doesn't check" })
  await expect(infoDialog).toBeVisible()
  await expect(caveatText).toBeVisible()
  await expect(
    page.getByText(/not your hand position, wrist, or posture/i),
  ).toBeVisible()
  await expect(
    page.getByText(/supplement to practicing with a teacher, not a replacement/i),
  ).toBeVisible()

  // The dialog is modal — close it before stopping the transport, so Stop
  // is not obscured by the dialog's own top layer.
  await infoDialog.getByRole('button', { name: 'Close' }).click()
  await expect(infoDialog).toBeHidden()
  await transport.getByRole('button', { name: 'Stop', exact: true }).click()
})
