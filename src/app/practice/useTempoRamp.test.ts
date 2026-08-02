/**
 * `useTempoRamp` (roadmap 2.27, REQ-3.9.1). `startRamp`/`advanceRamp` are
 * @core's and already tested there — these tests pin the HOOK's own
 * responsibilities: driving them from `start`/`reportRepetition`/`stop`, and
 * converting `currentBpm` into the `tempoScale` the practice screen applies.
 */
import { bpm } from '@core/shared/units.ts'
import type { RampSettings } from '@core/timing/metronome.ts'
import { clampScale } from '@core/timing/tempo.ts'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTempoRamp } from './useTempoRamp.ts'

const settings: RampSettings = {
  startBpm: bpm(60),
  targetBpm: bpm(64),
  stepBpm: 2,
  repsPerStep: 1,
}

describe('useTempoRamp', () => {
  it('starts disabled with no state and no tempoScale', () => {
    const { result } = renderHook(() => useTempoRamp(bpm(120)))
    expect(result.current.enabled).toBe(false)
    expect(result.current.state).toBeUndefined()
    expect(result.current.tempoScale).toBeUndefined()
  })

  it('advances 60 -> 62 -> 64 across two clean repetitions (REQ-3.9.1 worked example)', () => {
    const { result } = renderHook(() => useTempoRamp(bpm(120)))

    act(() => result.current.start(settings))
    expect(result.current.enabled).toBe(true)
    expect(result.current.state?.currentBpm).toBe(60)

    act(() => result.current.reportRepetition(true))
    expect(result.current.state?.currentBpm).toBe(62)

    act(() => result.current.reportRepetition(true))
    expect(result.current.state?.currentBpm).toBe(64)
  })

  it('does not lower the tempo on a failed repetition', () => {
    const { result } = renderHook(() => useTempoRamp(bpm(120)))
    act(() => result.current.start(settings))
    act(() => result.current.reportRepetition(true))
    expect(result.current.state?.currentBpm).toBe(62)

    act(() => result.current.reportRepetition(false))
    expect(result.current.state?.currentBpm).toBe(62)
  })

  it('stops at the target and does not overshoot on further clean repetitions', () => {
    const { result } = renderHook(() => useTempoRamp(bpm(120)))
    act(() => result.current.start(settings))
    act(() => result.current.reportRepetition(true))
    act(() => result.current.reportRepetition(true))
    expect(result.current.state?.currentBpm).toBe(64)
    expect(result.current.state?.done).toBe(true)
    // Reaching the target un-gates whatever this hook's `enabled` blocks
    // (e.g. the manual tempo slider) — a finished ramp must not read as
    // still running.
    expect(result.current.enabled).toBe(false)

    act(() => result.current.reportRepetition(true))
    expect(result.current.state?.currentBpm).toBe(64)
    expect(result.current.state?.done).toBe(true)
  })

  it('reports tempoScale as exactly currentBpm / writtenBpm, clamped', () => {
    const { result } = renderHook(() => useTempoRamp(bpm(120)))
    act(() => result.current.start(settings))
    act(() => result.current.reportRepetition(true))
    // 62 / 120, not 62 alone: a hook that returned the raw bpm as the scale
    // would double the tempo instead of reaching 62 bpm.
    expect(result.current.tempoScale).toBe(clampScale(62 / 120))
  })

  it('clamps tempoScale at MAX_TEMPO_SCALE when the ramp target implies a faster scale', () => {
    const { result } = renderHook(() => useTempoRamp(bpm(40)))
    const fastSettings: RampSettings = {
      startBpm: bpm(40),
      targetBpm: bpm(120),
      stepBpm: 80,
      repsPerStep: 1,
    }
    act(() => result.current.start(fastSettings))
    act(() => result.current.reportRepetition(true))
    expect(result.current.state?.currentBpm).toBe(120)
    // 120 / 40 = 3, which is above MAX_TEMPO_SCALE (2.0): the readout must
    // report the clamp, not the raw ratio.
    expect(result.current.tempoScale).toBe(2.0)
    expect(result.current.effectiveBpm).toBe(80)
  })

  it('reports undefined tempoScale when the written bpm is not yet known', () => {
    const { result } = renderHook(() => useTempoRamp(undefined))
    act(() => result.current.start(settings))
    act(() => result.current.reportRepetition(true))
    expect(result.current.state?.currentBpm).toBe(62)
    expect(result.current.tempoScale).toBeUndefined()
    expect(result.current.effectiveBpm).toBeUndefined()
  })

  it('reports undefined tempoScale rather than throwing when the written bpm is zero', () => {
    const { result } = renderHook(() => useTempoRamp(bpm(0)))
    act(() => result.current.start(settings))
    act(() => result.current.reportRepetition(true))
    expect(() => result.current.tempoScale).not.toThrow()
    expect(result.current.tempoScale).toBeUndefined()
  })

  it('advances a two-reps-per-rung drill only after the second clean repetition', () => {
    const twoRepSettings: RampSettings = {
      startBpm: bpm(60),
      targetBpm: bpm(64),
      stepBpm: 2,
      repsPerStep: 2,
    }
    const { result } = renderHook(() => useTempoRamp(bpm(120)))
    act(() => result.current.start(twoRepSettings))
    expect(result.current.repsPerStep).toBe(2)

    act(() => result.current.reportRepetition(true))
    expect(result.current.state?.currentBpm).toBe(60)
    expect(result.current.state?.repsAtCurrent).toBe(1)

    act(() => result.current.reportRepetition(true))
    expect(result.current.state?.currentBpm).toBe(62)
    expect(result.current.state?.repsAtCurrent).toBe(0)
  })

  it('reports nextBpm from the settings banked at start, not from live props', () => {
    const { result } = renderHook(() => useTempoRamp(bpm(120)))
    act(() => result.current.start(settings))
    expect(result.current.nextBpm).toBe(62)

    act(() => result.current.reportRepetition(true))
    expect(result.current.nextBpm).toBe(64)

    act(() => result.current.reportRepetition(true))
    expect(result.current.state?.done).toBe(true)
    expect(result.current.nextBpm).toBeUndefined()
  })

  it('reportRepetition before start is a no-op', () => {
    const { result } = renderHook(() => useTempoRamp(bpm(120)))
    act(() => result.current.reportRepetition(true))
    expect(result.current.state).toBeUndefined()
    expect(result.current.enabled).toBe(false)
  })

  it('stop clears the ramp back to disabled with no state', () => {
    const { result } = renderHook(() => useTempoRamp(bpm(120)))
    act(() => result.current.start(settings))
    act(() => result.current.reportRepetition(true))

    act(() => result.current.stop())
    expect(result.current.enabled).toBe(false)
    expect(result.current.state).toBeUndefined()
    expect(result.current.tempoScale).toBeUndefined()

    // A repetition after stop is a no-op, not a crash.
    act(() => result.current.reportRepetition(true))
    expect(result.current.state).toBeUndefined()
  })
})
