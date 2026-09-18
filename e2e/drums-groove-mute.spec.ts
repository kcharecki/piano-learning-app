import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { playGrooveHits, worstDriverDriftMs, type TimedHit } from './drum-pads.ts'

/**
 * E2E proof for roadmap DR-09 "per-limb mute" — switching a pad off has the
 * app voice that limb itself during the run, on the grader's own instants,
 * while the learner plays the rest; that pad gets no result row and no live
 * verdict. The pure filtering (`mutePads`, `mutedStrikes`) is proven against
 * `FakeClock`/fast-check in `mute.test.ts`, `mutedVoices.test.ts` and
 * `useGrooveRun.test.ts`; what only a real browser run can show is that
 * switching "Play Kick" off in the actual screen, then playing only the
 * other two limbs by hand, still grades a steady run with no "Kick" line
 * anywhere on it.
 *
 * Quarter-Note Rock at 80 bpm (the default groove — no navigation needed),
 * the same literal pattern `drums-groove-live-feedback.spec.ts` uses for it:
 * every quarter-note hi-hat, kick on 1 and 3, snare on 2 and 4 — minus every
 * kick, since the learner never plays it here, and every hit landed exactly
 * on time (unlike that spec's deliberately-late last hit) since the point of
 * this run is to grade steady.
 */

/** 80 bpm: a quarter is 750 ms, an eighth 375 ms, a 4/4 bar 3000 ms. */
const BAR_MS = 3000
const GRADED_MS = 6000

const HIHAT_IN_BAR = [0, 750, 1500, 2250] as const
const SNARE_IN_BAR = [750, 2250] as const

const HITS: readonly TimedHit[] = [
  ...HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms })),
  ...HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms: BAR_MS + ms })),
  ...SNARE_IN_BAR.map((ms) => ({ pad: 'snare' as const, ms })),
  ...SNARE_IN_BAR.map((ms) => ({ pad: 'snare' as const, ms: BAR_MS + ms })),
]

function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

function runState(page: Page) {
  return page.getByRole('status', { name: 'Run state' })
}

function lastHitStatus(page: Page) {
  return page.getByRole('status', { name: 'Last hit' })
}

function resultRegion(page: Page) {
  return page.getByRole('region', { name: 'Result' })
}

async function openGrooveTrainer(page: Page): Promise<void> {
  await page.goto('/drums/today')
  await mainNav(page).getByRole('button', { name: 'Groove', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()
  await expect(page.getByText('Quarter-Note Rock', { exact: true })).toBeVisible()
}

/** Same console-clean capture as `drums-groove-live-feedback.spec.ts`. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

// @serial — plays a whole pass in real time against real timers, the same
// reason `drums-groove-live-feedback.spec.ts` and `drums-groove-loop.spec.ts` are.
test('switching Kick off has the app voice it, grades the other two limbs steady, and never mentions Kick (roadmap DR-09 "per-limb mute") @serial', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await openGrooveTrainer(page)

  const kickSwitch = page.getByRole('switch', { name: 'Play Kick' })
  await expect(kickSwitch).toHaveAttribute('aria-checked', 'true')
  await kickSwitch.click()
  await expect(kickSwitch).toHaveAttribute('aria-checked', 'false')

  const dispatched = await playGrooveHits(page, HITS)
  expect(worstDriverDriftMs(dispatched)).toBeLessThanOrEqual(25)

  await expect(runState(page)).toHaveText('Run finished', { timeout: GRADED_MS })

  // Every hit landed on time and nothing else was expected of the two limbs
  // actually played, so the run grades steady.
  const result = resultRegion(page)
  await expect(result).toContainText('Steady run')
  await expect(result).not.toContainText('Kick')

  // The muted pad never earns a live verdict either — nothing dispatched
  // above ever struck it, so whatever `Last hit` ended up showing came from
  // one of the two limbs the learner actually played.
  const lastHit = (await lastHitStatus(page).textContent()) ?? ''
  expect(lastHit).not.toBe('')
  expect(lastHit).not.toContain('Kick')

  expect(errors).toEqual([])
})
