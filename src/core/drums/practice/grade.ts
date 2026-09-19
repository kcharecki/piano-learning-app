/**
 * Grading one groove run (roadmap DR-09/T.17). Takes the plan
 * (`./plan.ts`) and the instants the learner actually hit, and answers three
 * questions per pad — did every stroke land, where was that limb sitting
 * relative to the grid, and was it *consistent* — plus two run-wide ones:
 * are two limbs the score writes together arriving together, and is the whole
 * pattern sitting on the grid at all.
 *
 * ## Why the verdict is spread, not offset
 *
 * Every millisecond figure a browser can produce for a pad press carries the
 * machine's own latency: the pointer stack, the frame the handler runs on,
 * and (for a learner playing to the click) the audio output buffer. That
 * latency is a **constant added to every hit**. It moves a pad's mean offset
 * and it cannot touch that pad's spread about its own mean, nor the
 * difference between two pads' means. So the steady verdict is judged on
 * spread, on drift, and on the gap between limbs — never on the absolute
 * offset, which is reported to the learner but never graded. A run played
 * perfectly on a laptop with 55 ms of latency is a steady run.
 *
 * ## Why drift is checked separately from spread
 *
 * A limb that starts on the beat and ends a window late has a large spread,
 * but so does a limb that is merely jittery, and the two need different
 * advice. Worse, a *slow* drift over two bars can sit inside a spread budget
 * while being exactly the fault a groove trainer exists to catch (T.17.7 —
 * the first attempt's gates were run-long averages, and a growing limb offset
 * diluted into them). `driftMs` compares the second half of a pad's matched
 * strokes against the first half, so a limb that is walking away from the
 * click fails on its own terms even when its spread does not.
 *
 * ## Matching is a single pass, and that is a property of the window
 *
 * `plan.ts` caps the window at half a subdivision, so no two notated instants
 * for one pad have overlapping windows. A hit therefore falls inside at most
 * one instant's window and greedy nearest-first assignment is optimal — there
 * is no search here, and no tuning that could make one necessary.
 */
import { invariant } from '@core/shared/invariant.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { MAX_SLIP_STEPS, matchCountAt, pair, SLIP_COVERAGE, type OffsetSample } from './matchCount.ts'
import type { GroovePadPlan, GrooveRunPlan, SwingContext, UnisonPair } from './plan.ts'
import { padDisplacementSteps } from './padDisplacement.ts'
import { shiftedExpectedMs } from './slipShift.ts'
import { padDynamics, type PadDynamicsResult } from './dynamics.ts'

/** One pad press, in ms from the moment the graded window opened. */
export type GrooveHit = {
  readonly pad: MappedDrumPad
  readonly ms: number
  /**
   * MIDI velocity, 1..127. Absent means UNCLASSIFIED, not "normal" — an
   * on-screen pad press carries no velocity at all, and `dynamics.ts`'s
   * `padDynamics` excludes an unclassified stroke from grading entirely
   * (review round 3, RED 3): it is not counted toward `graded`, `wrong`, nor
   * either instant-count, on either side of the ghost/accent split.
   */
  readonly velocity?: number
}

/**
 * A pad's spread may be up to this fraction of the match window before the
 * run stops being steady. At the trainer's default (a 100 ms window on the
 * money beat) that is 40 ms of standard deviation about the limb's own mean
 * — audibly loose, but recognisably in time, which is the Debut-level bar
 * this trainer is grading against.
 */
export const STEADY_SPREAD_FRACTION = 0.4

/** How far a limb may walk between the first and second half of the run. */
export const STEADY_DRIFT_FRACTION = 0.5

/** How far apart two limbs the score writes on one instant may land. */
export const FLAM_FRACTION = 0.5

// `MAX_SLIP_STEPS`/`SLIP_COVERAGE` live in `matchCount.ts` (review round 3,
// item 2) so `padDisplacement.ts` can import them without importing FROM this
// module — re-exported here so every pre-existing `from './grade.ts'` import
// of either name keeps working unchanged.
export { MAX_SLIP_STEPS, SLIP_COVERAGE } from './matchCount.ts'

