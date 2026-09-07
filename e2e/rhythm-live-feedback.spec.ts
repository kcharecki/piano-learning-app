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
 * Tapping every mark an onset can fall on, shifted by a constant offset,
 * therefore guarantees that the marks which ARE real onsets land with the
 * verdict that offset implies — 'late' at `+45`, 'early' at `-155` (both
 * comfortably inside `toleranceTicks` and outside `hitWindowTicks` for both
 * drills' tolerance tables — see `tapClassifier.ts`), and 'hit' at `-25`,
 * inside the hit window — without this spec ever needing to know which mark
 * it actually was. The other mark (not a real onset) lands 'extra' instead —
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
/**
 * What the late arm can and cannot prove, stated rather than implied: with
 * 45-75ms of click latency always added, an aim of +5 also lands inside the
 * late band, and a run with that aim passes. So this constant chooses where
 * the tap LANDS; the assertion distinguishes the VOCABULARY — a tap after the
 * onset reads 'late' or 'extra' and never 'hit' or 'early' — not the
 * magnitude. The 'early' arm does not have this weakness: latency works
 * against it, so its aim is load-bearing, and moving it to -30 turns the spec
 * red.
 */
const LATE_OFFSET_MS = 45
const EARLY_OFFSET_MS = -155

/**
 * Where the 'hit' arm aims.
 *
 * Every aim here is BAND CENTRE MINUS THE MEASURED LATENCY, not band centre.
 * A click's own round trip (CDP, dispatch, React commit) only ever pushes a
 * tap later than its target, and on this machine it is worth 25-75ms: the
 * -25ms hit aim passes, which caps it at 75ms, and a +10ms late aim still
 * reads 'late' rather than 'hit', which floors it at 40ms. So a nominal +90
 * late aim was really landing at 130-165ms, straddling the 150ms tolerance
 * edge — which is exactly the failure the gate caught, both samples reading
 * 'extra' at once. The aims below sit at the centre of their bands AFTER that
 * latency is added: hit 0 (-25 + ~25-75), late ~100 (+45), early ~-100
 * (-155).
 */
const HIT_AIM_MS = -25

/**
 * Every mark an onset can possibly fall on, over the first six beats.
 *
 * Level-1 durations are only ever a quarter (500ms) or a half (1000ms) at the
 * fixed 120bpm, and onset 0 is at tick 0, so every onset in the pattern lands
 * on a multiple of 500ms — about half of these marks are real onsets and the
 * rest are not, whatever the draw. Two marks used to be enough, because two
 * marks always contain onset 1. They are not enough against JITTER: a tap
 * aimed 90ms late is 'late' only while the click's own latency keeps it under
 * the ~150ms tolerance, and the gate caught both of two samples overshooting
 * into 'extra' at once. Six marks is the same claim over more samples — every
 * deliberately-late tap still has to read 'late' or 'extra', never 'hit', and
 * at least one has to read 'late'.
 */
const ONSET_CANDIDATE_MARKS = [500, 1000, 1500, 2000, 2500, 3000]

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

/**
 * `@serial`: `scripts/e2e-gate.mjs` runs this one outside the parallel pass.
 * The offsets above are tuned against click-latency jitter, and twelve
 * parallel browsers push the jitter past the tuning.
 *
 * That was not the whole of it, and the second half was a defect in this spec
 * rather than in the load. Run 1 used to tap ONSET 0 — tick 0, the instant
 * `Start` begins the run — and assert 'hit' inside a ~50ms window, which asks
 * one browser click to land within 50ms of another with two visibility polls
 * in between. It read `late` on the gate, on an idle machine, and again on the
 * retry. The claim is right and is not widened here: an on-time tap still has
 * to read 'hit'. It is now made on a candidate onset-1 mark, the same
 * technique every other arm already used.
 */
test('the sight-tap drill shows a live hit/early/late verdict per tap, and a manual Stop grades only the elapsed prefix (roadmap U.3) @serial', async ({
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

  // ---- Run 1: an on-time tap on a real onset is 'hit'.
  //
  // On the CANDIDATE ONSET MARKS, not on onset 0. Onset 0 is at tick 0, which
  // is the instant `Start` starts the run, and the hit window is ~50ms — so
  // "tap onset 0 exactly on time" asks a browser click to arrive inside 50ms
  // of the click that began the run, with two visibility polls in between.
  // That raced, and lost: the gate read `late` here on an idle machine and
  // again on its retry. Every other arm already proves its claim without
  // knowing which mark is the real onset, and this one now does too.
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()
  await expect(tapButton).toBeEnabled()

  const hitSchedule = ONSET_CANDIDATE_MARKS.map((mark) => ({ mark, offsetMs: HIT_AIM_MS }))
  const hitVerdicts = await tapScheduleAndCollectVerdicts(page, tapButton, 'rhythm-tap-verdict', hitSchedule)
  expect(hitVerdicts.every((v) => v === 'hit' || v === 'extra')).toBe(true)
  expect(hitVerdicts).toContain('hit')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible()

  // ---- Run 2: every candidate mark that is a real onset lands 'late' when
  // shifted late, and no deliberately-late tap may read 'hit'.
  await page.getByRole('button', { name: 'Again' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()
  const lateSchedule = ONSET_CANDIDATE_MARKS.map((mark) => ({ mark, offsetMs: LATE_OFFSET_MS }))
  const lateVerdicts = await tapScheduleAndCollectVerdicts(page, tapButton, 'rhythm-tap-verdict', lateSchedule)
  expect(lateVerdicts.every((v) => v === 'late' || v === 'extra')).toBe(true)
  expect(lateVerdicts).toContain('late')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible()

  // ---- Run 3: the early-shifted candidate marks land 'early' on the ones
  // that are real onsets (same guarantee, opposite sign).
  await page.getByRole('button', { name: 'Again' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()
  const earlySchedule = ONSET_CANDIDATE_MARKS.map((mark) => ({ mark, offsetMs: EARLY_OFFSET_MS }))
  const earlyVerdicts = await tapScheduleAndCollectVerdicts(page, tapButton, 'rhythm-tap-verdict', earlySchedule)
  expect(earlyVerdicts.every((v) => v === 'early' || v === 'extra')).toBe(true)
  expect(earlyVerdicts).toContain('early')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible()

  // ---- Run 4 (baseline): tap NOTHING, let the 4-bar (8000ms), rest-free
  // pattern play out on its own — every onset (at least 8, complexity 1's
  // quarter-note floor over 4 bars of 4/4) ends up graded missed.
  await page.getByRole('button', { name: 'Again' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()
  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible({ timeout: 10_000 })
  const naturalMissed = Number(await page.getByTestId('rhythm-missed').textContent())
  expect(naturalMissed).toBeGreaterThan(0)

  // ---- Run 5 (the actual safety proof): tap nothing here either, but Stop
  // at a controlled ~3000ms checkpoint — comfortably mid-pattern, 5000ms
  // still left to run — instead of letting it play to the end. Only the
  // onsets whose window closed by then may be graded missed; the whole
  // second half of the pattern must still be pending.
  //
  // Roadmap U.3 fix round (F2/F5): Stop no longer trusts the live
  // classifier's own running tally — it re-grades the decided prefix with
  // the SAME batch grader (`gradeTapping`) the natural end-of-run path uses.
  // `rhythm-partial-note` ("Stopped early — graded N of M notes.") is the
  // visible proof of that: N must be a real prefix (0 < N < M, i.e. neither
  // "nothing decided" nor "the whole pattern"), and because the batch
  // grader was handed exactly those N onsets, every one of them is either
  // matched or missed — nothing outside the decided prefix can appear in
  // either count.
  await page.getByRole('button', { name: 'Again' }).click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()
  await page.waitForTimeout(3_000)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('rhythm-accuracy')).toBeVisible()
  await expect(page.getByTestId('rhythm-aborted')).not.toBeAttached()

  const partialNote = await page.getByTestId('rhythm-partial-note').textContent()
  const partialMatch = partialNote?.match(/graded (\d+) of (\d+) notes/)
  expect(partialMatch).not.toBeNull()
  const [, decidedStr, totalStr] = partialMatch ?? []
  const decided = Number(decidedStr)
  const total = Number(totalStr)
  expect(decided).toBeGreaterThan(0)
  expect(decided).toBeLessThan(total)

  const stoppedMatched = Number(await page.getByTestId('rhythm-matched').textContent())
  const stoppedMissed = Number(await page.getByTestId('rhythm-missed').textContent())
  expect(stoppedMatched + stoppedMissed).toBe(decided)
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
  // Roadmap U.3 fix round (F2/F5): same same-grader-prefix proof as the
  // sight-tap spec above — `clapback-partial-note` ("Stopped early — graded
  // N of M notes.") must show a real prefix (0 < N < M), and matched+missed
  // must equal exactly N, since the batch grader (`gradeClapback`, still
  // tempo-fitted — Stop never hardcodes `tempoScale: 1`) only ever saw the
  // decided onsets.
  await page.getByRole('button', { name: 'Again' }).click()
  await expect(page.getByTestId('clapback-tapping-status')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_500)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('clapback-accuracy')).toBeVisible()
  await expect(page.getByTestId('clapback-aborted')).not.toBeAttached()

  const partialNote = await page.getByTestId('clapback-partial-note').textContent()
  const partialMatch = partialNote?.match(/graded (\d+) of (\d+) notes/)
  expect(partialMatch).not.toBeNull()
  const [, decidedStr, totalStr] = partialMatch ?? []
  const decided = Number(decidedStr)
  const total = Number(totalStr)
  expect(decided).toBeGreaterThan(0)
  expect(decided).toBeLessThan(total)

  const stoppedMatched = Number(await page.getByTestId('clapback-matched').textContent())
  const stoppedMissed = Number(await page.getByTestId('clapback-missed').textContent())
  expect(stoppedMatched + stoppedMissed).toBe(decided)
  expect(stoppedMissed).toBeLessThan(naturalMissed)

  expect(errors).toEqual([])
})
