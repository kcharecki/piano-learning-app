import { expect, test, type Page } from '@playwright/test'
import { playGrooveHits, type TimedHit } from './drum-pads.ts'

/**
 * Roadmap DR-15 "coordination trainer" — the screen at `/drums/coordination`.
 *
 * Grading and the step-progress math are proved against a `FakeClock` in
 * `coordinationRun.test.ts` and `useCoordinationTrainer.test.ts`; what only a
 * real browser run can show is the whole page wired together: choosing Kick
 * permutations really lists all 16 drills with only the first unlocked, and
 * playing that first drill steady really unlocks the second one on screen.
 *
 * The first kick-permutation drill (easiest — slot 0, syncopation weight 0)
 * is eighth-note hi-hats, snare on beats 2 & 4, and the kick on the downbeat.
 * At 80 bpm — the trainer's default — a bar is 3000 ms; two bars are graded.
 */

/** 80 bpm: an eighth is 375 ms, a quarter 750 ms, a 4/4 bar 3000 ms. */
const BAR_MS = 3000

const HIHAT_IN_BAR = [0, 375, 750, 1125, 1500, 1875, 2250, 2625] as const
const SNARE_IN_BAR = [750, 2250] as const
const KICK_IN_BAR = [0] as const

/** Both graded bars of the first (easiest) kick-permutation drill, played correctly. */
const FIRST_DRILL_CORRECT: readonly TimedHit[] = [
  ...HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms })),
  ...HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms: BAR_MS + ms })),
  ...SNARE_IN_BAR.map((ms) => ({ pad: 'snare' as const, ms })),
  ...SNARE_IN_BAR.map((ms) => ({ pad: 'snare' as const, ms: BAR_MS + ms })),
  ...KICK_IN_BAR.map((ms) => ({ pad: 'kick' as const, ms })),
  ...KICK_IN_BAR.map((ms) => ({ pad: 'kick' as const, ms: BAR_MS + ms })),
]

function result(page: Page) {
  return page.getByRole('region', { name: 'Result' })
}

function steps(page: Page) {
  return page.getByRole('list', { name: 'Steps' }).getByRole('button')
}

// @serial — plays a whole two-bar pass in real time; run alongside another
// timing-sensitive spec it would be racing the same host scheduler for no
// benefit either way (same reasoning as drums-groove-loop.spec.ts).
test('Kick permutations lists all 16 drills, and a steady first pass unlocks the second (roadmap DR-15) @serial', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await page.goto('/drums/coordination')
  await expect(page.getByRole('heading', { level: 1, name: 'Coordination' })).toBeVisible()

  await page.getByRole('radio', { name: 'Kick permutations' }).click()

  const stepButtons = steps(page)
  await expect(stepButtons).toHaveCount(16)
  await expect(stepButtons.nth(0)).toBeEnabled()
  await expect(stepButtons.nth(0)).toHaveAttribute('aria-current', 'step')
  await expect(stepButtons.nth(1)).toBeDisabled()

  await playGrooveHits(page, FIRST_DRILL_CORRECT)

  await expect(result(page).getByText('Steady — next step unlocked')).toBeVisible()
  await expect(stepButtons.nth(1)).toBeEnabled()
  await expect(stepButtons.nth(1)).toHaveAttribute('aria-current', 'step')

  expect(consoleErrors).toEqual([])
})
