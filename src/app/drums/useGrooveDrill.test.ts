/**
 * Groove trainer wiring (roadmap DR-09): the one-origin count-in/graded-window
 * schedule, click output, hit capture and the finished verdict.
 * `gradeGroovePerformance`/`grooveOnsetsMs` already have their own suite
 * (`core/drums/practice/grooveGrader.test.ts`) — this only proves the hook
 * feeds them real hits at the right instants and reacts to what comes back,
 * the same split `useRhythmDrill.test.ts` draws against `gradeTapping`.
 *
 * The default groove (`money-beat`, 4/4, 80bpm) has a closed-form schedule —
 * 750ms/beat, 3000ms/bar, a 3000ms count-in, two graded bars and a 100ms
 * tolerance tail (9100ms total) — so the timings below are hardcoded fixture
 * data derived from that arithmetic, not re-derived from the grader.
 *
 * `useDrumsHistoryStore` is a module singleton (see its own module comment),
 * so every test resets it in `beforeEach` even when it does not itself run a
 * drill to completion.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { FakeClock, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { GRADED_REPEATS, useGrooveDrill, type GrooveDrillApi, type UseGrooveDrillOptions } from './useGrooveDrill.ts'

function manualDriver(): { driver: FrameDriver; pump: () => void } {
  let callback: (() => void) | undefined
  const driver: FrameDriver = (cb) => {
    callback = cb
    return () => {
      callback = undefined
    }
  }
  return { driver, pump: () => callback?.() }
}

/** Money Beat at 80bpm — the contract's own numbers (a quarter is 750ms). */
const BEAT_MS = 750
const BAR_MS = 4 * BEAT_MS
const COUNT_IN_MS = BAR_MS
const TOLERANCE_MS = 100
const END_MS = COUNT_IN_MS + BAR_MS * GRADED_REPEATS + TOLERANCE_MS

function setup() {
  const clock = new FakeClock()
  const audioOutput = new RecordingAudioOutput(clock)
  const manual = manualDriver()
  const options: UseGrooveDrillOptions = {
    clock,
    audioOutput,
    frameDriver: manual.driver,
    date: clock,
  }
  const { result, unmount } = renderHook((p: UseGrooveDrillOptions) => useGrooveDrill(p), {
    initialProps: options,
  })
  return { result, clock, audioOutput, manual, unmount }
}

type TimedHit = { readonly at: number; readonly pad: MappedDrumPad }

/**
 * Every onset Money Beat asks for, one graded pass (`passIndex` 0 or 1),
 * relative to the moment the graded window opens: hi-hat on all eight
 * eighths, kick on beats 1 and 3, snare on 2 and 4 — see `referenceGrooves.ts`.
 */
function passOnsets(passIndex: number): TimedHit[] {
  const base = passIndex * BAR_MS
  const eighth = BEAT_MS / 2
  const hh: TimedHit[] = Array.from({ length: 8 }, (_, i) => ({ at: base + i * eighth, pad: 'hhClosed' }))
  const kick: TimedHit[] = [
    { at: base, pad: 'kick' },
    { at: base + 2 * BEAT_MS, pad: 'kick' },
  ]
  const snare: TimedHit[] = [
    { at: base + BEAT_MS, pad: 'snare' },
    { at: base + 3 * BEAT_MS, pad: 'snare' },
  ]
  return [...hh, ...kick, ...snare]
}

/** Every onset for both graded passes, chronological — a clean, on-time performance. */
function correctRunEvents(): TimedHit[] {
  const events: TimedHit[] = []
  for (let pass = 0; pass < GRADED_REPEATS; pass++) events.push(...passOnsets(pass))
  return events.sort((a, b) => a.at - b.at)
}

/** The classic limb swap: the kick part played on the snare pad and vice versa, hi-hat untouched. */
function swappedRunEvents(): TimedHit[] {
  return correctRunEvents().map((e) => ({
    at: e.at,
    pad: e.pad === 'kick' ? 'snare' : e.pad === 'snare' ? 'kick' : e.pad,
  }))
}

/**
 * Drives `events` into the hook via the clock, not the render — matching the
 * module's own "hits are captured on the clock" design. `clock` starts at 0
 * and `start()` reads it as the run's origin, so an event `at` ms relative to
 * the graded window lands at absolute clock time `COUNT_IN_MS + at`.
 */
function playEvents(clock: FakeClock, result: { current: GrooveDrillApi }, events: readonly TimedHit[]): void {
  for (const event of events) {
    act(() => {
      clock.setTime(COUNT_IN_MS + event.at)
      result.current.hit(event.pad)
    })
  }
}

beforeEach(() => {
  useDrumsHistoryStore.setState({ attempts: [] })
})

afterEach(() => {
  cleanup()
})

