/**
 * `useSessionPlan`'s own wiring: budget changes drive `planSession` again,
 * the mix can be adjusted, and an unfillable request surfaces as `error`
 * rather than throwing or silently returning an empty plan. `candidates.ts`
 * and `planSession` itself have their own suites — this only asserts THIS
 * hook composes them correctly.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { makeScore } from '@core/notation/score.ts'
import { DEFAULT_MIX } from '@core/curriculum/session.ts'
import { useSessionPlan, MAX_BUDGET_MINUTES } from './useSessionPlan.ts'

function resetStores(): void {
  useScoreStore.setState({
    loaded: undefined,
    importError: undefined,
    availableMidiDevices: [],
    selectedMidiDeviceId: null,
    settings: {
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    },
  })
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
}

beforeEach(resetStores)
afterEach(() => {
  cleanup()
  resetStores()
})

describe('useSessionPlan', () => {
  it('defaults to a 30-minute budget and DEFAULT_MIX, and produces a plan', () => {
    const { result } = renderHook(() => useSessionPlan())

    expect(result.current.budgetMinutes).toBe(30)
    expect(result.current.mix).toEqual(DEFAULT_MIX)
    expect(result.current.error).toBeUndefined()
    expect(result.current.plan?.totalMinutes).toBe(30)
  })

  it('setBudgetMinutes re-runs planSession with the new budget, minutes summing exactly', () => {
    const { result } = renderHook(() => useSessionPlan())

    act(() => result.current.setBudgetMinutes(15))
    expect(result.current.plan?.totalMinutes).toBe(15)
    const sum15 = result.current.plan?.items.reduce((s, i) => s + i.minutes, 0)
    expect(sum15).toBe(15)

    act(() => result.current.setBudgetMinutes(60))
    expect(result.current.plan?.totalMinutes).toBe(60)
    const sum60 = result.current.plan?.items.reduce((s, i) => s + i.minutes, 0)
    expect(sum60).toBe(60)
  })

  it('accepts an arbitrary learner-typed budget, not just 15/30/60', () => {
    const { result } = renderHook(() => useSessionPlan())

    act(() => result.current.setBudgetMinutes(47))
    expect(result.current.plan?.totalMinutes).toBe(47)
    const sum = result.current.plan?.items.reduce((s, i) => s + i.minutes, 0)
    expect(sum).toBe(47)
  })

  it('setMixShare adjusts one segment share and plan.bySegment reflects it', () => {
    const { result } = renderHook(() => useSessionPlan())

    act(() => result.current.setMixShare('sight-reading', 1))
    act(() => result.current.setMixShare('technique', 0))
    act(() => result.current.setMixShare('lesson', 0))
    act(() => result.current.setMixShare('theory-ear', 0))

    // sight-reading is the only segment left with any share and it always
    // has a candidate, so it absorbs the entire budget (technique never has
    // candidates; lesson has none by default with no score loaded).
    expect(result.current.plan?.bySegment['sight-reading']).toBe(30)
  })

  it('surfaces planSession errors as readable text instead of swallowing them', () => {
    const { result } = renderHook(() => useSessionPlan())

    act(() => result.current.setBudgetMinutes(-5))

    expect(result.current.plan).toBeUndefined()
    expect(result.current.error).toBeDefined()
    expect(result.current.error).toMatch(/positive/i)
  })

  it('clamps an absurd typed budget to MAX_BUDGET_MINUTES instead of building a huge plan', () => {
    const { result } = renderHook(() => useSessionPlan())

    act(() => result.current.setBudgetMinutes(10_000_000))

    expect(result.current.budgetMinutes).toBe(MAX_BUDGET_MINUTES)
    expect(result.current.plan?.totalMinutes).toBe(MAX_BUDGET_MINUTES)
  })

  it('resetMix restores DEFAULT_MIX after setMixShare has changed it', () => {
    const { result } = renderHook(() => useSessionPlan())

    act(() => result.current.setMixShare('technique', 1))
    expect(result.current.mix).not.toEqual(DEFAULT_MIX)

    act(() => result.current.resetMix())
    expect(result.current.mix).toEqual(DEFAULT_MIX)
  })

  it('recomputes candidates when the loaded score changes (memo deps are not stale)', () => {
    const { result } = renderHook(() => useSessionPlan())

    expect(result.current.plan?.bySegment.lesson).toBe(0)

    act(() => {
      useScoreStore.getState().loadScore({
        score: makeScore({
          id: 'test-score',
          measures: [{}],
          notes: [],
          tempos: [{ tick: 0, bpm: 120 }],
        }),
        sourceName: 'Test Piece',
        musicXml: undefined,
      })
    })

    // Every segment has candidates since roadmap 4.4a, so the lesson segment
    // gets REQ-3.1.4's plain 40% of the 30-minute default budget.
    expect(result.current.plan?.bySegment.lesson).toBe(12)
  })
})
