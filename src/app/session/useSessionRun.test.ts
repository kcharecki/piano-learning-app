/**
 * `useSessionRun` (roadmap 5.44): the persisted run position, the deferred
 * per-item timer (mirroring `useLessons.ts`'s StrictMode-safe pattern), and
 * the explicit "complete this item, move to the next" step, over a `Store`
 * fake so no real IndexedDB is touched.
 */
import type { DateSource, Store } from '@core/ports/index.ts'
import type { PlannedSession } from '@core/curriculum/session.ts'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { FakeClock, MemoryStore } from '@test/fakes.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { useProgressStore } from '@app/state/progressStore.ts'
import {
  SEGMENT_ACTIVITY_KIND,
  SESSION_RUN_COLLECTION,
  SESSION_RUN_KEY,
  useSessionRun,
  type UseSessionRunOptions,
} from './useSessionRun.ts'

class FakeDateSource implements DateSource {
  private current: number
  constructor(startMs: number) {
    this.current = startMs
  }
  epochMillis(): number {
    return this.current
  }
  advance(deltaMs: number): void {
    this.current += deltaMs
  }
}

// A fixed, timezone-independent instant so `toDateString()` (used for the
// run's `dayKey`) is deterministic in CI regardless of host timezone: local
// noon on the day this constant was written, far from any midnight edge.
const TODAY_NOON = new Date(2024, 5, 15, 12, 0, 0).getTime()

function twoItemPlan(): PlannedSession {
  return {
    totalMinutes: 10,
    items: [
      {
        segment: 'warmup',
        exercise: { id: 'warmup-1', kind: 'technique', title: 'Warm-up', estimatedMinutes: 5 },
        minutes: 5,
      },
      {
        segment: 'technique',
        exercise: { id: 'tech-1', kind: 'technique', title: 'Scales', estimatedMinutes: 5 },
        minutes: 5,
      },
    ],
    bySegment: { warmup: 5, technique: 5, 'sight-reading': 0, lesson: 0, 'theory-ear': 0 },
  }
}

function options(
  clock: FakeClock,
  date: DateSource,
  store: Store,
): UseSessionRunOptions {
  return { clock, date, openStore: () => Promise.resolve(store) }
}

afterEach(() => {
  cleanup()
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
})

describe('SEGMENT_ACTIVITY_KIND', () => {
  it('maps every SessionSegmentKind to a real ActivityKind, warmup included', () => {
    expect(SEGMENT_ACTIVITY_KIND).toEqual({
      warmup: 'warmup',
      technique: 'technique',
      'sight-reading': 'sightreading',
      lesson: 'repertoire',
      'theory-ear': 'theory',
    })
  })
})

