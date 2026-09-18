/**
 * The MIDI-learn wizard's pure state machine (roadmap DR-02): "Hit your
 * kick... now your snare..." one pad at a time, captures whatever raw note
 * number the e-kit actually sends for it, and turns the captures into a
 * `KitMap` — the real fallback for every kit the shipped presets
 * (`presets.ts`) miss. Pure and total, like every other module in this
 * folder: no DOM, no IO, no clock. The app layer (`KitMapLearnCard.tsx`)
 * owns feeding real note-on events in and rendering the prompts; this module
 * owns only the step sequencing and the conflict/undo/finish rules.
 *
 * `LEARN_STEPS` is a fixed, ordered list: the nine pads a groove cannot be
 * graded without come first and are required; the six extra voices (rim,
 * cross-stick, and the ride's other zones) come after and are skippable —
 * a learner with a budget kit that only sends the bow note for its ride
 * finishes the wizard without ever seeing a prompt they cannot satisfy.
 */
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { HI_HAT, pad, type KitMap, type KitMapEntry } from './kitMap.ts'

export type LearnTarget = { readonly kind: 'pad'; readonly pad: MappedDrumPad } | { readonly kind: 'hiHat' }

export type LearnStep = {
  readonly target: LearnTarget
  readonly prompt: string
  readonly required: boolean
}

function padStep(p: MappedDrumPad, prompt: string, required: boolean): LearnStep {
  return { target: { kind: 'pad', pad: p }, prompt, required }
}

/**
 * Required first (kick..rideBow, the nine pads live grading depends on),
 * then the six optional extras. Order matches the contract exactly — a
 * property test elsewhere in this file relies only on the length and the
 * required/optional split, never on renumbering these by hand.
 */
export const LEARN_STEPS: readonly LearnStep[] = [
  padStep('kick', 'Hit your kick drum', true),
  padStep('snare', 'Hit your snare (centre)', true),
  { target: { kind: 'hiHat' }, prompt: 'Hit your hi-hat (closed)', required: true },
  padStep('hhPedal', 'Step on the hi-hat pedal', true),
  padStep('tomHigh', 'Hit your high tom', true),
  padStep('tomMid', 'Hit your mid tom', true),
  padStep('tomFloor', 'Hit your floor tom', true),
  padStep('crash1', 'Hit your crash cymbal', true),
  padStep('rideBow', 'Hit your ride cymbal (bow)', true),
  padStep('snareRim', 'Hit your snare rim, if you have one', false),
  padStep('crossStick', 'Play a cross-stick (side stick) on your snare, if you have one', false),
  padStep('rideBell', 'Hit your ride bell, if you have one', false),
  padStep('rideEdge', "Hit your ride's edge, if it sends a separate note", false),
  padStep('crash2', 'Hit your second crash cymbal, if you have one', false),
  padStep('splash', 'Hit your splash cymbal, if you have one', false),
]

export type LearnCapture = { readonly stepIndex: number; readonly note: number }

export type LearnState = {
  /** Index into `LEARN_STEPS`; `=== LEARN_STEPS.length` when every step is answered or skipped. */
  readonly stepIndex: number
  /** Ascending by `stepIndex`, at most one per step. */
  readonly captures: readonly LearnCapture[]
  /** The note just refused because another step already owns it; `undefined` otherwise. */
  readonly conflict: number | undefined
}

export function startLearn(): LearnState {
  return { stepIndex: 0, captures: [], conflict: undefined }
}

export function isFinished(stepIndex: number): boolean {
  return stepIndex >= LEARN_STEPS.length
}

export function currentStep(stepIndex: number): LearnStep | undefined {
  return LEARN_STEPS[stepIndex]
}

/**
 * Assigns `note` to the current step and advances. If the note already
 * belongs to a capture of another step, returns the same step with
 * `conflict: note` (nothing captured) — the wizard can only ever hold one
 * step per physical pad, since `kitMapFromCaptures` keys the resulting map
 * by note number. No-op when finished.
 */
export function captureNote(state: LearnState, note: number): LearnState {
  if (isFinished(state.stepIndex)) return state

  const alreadyOwned = state.captures.some((capture) => capture.note === note)
  if (alreadyOwned) {
    return { ...state, conflict: note }
  }

  return {
    stepIndex: state.stepIndex + 1,
    captures: [...state.captures, { stepIndex: state.stepIndex, note }],
    conflict: undefined,
  }
}

/** Advances without capturing; only when the current step is not required (otherwise returns state unchanged). */
export function skipStep(state: LearnState): LearnState {
  if (isFinished(state.stepIndex)) return state
  const step = currentStep(state.stepIndex)
  if (step === undefined || step.required) return state
  return { stepIndex: state.stepIndex + 1, captures: state.captures, conflict: undefined }
}

/** Steps back one step, removing its capture if any. No-op at step 0. Clears conflict. */
export function undoStep(state: LearnState): LearnState {
  if (state.stepIndex === 0) return state
  const previousStepIndex = state.stepIndex - 1
  const hadCapture = state.captures.some((capture) => capture.stepIndex === previousStepIndex)
  return {
    stepIndex: previousStepIndex,
    captures: hadCapture
      ? state.captures.filter((capture) => capture.stepIndex !== previousStepIndex)
      : state.captures,
    conflict: undefined,
  }
}

/** Every step with `required === true` has a capture. */
export function requiredStepsDone(captures: readonly LearnCapture[]): boolean {
  const capturedSteps = new Set(captures.map((capture) => capture.stepIndex))
  return LEARN_STEPS.every((step, index) => !step.required || capturedSteps.has(index))
}

/** Builds the map: each capture's note -> the entry named by its step's target. No `hiHat` config — the engine's defaults apply. */
export function kitMapFromCaptures(name: string, captures: readonly LearnCapture[]): KitMap {
  const notes: Record<number, KitMapEntry> = {}
  for (const capture of captures) {
    const step = LEARN_STEPS[capture.stepIndex]
    if (step === undefined) continue
    notes[capture.note] = step.target.kind === 'hiHat' ? HI_HAT : pad(step.target.pad)
  }
  return { name, notes }
}

export const LEARNED_KIT_MAP_NAME = 'Learned kit'
