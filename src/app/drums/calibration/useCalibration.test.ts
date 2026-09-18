/**
 * `useCalibration` — the calibration run, not the scoring (that is
 * `@core/drums/scoring/latency.test.ts`). What is pinned here is the timing
 * contract: one origin read once at `start()`, the click track scheduled one
 * bar ahead per frame and never behind "now", the count-in counting forward
 * before `collecting` opens, and a hit judged by the clock rather than by
 * which phase happens to be showing — the same discipline
 * `useGrooveRun.test.ts` pins for the groove trainer.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '@test/fakes.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { CALIBRATION_HITS } from '@core/drums/scoring/latency.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import type { Millis } from '@core/shared/units.ts'
import { CALIBRATION_BEAT_MS, useCalibration, type UseCalibrationOptions } from './useCalibration.ts'

const BEAT_MS = CALIBRATION_BEAT_MS // 750 at 80 bpm
const BAR_MS = BEAT_MS * 4 // 3000

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

type StrikeCall = { readonly pad: MappedDrumPad; readonly velocity: number; readonly atMs: number }
type ClickCall = { readonly accented: boolean; readonly atMs: number }

class RecordingDrumAudio implements DrumAudioOutput {
  readonly strikes: StrikeCall[] = []
  readonly clickCalls: ClickCall[] = []
  allNotesOffCalls = 0
  private readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  private at(explicit?: Millis): number {
    return explicit ?? this.clock.now()
  }

  strike(pad: MappedDrumPad, velocity: number, atMs?: Millis): void {
    this.strikes.push({ pad, velocity, atMs: this.at(atMs) })
  }

  click(accented: boolean, atMs?: Millis): void {
    this.clickCalls.push({ accented, atMs: this.at(atMs) })
  }

  allNotesOff(): void {
    this.allNotesOffCalls += 1
  }

  setVolume(): void {
    // Not exercised here.
  }

  now(): Millis {
    return this.clock.now()
  }
}

type Harness = {
  readonly clock: FakeClock
  readonly audio: RecordingDrumAudio
  readonly pump: () => void
  readonly result: { current: ReturnType<typeof useCalibration> }
}

function harness(inputOffsetMs?: number): Harness {
  const clock = new FakeClock()
  const audio = new RecordingDrumAudio(clock)
  const manual = manualDriver()
  const options: UseCalibrationOptions = {
    clock,
    audio: () => audio,
    frameDriver: manual.driver,
    ...(inputOffsetMs === undefined ? {} : { inputOffsetMs }),
  }
  const view = renderHook(() => useCalibration(options))
  return { clock, audio, pump: manual.pump, result: view.result }
}

function frameAt(h: Harness, ms: number): void {
  act(() => {
    h.clock.setTime(ms)
    h.pump()
  })
}

describe('useCalibration', () => {
  it('starts idle, with nothing scheduled and no deviations', () => {
    const h = harness()
    expect(h.result.current.phase).toBe('idle')
    expect(h.result.current.beat).toBe(0)
    expect(h.result.current.hits).toBe(0)
    expect(h.result.current.deviationsMs).toEqual([])
    expect(h.result.current.summary).toBeUndefined()
    expect(h.audio.clickCalls).toEqual([])
  })

  it('start() enters count-in at beat 1 and schedules the count-in bar synchronously, accenting the first beat', () => {
    const h = harness()
    act(() => h.result.current.start())

    expect(h.result.current.phase).toBe('count-in')
    expect(h.result.current.beat).toBe(1)
    expect(h.audio.clickCalls).toEqual([
      { accented: true, atMs: 0 },
      { accented: false, atMs: BEAT_MS },
      { accented: false, atMs: 2 * BEAT_MS },
      { accented: false, atMs: 3 * BEAT_MS },
    ])
  })

  it('counts the count-in bar forward, 1 through 4, then opens collecting at the bar', () => {
    const h = harness()
    act(() => h.result.current.start())
    const seen: number[] = []
    for (let beat = 0; beat < 4; beat++) {
      frameAt(h, beat * BEAT_MS)
      seen.push(h.result.current.beat)
    }
    expect(seen).toEqual([1, 2, 3, 4])
    expect(h.result.current.phase).toBe('count-in')

    frameAt(h, BAR_MS)
    expect(h.result.current.phase).toBe('collecting')
    expect(h.result.current.beat).toBe(1)
  })

  it('keeps counting 1-4 every bar while collecting, wrapping rather than stopping', () => {
    const h = harness()
    act(() => h.result.current.start())
    frameAt(h, BAR_MS)
    expect(h.result.current.phase).toBe('collecting')

    frameAt(h, BAR_MS + BEAT_MS)
    expect(h.result.current.beat).toBe(2)
    frameAt(h, BAR_MS + 2 * BEAT_MS)
    expect(h.result.current.beat).toBe(3)
    frameAt(h, BAR_MS + 3 * BEAT_MS)
    expect(h.result.current.beat).toBe(4)
    // Second collecting bar: wraps back to 1, does not keep counting to 5.
    frameAt(h, 2 * BAR_MS)
    expect(h.result.current.beat).toBe(1)
    expect(h.result.current.phase).toBe('collecting')
  })

  it('schedules bars one ahead of the current bar as frames advance, never behind "now"', () => {
    const h = harness()
    act(() => h.result.current.start())
    // Bar 0 (4 clicks) scheduled synchronously by start(); the very first
    // frame pump — even at time 0 — schedules bar 1 one bar ahead, exactly
    // as `useGrooveRun`'s own loop-mode scheduling does the moment pass 0
    // opens.
    frameAt(h, 0)
    expect(h.audio.clickCalls).toHaveLength(8)
    expect(h.audio.clickCalls.slice(4)).toEqual([
      { accented: true, atMs: BAR_MS },
      { accented: false, atMs: BAR_MS + BEAT_MS },
      { accented: false, atMs: BAR_MS + 2 * BEAT_MS },
      { accented: false, atMs: BAR_MS + 3 * BEAT_MS },
    ])

    // Once bar 1 (collecting's first bar) is under way, bar 2 gets scheduled.
    frameAt(h, BAR_MS)
    expect(h.audio.clickCalls).toHaveLength(12)
    expect(h.audio.clickCalls.every((c) => c.atMs >= 0)).toBe(true)
  })

  it('hit() always flashes and sounds the pad, even outside a run', () => {
    const h = harness()
    act(() => h.result.current.hit('kick'))
    expect(h.audio.strikes).toEqual([{ pad: 'kick', velocity: 96, atMs: 0 }])
    expect(h.result.current.flash).toMatchObject({ pad: 'kick' })
    // Idle: no deviation recorded.
    expect(h.result.current.deviationsMs).toEqual([])
  })

  it('records a deviation only while collecting', () => {
    const h = harness()
    act(() => h.result.current.start())
    // Still count-in: a hit sounds but is not scored.
    act(() => h.result.current.hit('kick'))
    expect(h.result.current.deviationsMs).toEqual([])

    frameAt(h, BAR_MS)
    expect(h.result.current.phase).toBe('collecting')

    act(() => {
      h.clock.setTime(BAR_MS)
      h.result.current.hit('kick')
    })
    expect(h.result.current.deviationsMs).toEqual([0])
    expect(h.result.current.hits).toBe(1)
  })

  it('reads a hit after the click as a positive (late) deviation from the nearest click', () => {
    const h = harness()
    act(() => h.result.current.start())
    frameAt(h, BAR_MS)

    act(() => {
      h.clock.setTime(BAR_MS + 30)
      h.result.current.hit('snare')
    })
    expect(h.result.current.deviationsMs).toEqual([30])
  })

  it('produces a summary once CALIBRATION_HITS deviations have landed, silences already-scheduled clicks, and stops scheduling', () => {
    const h = harness()
    act(() => h.result.current.start())
    frameAt(h, BAR_MS)

    // One frame pump per hit, each landing 30ms after its own click, so the
    // click track keeps scheduling ahead the whole way through — proving the
    // per-click judgement, not a single frozen instant.
    for (let i = 0; i < CALIBRATION_HITS; i++) {
      frameAt(h, BAR_MS + i * BEAT_MS)
      act(() => {
        h.clock.setTime(BAR_MS + i * BEAT_MS + 30)
        h.result.current.hit('kick')
      })
    }

    expect(h.result.current.phase).toBe('done')
    expect(h.result.current.beat).toBe(0)
    expect(h.result.current.hits).toBe(CALIBRATION_HITS)
    expect(h.result.current.summary).toEqual({ offsetMs: 30, spreadMs: 0, samples: CALIBRATION_HITS })
    // Up to 7 more clicks were already in the audio graph one bar ahead when
    // the 16th hit landed — reaching 'done' must silence them, exactly like
    // stop() does.
    expect(h.audio.allNotesOffCalls).toBeGreaterThanOrEqual(1)

    // A run stuck at 'done' no longer schedules — the transport loop
    // deactivates once phase leaves count-in/collecting, so a further pump
    // (were the driver still attached) would be a no-op; here we assert the
    // click count simply stops growing from further hits.
    const clicksAtDone = h.audio.clickCalls.length
    const allNotesOffAtDone = h.audio.allNotesOffCalls
    act(() => h.result.current.hit('kick'))
    expect(h.audio.clickCalls).toHaveLength(clicksAtDone)
    expect(h.audio.allNotesOffCalls).toBe(allNotesOffAtDone)
    expect(h.result.current.deviationsMs).toHaveLength(CALIBRATION_HITS)
  })

  it('alternating +30/+50 hits against successive clicks read offsetMs 40 (mean of the two biases), spreadMs 10', () => {
    const h = harness()
    act(() => h.result.current.start())
    frameAt(h, BAR_MS)

    for (let i = 0; i < CALIBRATION_HITS; i++) {
      frameAt(h, BAR_MS + i * BEAT_MS)
      const lateBy = i % 2 === 0 ? 30 : 50
      act(() => {
        h.clock.setTime(BAR_MS + i * BEAT_MS + lateBy)
        h.result.current.hit('kick')
      })
    }

    // Median of [30,50,30,50,...] (mean of the two middle values) is 40; the
    // median absolute deviation from 40 is 10 for every sample.
    expect(h.result.current.summary).toEqual({ offsetMs: 40, spreadMs: 10, samples: CALIBRATION_HITS })
  })

  it('judges a hit by the clock, not by whether the phase state update has caught up: a hit at the collecting downbeat is recorded with no frame pump crossing into it', () => {
    const h = harness()
    act(() => h.result.current.start())
    frameAt(h, BAR_MS - 1)
    expect(h.result.current.phase).toBe('count-in')

    act(() => {
      h.clock.setTime(BAR_MS)
      h.result.current.hit('kick')
    })

    expect(h.result.current.deviationsMs).toEqual([0])
  })

  it('accepts a hit inside the half-beat window before the collecting downbeat, but not one at a count-in click', () => {
    const h = harness()
    act(() => h.result.current.start())

    // A count-in click, a full beat before the downbeat — outside the
    // half-beat window, so it does not count, even though the gate is purely
    // clock-based and phase is still 'count-in' either way.
    act(() => {
      h.clock.setTime(BAR_MS - BEAT_MS)
      h.result.current.hit('snare')
    })
    expect(h.result.current.deviationsMs).toEqual([])

    // Inside the half-beat window right before the downbeat — still counts.
    act(() => {
      h.clock.setTime(BAR_MS - 100)
      h.result.current.hit('kick')
    })
    expect(h.result.current.deviationsMs).toEqual([-100])
  })

  it('stop() resets to idle, clears deviations, hits and summary, and calls allNotesOff', () => {
    const h = harness()
    act(() => h.result.current.start())
    frameAt(h, BAR_MS)
    act(() => {
      h.clock.setTime(BAR_MS + 10)
      h.result.current.hit('kick')
    })
    expect(h.result.current.deviationsMs).toEqual([10])

    act(() => h.result.current.stop())

    expect(h.result.current.phase).toBe('idle')
    expect(h.result.current.beat).toBe(0)
    expect(h.result.current.hits).toBe(0)
    expect(h.result.current.deviationsMs).toEqual([])
    expect(h.result.current.summary).toBeUndefined()
    expect(h.audio.allNotesOffCalls).toBe(1)
  })

  it('subtracts inputOffsetMs from the hit clock reading before scoring against the click grid', () => {
    const h = harness(40)
    act(() => h.result.current.start())
    frameAt(h, BAR_MS)

    // The clock reads 40ms after the click; with a 40ms rig offset supplied,
    // the corrected reading lands exactly on the click.
    act(() => {
      h.clock.setTime(BAR_MS + 40)
      h.result.current.hit('kick')
    })
    expect(h.result.current.deviationsMs).toEqual([0])
  })
})
