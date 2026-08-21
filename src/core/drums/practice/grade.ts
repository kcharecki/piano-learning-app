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
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { GrooveRunPlan, UnisonPair } from './plan.ts'

/** One pad press, in ms from the moment the graded window opened. */
export type GrooveHit = {
  readonly pad: MappedDrumPad
  readonly ms: number
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

/** How many subdivisions either side `slipSteps` will look for a displaced pattern. */
const MAX_SLIP_STEPS = 4

/** A whole-pattern displacement is only claimed if it explains this much of the run. */
const SLIP_COVERAGE = 0.75

export type GroovePadResult = {
  readonly pad: MappedDrumPad
  /** How many strokes the score asks for. Zero for a pad the groove does not use. */
  readonly expected: number
  /** How many strokes the learner played on this pad. */
  readonly hits: number
  readonly matched: number
  readonly missed: number
  readonly extra: number
  /** Mean of (hit - instant) over matched strokes. Positive is late. Undefined when nothing matched. */
  readonly meanOffsetMs: number | undefined
  /** Standard deviation of those offsets about `meanOffsetMs`. Undefined when nothing matched. */
  readonly spreadMs: number | undefined
  /** Second-half mean minus first-half mean. Positive means the limb is falling behind. */
  readonly driftMs: number | undefined
}

/** Two pads the SCORE puts on one instant, and how far apart they actually landed. */
export type UnisonGap = {
  readonly pads: UnisonPair
  readonly gapMs: number
}

export type GrooveRunResult = {
  readonly steady: boolean
  /** Total presses across every pad. Zero means nothing registered — a rig problem, not a timing one. */
  readonly totalHits: number
  readonly pads: readonly GroovePadResult[]
  /** Only pairs the score writes together, and only when both actually matched something. */
  readonly unison: readonly UnisonGap[]
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

type Pairing = {
  readonly offsets: readonly number[]
  readonly matched: number
}

/**
 * Nearest-first assignment of `hits` to `expected` inside `windowMs`. Optimal
 * because the windows do not overlap — see the module comment.
 */
function pair(expected: readonly number[], hits: readonly number[], windowMs: number): Pairing {
  const taken = new Array<boolean>(hits.length).fill(false)
  const offsets: number[] = []
  for (const instant of expected) {
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < hits.length; i++) {
      if (taken[i] === true) continue
      const hit = hits[i]
      if (hit === undefined) continue
      const distance = Math.abs(hit - instant)
      if (distance > windowMs) continue
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }
    if (bestIndex < 0) continue
    taken[bestIndex] = true
    offsets.push((hits[bestIndex] ?? 0) - instant)
  }
  return { offsets, matched: offsets.length }
}

/** How many of `expected`, shifted by `shiftMs`, find a hit. Counting only — no assignment kept. */
function matchCountAt(
  expected: readonly number[],
  hits: readonly number[],
  windowMs: number,
  shiftMs: number,
): number {
  return pair(
    expected.map((instant) => instant + shiftMs),
    hits,
    windowMs,
  ).matched
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
 */
function runSlipSteps(
  plan: GrooveRunPlan,
  hitsByPad: ReadonlyMap<MappedDrumPad, readonly number[]>,
): number | undefined {
  const steps = [...Array(MAX_SLIP_STEPS * 2 + 1).keys()].map((i) => i - MAX_SLIP_STEPS)
  const totals = new Map<number, number>(steps.map((step) => [step, 0]))
  let expectedTotal = 0
  let agreed: number | undefined
  let first = true

  for (const padPlan of plan.pads) {
    const hits = hitsByPad.get(padPlan.pad) ?? []
    expectedTotal += padPlan.expectedMs.length
    const counts = steps.map((step) => ({
      step,
      count: matchCountAt(padPlan.expectedMs, hits, plan.windowMs, step * plan.subdivisionMs),
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

/** Grade `hits` against `plan`. Pure and total: no clock, no ordering assumptions on `hits`. */
export function gradeGrooveRun(plan: GrooveRunPlan, hits: readonly GrooveHit[]): GrooveRunResult {
  const hitsByPad = new Map<MappedDrumPad, number[]>()
  for (const hit of hits) {
    const list = hitsByPad.get(hit.pad) ?? []
    list.push(hit.ms)
    hitsByPad.set(hit.pad, list)
  }
  for (const list of hitsByPad.values()) list.sort((a, b) => a - b)

  const offsetsByPad = new Map<MappedDrumPad, readonly number[]>()
  const pads: GroovePadResult[] = []
  for (const padPlan of plan.pads) {
    const padHits = hitsByPad.get(padPlan.pad) ?? []
    const { offsets, matched } = pair(padPlan.expectedMs, padHits, plan.windowMs)
    offsetsByPad.set(padPlan.pad, offsets)
    pads.push({
      pad: padPlan.pad,
      expected: padPlan.expectedMs.length,
      hits: padHits.length,
      matched,
      missed: padPlan.expectedMs.length - matched,
      extra: padHits.length - matched,
      meanOffsetMs: matched === 0 ? undefined : mean(offsets),
      spreadMs: matched === 0 ? undefined : standardDeviation(offsets),
      driftMs: drift(offsets),
    })
  }

  // A press on a pad this groove never asks for is not silently dropped: it
  // gets its own row with nothing expected, so it counts against the verdict
  // the same way any other spurious stroke does.
  const planned = new Set(plan.pads.map((padPlan) => padPlan.pad))
  for (const [pad, padHits] of hitsByPad) {
    if (planned.has(pad)) continue
    pads.push({
      pad,
      expected: 0,
      hits: padHits.length,
      matched: 0,
      missed: 0,
      extra: padHits.length,
      meanOffsetMs: undefined,
      spreadMs: undefined,
      driftMs: undefined,
    })
  }

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
    const aOffsets = offsetsByPad.get(a) ?? []
    const bOffsets = offsetsByPad.get(b) ?? []
    if (aOffsets.length === 0 || bOffsets.length === 0) continue
    unison.push({ pads: [a, b], gapMs: Math.abs(mean(aOffsets) - mean(bOffsets)) })
  }

  const totalHits = hits.length
  const steady =
    totalHits > 0 &&
    pads.every((row) => row.missed === 0 && row.extra === 0) &&
    pads.every((row) => row.spreadMs === undefined || row.spreadMs <= limits.spreadMs) &&
    pads.every((row) => row.driftMs === undefined || Math.abs(row.driftMs) <= limits.driftMs) &&
    unison.every((gap) => gap.gapMs <= limits.flamMs)

  return {
    steady,
    totalHits,
    pads,
    unison,
    slipSteps: runSlipSteps(plan, hitsByPad),
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
