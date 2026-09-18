/**
 * Pure app-side helpers for the coordination trainer (roadmap DR-15): turning
 * a drill mode + groove into the step list `CoordinationTrainerScreen` walks
 * through, and the pure "what happens after a graded pass" transition. No
 * React here — `useCoordinationTrainer.ts` is the hook that wraps these with
 * state and `useGrooveRun`.
 */
import type { GrooveScore } from '@core/drums/model/groove.ts'
import { layerStack } from '@core/drums/coordination/layers.ts'
import { singleKickPermutations } from '@core/drums/coordination/permutations.ts'

export type DrillMode = 'layers' | 'kicks'

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
 * groove library.
 */
export function drillSteps(mode: DrillMode, groove: GrooveScore): readonly DrillStep[] {
  if (mode === 'layers') {
    return layerStack(groove).map((layer) => ({
      index: layer.index,
      count: layer.count,
      title: layer.score.title,
      score: layer.score,
    }))
  }
  const drills = singleKickPermutations()
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
