/**
 * Wait mode for the groove trainer (roadmap DR-09 "wait mode"): no clock, no
 * click track, no grading. The run walks the plan's own expected instants in
 * order, and the playhead advances only when the learner has struck EVERY pad
 * written on the current instant — a unison instant (hat + kick together, as
 * in every instant of Quarter-Note Rock) needs both before it lets go.
 *
 * ## Steps come from the plan, not from a fresh reading of the score
 *
 * `waitSteps` collapses `GrooveRunPlan.pads[].expectedMs` — the SAME flat
 * per-pad instant lists `grade.ts` and the loop code already treat as ground
 * truth — into one ordered list of unison-grouped instants. Nothing here
 * re-derives timing from ticks or re-opens the score; a wait run is a
 * different way of walking exactly what a graded run would have walked.
 *
 * ## A hit is either required, advances, extra, or moot
 *
 * `applyWaitHit` is the whole state machine: a pad the current step still
 * needs is `'required'` (or `'advanced'` if it was the last one needed); a
 * pad the current step does not need — wrong pad, or a pad already satisfied
 * this step — is `'extra'` and changes nothing, not even a re-render's worth
 * of new state (the returned `state` is the same reference); once every step
 * is done, every further hit is `'done'`. There is no penalty path: wait mode
 * grades nothing, and `'extra'`/`'done'` exist so the caller can choose to
 * stay silent about them rather than because either means the learner erred.
 */
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { invariant } from '@core/shared/invariant.ts'

/** One expected instant of the graded window: every pad written there. `pads` sorted by name, unique. */
export type WaitStep = {
  readonly index: number
  /** ms from the graded origin, exactly as `GrooveRunPlan.pads[].expectedMs` carries it */
  readonly atMs: number
  /**
   * `atMs`'s own NOMINAL (straight, unswung) instant — `GroovePadPlan.expectedNominalMs`'s
   * value at the same index. `stepPosition`'s `subdivision` is named from
   * this, never from `atMs`: a swung "&" does not sit on the straight
   * sixteenth grid `atMs` would be tested against (F3).
   */
  readonly nominalAtMs: number
  readonly pads: readonly MappedDrumPad[]
}

/** Distinct instants across every plan pad, ascending by `atMs`; index 0..n-1. Empty plan pads → []. */
export function waitSteps(plan: GrooveRunPlan): readonly WaitStep[] {
  const padsByMs = new Map<number, Set<MappedDrumPad>>()
  const nominalByMs = new Map<number, number>()
  for (const padPlan of plan.pads) {
    for (let i = 0; i < padPlan.expectedMs.length; i++) {
      const atMs = padPlan.expectedMs[i]
      const nominalAtMs = padPlan.expectedNominalMs[i]
      if (atMs === undefined || nominalAtMs === undefined) continue
      const set = padsByMs.get(atMs) ?? new Set<MappedDrumPad>()
      set.add(padPlan.pad)
      padsByMs.set(atMs, set)
      // Swing is a function of the tick alone, never the pad (`swing.ts`'s
      // own doc), so every pad written on one swung instant shares the same
      // nominal instant too — an invariant, not a silent first-writer-wins.
      const existingNominal = nominalByMs.get(atMs)
      invariant(
        existingNominal === undefined || existingNominal === nominalAtMs,
        `wait steps: instant ${atMs}ms has two different nominal instants (${String(existingNominal)}, ${nominalAtMs}) across pads — swing must be a function of tick alone`,
      )
      if (existingNominal === undefined) nominalByMs.set(atMs, nominalAtMs)
    }
  }
  const sortedMs = [...padsByMs.keys()].sort((a, b) => a - b)
  return sortedMs.map((atMs, index) => {
    const pads = padsByMs.get(atMs)
    const nominalAtMs = nominalByMs.get(atMs)
    invariant(nominalAtMs !== undefined, `wait steps: no nominal instant recorded for ${atMs}ms`)
    return {
      index,
      atMs,
      nominalAtMs,
      pads: pads === undefined ? [] : [...pads].sort(),
    }
  })
}