describe('useSessionRun', () => {
  it('starts unhydrated with no run, then hydrates to no run when nothing was persisted', async () => {
    const clock = new FakeClock()
    const date = new FakeDateSource(TODAY_NOON)
    const store = new MemoryStore()
    const { result } = renderHook(() => useSessionRun(options(clock, date, store)))

    expect(result.current.run).toBeUndefined()
    await waitFor(() => expect(result.current.hydrated).toBe(true))
    expect(result.current.run).toBeUndefined()
    expect(result.current.currentIndex).toBeUndefined()
  })

  it('startSession begins a run at item 0 and persists it', async () => {
    const clock = new FakeClock()
    const date = new FakeDateSource(TODAY_NOON)
    const store = new MemoryStore()
    const { result } = renderHook(() => useSessionRun(options(clock, date, store)))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    act(() => result.current.startSession(twoItemPlan()))

    expect(result.current.currentIndex).toBe(0)
    expect(result.current.run?.doneFlags).toEqual([false, false])

    await waitFor(async () => {
      const saved = await store.get(SESSION_RUN_COLLECTION, SESSION_RUN_KEY)
      expect(saved).toBeDefined()
    })
  })

  it('starts the current item\'s timer (deferred) under its segment\'s ActivityKind', async () => {
    const clock = new FakeClock()
    const date = new FakeDateSource(TODAY_NOON)
    const store = new MemoryStore()
    const { result } = renderHook(() => useSessionRun(options(clock, date, store)))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    act(() => result.current.startSession(twoItemPlan()))
    // The timer's start() is deferred a macrotask (StrictMode guard, see the
    // module doc) — wait for it to actually land before advancing the clock,
    // or the advance happens before `startClockMs` is even captured.
    await waitFor(() => expect(result.current.running).toBe(true))
    act(() => clock.advance(1))
    expect(result.current.elapsedMs()).toBeGreaterThan(0)
  })

  it('completeCurrentItem logs a PracticeEntry for the finished item and advances to the next', async () => {
    const clock = new FakeClock()
    const date = new FakeDateSource(TODAY_NOON)
    const store = new MemoryStore()
    const { result } = renderHook(() => useSessionRun(options(clock, date, store)))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    act(() => result.current.startSession(twoItemPlan()))
    await waitFor(() => expect(result.current.running).toBe(true)) // timer armed
    // `elapsedMs()`'s live readout comes off `clock` (monotonic); a logged
    // entry's actual `startedAt`/`endedAt` come off `date` (wall clock) —
    // `PracticeTimer`'s own two-port split (see `log.ts`'s module doc).
    // Advance both together, as real elapsed time would.
    act(() => {
      clock.advance(3 * 60_000)
      date.advance(3 * 60_000)
    })

    act(() => result.current.completeCurrentItem())

    expect(result.current.currentIndex).toBe(1)
    expect(result.current.run?.doneFlags).toEqual([true, false])

    const entries = useProgressStore.getState().practiceEntries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'warmup', itemId: 'warmup-1', itemName: 'Warm-up' })
    expect((entries[0]?.endedAt ?? 0) - (entries[0]?.startedAt ?? 0)).toBe(3 * 60_000)

    // The second item's timer is now running.
    await waitFor(() => expect(result.current.running).toBe(true))
    act(() => {
      clock.advance(2 * 60_000)
      date.advance(2 * 60_000)
    })
    act(() => result.current.completeCurrentItem())

    expect(result.current.currentIndex).toBeUndefined() // session complete
    expect(result.current.run?.doneFlags).toEqual([true, true])
    const finalEntries = useProgressStore.getState().practiceEntries
    expect(finalEntries).toHaveLength(2)
    expect(finalEntries.some((e) => e.kind === 'technique' && e.itemId === 'tech-1')).toBe(true)
  })

  it('a fresh hook instance resumes at the correct item after "reload" (same store, same day)', async () => {
    const clock1 = new FakeClock()
    const date1 = new FakeDateSource(TODAY_NOON)
    const store = new MemoryStore()

    const first = renderHook(() => useSessionRun(options(clock1, date1, store)))
    await waitFor(() => expect(first.result.current.hydrated).toBe(true))
    act(() => first.result.current.startSession(twoItemPlan()))
    await waitFor(() => expect(first.result.current.running).toBe(true))
    act(() => clock1.advance(60_000))
    act(() => first.result.current.completeCurrentItem())
    await waitFor(() => expect(first.result.current.currentIndex).toBe(1))
    // Let the persistence effect for the post-completion state land before
    // "reloading" — a real reload cannot race its own in-flight save either.
    await waitFor(async () => {
      const saved = await store.get<{ doneFlags: readonly boolean[] }>(
        SESSION_RUN_COLLECTION,
        SESSION_RUN_KEY,
      )
      expect(saved?.doneFlags).toEqual([true, false])
    })
    first.unmount()

    // "Reload": a brand new hook instance, own clock, same store and day.
    const clock2 = new FakeClock()
    const date2 = new FakeDateSource(TODAY_NOON + 5_000)
    const second = renderHook(() => useSessionRun(options(clock2, date2, store)))
    await waitFor(() => expect(second.result.current.hydrated).toBe(true))

    expect(second.result.current.currentIndex).toBe(1)
    expect(second.result.current.run?.doneFlags).toEqual([true, false])
    expect(second.result.current.run?.plan.items[1]?.exercise.id).toBe('tech-1')
  })

  it('discards a persisted run from a previous day rather than resuming it', async () => {
    const clock = new FakeClock()
    const date = new FakeDateSource(TODAY_NOON)
    const store = new MemoryStore()
    await store.put(SESSION_RUN_COLLECTION, SESSION_RUN_KEY, {
      plan: twoItemPlan(),
      dayKey: 'a day that is not today',
      doneFlags: [true, false],
    })

    const { result } = renderHook(() => useSessionRun(options(clock, date, store)))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    expect(result.current.run).toBeUndefined()
  })

  it('planNewSession discards the run and deletes the persisted record', async () => {
    const clock = new FakeClock()
    const date = new FakeDateSource(TODAY_NOON)
    const store = new MemoryStore()
    const { result } = renderHook(() => useSessionRun(options(clock, date, store)))
    await waitFor(() => expect(result.current.hydrated).toBe(true))

    act(() => result.current.startSession(twoItemPlan()))
    await waitFor(async () => {
      const saved = await store.get(SESSION_RUN_COLLECTION, SESSION_RUN_KEY)
      expect(saved).toBeDefined()
    })

    act(() => result.current.planNewSession())

    expect(result.current.run).toBeUndefined()
    await waitFor(async () => {
      const saved = await store.get(SESSION_RUN_COLLECTION, SESSION_RUN_KEY)
      expect(saved).toBeUndefined()
    })
  })
})
