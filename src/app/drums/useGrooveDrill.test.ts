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
 * data derived from that arithmetic, not re-derived from the grader. Every
 * `setup()` pins `initialGrooveId: 'money-beat'` so that arithmetic keeps
 * holding even though the trainer's own default groove is now
 * `quarter-hat-rock` (easiest-first) — the one test that cares about the
 * real default overrides it back to `undefined`.
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
import { grooveToleranceMs } from '@core/drums/practice/grooveGrader.ts'
import {
  GRADED_REPEATS,
  REPEAT_CHOICES,
  useGrooveDrill,
  type GrooveDrillApi,
  type UseGrooveDrillOptions,
} from './useGrooveDrill.ts'

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

function setup(overrides: Partial<UseGrooveDrillOptions> = {}) {
  const clock = new FakeClock()
  const audioOutput = new RecordingAudioOutput(clock)
  const manual = manualDriver()
  const options: UseGrooveDrillOptions = {
    clock,
    audioOutput,
    frameDriver: manual.driver,
    date: clock,
    // The fixture arithmetic in this file (BEAT_MS, passOnsets, ...) is all
    // derived from Money Beat; pin it here so the trainer's real default
    // (easiest-first, `quarter-hat-rock`) does not silently break every
    // other test. `setup({ initialGrooveId: undefined })` opts back out.
    initialGrooveId: 'money-beat',
    ...overrides,
  }
  const { result, unmount } = renderHook((p: UseGrooveDrillOptions) => useGrooveDrill(p), {
    initialProps: options,
  })
  return { result, clock, audioOutput, manual, unmount }
}

type TimedHit = { readonly at: number; readonly pad: MappedDrumPad }

/**
 * Every onset Money Beat asks for, one graded pass (`passIndex` 0-based),
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

/** Every onset for `repeats` graded passes, chronological — a clean, on-time performance. */
function correctRunEventsFor(repeats: number): TimedHit[] {
  const events: TimedHit[] = []
  for (let pass = 0; pass < repeats; pass++) events.push(...passOnsets(pass))
  return events.sort((a, b) => a.at - b.at)
}