export type GroovePadResult = {
  readonly pad: MappedDrumPad
  /** How many strokes the score asks for. Zero for a pad the groove does not use. */
  readonly expected: number
  /**
   * How many strokes the learner played on this pad, MINUS any that the
   * articulation-slip pass (see `ARTICULATION_SIBLINGS`) reassigned entirely
   * to a sibling pad's row — a slipped hit is counted there (`slipped`), not
   * here. Chosen so `hits === matched + extra` keeps holding on every row,
   * played pads included, once slips have been resolved.
   */
  readonly hits: number
  /**
   * Always the STEP-0 pairing (`pair()` run at the plan's own nominal grid,
   * never re-paired at a displaced pad's effective shift). `dynamics.graded`
   * (below) counts matched strokes too, but at a DIFFERENT pairing — the
   * pad's effective shift (review round 3, RED 1) — so on a run displaced by
   * whole grid steps the two numbers answer different questions and can
   * disagree; neither is a bug, and callers must not substitute one for the
   * other.
   */
  readonly matched: number
  /** Invariant on every row: `expected === matched + missed + slipped`. */
  readonly missed: number
  readonly extra: number
  /** Expected instants on this pad that were struck on time, but on its sibling articulation (open vs closed hat). Neither matched nor missed. */
  readonly slipped: number
  /** Mean of (hit - instant) over matched strokes plus any slipped-in hits (the instant was played, only the articulation was wrong). Undefined when neither happened. */
  readonly meanOffsetMs: number | undefined
  /** Standard deviation of those offsets about `meanOffsetMs`. Undefined when neither happened. */
  readonly spreadMs: number | undefined
  /** Second-half mean minus first-half mean. Positive means the limb is falling behind. */
  readonly driftMs: number | undefined
  /**
   * This ONE pad's own whole-nominal-grid-step displacement (roadmap DR-07
   * tail) — `padDisplacementSteps` run on this pad's hits alone, so a limb
   * can be named even when `runSlipSteps` finds no whole-pattern agreement.
   * `0` means this pad's own hits sit on their own grid position; `undefined`
   * means the pad has no hits, or its hits do not clearly favour any one
   * grid position over the others (see `padDisplacement.ts`).
   */
  readonly displacementSteps: number | undefined
  /**
   * Velocity-vs-notated-dynamics grading for this pad's own matched strokes
   * (roadmap DR-07 tail / DR-03) — see `dynamics.ts`. Always PRE-
   * articulation-slip (never the slip-adjusted pairing: the slip pass's own
   * internal `pair()` call re-indexes against a leftover sub-array, so its
   * offsets' `expectedIndex`/`hitIndex` are not positions in this pad's own
   * `expectedDynamics`/hit list) — but, since review round 3 (RED 1), paired
   * at this pad's EFFECTIVE grid shift, not always step 0: `slipSteps` when
   * the whole run agrees on one, else this pad's own `displacementSteps`,
   * else 0. At step 0 this is exactly `originalOffsetsByPad`. See
   * `gradeGrooveRun`'s `effectiveStep`/`dynamicsOffsets` for why step 0 alone
   * is wrong for a pattern displaced by whole grid steps: at that step, a hit
   * intended for instant N but arriving `step` grid-steps late falls inside a
   * DIFFERENT instant's (N + step's) window, so it gets paired against, and
   * graded on, the wrong notated dynamics class entirely — a learner who
   * played perfect dynamics but landed the whole pattern late was told BOTH
   * "the pattern sat behind the click" (correctly) and a false dynamics
   * complaint (incorrectly).
   */
  readonly dynamics: PadDynamicsResult
}

/** Two pads the SCORE puts on one instant, and how far apart they actually landed. */
export type UnisonGap = {
  readonly pads: UnisonPair
  readonly gapMs: number
}

/**
 * Sibling articulation pairs (roadmap T.33) — pads that notate the same limb
 * doing the same physical stroke with one flag flipped (open vs. closed
 * hi-hat). One entry per pair; `gradeGrooveRun`'s slip pass tries both
 * directions of every pair (expected-on-A-played-on-B, then the reverse), so
 * listing `['hhOpen', 'hhClosed']` once catches a learner who played open for
 * closed AND one who played closed for open.
 */
export const ARTICULATION_SIBLINGS: readonly (readonly [MappedDrumPad, MappedDrumPad])[] = [
  ['hhOpen', 'hhClosed'],
]

/** One (expected, played) direction of a sibling-articulation mixup, and how many times it happened. */
export type ArticulationSlip = {
  readonly expected: MappedDrumPad
  readonly played: MappedDrumPad
  readonly count: number
}

