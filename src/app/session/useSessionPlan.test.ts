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
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
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
  // roadmap 4.10: a truly cold profile's repertoire library — the lesson
  // segment's fallback chain (candidates.ts) is only fully exercised when
  // this is empty, so every test starts from that real cold-profile state.
  useRepertoireStore.setState({ pieces: [] })
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

    // sight-reading is the only mixable segment left with any share, so it
    // absorbs the ENTIRE 30-minute budget — technique's share is zeroed too,
    // and (roadmap 4.10) warm-up only ever draws from technique's OWN share
    // of the bucket, so zeroing technique's share zeroes warm-up as well,
    // even though warm-up still has its fixed candidate. See session.ts's
    // module doc, "Warm-up shares technique's bucket".
    expect(result.current.plan?.bySegment['sight-reading']).toBe(30)
    expect(result.current.plan?.bySegment.warmup).toBe(0)
    expect(result.current.plan?.bySegment.technique).toBe(0)
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

    // roadmap 4.10: a cold profile (no score, no repertoire) still gets a
    // non-zero lesson segment — the curriculum fallback — so this test's
    // signal is no longer "0 -> non-zero" but WHICH candidate the segment's
    // item names, which must track the loaded score once one appears.
    expect(result.current.plan?.bySegment.lesson).toBe(12)
    const beforeItem = result.current.plan?.items.find((item) => item.segment === 'lesson')
    expect(beforeItem?.exercise.kind).toBe('play')
    expect(beforeItem?.exercise.title).toMatch(/^Lesson: /)

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

    // The share itself is unaffected by which candidate fills it — lesson
    // stays REQ-3.1.4's plain 40% of the full 30-minute budget throughout —
    // but the actual item now names the loaded score, proving the memo
    // re-read scoreStore rather than caching the cold-profile candidate.
    expect(result.current.plan?.bySegment.lesson).toBe(12)
    const afterItem = result.current.plan?.items.find((item) => item.segment === 'lesson')
    expect(afterItem?.exercise.kind).toBe('repertoire')
    expect(afterItem?.exercise.title).toContain('Test Piece')
  })
})
