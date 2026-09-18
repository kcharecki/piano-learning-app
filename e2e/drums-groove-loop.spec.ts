import { expect, test, type Page } from '@playwright/test'
import { playGrooveHits, type TimedHit } from './drum-pads.ts'

/**
 * Roadmap DR-09 "loop" — end to end. Everything about pass arithmetic and
 * click scheduling is proved against a `FakeClock` in `loop.test.ts` and
 * `useGrooveRun.test.ts`; what only a real browser run can show is that
 * turning Loop on actually removes the second count-in and keeps the run
 * going into a second pass, driven by real `pointerdown` events against real
 * timers.
 *
 * The default groove (Quarter-Note Rock, 80 bpm) is used as-is — no groove
 * navigation needed, and it is also the persona's easiest reading, so the
 * hit pattern below is Every 8th-note hi-hat, kick on 1 and 3, snare on 2 and
 * 4, written out as literals the same way `improve-DR-09.spec.ts` writes its
 * own arms: nothing here is read from `referenceGrooves.ts` or from
 * anything else the app also grades against.
 */

/** 80 bpm: a quarter is 750 ms, an eighth 375 ms, a 4/4 bar 3000 ms. */
const BAR_MS = 3000

const HIHAT_IN_BAR = [0, 750, 1500, 2250] as const
const KICK_IN_BAR = [0, 1500] as const
const SNARE_IN_BAR = [750, 2250] as const

/** One graded pass of Quarter-Note Rock, played correctly. */
const ONE_PASS_CORRECT: readonly TimedHit[] = [
  ...HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms })),
  ...HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms: BAR_MS + ms })),
  ...KICK_IN_BAR.map((ms) => ({ pad: 'kick' as const, ms })),
  ...KICK_IN_BAR.map((ms) => ({ pad: 'kick' as const, ms: BAR_MS + ms })),
  ...SNARE_IN_BAR.map((ms) => ({ pad: 'snare' as const, ms })),
  ...SNARE_IN_BAR.map((ms) => ({ pad: 'snare' as const, ms: BAR_MS + ms })),
]

function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

function result(page: Page) {
  return page.getByRole('region', { name: 'Result' })
}

function runState(page: Page) {
  return page.getByRole('status', { name: 'Run state' })
}

async function openGrooveTrainer(page: Page): Promise<void> {
  await page.goto('/drums/today')
  await mainNav(page).getByRole('button', { name: 'Groove', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()
  await expect(page.getByText('Quarter-Note Rock', { exact: true })).toBeVisible()
}

// @serial — this spec plays a whole pass in real time and then waits, live,
// for a second one to open; run alongside another timing-sensitive spec it
// would be racing the same host scheduler for no benefit either way.
test('turning Loop on repeats the graded window with no further count-in, grading each pass on its own, until Stop (roadmap DR-09 "loop") @serial', async ({
  page,
}) => {
  await openGrooveTrainer(page)

  const loopToggle = page.getByRole('switch', { name: 'Loop' })
  await expect(loopToggle).toHaveAttribute('aria-checked', 'false')
  await loopToggle.click()
  await expect(loopToggle).toHaveAttribute('aria-checked', 'true')

  // One full, correct pass — this also proves the FIRST pass still gets its
  // one bar of count-in, since `playGrooveHits` schedules every hit relative
  // to the instant the run state first says "Playing".
  await playGrooveHits(page, ONE_PASS_CORRECT)

  // No second count-in: the run state must reach pass 2 on its own, without
  // ever printing "Counting in" again. Polled rather than slept — the pass
  // boundary lands wherever the host scheduler puts it, and pass 2 opens the
  // instant pass 1's `gradedMs` elapses, independent of when pass 1 actually
  // finishes grading (the windows overlap by `windowMs`, by design).
  await expect(runState(page)).toHaveText(/^Playing — bar \d+ of \d+, pass 2$/, {
    timeout: 10_000,
  })
  await expect(page.getByText('Counting in', { exact: false })).not.toBeVisible()

  // Pass 1 has, by now, definitely graded — the tally is the proof loop mode
  // actually finished a pass rather than merely opening a second one.
  //
  // Contract note: a played-perfectly pass SHOULD grade steady, and
  // `useGrooveRun.test.ts` pins that exact outcome against a `FakeClock`.
  // Here, real `setTimeout`s carry every one of this pass's 24 hits, and
  // `grade.ts`'s steady bar looks at the spread across every one of them —
  // one hit nudged by host jitter into a worse bucket is enough to flip it,
  // even though every hit still matched its intended note. So this asserts
  // only what loop mode itself is answerable for — a pass graded — and
  // leaves the grader's own steady threshold to the suite that already
  // proves it deterministically.
  await expect(result(page).getByText(/^\d+ of 1 pass steady$/)).toBeVisible()

  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(runState(page)).toHaveText('Ready when you are')
  // Stop discards the pass in progress but keeps the tally from the one that
  // did grade — it is the record of what happened, not a live readout.
  await expect(result(page).getByText(/^\d+ of 1 pass steady$/)).toBeVisible()
})