export type GrooveRunResult = {
  /**
   * False if any row is missed/extra beyond pairing, spread or drift is out
   * of budget, a unison pair flams beyond the limit, OR any row slipped an
   * articulation — a pattern played with the wrong hi-hat state throughout is
   * not steady, independent of its timing.
   */
  readonly steady: boolean
  /**
   * Literal press count, before any slip reassignment — `sum(pads[].hits)` is
   * smaller by the slip total. Zero means nothing registered — a rig
   * problem, not a timing one.
   */
  readonly totalHits: number
  readonly pads: readonly GroovePadResult[]
  /** Only pairs the score writes together, and only when both actually matched something. */
  readonly unison: readonly UnisonGap[]
  /** One entry per (expected, played) direction with count > 0, in ARTICULATION_SIBLINGS order, expected-first direction before the reverse. */
  readonly articulation: readonly ArticulationSlip[]
  /**
   * The whole pattern sitting a whole number of subdivisions off the grid,
   * positive for behind. Claimed only when EVERY pad that was played agrees
   * on the same displacement — see `runSlipSteps`.
   */
  readonly slipSteps: number | undefined
  /** The limits the verdict was judged against, so the screen can explain itself. */
  readonly limits: {
    readonly spreadMs: number
    readonly driftMs: number
    readonly flamMs: number
  }
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  const variance = mean(values.map((value) => (value - average) ** 2))
  return Math.sqrt(variance)
}

/**
 * Second-half mean minus first-half mean, over strokes already ordered by the
 * instant they answer. Needs two strokes a side to mean anything.
 */
function drift(offsets: readonly number[]): number | undefined {
  if (offsets.length < 4) return undefined
  const half = Math.floor(offsets.length / 2)
  return mean(offsets.slice(offsets.length - half)) - mean(offsets.slice(0, half))
}

/**
 * The displacement, in whole subdivisions, that every played pad agrees on.
 *
 * Both halves of that sentence matter. **Whole subdivisions**, because a
 * pattern that is genuinely in the wrong place is in a *grid* position, and
 * reporting an arbitrary millisecond shift as "two steps behind the click" is
 * how the first attempt at this feature told a learner who was 120 ms late
 * that they were playing the pattern in the wrong place (T.17.3). **Every pad
 * agrees**, because a learner who swaps two limbs produces two pads whose
 * best displacements are equal and opposite, and calling that a phase slip
 * would blame the clock for a hand problem.
 *
 * **Nominal-tick shift, re-swung.** The shift cell is `plan.ts`'s
 * `nominalSubdivisionTicks` — the smallest gap between distinct notated
 * instants on the NOMINAL (straight) grid, never the SWUNG one
 * (`subdivisionTicks`/`subdivisionMs`, which only feed `windowMs`). Swinging
 * can shrink a nominal grid step under itself unevenly (a jazz-ride bar's
 * nominal eighths are 240 ticks apart, but 67%-swing packs the swung pair down
 * to 322/158), so stepping by the SWUNG gap and re-swinging can land a
 * "played one grid step late" candidate a handful of ticks off the note's
 * true swung position — close enough that the match window still catches it,
 * far enough that it is the wrong displacement. Stepping by the NOMINAL gap
 * and then re-swinging each candidate (`padPlan.expectedNominalTicks[i] +
 * step * nominalSubdivisionTicks`, then `shiftedExpectedMs`, `slipShift.ts`)
 * asks exactly the question that matters: "if every note had been written
 * `step` grid-steps later, where would swing have put it". On a straight
 * score `swungTick` is the identity and `nominalSubdivisionTicks ===
 * subdivisionTicks`, so this is the old constant-offset formula unchanged
 * (`slipShift.test.ts`'s property test checks that equivalence).
 */
function runSlipSteps(
  pads: readonly GroovePadPlan[],
  windowMs: number,
  nominalSubdivisionTicks: number,
  swing: SwingContext,
  msPerTick: number,
  hitsByPad: ReadonlyMap<MappedDrumPad, readonly number[]>,
): number | undefined {
  const steps = [...Array(MAX_SLIP_STEPS * 2 + 1).keys()].map((i) => i - MAX_SLIP_STEPS)
  const totals = new Map<number, number>(steps.map((step) => [step, 0]))
  let expectedTotal = 0
  let agreed: number | undefined
  let first = true

  for (const padPlan of pads) {
    const hits = hitsByPad.get(padPlan.pad) ?? []
    expectedTotal += padPlan.expectedMs.length
    const counts = steps.map((step) => ({
      step,
      count: matchCountAt(
        shiftedExpectedMs(padPlan.expectedNominalTicks, step, nominalSubdivisionTicks, swing, msPerTick),
        hits,
        windowMs,
      ),
    }))
    for (const { step, count } of counts) totals.set(step, (totals.get(step) ?? 0) + count)
    if (hits.length === 0) continue

    const best = counts.reduce((a, b) => (b.count > a.count ? b : a))
    const tied = counts.filter((c) => c.count === best.count).length > 1
    if (tied) return undefined
    if (first) {
      agreed = best.step
      first = false
    } else if (agreed !== best.step) {
      return undefined
    }
  }

  if (agreed === undefined || agreed === 0) return undefined
  const atAgreed = totals.get(agreed) ?? 0
  if (atAgreed <= (totals.get(0) ?? 0)) return undefined
  if (atAgreed < expectedTotal * SLIP_COVERAGE) return undefined
  return agreed
}

