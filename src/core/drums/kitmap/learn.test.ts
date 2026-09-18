/**
 * The MIDI-learn wizard's state machine (roadmap DR-02). Examples cover the
 * documented edge cases (conflict, skip refused on a required step, undo,
 * finish); the property tests pin the invariants any UI built on top of this
 * relies on holding for every reachable sequence of operations, not just the
 * examples below.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { HI_HAT, pad } from './kitMap.ts'
import {
  LEARN_STEPS,
  LEARNED_KIT_MAP_NAME,
  captureNote,
  currentStep,
  isFinished,
  kitMapFromCaptures,
  requiredStepsDone,
  skipStep,
  startLearn,
  undoStep,
  type LearnState,
} from './learn.ts'

describe('LEARN_STEPS', () => {
  it('the nine required steps come first, in order, then six optional ones', () => {
    expect(LEARN_STEPS).toHaveLength(15)
    expect(LEARN_STEPS.slice(0, 9).map((step) => step.target)).toEqual([
      { kind: 'pad', pad: 'kick' },
      { kind: 'pad', pad: 'snare' },
      { kind: 'hiHat' },
      { kind: 'pad', pad: 'hhPedal' },
      { kind: 'pad', pad: 'tomHigh' },
      { kind: 'pad', pad: 'tomMid' },
      { kind: 'pad', pad: 'tomFloor' },
      { kind: 'pad', pad: 'crash1' },
      { kind: 'pad', pad: 'rideBow' },
    ])
    expect(LEARN_STEPS.slice(0, 9).every((step) => step.required)).toBe(true)
    expect(LEARN_STEPS.slice(9).every((step) => !step.required)).toBe(true)
    expect(LEARN_STEPS.slice(9).map((step) => step.target)).toEqual([
      { kind: 'pad', pad: 'snareRim' },
      { kind: 'pad', pad: 'crossStick' },
      { kind: 'pad', pad: 'rideBell' },
      { kind: 'pad', pad: 'rideEdge' },
      { kind: 'pad', pad: 'crash2' },
      { kind: 'pad', pad: 'splash' },
    ])
  })
})

describe('startLearn', () => {
  it('starts at step 0 with no captures and no conflict', () => {
    expect(startLearn()).toEqual({ stepIndex: 0, captures: [], conflict: undefined })
  })
})

describe('captureNote', () => {
  it('captures the current step and advances', () => {
    const state = captureNote(startLearn(), 36)
    expect(state).toEqual({ stepIndex: 1, captures: [{ stepIndex: 0, note: 36 }], conflict: undefined })
  })

  it('a note already captured by another step refuses instead of capturing, and does not advance', () => {
    let state = captureNote(startLearn(), 36) // kick <- 36
    state = captureNote(state, 38) // snare <- 38
    const beforeConflict = state

    state = captureNote(state, 36) // hi-hat step tries to claim 36, already the kick's

    expect(state.stepIndex).toBe(beforeConflict.stepIndex)
    expect(state.captures).toEqual(beforeConflict.captures)
    expect(state.conflict).toBe(36)
  })

  it('is a no-op once finished', () => {
    let state: LearnState = startLearn()
    for (let i = 0; i < LEARN_STEPS.length; i += 1) {
      state = captureNote(state, i)
    }
    expect(isFinished(state.stepIndex)).toBe(true)
    const finished = state
    expect(captureNote(state, 99)).toEqual(finished)
  })
})

describe('skipStep', () => {
  it('refuses on a required step and returns the state unchanged', () => {
    const state = startLearn() // step 0, kick, required
    expect(skipStep(state)).toBe(state)
  })

  it('advances without capturing on an optional step', () => {
    let state: LearnState = startLearn()
    for (let i = 0; i < 9; i += 1) state = captureNote(state, i) // clear the 9 required steps
    expect(currentStep(state.stepIndex)?.required).toBe(false)

    const next = skipStep(state)
    expect(next.stepIndex).toBe(state.stepIndex + 1)
    expect(next.captures).toBe(state.captures)
  })

  it('is a no-op once finished', () => {
    let state: LearnState = startLearn()
    for (let i = 0; i < 9; i += 1) state = captureNote(state, i)
    for (let i = 0; i < 6; i += 1) state = skipStep(state)
    expect(isFinished(state.stepIndex)).toBe(true)
    expect(skipStep(state)).toBe(state)
  })
})

describe('undoStep', () => {
  it('steps back and removes the capture of the step it returns to', () => {
    const captured = captureNote(startLearn(), 36)
    const undone = undoStep(captured)
    expect(undone).toEqual({ stepIndex: 0, captures: [], conflict: undefined })
  })

  it('stepping back onto a skipped step leaves captures untouched (nothing to remove)', () => {
    let state: LearnState = startLearn()
    for (let i = 0; i < 9; i += 1) state = captureNote(state, i)
    state = skipStep(state) // step 9 (snareRim) skipped
    const beforeUndo = state
    state = undoStep(state)
    expect(state.stepIndex).toBe(9)
    expect(state.captures).toBe(beforeUndo.captures)
  })

  it('is a no-op at step 0', () => {
    const state = startLearn()
    expect(undoStep(state)).toBe(state)
  })

  it('clears a conflict', () => {
    let state = captureNote(startLearn(), 36)
    state = captureNote(state, 36) // conflict against the kick's own note
    expect(state.conflict).toBe(36)
    state = undoStep(state)
    expect(state.conflict).toBeUndefined()
  })
})

describe('requiredStepsDone', () => {
  it('false until every required step has a capture, true once they do', () => {
    let state: LearnState = startLearn()
    for (let i = 0; i < 8; i += 1) {
      state = captureNote(state, i)
      expect(requiredStepsDone(state.captures)).toBe(false)
    }
    state = captureNote(state, 8) // 9th required step (rideBow)
    expect(requiredStepsDone(state.captures)).toBe(true)
  })

  it('is unaffected by skipped optional steps', () => {
    let state: LearnState = startLearn()
    for (let i = 0; i < 9; i += 1) state = captureNote(state, i)
    expect(requiredStepsDone(state.captures)).toBe(true)
    state = skipStep(state)
    expect(requiredStepsDone(state.captures)).toBe(true)
  })
})

describe('finishing the wizard', () => {
  it('capturing every required step and skipping every optional one reaches isFinished', () => {
    let state: LearnState = startLearn()
    for (let i = 0; i < 9; i += 1) state = captureNote(state, i)
    expect(isFinished(state.stepIndex)).toBe(false)
    for (let i = 0; i < 6; i += 1) state = skipStep(state)
    expect(isFinished(state.stepIndex)).toBe(true)
    expect(state.captures).toHaveLength(9)
  })
})

describe('kitMapFromCaptures', () => {
  it('maps each capture note to the entry named by its step target, including the hi-hat step', () => {
    let state: LearnState = startLearn()
    state = captureNote(state, 36) // kick
    state = captureNote(state, 38) // snare
    state = captureNote(state, 42) // hi-hat (hiHat entry, not a pad)

    const map = kitMapFromCaptures(LEARNED_KIT_MAP_NAME, state.captures)
    expect(map.name).toBe(LEARNED_KIT_MAP_NAME)
    expect(map.notes).toEqual({ 36: pad('kick'), 38: pad('snare'), 42: HI_HAT })
    expect(map.hiHat).toBeUndefined()
  })

  it('an empty capture list builds an empty map', () => {
    expect(kitMapFromCaptures(LEARNED_KIT_MAP_NAME, [])).toEqual({ name: LEARNED_KIT_MAP_NAME, notes: {} })
  })
})

// ------------------------------------------------------------- property tests

type Op = { readonly kind: 'capture'; readonly note: number } | { readonly kind: 'skip' } | { readonly kind: 'undo' }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('capture' as const), note: fc.integer({ min: 0, max: 127 }) }),
  fc.record({ kind: fc.constant('skip' as const) }),
  fc.record({ kind: fc.constant('undo' as const) }),
)

function applyOp(state: LearnState, op: Op): LearnState {
  if (op.kind === 'capture') return captureNote(state, op.note)
  if (op.kind === 'skip') return skipStep(state)
  return undoStep(state)
}

describe('property: any sequence of capture/skip/undo ops', () => {
  it('captures stay ascending, unique by stepIndex, and unique by note; stepIndex stays in range', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        let state: LearnState = startLearn()
        for (const op of ops) {
          state = applyOp(state, op)

          expect(state.stepIndex).toBeGreaterThanOrEqual(0)
          expect(state.stepIndex).toBeLessThanOrEqual(LEARN_STEPS.length)

          const stepIndices = state.captures.map((c) => c.stepIndex)
          const sorted = [...stepIndices].sort((a, b) => a - b)
          expect(stepIndices).toEqual(sorted)
          expect(new Set(stepIndices).size).toBe(stepIndices.length)

          const notes = state.captures.map((c) => c.note)
          expect(new Set(notes).size).toBe(notes.length)
        }
      }),
    )
  })

  it('kitMapFromCaptures always has exactly captures.length note keys', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        let state: LearnState = startLearn()
        for (const op of ops) state = applyOp(state, op)

        const map = kitMapFromCaptures(LEARNED_KIT_MAP_NAME, state.captures)
        expect(Object.keys(map.notes)).toHaveLength(state.captures.length)
      }),
    )
  })
})
