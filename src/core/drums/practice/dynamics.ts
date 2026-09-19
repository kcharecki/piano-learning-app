/**
 * Velocity-vs-notated-dynamics grading (roadmap DR-07 tail / DR-03). A note
 * the score marks 'accent' or 'ghost' asks for a *deliberately* different
 * velocity than the surrounding 'normal' strokes; this module answers
 * whether the learner actually played it that way, for the strokes
 * `grade.ts`'s own pairing already matched to an expected instant.
 *
 * Deliberately takes the FIELDS a caller already has, not a `GroovePadPlan`
 * or `GrooveRunResult` record (the orphan-signals lint rule) — `grade.ts`
 * builds `matches` from its own pairing (`OffsetSample.expectedIndex`/
 * `hitIndex`), never re-pairs here.
 */
import { velocityClassOf, type VelocityThresholds } from '@core/drums/model/velocity.ts'
import type { DynamicsClass } from '@core/drums/model/groove.ts'

export type PadDynamicsResult = {
  /**
   * Matched strokes whose expected class was 'accent' or 'ghost' — 'normal'
   * is never graded, since any velocity satisfies it. Counted in the
   * EFFECTIVE-shift pairing `grade.ts` passes in (`slipSteps` when defined,
   * else this pad's own `displacementSteps`, else 0 — review round 3, RED 1),
   * which can differ from `GroovePadResult.matched` (always the step-0
   * pairing) on a displaced run: the two numbers answer different questions
   * and are not interchangeable.
   */
  readonly graded: number
  /** Of `graded`, how many classified to something other than the expected class. */
  readonly wrong: number
  /** Of `wrong`, expected 'ghost' but played too loud. */
  readonly softWanted: number
  /** Of `wrong`, expected 'accent' but played too soft. */
  readonly loudWanted: number
  /**
   * Of `graded`, how many were notated 'ghost' — the denominator `softWanted`
   * is counted out of. Callers must not report `softWanted` against `graded`
   * (both kinds combined): a pad with both ghost and accent instants would
   * read as "N of (ghosts + accents) ghost notes", overstating how many
   * ghost notes there even were.
   */
  readonly ghostInstants: number
  /** Of `graded`, how many were notated 'accent' — the denominator `loudWanted` is counted out of, same reasoning as `ghostInstants`. */
  readonly accentInstants: number
  /**
   * Review round 3 (RED, "mouse-only ghost-funk falsely passes"): matched
   * strokes on an accent/ghost instant whose hit carried NO velocity — i.e.
   * would have contributed to `graded` had it carried one. Disjoint from
   * `graded`: a matched stroke on a non-'normal' instant is either graded (has
   * a velocity) or unclassified (does not), never both, and a stroke on a
   * 'normal' instant is never counted here either. See
   * `dynamicsCoverageNote` (`resultLines.ts`) for how a caller turns this into
   * a learner-facing sentence instead of a silent, falsely-clean zero.
   */
  readonly unclassified: number
}

/**
 * One matched stroke, as `grade.ts`'s pairing already knows it: which
 * expected instant it answers (an index into the pad's own
 * `expectedDynamics`), and the velocity it was struck with — `undefined`
 * when the input carried none at all. That is NOT the same as "played
 * normally": a mouse-clicked on-screen pad has no way to express velocity,
 * so an absent velocity is UNCLASSIFIED and excluded from grading entirely
 * (review round 3, RED 3) — see `padDynamics`'s own doc. A keyboard press
 * always carries a velocity (`groovePadHooks.ts`'s `KEYBOARD_NORMAL_VELOCITY`
 * for a plain press); only mouse input and a MIDI device that never reports
 * velocity produce `undefined` here.
 */
export type GradedDynamicsMatch = {
  readonly expectedIndex: number
  readonly velocity: number | undefined
}

/**
 * Grade each of `matches` against the class notated at its `expectedIndex`
 * in `expectedDynamics`. A 'normal'-expected note is never graded — any
 * velocity satisfies it, deliberately: DR-03's contract is that a learner
 * playing normal strokes should never see a dynamics complaint just for
 * varying their touch a little.
 *
 * A match with NO velocity at all is likewise never graded, but for a
 * different reason (review round 3, RED 3): it is UNCLASSIFIED, not
 * assumed-normal. A mouse learner clicking an on-screen pad has no way to
 * express velocity, so grading an absent velocity as 'normal' would tell
 * that learner "16 of 16 ghost notes came out full" on a ghost-funk groove
 * they have no way to play correctly or incorrectly — a false, unactionable
 * verdict. Excluded means excluded everywhere: not counted toward `graded`,
 * `wrong`, nor either instant-count (`ghostInstants`/`accentInstants`), on
 * either side of the ghost/accent split.
 */
export function padDynamics(
  matches: readonly GradedDynamicsMatch[],
  expectedDynamics: readonly DynamicsClass[],
  thresholds?: VelocityThresholds,
): PadDynamicsResult {
  let graded = 0
  let unclassified = 0
  let softWanted = 0
  let loudWanted = 0
  let ghostInstants = 0
  let accentInstants = 0
  for (const match of matches) {
    const expected = expectedDynamics[match.expectedIndex]
    if (expected === undefined || expected === 'normal') continue
    if (match.velocity === undefined) {
      unclassified += 1 // would have been graded had it carried a velocity
      continue
    }
    graded += 1
    if (expected === 'ghost') ghostInstants += 1
    else accentInstants += 1
    const played = velocityClassOf(match.velocity, thresholds)
    if (played === expected) continue
    if (expected === 'ghost') softWanted += 1
    else loudWanted += 1
  }
  return { graded, wrong: softWanted + loudWanted, softWanted, loudWanted, ghostInstants, accentInstants, unclassified }
}