/** Mutable per-pad working state the slip pass reads and rewrites — collapsed into a `GroovePadResult` at the end. */
type PadState = {
  readonly pad: MappedDrumPad
  readonly expected: number
  /** Starts as the literal press count; decremented when a hit here is reassigned away as a slip (see the doc on `GroovePadResult.hits`). */
  hits: number
  readonly matched: number
  /** Still-unmatched expected instants, mutated down as the slip pass claims them. */
  missedInstants: readonly number[]
  /** Still-unclaimed hits on this pad, mutated down as the slip pass reassigns them. */
  extraHits: readonly number[]
  /**
   * Matched offsets, plus one appended per hit the slip pass reassigns TO
   * this pad (as the expected side). NOT necessarily in instant order once
   * the slip pass has appended to it — every reader sorts by `instant`
   * first (see `sortedOffsets` in `gradeGrooveRun`).
   */
  offsets: readonly OffsetSample[]
  slipped: number
}

/**
 * The articulation-slip pass (roadmap T.33): for each sibling pair and each
 * direction (expected pad E, played pad P), greedily re-pairs E's remaining
 * missed instants against P's remaining extra hits, nearest-first inside
 * `windowMs` — exactly `pair`'s own logic, just run a second time across a
 * different pad. Runs strictly AFTER the per-pad pairing in `gradeGrooveRun`,
 * so a hit or instant already matched to its own pad is never touched: only
 * what pairing left over on both sides is up for grabs here.
 */
function applyArticulationSlips(
  states: ReadonlyMap<MappedDrumPad, PadState>,
  windowMs: number,
): readonly ArticulationSlip[] {
  const articulation: ArticulationSlip[] = []
  for (const siblingPair of ARTICULATION_SIBLINGS) {
    const directions: readonly (readonly [MappedDrumPad, MappedDrumPad])[] = [
      [siblingPair[0], siblingPair[1]],
      [siblingPair[1], siblingPair[0]],
    ]
    for (const [expectedPad, playedPad] of directions) {
      const expectedState = states.get(expectedPad)
      const playedState = states.get(playedPad)
      if (expectedState === undefined || playedState === undefined) continue
      if (expectedState.missedInstants.length === 0 || playedState.extraHits.length === 0) continue

      const slip = pair(expectedState.missedInstants, playedState.extraHits, windowMs)
      if (slip.matched === 0) continue

      expectedState.missedInstants = slip.unmatchedExpected
      expectedState.offsets = [...expectedState.offsets, ...slip.offsets]
      expectedState.slipped += slip.matched
      playedState.extraHits = slip.unmatchedHits
      playedState.hits -= slip.matched
      articulation.push({ expected: expectedPad, played: playedPad, count: slip.matched })
    }
  }
  return articulation
}

