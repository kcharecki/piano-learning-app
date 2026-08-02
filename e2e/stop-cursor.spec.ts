import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 2.20a: after pressing Stop, the OSMD score cursor
 * must land wherever the transport's playhead actually rewound to, not stay
 * stranded wherever playback happened to stop while the position readout has
 * already snapped back to bar 1.
 *
 * The naive fix — moving the cursor from inside `usePracticeEngine.stop()`
 * through `feedback.cursorRef`, the ref `usePracticeEngine` is actually given
 * (see `PracticeScreen.tsx`) — was reverted: that ref reads any backward
 * cursor move as a loop wrap and resets `useNoteFeedback`'s matcher, breaking
 * `e2e/record-replay.spec.ts`. The real fix moves the cursor through the raw
 * `ScoreViewerHandle` instead (`PracticeScreen`'s own `handleStop`), which
 * this spec cannot observe directly — it only proves the visible symptom:
 * the cursor actually moves back after Stop.
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

test('pressing Stop snaps the score cursor back to its at-rest position, matching the rewound position readout (roadmap 2.20a)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Practice').click()

  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible({ timeout: 15_000 })

  // OSMD injects the cursor as an <img> whose id starts with "cursorImg" —
  // discovered by inspecting the real render, not assumed.
  const cursor = container.locator('img[id^="cursorImg"]').first()
  await expect(cursor).toBeVisible()

  // OSMD's own `followCursor: true` option auto-scrolls the PAGE as playback
  // advances (discovered while writing this spec) — an orthogonal, existing
  // behaviour that has nothing to do with this task's bug, but which makes
  // `boundingBox()` (viewport-relative) unusable here: it never scrolls back
  // on Stop, so the cursor's viewport position differs even when the fix
  // works correctly and the cursor is back on the right note. The cursor's
  // own inline `top`/`left` style is what OSMD actually positions it with —
  // relative to the score, not the viewport — so that is what this reads.
  async function cursorPosition(): Promise<{ top: string; left: string }> {
    return cursor.evaluate((el) => ({
      top: (el as HTMLElement).style.top,
      left: (el as HTMLElement).style.left,
    }))
  }

  const restPosition = await cursorPosition()

  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  // Poll until the cursor has actually moved — no fixed delay, since the
  // sample's tempo (and therefore how long the first onset takes to advance
  // past) is an implementation detail this spec should not hardcode.
  await expect.poll(cursorPosition, { timeout: 10_000 }).not.toEqual(restPosition)

  // Confirms the readout actually left bar 1 while playing, so the
  // post-Stop assertion below has something to contradict — otherwise it
  // would be a tautology that no mutant of the fix could fail.
  await expect(transport.getByLabel('Position')).not.toContainText('Measure 1,')

  await transport.getByRole('button', { name: 'Stop', exact: true }).click()

  // The bug this task fixes: without it, the cursor would still read
  // wherever Play last left it while this readout already says bar 1.
  await expect.poll(cursorPosition, { timeout: 5_000 }).toEqual(restPosition)
  await expect(transport.getByLabel('Position')).toContainText('Measure 1,')

  expect(errors).toEqual([])
})
