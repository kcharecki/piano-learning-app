/**
 * `usePracticeSheet` (roadmap 5.47): the aggregation feeding the printable
 * practice sheet is a real reduction of `useProgressStore`, matching
 * `@core/progress/log.ts`'s own range semantics — never a hand-rolled second
 * definition of "this week" that could silently disagree with the dashboard
 * `useDashboard` already renders.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DateSource } from '@core/ports/index.ts'
import { DAY_MS } from '@core/srs/scheduler.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import { useProgressStore, type StoredAssessment } from '@app/state/progressStore.ts'
import { usePracticeSheet } from './usePracticeSheet.ts'

class FakeDateSource implements DateSource {
  private current: number
  constructor(current: number) {
    this.current = current
  }
  epochMillis(): number {
    return this.current
  }
}

const NOW = 20_000 * DAY_MS + 12 * 60 * 60 * 1000 // not a local-midnight instant

function resetStore(): void {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
}

beforeEach(resetStore)

function entry(overrides: Partial<PracticeEntry> & Pick<PracticeEntry, 'id' | 'startedAt' | 'endedAt' | 'kind' | 'itemName'>): PracticeEntry {
  return overrides
}

describe('usePracticeSheet — empty window', () => {
  it('reports hasActivity: false and empty collections when nothing was practiced in the last 7 days', () => {
    const { result } = renderHook(() =>
      usePracticeSheet({ date: new FakeDateSource(NOW), utcOffsetMinutes: 0 }),
    )
    expect(result.current.hasActivity).toBe(false)
    expect(result.current.categories).toEqual([])
    expect(result.current.items).toEqual([])
    expect(result.current.assessments).toEqual([])
    expect(result.current.totalMinutes).toBe(0)
    expect(result.current.daysPracticed).toBe(0)
    expect(result.current.totalDays).toBe(7)
  })

  it('excludes an entry that started before the 7-day window, but includes one exactly at its start', () => {
    const rangeStart = NOW - 7 * DAY_MS
    useProgressStore.getState().addPracticeEntry(
      entry({
        id: 'too-old',
        startedAt: rangeStart - 1,
        endedAt: rangeStart - 1 + 10 * 60_000,
        kind: 'technique',
        itemName: 'Old drill',
      }),
    )
    useProgressStore.getState().addPracticeEntry(
      entry({
        id: 'at-boundary',
        startedAt: rangeStart,
        endedAt: rangeStart + 10 * 60_000,
        kind: 'technique',
        itemName: 'Boundary drill',
      }),
    )

    const { result } = renderHook(() =>
      usePracticeSheet({ date: new FakeDateSource(NOW), utcOffsetMinutes: 0 }),
    )
    expect(result.current.hasActivity).toBe(true)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]?.itemName).toBe('Boundary drill')
  })
})

describe('usePracticeSheet — populated window', () => {
  beforeEach(() => {
    useProgressStore.getState().addPracticeEntry(
      entry({
        id: 'pe-1',
        startedAt: NOW - 2 * DAY_MS,
        endedAt: NOW - 2 * DAY_MS + 15 * 60_000,
        kind: 'repertoire',
        itemId: 'minuet-g',
        itemName: 'Minuet in G',
      }),
    )
    useProgressStore.getState().addPracticeEntry(
      entry({
        id: 'pe-2',
        startedAt: NOW - 1 * DAY_MS,
        endedAt: NOW - 1 * DAY_MS + 5 * 60_000,
        kind: 'repertoire',
        itemId: 'minuet-g',
        itemName: 'Minuet in G',
      }),
    )
    useProgressStore.getState().addPracticeEntry(
      entry({
        id: 'pe-3',
        startedAt: NOW - 3 * DAY_MS,
        endedAt: NOW - 3 * DAY_MS + 10 * 60_000,
        kind: 'technique',
        itemName: 'Five-finger patterns',
      }),
    )
    const assessment: StoredAssessment = {
      id: 'assess-1',
      scoreId: 'minuet-g',
      scoreTitle: 'Minuet in G',
      at: NOW - 1 * DAY_MS,
      result: {
        scoreId: 'minuet-g',
        accuracy: 0.82,
        timingConsistency: 0.7,
        meanAbsDeviationMs: 20,
        tempoBpm: 90,
        measures: [],
        counts: { correct: 20, wrongPitch: 2, missed: 2, extra: 0 },
        completedAt: NOW - 1 * DAY_MS,
      },
    }
    useProgressStore.getState().addAssessment(assessment)
  })

  it('sums minutes and sessions per category, in ACTIVITY_KINDS order', () => {
    const { result } = renderHook(() =>
      usePracticeSheet({ date: new FakeDateSource(NOW), utcOffsetMinutes: 0 }),
    )
    expect(result.current.hasActivity).toBe(true)
    expect(result.current.categories).toEqual([
      { kind: 'technique', minutes: 10, sessions: 1 },
      { kind: 'repertoire', minutes: 20, sessions: 2 },
    ])
    expect(result.current.totalMinutes).toBe(30)
  })

  it('groups sessions on the same item (by itemId) into one row with combined minutes/sessions and the most recent lastPracticedAt', () => {
    const { result } = renderHook(() =>
      usePracticeSheet({ date: new FakeDateSource(NOW), utcOffsetMinutes: 0 }),
    )
    const minuet = result.current.items.find((i) => i.itemName === 'Minuet in G')
    expect(minuet).toEqual({
      itemName: 'Minuet in G',
      kind: 'repertoire',
      minutes: 20,
      sessions: 2,
      lastPracticedAt: NOW - 1 * DAY_MS,
    })
  })

  it('includes an assessment recorded in the window, with its real accuracy', () => {
    const { result } = renderHook(() =>
      usePracticeSheet({ date: new FakeDateSource(NOW), utcOffsetMinutes: 0 }),
    )
    expect(result.current.assessments).toEqual([
      { scoreTitle: 'Minuet in G', accuracy: 0.82, at: NOW - 1 * DAY_MS },
    ])
  })

  it('counts exactly 3 distinct practiced days out of 7', () => {
    const { result } = renderHook(() =>
      usePracticeSheet({ date: new FakeDateSource(NOW), utcOffsetMinutes: 0 }),
    )
    expect(result.current.daysPracticed).toBe(3)
    expect(result.current.totalDays).toBe(7)
  })
})
