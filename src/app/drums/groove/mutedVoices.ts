/**
 * Turns a muted set into the absolute instants the app must voice itself
 * (roadmap DR-09 "per-limb mute"). Pure — no React, no clock — so
 * `useGrooveRun.ts` can call it once per pass and stay thin. See
 * `@core/drums/practice/mute.ts` for the grading-side half of this feature.
 */
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { mutedPadPlans } from '@core/drums/practice/mute.ts'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'

export type MutedStrike = {
  readonly pad: MappedDrumPad
  readonly atMs: number
}

/** The velocity the app voices a muted limb at — under the learner's own HIT_VELOCITY (96), above a ghost. */
export const VOICED_VELOCITY = 84

/**
 * Absolute instants for ONE pass whose graded window opens at `originMs`:
 * every muted pad's `expectedMs` shifted by `originMs`, sorted by `atMs` then
 * by pad name (so two pads sharing an instant come back in a stable order).
 */
export function mutedStrikes(
  plan: GrooveRunPlan,
  muted: ReadonlySet<MappedDrumPad>,
  originMs: number,
): readonly MutedStrike[] {
  const strikes: MutedStrike[] = []
  for (const padPlan of mutedPadPlans(plan, muted)) {
    for (const ms of padPlan.expectedMs) {
      strikes.push({ pad: padPlan.pad, atMs: originMs + ms })
    }
  }
  return strikes.sort((a, b) => a.atMs - b.atMs || (a.pad < b.pad ? -1 : a.pad > b.pad ? 1 : 0))
}
