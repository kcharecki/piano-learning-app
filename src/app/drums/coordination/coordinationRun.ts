/**
 * Pure app-side helpers for the coordination trainer (roadmap DR-15): turning
 * a drill mode + groove into the step list `CoordinationTrainerScreen` walks
 * through, and the pure "what happens after a graded pass" transition. No
 * React here — `useCoordinationTrainer.ts` is the hook that wraps these with
 * state and `useGrooveRun`.
 */
import type { GrooveScore } from '@core/drums/model/groove.ts'
import { hhFootDrills } from '@core/drums/coordination/hhFoot.ts'
import { layerStack } from '@core/drums/coordination/layers.ts'
import { singleKickPermutations, twoKickPermutations } from '@core/drums/coordination/permutations.ts'
import type { Rng } from '@core/ports/index.ts'

export type DrillMode = 'layers' | 'kicks' | 'kicks2' | 'hhFoot'

/** How many two-kick drills one visit to the mode draws. */
export const TWO_KICK_DRILLS = 12

export type DrillStep = {
  readonly index: number
  readonly count: number
  readonly title: string
  readonly score: GrooveScore
}

/**
 * `'layers'`: `layerStack(groove)`, one step per cumulative layer.
 * `'kicks'`: the 16 single-kick permutation drills — `groove` is ignored,
 * since the kick drills are their own fixed content, not built from the
 * groove library. `'kicks2'`: `TWO_KICK_DRILLS` two-kick drills drawn fresh
 * through `rng` — `groove` is ignored here too. `'hhFoot'`:
 * `hhFootDrills(groove)`, one step per cumulative build stage (ride + foot,
 * then kick, then snare). `rng` is consulted ONLY in `'kicks2'`; the other
 * three modes never call it.
 */
export function drillSteps(mode: DrillMode, groove: GrooveScore, rng: Rng): readonly DrillStep[] {
  if (mode === 'layers') {
    return layerStack(groove).map((layer) => ({
      index: layer.index,
      count: layer.count,
      title: layer.score.title,
      score: layer.score,
    }))
  }
  if (mode === 'hhFoot') {
    const drills = hhFootDrills(groove)
    return drills.map((drill, index) => ({
      index,
      count: drills.length,
      title: drill.score.title,
      score: drill.score,
    }))
  }
  const drills = mode === 'kicks' ? singleKickPermutations() : twoKickPermutations(rng, TWO_KICK_DRILLS)
  return drills.map((drill, index) => ({
    index,
    count: drills.length,
    title: drill.score.title,
    score: drill.score,
  }))
}

export type StepState = {
  readonly index: number
  readonly unlocked: number
}

/**
 * After a graded pass: a steady pass advances `index` to the next step
 * (capped at the last one) and raises `unlocked` to match if that is
 * further than it already was. A pass that was not steady changes nothing —
 * the learner stays on the step they just attempted.
 */
export function advance(state: StepState, steady: boolean, count: number): StepState {
  if (!steady || count <= 0) return state
  const nextIndex = Math.min(state.index + 1, count - 1)
  return { index: nextIndex, unlocked: Math.max(state.unlocked, nextIndex) }
}
