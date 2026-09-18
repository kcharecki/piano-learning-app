/**
 * `useWaitRun` — the React shell around `@core/drums/practice/wait.ts`'s
 * state machine. What is pinned here is the wiring: start/stop/phase
 * transitions, that every hit sounds and flashes regardless of outcome, and
 * that a plan swap mid-run stops it — the state machine itself is proven in
 * `wait.test.ts`.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { quarterNoteRock } from '@core/drums/model/referenceGrooves.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import type { Millis } from '@core/shared/units.ts'
import { useWaitRun } from './useWaitRun.ts'

type StrikeCall = { readonly pad: MappedDrumPad; readonly velocity: number }

class RecordingDrumAudio implements DrumAudioOutput {
  readonly strikes: StrikeCall[] = []
  strike(pad: MappedDrumPad, velocity: number): void {
    this.strikes.push({ pad, velocity })
  }
  click(): void {
    // Not used by wait mode.
  }
  allNotesOff(): void {
    // Not used by wait mode.
  }
  setVolume(): void {
    // Not exercised here.
  }
  now(): Millis {
    return 0 as Millis
  }
}

function plan80(): GrooveRunPlan {
  return planGrooveRun(quarterNoteRock(), 80)
}

function harness(initialPlan: GrooveRunPlan = plan80()) {
  const audio = new RecordingDrumAudio()
  const { result, rerender } = renderHook(({ plan }) => useWaitRun({ plan, audio: () => audio }), {
    initialProps: { plan: initialPlan },
  })
  return { audio, result, setPlan: (plan: GrooveRunPlan) => rerender({ plan }) }
}

describe('useWaitRun', () => {
  it('starts idle, with all 8 unison steps for Quarter-Note Rock at 80 bpm', () => {
    const { result } = harness()
    expect(result.current.phase).toBe('idle')
    expect(result.current.steps).toHaveLength(8)
    expect(result.current.state.stepIndex).toBe(0)
  })

  it('start() moves to waiting, at the initial state, with no outcome yet', () => {
    const { result } = harness()
    act(() => result.current.start())
    expect(result.current.phase).toBe('waiting')
    expect(result.current.state).toEqual({ stepIndex: 0, satisfied: [] })
    expect(result.current.lastOutcome).toBeUndefined()
  })

  it('every hit sounds and flashes, in or out of a run', () => {
    const { result, audio } = harness()
    act(() => result.current.hit('snare'))
    expect(audio.strikes).toEqual([{ pad: 'snare', velocity: 96 }])
    expect(result.current.flash?.pad).toBe('snare')
    // Not in a run: applying to the state machine never happened.
    expect(result.current.lastOutcome).toBeUndefined()
  })

  it('a hit outside the current step is "extra" and does not move the state', () => {
    const { result } = harness()
    act(() => result.current.start())
    act(() => result.current.hit('snare')) // step 1 wants kick + hi-hat
    expect(result.current.lastOutcome).toBe('extra')
    expect(result.current.state).toEqual({ stepIndex: 0, satisfied: [] })
  })

  it('striking both pads of the unison first step advances to step 2', () => {
    const { result } = harness()
    act(() => result.current.start())
    act(() => result.current.hit('kick'))
    expect(result.current.lastOutcome).toBe('required')
    expect(result.current.state.stepIndex).toBe(0)
    act(() => result.current.hit('hhClosed'))
    expect(result.current.lastOutcome).toBe('advanced')
    expect(result.current.state).toEqual({ stepIndex: 1, satisfied: [] })
  })

  it('completing every step reaches "done"', () => {
    const { result } = harness()
    act(() => result.current.start())
    const pairs: readonly [MappedDrumPad, MappedDrumPad][] = [
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
    ]
    for (const [a, b] of pairs) {
      act(() => result.current.hit(a))
      act(() => result.current.hit(b))
    }
    expect(result.current.phase).toBe('done')
    expect(result.current.state.stepIndex).toBe(8)
  })

  it('stop() returns to idle and resets the state', () => {
    const { result } = harness()
    act(() => result.current.start())
    act(() => result.current.hit('kick'))
    act(() => result.current.stop())
    expect(result.current.phase).toBe('idle')
    expect(result.current.state).toEqual({ stepIndex: 0, satisfied: [] })
  })

  /** F4(b): a leftover `lastOutcome` from before stop() must not survive it. */
  it('stop() also clears the last outcome', () => {
    const { result } = harness()
    act(() => result.current.start())
    act(() => result.current.hit('kick'))
    expect(result.current.lastOutcome).toBe('required')

    act(() => result.current.stop())
    expect(result.current.lastOutcome).toBeUndefined()
  })

  /** F4(c): a required hit sounds through the audio port, same as any other hit. */
  it('a required hit during a run strikes the pad through the audio port', () => {
    const { result, audio } = harness()
    act(() => result.current.start())
    act(() => result.current.hit('kick')) // step 1 wants kick + hi-hat
    expect(result.current.lastOutcome).toBe('required')
    expect(audio.strikes).toEqual([{ pad: 'kick', velocity: 96 }])
  })

  /** F4(c): an extra hit is inert to the state machine, but still sounds. */
  it('an extra hit during a run also strikes the pad through the audio port', () => {
    const { result, audio } = harness()
    act(() => result.current.start())
    act(() => result.current.hit('snare')) // step 1 wants kick + hi-hat, not snare
    expect(result.current.lastOutcome).toBe('extra')
    expect(audio.strikes).toEqual([{ pad: 'snare', velocity: 96 }])
  })

  it('a plan swap while waiting stops the run', () => {
    const { result, setPlan } = harness()
    act(() => result.current.start())
    act(() => result.current.hit('kick'))
    expect(result.current.phase).toBe('waiting')

    act(() => setPlan(planGrooveRun(quarterNoteRock(), 90)))
    expect(result.current.phase).toBe('idle')
    expect(result.current.state).toEqual({ stepIndex: 0, satisfied: [] })
  })

  /**
   * F4(a): the old reset only fired when `phaseRef.current === 'waiting'`, so
   * a plan change after a run had already finished left `phase` stuck at
   * 'done' for a plan the screen has moved on from.
   */
  it('a plan swap after the run is done also returns to idle', () => {
    const { result, setPlan } = harness()
    act(() => result.current.start())
    const pairs: readonly [MappedDrumPad, MappedDrumPad][] = [
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
    ]
    for (const [a, b] of pairs) {
      act(() => result.current.hit(a))
      act(() => result.current.hit(b))
    }
    expect(result.current.phase).toBe('done')

    act(() => setPlan(planGrooveRun(quarterNoteRock(), 90)))
    expect(result.current.phase).toBe('idle')
    expect(result.current.state).toEqual({ stepIndex: 0, satisfied: [] })
  })

  it('a finished run stays "done" — a further hit never re-arms it', () => {
    const { result } = harness()
    act(() => result.current.start())
    const pairs: readonly [MappedDrumPad, MappedDrumPad][] = [
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
      ['kick', 'hhClosed'],
      ['snare', 'hhClosed'],
    ]
    for (const [a, b] of pairs) {
      act(() => result.current.hit(a))
      act(() => result.current.hit(b))
    }
    expect(result.current.phase).toBe('done')
    act(() => result.current.hit('kick'))
    expect(result.current.lastOutcome).toBe('done')
    expect(result.current.phase).toBe('done')
  })

  /**
   * `waitSteps` returns `[]` for a plan with no pads at all — contrived here
   * since none of the trainer's real grooves are empty — so `start()`'s own
   * "no steps → straight to done" branch has a direct test.
   */
  it('start() on a plan with no pads goes straight to "done"', () => {
    const base = plan80()
    const emptyPlan: GrooveRunPlan = { ...base, pads: [] }
    const { result } = harness(emptyPlan)
    expect(result.current.steps).toHaveLength(0)
    act(() => result.current.start())
    expect(result.current.phase).toBe('done')
  })
})
