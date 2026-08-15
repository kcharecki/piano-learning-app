import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap U.3: real-time per-tap early/late/hit feedback and a
 * manual Stop that grades only the elapsed prefix — `core/rhythm/
 * tapClassifier.ts`, wired into `useRhythmDrill.ts`/`useClapbackDrill.ts` and
 * surfaced by `RhythmScreen.tsx`/`RhythmClapback.tsx`'s tap pad.
 *
 * ## Proving a live verdict without controlling the random pattern
 *
 * Neither drill exposes a seeded `rng` to the real (non-test-harness) app, so
 * — like `rhythm.spec.ts`'s own "tap every possible position" technique —
 * this cannot assert "tap position X is onset Y". What IS structurally
 * guaranteed, regardless of the draw (`core/generator/rhythm.ts`'s
 * complexity-1/level-1 tables: `REST_PROBABILITY[1] === 0`,
 * `MIN_DURATION_BY_COMPLEXITY[1] === QUARTER` (500ms), `MAX_DURATION_BY_
 * COMPLEXITY[1] === HALF` (1000ms), at the fixed 120bpm both drills always
 * play this pattern at — see `useRhythmDrill.ts`'s `FIXED_TEMPO` comment):
 *
 *  - onset 0 is ALWAYS at tick 0 (complexity/level 1 never draws a rest), and
 *  - onset 1 (whatever comes right after it) starts exactly where onset 0's
 *    OWN duration ends — and that duration is only ever a quarter or a half
 *    note. So onset 1 is always at EXACTLY 500ms or EXACTLY 1000ms; there is
 *    no third option.
 *
 * Tapping both of those candidate marks, shifted by a constant `+90`/`-90`
 * ms, therefore guarantees that whichever one is the real onset 1 lands
 * 'late'/'early' (90ms sits comfortably inside `toleranceTicks` but outside
 * `hitWindowTicks` for both drills' tolerance tables — see
 * `tapClassifier.ts`), without this spec ever needing to know which mark it
 * actually was. The other mark (not a real onset) lands 'extra' instead —
 * also asserted on, so a stub that flashed unconditionally could not pass.
 *
 * ## Proving Stop grades only the elapsed prefix
 *
 * Racing a single tap immediately followed by Stop against a real browser's
 * click latency is flaky on a loaded machine (confirmed while writing this
 * spec: occasionally the round trip alone eats enough wall-clock time to
 * cross the ~150-166ms tolerance window, on EITHER side — a scheduled tap can
 * land late enough to miss its onset, and even an "immediate" tap can land
 * late enough that the onset's own window has already elapsed by the time it
 * arrives). So this proves the property a way that needs no tap to land
 * inside any particular window at all: tap NOTHING, once in a run left to
 * finish naturally (the baseline — `missed` there is every onset in the
 * pattern, always a large number for these bar counts) and once in a run
 * Stopped at a controlled, comfortably-mid-pattern checkpoint (the same
 * wait-out-remaining-time technique as the schedules above, so ordinary
 * jitter shifts the checkpoint by tens of ms, not whether it lands inside a
 * sub-200ms window at all). A Stop that regressed to grading the whole
 * remaining pattern — whether by re-implementing the run-ended path, or by
 * reading the transport's own (rewound-by-`engine.stop()`) position instead
 * of the real elapsed time, both pitfalls `useRhythmDrill.ts`/
 * `useClapbackDrill.ts` document — would make the two `missed` counts equal.
 * A real early Stop leaves most of the pattern's onsets still pending
 * (neither matched nor missed), keeping the counts far apart by a margin no
 * ordinary click jitter can close.
 */

/**
 * Comfortably inside `toleranceTicks` but outside `hitWindowTicks` for BOTH
 * `TAPPING_DEFAULTS.toleranceMs` (150ms/~50ms) and clap-back level 1's own
 * table (`toleranceTicksForLevel(1)`, ~167ms/~56ms) — see the module doc.
 *
 * The two offsets are NOT symmetric on purpose. `tapScheduleAndCollectVerdicts`
 * always WAITS OUT the remaining time to a target before clicking, so a click's
 * own real-world latency (CDP round trip, event dispatch, React commit) can
 * only ever push the actual tap LATER than the target, never earlier — real
 * jitter observed on a loaded dev machine while writing this spec was enough
 * to occasionally erase a 90ms `EARLY_OFFSET_MS` entirely (jitter adds
 * straight onto a negative offset, shrinking it toward — and sometimes past —
 * zero, flipping the verdict to 'hit' or even 'late'). `LATE_OFFSET_MS` has
 * the opposite exposure — jitter only pushes it further into 'late' (risking
 * an overshoot into 'extra', which this spec already tolerates) — so it can
 * stay modest. `EARLY_OFFSET_MS` is pushed close to the tolerance boundary
 * instead, trading a little headroom against 'extra' for a lot more headroom
 * against jitter erasing the 'early' verdict altogether.
 */
const LATE_OFFSET_MS = 90
const EARLY_OFFSET_MS = -130

/** Onset 1 is always at exactly one of these two marks — see the module doc. */
const ONSET_1_CANDIDATE_MARKS = [500, 1000]

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** Tap at every `{mark, offsetMs}` pair's absolute `mark + offsetMs`, all
 *  anchored to ONE `Date.now()` captured right before the loop (not one
 *  fresh per tap, and not split across separate calls) — `rhythm.spec.ts`'s
 *  own documented reason: click round trips are unmeasured real time, so
 *  waiting out the remaining time to each absolute target keeps drift
 *  bounded instead of letting it compound. Returns the `data-verdict` read
 *  immediately after each tap. */
async function tapScheduleAndCollectVerdicts(
  page: Page,
  tapButton: ReturnType<Page['getByRole']>,
  verdictTestId: string,
  schedule: readonly { readonly mark: number; readonly offsetMs: number }[],
): Promise<(string | null)[]> {
  const verdicts: (string | null)[] = []
  const t0 = Date.now()
  for (const { mark, offsetMs } of schedule) {
    const target = mark + offsetMs
    const remaining = target - (Date.now() - t0)
    if (remaining > 0) await page.waitForTimeout(remaining)
    await tapButton.click()
    verdicts.push(await page.getByTestId(verdictTestId).getAttribute('data-verdict'))
  }
  return verdicts
}

test('the sight-tap drill shows a live hit/early/late verdict per tap, and a manual Stop grades only the elapsed prefix (roadmap U.3)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Rhythm' })
    .click()
  await expect(page.getByRole('heading', { name: 'Rhythm' })).toBeVisible()

  const tapButton = page.getByRole('button', { name: 'Tap' })

  // ---- Run 1: onset 0 tapped exactly on time is 'hit'; whichever of the two
  // possible onset-1 marks is real lands 'late' when shifted +90ms.
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()
  await expect(tapButton).toBeEnabled()

  const lateSchedule = [
    { mark: 0, offsetMs: 0 },
    ...ONSET_1_CANDIDATE_MARKS.map((mark) => ({ mark, offsetMs: LATE_OFFSET_MS })),
  ]
  const lateVerdicts = await tapScheduleAndCollectVerdicts(page, tapButton, 'rhythm-tap-verdict', lateSchedule)
  expect(lateVerdicts[0]).toBe('hit')
  expect(lateVerdicts.slice(1).every((v) => v === 'late' || v === 'extra')).toBe(true)
  expect(lateVerdicts).toContain('late')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible()

  // ---- Run 2: the -90ms-shifted candidate marks land 'early' on whichever
  // one is the real onset 1 (same guarantee, opposite sign).
  await page.getByRole('button', { name: 'Again' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()
  const earlySchedule = ONSET_1_CANDIDATE_MARKS.map((mark) => ({ mark, offsetMs: EARLY_OFFSET_MS }))
  const earlyVerdicts = await tapScheduleAndCollectVerdicts(page, tapButton, 'rhythm-tap-verdict', earlySchedule)
  expect(earlyVerdicts.every((v) => v === 'early' || v === 'extra')).toBe(true)
  expect(earlyVerdicts).toContain('early')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible()

  // ---- Run 3 (baseline): tap NOTHING, let the 4-bar (8000ms), rest-free
  // pattern play out on its own — every onset (at least 8, complexity 1's
  // quarter-note floor over 4 bars of 4/4) ends up graded missed.
  await page.getByRole('button', { name: 'Again' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()
  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible({ timeout: 10_000 })
  const naturalMissed = Number(await page.getByTestId('rhythm-missed').textContent())
  expect(naturalMissed).toBeGreaterThan(0)

  // ---- Run 4 (the actual safety proof): tap nothing here either, but Stop
  // at a controlled ~3000ms checkpoint — comfortably mid-pattern, 5000ms
  // still left to run — instead of letting it play to the end. Only the
  // onsets whose window closed by then may be graded missed; the whole
  // second half of the pattern must still be pending.
  await page.getByRole('button', { name: 'Again' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()
  await page.waitForTimeout(3_000)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible()

  const stoppedMissed = Number(await page.getByTestId('rhythm-missed').textContent())
  expect(stoppedMissed).toBeLessThan(naturalMissed)

  expect(errors).toEqual([])
})

test('the clap-back drill also grades a manual Stop against only the elapsed prefix (roadmap U.3)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Rhythm' })
    .click()
  await page.getByRole('button', { name: 'Clap-back mode' }).click()
  await expect(page.getByTestId('clapback-level')).toHaveText('1')

  // ---- Baseline: tap nothing, let the 2-bar (4000ms), rest-free pattern
  // play out on its own. Every onset — at minimum 4, level 1's quarter-note
  // floor over 2 bars of 4/4 — ends up graded missed.
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('clapback-tapping-status')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('clapback-accuracy')).toBeVisible({ timeout: 10_000 })
  const naturalMissed = Number(await page.getByTestId('clapback-missed').textContent())
  expect(naturalMissed).toBeGreaterThan(0)

  // ---- The safety proof: tap nothing again, but Stop at a controlled
  // ~1500ms checkpoint — comfortably mid-pattern, 2500ms still left to run —
  // instead of letting it play to the end. Also exercises
  // `useClapbackDrill.ts`'s own `stopRun()` → `finishTapping()` path (the
  // level-re-adaptation branch), not just the sight-tap hook's.
  await page.getByRole('button', { name: 'Again' }).click()
  await expect(page.getByTestId('clapback-tapping-status')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_500)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('clapback-accuracy')).toBeVisible()

  const stoppedMissed = Number(await page.getByTestId('clapback-missed').textContent())
  expect(stoppedMissed).toBeLessThan(naturalMissed)

  expect(errors).toEqual([])
})
