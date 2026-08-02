/**
 * `usePracticeLog` wiring (roadmap 2.24, REQ-3.9.5): starts/stops a
 * `PracticeTimer` and appends the finished entry to `useProgressStore`,
 * including on unmount.
 */
import type { DateSource } from '@core/ports/index.ts'
import type { PracticeEntry } from '@core/progress/log.ts'
import { act, renderHook } from '@testing-library/react'
import { FakeClock } from '@test/fakes.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { useProgressStore } from '@app/state/progressStore.ts'
import { usePracticeLog, type UsePracticeLogOptions } from './usePracticeLog.ts'

/**
 * A `DateSource` deliberately NOT implemented by the same object as the
 * `Clock` under test — unlike `FakeClock`, which implements both from one
 * counter and would hide a swapped constructor argument. `epochMillis()`
 * starts far from 0 so a bug that reads the `Clock`'s small elapsed-ms
 * counter instead is unmistakable in an assertion.
 */
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

const EPOCH_BASE = 1_700_000_000_000

function makeOptions(clock: FakeClock, date: DateSource): UsePracticeLogOptions {
  return { clock, date }
}

afterEach(() => {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
})

describe('usePracticeLog', () => {
  it('starts idle, not running', () => {
    const clock = new FakeClock()
    const { result } = renderHook((p: UsePracticeLogOptions) => usePracticeLog(p), {
      initialProps: makeOptions(clock, clock),
    })

    expect(result.current.running).toBe(false)
  })

  it('start() begins timing; stop() ends it and appends the entry to useProgressStore', () => {
    const clock = new FakeClock()
    const { result } = renderHook((p: UsePracticeLogOptions) => usePracticeLog(p), {
      initialProps: makeOptions(clock, clock),
    })

    act(() => result.current.start('repertoire', 'Test Piece'))
    expect(result.current.running).toBe(true)
    expect(useProgressStore.getState().practiceEntries).toEqual([])

    act(() => clock.advance(500))
    let entry: PracticeEntry | undefined
    act(() => {
      entry = result.current.stop()
    })

    expect(result.current.running).toBe(false)
    expect(entry).toMatchObject({ kind: 'repertoire', itemName: 'Test Piece' })
    expect(useProgressStore.getState().practiceEntries).toEqual([entry])
  })

  it('stop() without a running session is a no-op: returns undefined and writes nothing', () => {
    const clock = new FakeClock()
    const { result } = renderHook((p: UsePracticeLogOptions) => usePracticeLog(p), {
      initialProps: makeOptions(clock, clock),
    })

    let entry: unknown = 'unset'
    act(() => {
      entry = result.current.stop()
    })

    expect(entry).toBeUndefined()
    expect(useProgressStore.getState().practiceEntries).toEqual([])
  })

  it('start() while already running is a no-op, not a crash, and does not lose the first session', () => {
    const clock = new FakeClock()
    const { result } = renderHook((p: UsePracticeLogOptions) => usePracticeLog(p), {
      initialProps: makeOptions(clock, clock),
    })

    act(() => result.current.start('warmup', 'Scales'))
    expect(() => {
      act(() => result.current.start('theory', 'Should be ignored'))
    }).not.toThrow()

    let entry: PracticeEntry | undefined
    act(() => {
      entry = result.current.stop()
    })
    expect(entry).toMatchObject({ kind: 'warmup', itemName: 'Scales' })
  })

  it('a session still running at unmount is stopped and its entry is still stored (safety net)', () => {
    const clock = new FakeClock()
    const { result, unmount } = renderHook((p: UsePracticeLogOptions) => usePracticeLog(p), {
      initialProps: makeOptions(clock, clock),
    })

    act(() => result.current.start('sightreading', 'Sight Reading'))
    act(() => clock.advance(200))
    unmount()

    const entries = useProgressStore.getState().practiceEntries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'sightreading', itemName: 'Sight Reading' })
  })

  it('unmounting an already-stopped session does not duplicate the entry', () => {
    const clock = new FakeClock()
    const { result, unmount } = renderHook((p: UsePracticeLogOptions) => usePracticeLog(p), {
      initialProps: makeOptions(clock, clock),
    })

    act(() => result.current.start('technique', 'Arpeggios'))
    act(() => result.current.stop())
    unmount()

    expect(useProgressStore.getState().practiceEntries).toHaveLength(1)
  })

  it(
    "the stored entry's timestamps come from the DateSource, not the Clock's small elapsed " +
      "counter — passing clock/date to PracticeTimer in the wrong order would fail this",
    () => {
      const clock = new FakeClock() // elapsed-time counter, starts at 0
      const date = new FakeDateSource(EPOCH_BASE) // wall-clock epoch, starts far from 0
      const { result } = renderHook((p: UsePracticeLogOptions) => usePracticeLog(p), {
        initialProps: makeOptions(clock, date),
      })

      act(() => result.current.start('lesson', 'Wall Clock Check'))
      // The Clock (elapsed) and the DateSource (wall clock) advance by
      // DIFFERENT amounts, so a swapped constructor argument is observable:
      // if the hook passed `date` where `clock` belongs (or vice versa), the
      // entry's startedAt/endedAt would reflect the wrong source's delta.
      act(() => {
        clock.advance(30)
        date.advance(500)
      })

      // `elapsedMs` is the Clock's own delta (30ms) — it must read the Clock,
      // not the DateSource's much larger delta, or a swapped constructor
      // argument here would go completely unobserved.
      expect(result.current.elapsedMs()).toBe(30)

      let entry: PracticeEntry | undefined
      act(() => {
        entry = result.current.stop()
      })

      // Plausible epoch timestamps: derived from the DateSource's starting
      // point, not the Clock's near-zero counter.
      expect(entry?.startedAt).toBe(EPOCH_BASE)
      expect(entry?.endedAt).toBe(EPOCH_BASE + 500)
      // The Clock's own elapsed delta (30ms) must never leak into the entry.
      expect(entry?.endedAt).not.toBe(30)
      expect(entry && entry.endedAt - entry.startedAt).toBe(500)
    },
  )
})
