/**
 * Per-limb mute for the groove trainer (roadmap DR-09 "per-limb mute"). The
 * learner can switch a pad off and have the app voice it instead of grading
 * it — this module is the pure half of that: turning a `GrooveRunPlan` into
 * the plan the GRADER should use once some pads are muted.
 *
 * ## Timing fields are never touched
 *
 * `plan.ts`'s own module comment is emphatic that the match window comes from
 * the WHOLE score, never from what is left after muting — a sparse remaining
 * limb must get no discount for being sparse. So every timing field
 * (`windowMs`, `gradedMs`, `beatMs`, `barMs`, `bpm`, `countInBars`,
 * `countInBeats`, `gradedBars`, `subdivisionMs`, `toleranceMs`, `grooveId`,
 * `title`) is carried over byte-identical; only the pad-bearing fields
 * (`pads`, `unisonPairs`) are filtered.
 */
import { invariant } from '@core/shared/invariant.ts'
import type { GroovePadPlan, GrooveRunPlan } from './plan.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'

/**
 * `plan` with every muted pad removed from grading. `muted` empty returns
 * `plan` itself (same reference) — nothing to filter, nothing to allocate.
 * Throws if every pad the score uses would be muted: a run needs at least one
 * graded limb.
 */
export function mutePads(plan: GrooveRunPlan, muted: ReadonlySet<MappedDrumPad>): GrooveRunPlan {
  if (muted.size === 0) return plan

  const pads = plan.pads.filter((padPlan) => !muted.has(padPlan.pad))
  invariant(pads.length > 0, 'mutePads: every pad in the plan would be muted')

  const unisonPairs = plan.unisonPairs.filter(([a, b]) => !muted.has(a) && !muted.has(b))

  return { ...plan, pads, unisonPairs }
}

/** The pad plans the app must voice itself, in `plan.pads`'s own order. */
export function mutedPadPlans(
  plan: GrooveRunPlan,
  muted: ReadonlySet<MappedDrumPad>,
): readonly GroovePadPlan[] {
  return plan.pads.filter((padPlan) => muted.has(padPlan.pad))
}
