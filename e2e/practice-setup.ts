import type { Page } from '@playwright/test'

/**
 * Opens the Practice screen's "Practice setup" disclosure.
 *
 * Roadmap UI-24 (2026-08-15 final visual pass) changed that `<details>` from
 * `open` to closed by default — see `PracticeScreen.tsx`'s own comment for the
 * decision and its reasoning. Loop range, hand mute, metronome, piano roll,
 * wait mode and record/replay all live inside it, and nine specs in this suite
 * reached them directly with no expand step. This is that expand step, in one
 * place, so the next change to the disclosure's default is a one-file edit
 * rather than nine.
 *
 * Idempotent: a `<details>` that is already open is left alone rather than
 * toggled shut, so a spec may call this more than once (or after a navigation
 * that re-mounted the screen) without having to track the state itself.
 *
 * Deliberately NOT a `summary.click()`: clicking an already-open disclosure
 * closes it, which is the exact failure mode this guard exists to prevent.
 */
export async function openPracticeSetup(page: Page): Promise<void> {
  const details = page.locator('details.practice-setup')
  await details.waitFor({ state: 'attached' })
  if (await details.evaluate((el: HTMLDetailsElement) => el.open)) return
  await page.getByText('Practice setup', { exact: true }).click()
  await details.waitFor({ state: 'attached' })
}
