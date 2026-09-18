import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { playGrooveHits, worstDriverDriftMs, type TimedHit } from './drum-pads.ts'

/**
 * E2E proof for roadmap DR-09 "per-hit live feedback" — every ACCEPTED hit
 * gets an instant verdict, not just a score at the end of the run. The
 * grading itself (`judgeLiveHit`) is proven against a `FakeClock` in
 * `liveHit.test.ts` and `useGrooveRun.test.ts`; what only a real browser run
 * can show is that a real `pointerdown` reaches the status line
 * (`role="status"`, `aria-label="Last hit"`) and the struck pad's own
 * `data-verdict` attribute.
 *
 * Quarter-Note Rock at 80 bpm (the default groove — no navigation needed),
 * same literal hit pattern `drums-groove-loop.spec.ts` already uses for this
 * groove: every 8th-note hi-hat, kick on 1 and 3, snare on 2 and 4. Every hit
 * is played correctly EXCEPT the very last one, the second bar's snare, which
 * is deliberately struck 60ms late against its expected instant (5250ms into
 * the graded window) — comfortably inside the groove's own 100ms window (see
 * `plan.ts`'s `DEFAULT_TOLERANCE_MS`/`subdivisionTicks`: this groove's
 * smallest onset spacing is a quarter note, 750ms at 80bpm, so
 * `windowMs = min(100, 375) = 100`) and well past `ON_TIME_FRACTION *
 * windowMs` (25ms), so it must read 'late', never 'on-time' or 'extra'.
 * Being the hit with the largest `ms`, it is also necessarily the LAST one
 * `playGrooveHits` dispatches — so whatever `Last hit` shows once the drive
 * finishes is this hit's own verdict, not a race against some other pad.
 *
 * ## What this spec does not attempt
 *
 * The task that specified this coverage asked for a mid-run checkpoint too:
 * poll for "Kick on time" right after the first clean kick. Quarter-Note
 * Rock's own first kick (bar 1, beat 1) lands at the SAME instant as the
 * first hi-hat — both are scheduled for `ms: 0`, the instant the graded
 * window opens — so "the status right after the first kick" is not a
 * deterministic thing to observe: it is a race between two hits fired back
 * to back with no time between them, and which one's verdict is still on
 * screen when this spec gets to look depends on browser/React scheduling,
 * not on anything DR-09 is answerable for. Picking a different, non-tied
 * instant to check instead would stop testing this groove's real hit pattern
 * and start testing an instant chosen only because it is convenient — so
 * this is left out rather than asserted on a coin flip; the final-hit check
 * above already exercises the same "does a real tap update the status line"
 * claim without that race.
 */

/** 80 bpm: a quarter is 750 ms, an eighth 375 ms, a 4/4 bar 3000 ms. */
const BAR_MS = 3000
const GRADED_MS = 6000

const HIHAT_IN_BAR = [0, 750, 1500, 2250] as const
const KICK_IN_BAR = [0, 1500] as const

/** The second bar's snare (expected at 2250ms into the bar, i.e. 5250ms into
 *  the graded window) struck 60ms late — see the module comment. */
const LATE_SNARE_OFFSET_MS = 60

const HITS: readonly TimedHit[] = [
  ...HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms })),
  ...HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms: BAR_MS + ms })),
  ...KICK_IN_BAR.map((ms) => ({ pad: 'kick' as const, ms })),
  ...KICK_IN_BAR.map((ms) => ({ pad: 'kick' as const, ms: BAR_MS + ms })),
  { pad: 'snare', ms: 750 },
  { pad: 'snare', ms: BAR_MS + 2250 + LATE_SNARE_OFFSET_MS },
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

async function openGrooveTrainer(page: Page): Promise<void> {
  await page.goto('/drums/today')
  await mainNav(page).getByRole('button', { name: 'Groove', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()
  await expect(page.getByText('Quarter-Note Rock', { exact: true })).toBeVisible()
}

/** Same console-clean capture as `rhythm-live-feedback.spec.ts`. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

// @serial — plays a whole pass in real time against real timers, the same
// reason `drums-groove-loop.spec.ts` is serial.
test('a real tap gets its own live verdict, in the status line and as a colour on the pad it struck (roadmap DR-09 "per-hit live feedback") @serial', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await openGrooveTrainer(page)

  // Before anything is struck, there is nothing to report yet.
  await expect(lastHitStatus(page)).toHaveText('')

  const dispatched = await playGrooveHits(page, HITS)

  // The driver's own scheduling accuracy, independent of the deliberate
  // 60ms-late AIM built into the last hit above — this is `playGrooveHits`
  // hitting ITS OWN targets on time, the same check `drums-groove-loop.spec.ts`
  // makes of itself.
  expect(worstDriverDriftMs(dispatched)).toBeLessThanOrEqual(25)

  // The last hit dispatched (by construction, the one with the largest `ms`)
  // is the deliberately-late snare — so whatever `Last hit` shows now is that
  // hit's own verdict.
  const statusText = (await lastHitStatus(page).textContent()) ?? ''
  const match = statusText.match(/^Snare late by (\d+) ms$/)
  expect(match, `expected "Snare late by N ms", got "${statusText}"`).not.toBeNull()
  const lateMs = Number(match?.[1])
  // A real click's own latency only ever pushes a tap LATER, so the observed
  // lateness can exceed the 60ms aim, but not fall below it, and 20ms of
  // headroom either side comfortably clears the 25ms on-time threshold
  // without reaching the 100ms window's own edge.
  expect(lateMs).toBeGreaterThanOrEqual(40)
  expect(lateMs).toBeLessThanOrEqual(80)

  // The same verdict, echoed as the struck pad's own colour.
  await expect(page.getByRole('button', { name: 'Snare' })).toHaveAttribute('data-verdict', 'late')

  // Let the run finish grading rather than leaving it mid-flight, the same
  // tidy-up `drums-groove-loop.spec.ts` does with its own Stop.
  await expect(runState(page)).toHaveText('Run finished', { timeout: GRADED_MS })
  // `lastHit` survives the run finishing (see `useGrooveRun`'s module
  // comment) — the learner's last tap does not vanish the instant the
  // verdict panel appears.
  await expect(lastHitStatus(page)).toHaveText(/^Snare late by \d+ ms$/)

  expect(errors).toEqual([])
})