describe('useGrooveDrill — count-in and playing', () => {
  it('start() moves through count-in into playing, with bar/beat tracking position', () => {
    const { result, clock, manual } = setup()

    act(() => result.current.start())
    expect(result.current.phase).toBe('count-in')

    act(() => manual.pump())
    expect(result.current.phase).toBe('count-in')
    expect(result.current.bar).toBe(0)
    expect(result.current.beat).toBe(1)

    act(() => {
      clock.advance(3000)
      manual.pump()
    })
    expect(result.current.phase).toBe('playing')
    expect(result.current.bar).toBe(1)

    act(() => {
      clock.advance(3100)
      manual.pump()
    })
    expect(result.current.phase).toBe('playing')
    expect(result.current.bar).toBe(2)
  })
})

describe('useGrooveDrill — clicks', () => {
  it('schedules one click per beat of the count-in plus the graded bars, downbeat accented', () => {
    const { result, clock, manual, audioOutput } = setup()

    act(() => result.current.start())
    act(() => {
      clock.advance(END_MS)
      manual.pump()
    })

    expect(audioOutput.clicks.length).toBe(12)
    expect(audioOutput.clicks.map((c) => c.accented)).toEqual([
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ])
    expect(audioOutput.clicks[0]?.at).toBe(0)
    expect(audioOutput.clicks[4]?.at).toBe(3000)
    expect(audioOutput.clicks[8]?.at).toBe(6000)
  })
})

describe('useGrooveDrill — grading a finished run', () => {
  it('a correctly played run finishes done, clean, with the expected per-pad counts', () => {
    const { result, clock, manual } = setup()

    act(() => result.current.start())
    playEvents(clock, result, correctRunEvents())
    act(() => {
      clock.setTime(END_MS)
      manual.pump()
    })

    expect(result.current.phase).toBe('done')
    expect(result.current.performance?.clean).toBe(true)
    const rows = result.current.rows
    expect(rows.find((r) => r.pad === 'hhClosed')).toMatchObject({ expected: 16, matched: 16, missed: 0, extra: 0 })
    expect(rows.find((r) => r.pad === 'snare')).toMatchObject({ expected: 4, matched: 4, missed: 0, extra: 0 })
    expect(rows.find((r) => r.pad === 'kick')).toMatchObject({ expected: 4, matched: 4, missed: 0, extra: 0 })
  })

  it('swapping the snare and kick hits fails those two pads while the hi-hat stays clean', () => {
    const { result, clock, manual } = setup()

    act(() => result.current.start())
    playEvents(clock, result, swappedRunEvents())
    act(() => {
      clock.setTime(END_MS)
      manual.pump()
    })

    expect(result.current.performance?.clean).toBe(false)
    const rows = result.current.rows
    expect(rows.find((r) => r.pad === 'hhClosed')).toMatchObject({ expected: 16, matched: 16, missed: 0, extra: 0 })
    expect(rows.find((r) => r.pad === 'snare')).toMatchObject({ expected: 4, matched: 0, missed: 4, extra: 4 })
    expect(rows.find((r) => r.pad === 'kick')).toMatchObject({ expected: 4, matched: 0, missed: 4, extra: 4 })
  })

  it('a finished run appends exactly one attempt to the history store', () => {
    const { result, clock, manual } = setup()

    act(() => result.current.start())
    playEvents(clock, result, correctRunEvents())
    act(() => {
      clock.setTime(END_MS)
      manual.pump()
    })

    const attempts = useDrumsHistoryStore.getState().attempts
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      grooveId: 'money-beat',
      grooveTitle: 'Money Beat',
      bpm: 80,
      repeats: GRADED_REPEATS,
    })
  })
})

describe('useGrooveDrill — stop abandons', () => {
  it('stop() mid-run returns to idle, leaves performance undefined, and touches no history', () => {
    const { result, clock } = setup()

    act(() => result.current.start())
    act(() => {
      clock.advance(1000)
      result.current.hit('hhClosed')
    })

    act(() => result.current.stop())

    expect(result.current.phase).toBe('idle')
    expect(result.current.performance).toBeUndefined()
    expect(useDrumsHistoryStore.getState().attempts).toHaveLength(0)
  })
})

describe('useGrooveDrill — bpm and groove selection', () => {
  it('setBpm clamps out-of-range values, and neither action takes effect mid-run', () => {
    const { result } = setup()

    act(() => result.current.setBpm(500))
    expect(result.current.bpm).toBe(200)

    act(() => result.current.setBpm(-20))
    expect(result.current.bpm).toBe(40)

    act(() => result.current.setBpm(80))
    expect(result.current.bpm).toBe(80)

    act(() => result.current.start())
    act(() => {
      result.current.setBpm(120)
      result.current.setGrooveId('ghost-funk-bar')
    })

    expect(result.current.bpm).toBe(80)
    expect(result.current.score.id).toBe('money-beat')
  })
})

describe('useGrooveDrill — pads and grid', () => {
  it('pads is in kit order, and cellsFor marks the cells each pad actually sounds on', () => {
    const { result } = setup()

    expect(result.current.pads).toEqual(['hhClosed', 'snare', 'kick'])
    expect(result.current.cellsFor('hhClosed')).toEqual([true, true, true, true, true, true, true, true])
    expect(result.current.cellsFor('snare')).toEqual([false, false, true, false, false, false, true, false])
  })
})
