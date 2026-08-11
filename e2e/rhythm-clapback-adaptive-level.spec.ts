import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for the MAJOR-1 review finding (roadmap 3.21 adversarial audit,
 * `useClapbackDrill.ts`): the clap-back level used to be plain component
 * `useState`, reset to Level 1 on every mount and never persisted anywhere —
 * `RhythmClapback.test.tsx`/`useClapbackDrill.test.ts` already prove the fix
 * at the unit level (a fresh hook instance reads the level back from
 * `useEarTrainingStore`, and 5 consecutive perfect graded runs promote it);
 * this proves the SAME thing survives what those unit tests cannot exercise
 * at all — a real, full page reload, through the actual IndexedDB-backed
 * persistence layer (`app/state/persistence.ts`), not just a React remount
 * inside one running JS session.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('the clap-back level survives a real page reload — it no longer resets to Level 1 (roadmap 3.21 review fix)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Rhythm' })
    .click()
  await page.getByRole('button', { name: 'Clap-back mode' }).click()

  await expect(page.getByTestId('clapback-level')).toHaveText('Level 1')
  await page.getByRole('button', { name: 'Increase level' }).click()
  await page.getByRole('button', { name: 'Increase level' }).click()
  await expect(page.getByTestId('clapback-level')).toHaveText('Level 3')

  // `persistence.ts`'s write queue (`createWriteQueue`) saves to IndexedDB
  // asynchronously with no synchronous "flush" signal this test can await —
  // give it a moment to actually land before reloading, or the reload can
  // race ahead of the second click's own write.
  await page.waitForTimeout(300)

  // A full reload — a new page load, not a React remount — is the only thing
  // that actually distinguishes "persisted to storage" from "persisted in a
  // module-level variable that happens to survive because the tab never
  // closed". `persistence.ts` writes the ear-training session (which now
  // includes this drill's level, see `useClapbackDrill.ts`'s module doc) to
  // IndexedDB on every change and restores it on load. The app has no
  // URL-based routing, so a reload always lands back on the default screen —
  // re-navigate to clap-back mode exactly as the first visit did.
  await page.reload()
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Rhythm' })
    .click()
  await page.getByRole('button', { name: 'Clap-back mode' }).click()

  await expect(page.getByTestId('clapback-level')).toHaveText('Level 3')

  expect(errors).toEqual([])
})