export type WaitState = {
  /** Index of the step being waited for; `steps.length` once every step is satisfied. */
  readonly stepIndex: number
  /** Pads of the current step already struck since the step began. */
  readonly satisfied: readonly MappedDrumPad[]
}

export const INITIAL_WAIT_STATE: WaitState = { stepIndex: 0, satisfied: [] }

export type WaitHitOutcome =
  | 'required' // pad was needed on this step and is now satisfied; step not yet complete
  | 'advanced' // pad completed the step; state moved to the next step (satisfied reset)
  | 'extra' // pad not needed now (or already satisfied): state unchanged
  | 'done' // run already complete: state unchanged

export function applyWaitHit(
  steps: readonly WaitStep[],
  state: WaitState,
  pad: MappedDrumPad,
): { readonly state: WaitState; readonly outcome: WaitHitOutcome } {
  if (state.stepIndex >= steps.length) return { state, outcome: 'done' }
  const step = steps[state.stepIndex]
  if (step === undefined) return { state, outcome: 'done' }

  if (!step.pads.includes(pad) || state.satisfied.includes(pad)) {
    return { state, outcome: 'extra' }
  }

  const satisfied = [...state.satisfied, pad]
  if (satisfied.length === new Set(step.pads).size) {
    return { state: { stepIndex: state.stepIndex + 1, satisfied: [] }, outcome: 'advanced' }
  }
  return { state: { stepIndex: state.stepIndex, satisfied }, outcome: 'required' }
}

/**
 * 1-based bar and beat of a step, plus the nearest sixteenth within the beat:
 * 0 = on the beat, 1 = "e", 2 = "and", 3 = "a" — `undefined` when the instant
 * is not within `EPSILON_MS` of any sixteenth grid point (a triplet, say).
 */
export type StepPosition = {
  readonly bar: number
  readonly beat: number
  readonly subdivision: 0 | 1 | 2 | 3 | undefined
}

/** Guards the modulo checks below against float dust from ms-per-tick division; in ms throughout. */
const EPSILON_MS = 1e-6

export function stepPosition(step: WaitStep, plan: GrooveRunPlan): StepPosition {
  // A1: bar, beat AND subdivision are all named off `nominalAtMs`, never the
  // swung `atMs` — mixing a swung bar/beat with a nominal subdivision put a
  // swung instant that crosses a beat boundary (e.g. a late-swung sixteenth
  // pushed past the next beat line) under the WRONG beat's subdivision.
  // `nominalAtMs` is the same straight instant the notated position always
  // was; deriving bar, beat and subdivision from one shared time keeps them
  // mutually consistent.
  const nominalBar = Math.floor((step.nominalAtMs + EPSILON_MS) / plan.barMs) + 1
  const nominalIntoBar = step.nominalAtMs - (nominalBar - 1) * plan.barMs
  const nominalBeat = Math.floor((nominalIntoBar + EPSILON_MS) / plan.beatMs) + 1
  const nominalIntoBeat = nominalIntoBar - (nominalBeat - 1) * plan.beatMs
  const sixteenth = plan.beatMs / 4
  const k = Math.round(nominalIntoBeat / sixteenth)
  // The floor+epsilon rollover above already carries a beat-boundary instant
  // into the NEXT beat's `nominalIntoBeat` ≈ 0, so `k` never lands on 4 here.
  // `nominalIntoBeat` can land a hair below 0 (float dust), rounding `k` to
  // `-0`; `((k % 4) + 4) % 4` normalizes that to `0` rather than failing `toBe(0)`.
  const subdivision =
    Math.abs(nominalIntoBeat - k * sixteenth) <= EPSILON_MS ? (((k % 4) + 4) % 4 as 0 | 1 | 2 | 3) : undefined
  return { bar: nominalBar, beat: nominalBeat, subdivision }
}