/** The two graded passes this file's fixture arithmetic (`END_MS`) assumes. */
function correctRunEvents(): TimedHit[] {
  return correctRunEventsFor(GRADED_REPEATS)
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

describe('useGrooveDrill — audio output construction', () => {
  it('clicks nothing before start(), even with an audio output already injected at render', () => {
    // The injected fake stands in for the real output, so this cannot
    // observe the actual `AudioContext` construction the fix defers into
    // `start()` — what it can observe is the consequence: nothing is asked
    // to click before `start()` runs, where the old code would already have
    // built (and possibly used) a real output the instant the hook rendered.
    const { result, audioOutput, manual } = setup()

    expect(audioOutput.clicks.length).toBe(0)

    act(() => result.current.start())
    expect(audioOutput.clicks.length).toBe(0)

    act(() => manual.pump())
    expect(audioOutput.clicks.length).toBeGreaterThan(0)
  })
})

describe('useGrooveDrill — grading a finished run', () => {
  it('a correctly played run finishes done, complete, with the expected per-pad counts', () => {
    const { result, clock, manual } = setup()

    act(() => result.current.start())
    playEvents(clock, result, correctRunEvents())
    act(() => {
      clock.setTime(END_MS)
      manual.pump()
    })

    expect(result.current.phase).toBe('done')
    expect(result.current.performance?.complete).toBe(true)
    const rows = result.current.rows
    expect(rows.find((r) => r.pad === 'hhClosed')).toMatchObject({ expected: 16, matched: 16, missed: 0, extra: 0 })
    expect(rows.find((r) => r.pad === 'snare')).toMatchObject({ expected: 4, matched: 4, missed: 0, extra: 0 })
    expect(rows.find((r) => r.pad === 'kick')).toMatchObject({ expected: 4, matched: 4, missed: 0, extra: 0 })
  })

  it('swapping the snare and kick hits fails those two pads while the hi-hat stays complete', () => {
    const { result, clock, manual } = setup()

    act(() => result.current.start())
    playEvents(clock, result, swappedRunEvents())
    act(() => {
      clock.setTime(END_MS)
      manual.pump()
    })

    expect(result.current.performance?.complete).toBe(false)
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

describe('useGrooveDrill — count-in hits (defect 1)', () => {
  it('discards a hit that lands well before the graded window as count-in noise', () => {
    const { result, clock, manual } = setup()

    act(() => result.current.start())
    // A ride through the count-in, on its second beat — nowhere near one
    // tolerance window of beat 1, so this is exactly the count-in noise the
    // count-in exists to absorb, not a lean-in.
    act(() => {
      clock.setTime(BEAT_MS)
      result.current.hit('hhClosed')
    })
    playEvents(clock, result, correctRunEvents())
    act(() => {
      clock.setTime(END_MS)
      manual.pump()
    })

    expect(result.current.performance?.complete).toBe(true)
    expect(result.current.rows.find((r) => r.pad === 'hhClosed')).toMatchObject({
      expected: 16,
      matched: 16,
      missed: 0,
      extra: 0,
    })
  })

  it('still grades a hit slightly before beat 1 as an early lean, not a miss or an extra', () => {
    const { result, clock, manual } = setup()
    // Replace the on-time pass-0 hi-hat downbeat with an early press, so a
    // wrongly-discarded hit would show up as one missed and one extra rather
    // than being silently absorbed into the match.
    const events = correctRunEvents().filter((e) => !(e.pad === 'hhClosed' && e.at === 0))

    act(() => result.current.start())
    act(() => {
      // 50ms before the graded window opens — inside the tolerance window
      // (100ms for Money Beat at 80bpm), so this must still match the
      // pass-0 hi-hat onset at relative time 0.
      clock.setTime(COUNT_IN_MS - 50)
      result.current.hit('hhClosed')
    })
    playEvents(clock, result, events)
    act(() => {
      clock.setTime(END_MS)
      manual.pump()
    })

    expect(result.current.rows.find((r) => r.pad === 'hhClosed')).toMatchObject({
      expected: 16,
      matched: 16,
      missed: 0,
      extra: 0,
    })
  })
})

describe('useGrooveDrill — tolerance is derived (defect 2)', () => {
  it('matches grooveToleranceMs — 100ms for Money Beat at 80bpm, less for a sixteenth-note groove', () => {
    const moneyBeat = setup()
    const expectedMoneyBeat = grooveToleranceMs(moneyBeat.result.current.score, 80, GRADED_REPEATS)
    expect(expectedMoneyBeat).toBe(100)
    expect(moneyBeat.result.current.toleranceMs).toBe(expectedMoneyBeat)

    const ghostFunk = setup({ initialGrooveId: 'ghost-funk-bar' })
    const expectedGhostFunk = grooveToleranceMs(ghostFunk.result.current.score, 80, GRADED_REPEATS)
    expect(expectedGhostFunk).toBeLessThan(100)
    expect(ghostFunk.result.current.toleranceMs).toBe(expectedGhostFunk)
  })
})

describe('useGrooveDrill — repeats are settable (defect 3)', () => {
  it('setRepeats changes repeats, refusing an unlisted value or a change mid-run', () => {
    const { result } = setup()

    expect(result.current.repeats).toBe(GRADED_REPEATS)
    expect(result.current.repeatChoices).toEqual(REPEAT_CHOICES)

    act(() => result.current.setRepeats(4))
    expect(result.current.repeats).toBe(4)

    act(() => result.current.setRepeats(3))
    expect(result.current.repeats).toBe(4)

    act(() => result.current.start())
    act(() => result.current.setRepeats(8))
    expect(result.current.repeats).toBe(4)
  })

  it('a longer repeat count grades proportionally more expected notes', () => {
    const twoBars = setup()
    act(() => twoBars.result.current.start())
    playEvents(twoBars.clock, twoBars.result, correctRunEvents())
    act(() => {
      twoBars.clock.setTime(END_MS)
      twoBars.manual.pump()
    })
    const expectedTotalAt2 = twoBars.result.current.performance?.expectedTotal
    expect(expectedTotalAt2).toBeGreaterThan(0)

    const fourBars = setup()
    act(() => fourBars.result.current.setRepeats(4))
    const tolerance4 = fourBars.result.current.toleranceMs
    act(() => fourBars.result.current.start())
    playEvents(fourBars.clock, fourBars.result, correctRunEventsFor(4))
    act(() => {
      fourBars.clock.setTime(COUNT_IN_MS + BAR_MS * 4 + tolerance4)
      fourBars.manual.pump()
    })

    expect(fourBars.result.current.performance?.expectedTotal).toBe((expectedTotalAt2 ?? 0) * 2)
  })
})

describe('useGrooveDrill — tempo remembers the last run (defect 5)', () => {
  it('seeds bpm from the last attempt once the history store hydrates it', () => {
    const producer = setup()
    act(() => producer.result.current.setBpm(120))
    act(() => producer.result.current.start())
    act(() => {
      producer.clock.setTime(20_000)
      producer.manual.pump()
    })
    expect(producer.result.current.phase).toBe('done')
    expect(useDrumsHistoryStore.getState().attempts[0]?.bpm).toBe(120)

    const learner = setup()
    expect(learner.result.current.bpm).toBe(120)
  })

  it('does not overwrite a tempo the learner already set when a later attempt arrives', () => {
    const learner = setup()
    act(() => learner.result.current.setBpm(90))

    const producer = setup()
    act(() => producer.result.current.setBpm(150))
    act(() => producer.result.current.start())
    act(() => {
      producer.clock.setTime(20_000)
      producer.manual.pump()
    })
    expect(useDrumsHistoryStore.getState().attempts[0]?.bpm).toBe(150)

    expect(learner.result.current.bpm).toBe(90)
  })

  it('an explicit initialBpm always wins over a seeded attempt', () => {
    const producer = setup()
    act(() => producer.result.current.setBpm(150))
    act(() => producer.result.current.start())
    act(() => {
      producer.clock.setTime(20_000)
      producer.manual.pump()
    })
    expect(useDrumsHistoryStore.getState().attempts[0]?.bpm).toBe(150)

    const learner = setup({ initialBpm: 60 })
    expect(learner.result.current.bpm).toBe(60)
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

  it('opens on the easiest groove when no initialGrooveId is given', () => {
    // Not `setup()` — its whole point is pinning `initialGrooveId` to Money
    // Beat, and `exactOptionalPropertyTypes` refuses `{ initialGrooveId:
    // undefined }` as an override (the property must be absent, not `undefined`).
    const clock = new FakeClock()
    const audioOutput = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook((p: UseGrooveDrillOptions) => useGrooveDrill(p), {
      initialProps: { clock, audioOutput, frameDriver: manual.driver, date: clock },
    })

    expect(result.current.score.id).toBe('quarter-hat-rock')
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
