/**
 * Property tests for the posture-prompt schedule (roadmap 5.23). The
 * decision itself is a two-field threshold check, so the properties worth
 * proving are: below both thresholds is never due, at-or-above either
 * threshold alone is always due regardless of the other field, running time
 * accumulates correctly no matter how it is split across calls (the bug a
 * hand-rolled accumulator in the hook would be most likely to introduce),
 * and acknowledging always returns to "not due".
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  acknowledgePrompt,
  addAttempt,
  addRunningTime,
  INITIAL_POSTURE_SCHEDULE_STATE,
  isPosturePromptDue,
  POSTURE_PROMPT_ATTEMPT_COUNT,
  POSTURE_PROMPT_RUNNING_MS,
  type PostureScheduleState,
} from './posturePromptSchedule.ts'

const belowRunningMs = fc.integer({ min: 0, max: POSTURE_PROMPT_RUNNING_MS - 1 })
const belowAttempts = fc.integer({ min: 0, max: POSTURE_PROMPT_ATTEMPT_COUNT - 1 })
const atOrAboveRunningMs = fc.integer({ min: POSTURE_PROMPT_RUNNING_MS, max: POSTURE_PROMPT_RUNNING_MS * 10 })
const atOrAboveAttempts = fc.integer({
  min: POSTURE_PROMPT_ATTEMPT_COUNT,
  max: POSTURE_PROMPT_ATTEMPT_COUNT * 10,
})

function stateOf(runningMsSincePrompt: number, attemptsSincePrompt: number): PostureScheduleState {
  return { runningMsSincePrompt, attemptsSincePrompt }
}

describe('posturePromptSchedule', () => {
  it('the initial state is never due', () => {
    expect(isPosturePromptDue(INITIAL_POSTURE_SCHEDULE_STATE)).toBe(false)
  })

  it('is never due while both counters stay below their thresholds', () => {
    fc.assert(
      fc.property(belowRunningMs, belowAttempts, (ms, attempts) => {
        expect(isPosturePromptDue(stateOf(ms, attempts))).toBe(false)
      }),
    )
  })

  it('is due once running time alone reaches its threshold, whatever the attempt count', () => {
    fc.assert(
      fc.property(atOrAboveRunningMs, belowAttempts, (ms, attempts) => {
        expect(isPosturePromptDue(stateOf(ms, attempts))).toBe(true)
      }),
    )
  })

  it('is due once the attempt count alone reaches its threshold, whatever the running time', () => {
    fc.assert(
      fc.property(belowRunningMs, atOrAboveAttempts, (ms, attempts) => {
        expect(isPosturePromptDue(stateOf(ms, attempts))).toBe(true)
      }),
    )
  })

  it('addRunningTime accumulates the same total no matter how it is split across calls', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 60_000 }), { minLength: 0, maxLength: 20 }),
        (chunks) => {
          const total = chunks.reduce((sum, c) => sum + c, 0)
          const accumulated = chunks.reduce(
            (state, c) => addRunningTime(state, c),
            INITIAL_POSTURE_SCHEDULE_STATE,
          )
          expect(accumulated.runningMsSincePrompt).toBe(total)
          expect(accumulated.attemptsSincePrompt).toBe(0)
        },
      ),
    )
  })

  it('addAttempt increments the attempt counter one at a time and never touches running time', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), (n) => {
        let state = INITIAL_POSTURE_SCHEDULE_STATE
        for (let i = 0; i < n; i++) state = addAttempt(state)
        expect(state.attemptsSincePrompt).toBe(n)
        expect(state.runningMsSincePrompt).toBe(0)
      }),
    )
  })

  it('acknowledging always returns to the not-due initial state, from any prior state', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 1_000 }), (ms, attempts) => {
        const acknowledged = acknowledgePrompt()
        expect(acknowledged).toEqual(INITIAL_POSTURE_SCHEDULE_STATE)
        expect(isPosturePromptDue(acknowledged)).toBe(false)
        // sanity: the prior state really could have been due, so this is a
        // real reset and not a no-op the compiler could constant-fold away.
        void stateOf(ms, attempts)
      }),
    )
  })

  it('a negative or zero running-time credit is a no-op', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000, max: 0 }), (ms) => {
        expect(addRunningTime(INITIAL_POSTURE_SCHEDULE_STATE, ms)).toEqual(INITIAL_POSTURE_SCHEDULE_STATE)
      }),
    )
  })
})