/** Grade `hits` against `plan`. Pure and total: no clock, no ordering assumptions on `hits`. */
export function gradeGrooveRun(plan: GrooveRunPlan, hits: readonly GrooveHit[]): GrooveRunResult {
  const hitsByPad = new Map<MappedDrumPad, number[]>()
  // DR-07 tail: each pad's velocities, index-for-index with `hitsByPad`'s ms
  // list — the ms/velocity pair for one hit is sorted as a UNIT (below), so
  // `OffsetSample.hitIndex` (an index into `hitsByPad.get(pad)`) always finds
  // the right velocity, never one that has drifted out of alignment with it.
  const velocitiesByPad = new Map<MappedDrumPad, (number | undefined)[]>()
  const rawHitsByPad = new Map<MappedDrumPad, { readonly ms: number; readonly velocity: number | undefined }[]>()
  for (const hit of hits) {
    const list = rawHitsByPad.get(hit.pad) ?? []
    list.push({ ms: hit.ms, velocity: hit.velocity })
    rawHitsByPad.set(hit.pad, list)
  }
  for (const [pad, list] of rawHitsByPad) {
    const sorted = [...list].sort((a, b) => a.ms - b.ms)
    hitsByPad.set(pad, sorted.map((h) => h.ms))
    velocitiesByPad.set(pad, sorted.map((h) => h.velocity))
  }

  // A press on a pad this groove never asks for is not silently dropped: it
  // gets its own row with nothing expected, so it counts against the verdict
  // the same way any other spurious stroke does. Planned pads come first (in
  // the score's own pad order), then any hit-only pads, in first-seen order —
  // the same ordering the two separate loops used to produce.
  const padOrder: MappedDrumPad[] = plan.pads.map((padPlan) => padPlan.pad)
  const planned = new Set(padOrder)
  for (const pad of hitsByPad.keys()) {
    if (!planned.has(pad)) padOrder.push(pad)
  }

  const expectedMsByPad = new Map(plan.pads.map((padPlan) => [padPlan.pad, padPlan.expectedMs]))
  // Feeds `displacementSteps` below — a pad this groove never asks for (a
  // hit-only row) has no entry here, so it falls back to `[]`, and
  // `padDisplacementSteps` reports `undefined` for an empty expected list the
  // same way it does for a pad with no hits: no grid position to speak of.
  const expectedNominalTicksByPad = new Map(plan.pads.map((padPlan) => [padPlan.pad, padPlan.expectedNominalTicks]))
  // Feeds `dynamics` below, same fallback reasoning as `expectedNominalTicksByPad`.
  const expectedDynamicsByPad = new Map(plan.pads.map((padPlan) => [padPlan.pad, padPlan.expectedDynamics]))
  // Snapshot of each pad's OWN matched offsets, before the slip pass can add
  // any borrowed from elsewhere — unison gaps compare limbs on their own
  // timing only, never inflated by a sibling's slipped-in offsets.
  const originalOffsetsByPad = new Map<MappedDrumPad, readonly OffsetSample[]>()
  const states = new Map<MappedDrumPad, PadState>()
  for (const pad of padOrder) {
    const expectedMs = expectedMsByPad.get(pad) ?? []
    const padHits = hitsByPad.get(pad) ?? []
    const { offsets, matched, unmatchedExpected, unmatchedHits } = pair(expectedMs, padHits, plan.windowMs)
    originalOffsetsByPad.set(pad, offsets)
    states.set(pad, {
      pad,
      expected: expectedMs.length,
      hits: padHits.length,
      matched,
      missedInstants: unmatchedExpected,
      extraHits: unmatchedHits,
      offsets,
      slipped: 0,
    })
  }

  const articulation = applyArticulationSlips(states, plan.windowMs)

  // DR-07 tail (review round 3, RED 1): computed here, BEFORE `pads`, so each
  // pad's dynamics can be graded against the pairing at its EFFECTIVE grid
  // shift below, instead of always at step 0. Hoisting changes nothing about
  // what `runSlipSteps` computes — it only reads `plan.pads`, scalar plan
  // fields, and `hitsByPad`, none of which depend on the `pads` array being
  // built — only when it runs.
  const slipSteps = runSlipSteps(
    plan.pads,
    plan.windowMs,
    plan.nominalSubdivisionTicks,
    plan.swing,
    plan.msPerTick,
    hitsByPad,
  )

  const pads: GroovePadResult[] = padOrder.map((pad) => {
    const state = states.get(pad)
    invariant(state !== undefined, `pad state missing for ${pad}`)
    // The slip pass appends its offsets at the end of `state.offsets`,
    // regardless of where the slipped-in instant sits among the pad's own —
    // so `drift()`'s first-half/second-half split (positional, over strokes
    // "ordered by the instant they answer") would be corrupted by a slip
    // anywhere but the tail. Sort back to instant order before any stat that
    // is order-sensitive; mean/spread do not care, but doing it once here
    // keeps every stat reading the same, correctly-ordered list.
    const sortedOffsets = [...state.offsets].sort((a, b) => a.instant - b.instant).map((o) => o.offset)
    // This pad's own hits against its own grid — see
    // `GroovePadResult.displacementSteps`'s own doc for why this is asked per
    // pad rather than only of the whole pattern. Computed here (not inline
    // below) because `effectiveStep` needs it too.
    const displacementSteps = padDisplacementSteps(
      expectedNominalTicksByPad.get(pad) ?? [],
      hitsByPad.get(pad) ?? [],
      plan.windowMs,
      plan.nominalSubdivisionTicks,
      plan.swing,
      plan.msPerTick,
      MAX_SLIP_STEPS,
    )
    // DR-07 tail (review round 3, RED 1): grade dynamics against the pairing
    // at this pad's EFFECTIVE shift — the whole-run `slipSteps` when the run
    // agrees on one, else this pad's own `displacementSteps`, else 0 (the
    // original step-0 pairing already sitting in `originalOffsetsByPad`). See
    // `GroovePadResult.dynamics`'s own doc for the bug this fixes.
    const effectiveStep = slipSteps ?? displacementSteps ?? 0
    const dynamicsOffsets =
      effectiveStep === 0
        ? (originalOffsetsByPad.get(pad) ?? [])
        : pair(
            shiftedExpectedMs(
              expectedNominalTicksByPad.get(pad) ?? [],
              effectiveStep,
              plan.nominalSubdivisionTicks,
              plan.swing,
              plan.msPerTick,
            ),
            hitsByPad.get(pad) ?? [],
            plan.windowMs,
          ).offsets
    return {
      pad: state.pad,
      expected: state.expected,
      hits: state.hits,
      matched: state.matched,
      missed: state.missedInstants.length,
      extra: state.extraHits.length,
      slipped: state.slipped,
      meanOffsetMs: sortedOffsets.length === 0 ? undefined : mean(sortedOffsets),
      spreadMs: sortedOffsets.length === 0 ? undefined : standardDeviation(sortedOffsets),
      driftMs: drift(sortedOffsets),
      // This pad's own hits (not the slip-adjusted `state`) against its own
      // grid — see `GroovePadResult.displacementSteps`'s own doc for why this
      // is asked per pad rather than only of the whole pattern.
      displacementSteps,
      // PRE-slip pairing, at this pad's EFFECTIVE shift — see this field's
      // own doc on `GroovePadResult` and the comment on `effectiveStep` above.
      dynamics: padDynamics(
        dynamicsOffsets.map((o) => ({
          expectedIndex: o.expectedIndex,
          velocity: (velocitiesByPad.get(pad) ?? [])[o.hitIndex],
        })),
        expectedDynamicsByPad.get(pad) ?? [],
      ),
    }
  })

  const limits = {
    spreadMs: plan.windowMs * STEADY_SPREAD_FRACTION,
    driftMs: plan.windowMs * STEADY_DRIFT_FRACTION,
    flamMs: plan.windowMs * FLAM_FRACTION,
  }

  // Only pairs the SCORE writes on one instant, and only when both limbs
  // actually landed something to compare (T.17.2 — the first attempt took
  // max-minus-min over every pad's run-long mean and named kick and snare on
  // the money beat, where they share no instant at all).
  const unison: UnisonGap[] = []
  for (const [a, b] of plan.unisonPairs) {
    const aOffsets = originalOffsetsByPad.get(a) ?? []
    const bOffsets = originalOffsetsByPad.get(b) ?? []
    if (aOffsets.length === 0 || bOffsets.length === 0) continue
    unison.push({
      pads: [a, b],
      gapMs: Math.abs(mean(aOffsets.map((o) => o.offset)) - mean(bOffsets.map((o) => o.offset))),
    })
  }

  const totalHits = hits.length
  const steady =
    totalHits > 0 &&
    pads.every((row) => row.missed === 0 && row.extra === 0) &&
    pads.every((row) => row.slipped === 0) &&
    pads.every((row) => row.spreadMs === undefined || row.spreadMs <= limits.spreadMs) &&
    pads.every((row) => row.driftMs === undefined || Math.abs(row.driftMs) <= limits.driftMs) &&
    unison.every((gap) => gap.gapMs <= limits.flamMs)

  return {
    steady,
    totalHits,
    pads,
    unison,
    articulation,
    // Hoisted above `pads` now (review round 3, RED 1) — same value, computed once.
    slipSteps,
    limits,
  }
}

/** The worst unison pair, for the one flam sentence the screen shows. */
export function worstUnisonGap(result: GrooveRunResult): UnisonGap | undefined {
  let worst: UnisonGap | undefined
  for (const gap of result.unison) {
    if (gap.gapMs <= result.limits.flamMs) continue
    if (worst === undefined || gap.gapMs > worst.gapMs) worst = gap
  }
  return worst
}
