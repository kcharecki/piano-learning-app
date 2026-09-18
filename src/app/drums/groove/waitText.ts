/**
 * Wait mode's own status line (roadmap DR-09 "wait mode") — the text half of
 * `useWaitRun.ts`. Kept out of the `.tsx` files per the house rule that a
 * component module exports only components: this is pure text formatting,
 * co-located with its own test the way `resultLines.ts`/`liveHitText.ts` are.
 */
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { stepPosition, type WaitState, type WaitStep } from '@core/drums/practice/wait.ts'
import { GROOVE_PAD_LABEL, sortPadsForDisplay } from './padLabels.ts'
import type { WaitRunPhase } from './useWaitRun.ts'

export function waitStateText(
  phase: WaitRunPhase,
  steps: readonly WaitStep[],
  state: WaitState,
  plan: GrooveRunPlan,
): string {
  if (phase === 'idle') {
    return 'Wait mode: the run moves on only when you strike every note of the current beat'
  }
  if (phase === 'done') {
    return 'Done — every stroke landed. Start again or switch Wait off for a graded run.'
  }

  const step = steps[state.stepIndex]
  if (step === undefined) {
    // Defensive only: `phase` is 'waiting' exactly while `stepIndex < steps.length`.
    return 'Done — every stroke landed. Start again or switch Wait off for a graded run.'
  }
  const remaining = step.pads.filter((pad) => !state.satisfied.includes(pad))
  const names = sortPadsForDisplay(remaining, (pad) => pad)
    .map((pad) => GROOVE_PAD_LABEL[pad])
    .join(' + ')
  const { bar, beat, subdivision } = stepPosition(step, plan)
  return `Waiting for ${names} — bar ${bar}, beat ${beat}${subdivisionSuffix(subdivision)} (step ${
    state.stepIndex + 1
  } of ${steps.length})`
}

/** The spoken suffix for a step's nearest sixteenth within the beat — see `stepPosition`. */
function subdivisionSuffix(subdivision: 0 | 1 | 2 | 3 | undefined): string {
  switch (subdivision) {
    case 0:
      return ''
    case 1:
      return ' e'
    case 2:
      return ' and'
    case 3:
      return ' a'
    case undefined:
      return ' (off the beat)'
  }
}
