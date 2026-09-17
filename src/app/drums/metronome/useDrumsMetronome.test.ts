/**
 * `useDrumsMetronome` — pinned here: click placement, gap-click return-drift
 * grading, random mute under an injected `Rng`, the bar-stepped tempo ramp,
 * subdivision-volume-0 still dispatching (never filtering) a click, `stop()`
 * silencing audio, and (roadmap DR-12 adversarial-review follow-up) the
 * look-ahead scheduling invariant, the one-bar hidden-tab catch-up cap, the
 * deferred return report, `setBpm` + `start()` composing in one tick, and
 * `setPlacement` rejecting a bad value instead of throwing inside the frame
 * pump. All timing goes through a `FakeClock` and a manual `FrameDriver` —
 * no real time, no real randomness.
 *
 * `pumpFrames` replaces the old "one big `clock.advance` then one `pump()`"
 * shape: `flush` now schedules only a `LOOKAHEAD_MS` window per call, so a
 * multi-bar advance must be delivered as many small frames — exactly how the
 * real `rAF`-driven loop calls it — or the one-bar catch-up cap in `flush`
 * (correctly) treats the whole advance as a hidden-tab backlog and skips it.
 */
import { act, renderHook } from '@testing-library/react'
import fc from 'fast-check'
import { FakeClock, scriptedRng } from '@test/fakes.ts'
import { describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { seededRng } from '@core/ports/rng.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import type { Millis } from '@core/shared/units.ts'
import { DRUMS_MAX_BPM, DRUMS_MIN_BPM, useDrumsMetronome } from './useDrumsMetronome.ts'

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

/**
 * Deliver `totalMs` of clock time as a sequence of small frames, the way a
 * real `rAF` loop would (~every 16 ms), rather than one giant jump. Needed
 * now that `flush` schedules only a look-ahead window per call and treats a
 * jump of more than one bar as a hidden-tab backlog to skip, not replay.
 */
function pumpFrames(clock: FakeClock, pump: () => void, totalMs: number, stepMs = 20): void {
  let remaining = totalMs
  while (remaining > 0) {
    const step = Math.min(stepMs, remaining)
    clock.advance(step)
    pump()
    remaining -= step
  }
}

type ClickCall = { readonly accented: boolean; readonly at: number; readonly gain: number }

/**
 * Records every `click` call, the same discipline `RecordingAudioOutput`
 * gives the piano side and `useGrooveRun.test.ts`'s `RecordingDrumAudio`
 * gives the drum side — ported here with `gain` recorded too (roadmap DR-12).
 * `strike`'s `pad` param is typed `unknown`: method parameters are checked
 * bivariantly, so this still satisfies `DrumAudioOutput` without importing
 * `MappedDrumPad`, which this slice's dependencies do not include.
 */
class FakeDrumAudioOutput implements DrumAudioOutput {
  readonly clicks: ClickCall[] = []
  allNotesOffCalls = 0
  private readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  strike(_pad: unknown, _velocity: number, _atMs?: Millis): void {}

  click(accented: boolean, atMs?: Millis, gain = 1): void {
    this.clicks.push({ accented, at: atMs ?? this.clock.now(), gain })
  }

  allNotesOff(): void {
    this.allNotesOffCalls++
  }

  setVolume(): void {}

  now(): Millis {
    return this.clock.now()
  }
}

describe('useDrumsMetronome', () => {
  it('places clicks on beats 2 and 4 only (E.1)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(1), initialBpm: 100 }),
    )
    act(() => result.current.setPlacement({ kind: 'beats', beats: [1, 3] }))
    act(() => result.current.start())
    act(() => pumpFrames(clock, pump, 4300))

    expect(audio.clicks.map((c) => c.at)).toEqual([600, 1800, 3000, 4200])
  })

  it('gap click: a tap near the return bar reports signed drift (E.2)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(2), initialBpm: 100 }),
    )
    act(() => result.current.setGap({ onBars: 1, offBars: 1 }))
    act(() => result.current.start())

    // Bar 0 sounds (ms 0-2400), bar 1 is silent (ms 2400-4800) — enter it first.
    act(() => pumpFrames(clock, pump, 3000))
    expect(result.current.silentBar).toBe(true)

    // Bar 2's downbeat lands at 4800 ms; tap 38 ms late.
    act(() => pumpFrames(clock, pump, 1838))
    act(() => result.current.tap())

    // Cross into bar 2, then run past the return-grading window so the
    // deferred report (MAJOR 1) has a chance to fire.
    act(() => pumpFrames(clock, pump, 800))

    expect(result.current.lastReturn).toEqual({ bar: 2, driftMs: 38 })
  })

  it('gap click: a LATE tap (after the downbeat) still reports signed drift (MAJOR 1)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(20), initialBpm: 100 }),
    )
    act(() => result.current.setGap({ onBars: 1, offBars: 1 }))
    act(() => result.current.start())

    // Bar 2's downbeat lands at 4800 ms. Tap 80 ms AFTER it — a report
    // computed at the crossing frame (before the tap exists) would miss
    // this; the deferred report must not.
    act(() => pumpFrames(clock, pump, 4880))
    act(() => result.current.tap())
    act(() => pumpFrames(clock, pump, 400))

    expect(result.current.lastReturn).toEqual({ bar: 2, driftMs: 80 })
  })

  it('gap click: an early tap (before the downbeat) reports negative drift (MAJOR 1)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(21), initialBpm: 100 }),
    )
    act(() => result.current.setGap({ onBars: 1, offBars: 1 }))
    act(() => result.current.start())

    // Bar 2's downbeat lands at 4800 ms; tap 80 ms early, at 4720 ms.
    act(() => pumpFrames(clock, pump, 4720))
    act(() => result.current.tap())
    act(() => pumpFrames(clock, pump, 400))

    expect(result.current.lastReturn).toEqual({ bar: 2, driftMs: -80 })
  })

  it('gap click: no tap near the return bar reports no drift (E.2)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(3), initialBpm: 100 }),
    )
    act(() => result.current.setGap({ onBars: 1, offBars: 1 }))
    act(() => result.current.start())

    act(() => pumpFrames(clock, pump, 5200)) // straight through bar 1's silence into bar 2, no tap

    expect(result.current.lastReturn).toEqual({ bar: 2, driftMs: undefined })
  })

  it('random mute: p=0 never mutes, p=1 always mutes (E.3)', () => {
    const clockA = new FakeClock(0)
    const audioA = new FakeDrumAudioOutput(clockA)
    const driverA = manualDriver()
    const zeroP = renderHook(() =>
      useDrumsMetronome({
        clock: clockA,
        audio: audioA,
        driver: driverA.driver,
        rng: scriptedRng([0]),
        initialBpm: 100,
      }),
    )
    act(() => zeroP.result.current.setMuteProbability(0))
    act(() => zeroP.result.current.start())
    act(() => pumpFrames(clockA, driverA.pump, 3 * 2400))
    expect(audioA.clicks.length).toBeGreaterThan(0)

    const clockB = new FakeClock(0)
    const audioB = new FakeDrumAudioOutput(clockB)
    const driverB = manualDriver()
    const oneP = renderHook(() =>
      useDrumsMetronome({
        clock: clockB,
        audio: audioB,
        driver: driverB.driver,
        rng: scriptedRng([0]),
        initialBpm: 100,
      }),
    )
    act(() => oneP.result.current.setMuteProbability(1))
    act(() => oneP.result.current.start())
    act(() => pumpFrames(clockB, driverB.pump, 3 * 2400))
    expect(audioB.clicks).toHaveLength(0)
    // MINOR d: a fully-muted bar reads as silent on the transport readout too.
    expect(oneP.result.current.silentBar).toBe(true)
  })

  it('ramps bpm by step every N bars up to target, then holds (E.4)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(4), initialBpm: 60 }),
    )
    act(() => result.current.setRamp({ stepBpm: 5, everyBars: 1, targetBpm: 70 }))
    act(() => result.current.start())

    act(() => pumpFrames(clock, pump, 4001)) // bar 0 (at 60 bpm, 4000 ms) -> bar 1
    expect(result.current.bpm).toBe(65)

    act(() => pumpFrames(clock, pump, 3693)) // bar 1 (at 65 bpm, ~3692 ms) -> bar 2
    expect(result.current.bpm).toBe(70)

    act(() => pumpFrames(clock, pump, 3429 * 3)) // several more bars at 70 bpm — ramp is done, holds
    expect(result.current.bpm).toBe(70)
  })

  it('a downward ramp steps toward its target too (MINOR b)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(22), initialBpm: 100 }),
    )
    act(() => result.current.setRamp({ stepBpm: 10, everyBars: 1, targetBpm: 80 }))
    act(() => result.current.start())

    act(() => pumpFrames(clock, pump, 2401)) // bar 0 (2400 ms) -> bar 1
    expect(result.current.bpm).toBe(90)

    act(() => pumpFrames(clock, pump, 2668)) // bar 1 (~2667 ms) -> bar 2
    expect(result.current.bpm).toBe(80)
  })

  it('subdivision volume 0 still sends every subdivision click, at gain 0 (E.5)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(5), initialBpm: 100 }),
    )
    act(() => result.current.setSubdivision(2))
    act(() => result.current.setSubdivisionVolume(0))
    act(() => result.current.start())
    act(() => pumpFrames(clock, pump, 2300)) // bar 0's 8 clicks (4 beats x 2 subdivisions), not yet bar 1's downbeat

    expect(audio.clicks).toHaveLength(8)
    expect(audio.clicks.filter((c) => c.gain === 0)).toHaveLength(4)
    expect(audio.clicks.filter((c) => c.gain === 1)).toHaveLength(4)
  })

  it('stop silences audio and resets the readout (E.6)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(6) }),
    )
    act(() => result.current.start())
    act(() => pumpFrames(clock, pump, 500))
    act(() => result.current.stop())

    expect(audio.allNotesOffCalls).toBe(1)
    expect(result.current.running).toBe(false)
    expect(result.current.bar).toBe(-1)
  })

  it('setBpm clamps into range instead of rejecting an out-of-range value', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver } = manualDriver()
    const { result } = renderHook(() => useDrumsMetronome({ clock, audio, driver }))

    act(() => result.current.setBpm(1000))
    expect(result.current.bpm).toBe(DRUMS_MAX_BPM)

    act(() => result.current.setBpm(-5))
    expect(result.current.bpm).toBe(DRUMS_MIN_BPM)
  })

  it('setGap rejects an out-of-range offBars and keeps the previous gap', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver } = manualDriver()
    const { result } = renderHook(() => useDrumsMetronome({ clock, audio, driver }))

    act(() => result.current.setGap({ onBars: 1, offBars: 9 }))
    expect(result.current.error).toBeDefined()
    expect(result.current.gap).toEqual({ onBars: 1, offBars: 0 })
  })

  it('setPlacement rejects an out-of-range beat instead of throwing inside the frame pump (MAJOR 3)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(23), initialBpm: 100 }),
    )
    const before = result.current.placement

    act(() => result.current.setPlacement({ kind: 'beats', beats: [1, 9] }))
    expect(result.current.error).toBeDefined()
    expect(result.current.placement).toEqual(before)

    act(() => result.current.setPlacement({ kind: 'every-n-bars', n: 0 }))
    expect(result.current.error).toBeDefined()
    expect(result.current.placement).toEqual(before)

    // The transport still runs fine afterwards — a rejected placement never
    // reached `draftRef`, so `flush` never saw it.
    act(() => result.current.start())
    act(() => pumpFrames(clock, pump, 100))
    expect(result.current.running).toBe(true)
  })

  it('setBpm then start() in the same tick starts at the NEW tempo (MAJOR 2)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(24), initialBpm: 100 }),
    )

    act(() => {
      result.current.setBpm(200)
      result.current.start()
    })

    expect(result.current.bpm).toBe(200)
    // At 200 bpm, beat = 300 ms — confirm the transport actually runs at the
    // new rate, not just that the readout says so.
    act(() => pumpFrames(clock, pump, 320))
    expect(audio.clicks[0]?.at).toBe(0)
    expect(audio.clicks[1]?.at).toBe(300)
  })

  it('a hidden-tab-sized frame gap dispatches zero clicks and the next frame resumes cleanly (BLOCKER 2)', () => {
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(25), initialBpm: 100 }),
    )
    act(() => result.current.start())
    act(() => pumpFrames(clock, pump, 100)) // a couple of normal frames first
    const dispatchedBeforeGap = audio.clicks.length

    // A 20-minute gap: no intervening frames at all, one huge jump.
    act(() => {
      clock.advance(20 * 60 * 1000)
      pump()
    })
    expect(audio.clicks).toHaveLength(dispatchedBeforeGap) // nothing new dispatched

    // The next normal frames resume cleanly: the readout reflects "now", and
    // clicks flow again without a backlog burst. At 100 bpm one beat is 600
    // ms, so 700 ms of real frames guarantees crossing at least one click
    // regardless of where the 20-minute jump happened to land in the beat's
    // phase.
    act(() => pumpFrames(clock, pump, 700))
    expect(result.current.running).toBe(true)
    expect(audio.clicks.length).toBeGreaterThan(dispatchedBeforeGap)
    // No enormous burst: comfortably under a bar's worth of clicks for the
    // ~700 ms actually covered by real frames.
    expect(audio.clicks.length - dispatchedBeforeGap).toBeLessThan(8)
  })

  it('a mid-run bpm drag never re-times ticks already scheduled (setBpm appends at the edge, never coalesces)', () => {
    // 40 → 240 → 40 inside one bar. The stretch scheduled while the dial read
    // 240 was dispatched at 240-bpm spacing; a later mark must not re-bill it
    // at 40 (a first cut coalesced same-bar marks and did exactly that, which
    // shifted every later click and froze the readout). So the gap between
    // the opening downbeat and the next click must be strictly shorter than a
    // whole beat at 40 (1500 ms) — part of it was genuinely played at 240 —
    // and longer than a beat at 240 (250 ms), since part of it was at 40.
    const clock = new FakeClock(0)
    const audio = new FakeDrumAudioOutput(clock)
    const { driver, pump } = manualDriver()
    const { result } = renderHook(() =>
      useDrumsMetronome({ clock, audio, driver, rng: seededRng(7), initialBpm: 40 }),
    )
    act(() => result.current.start())
    act(() => pumpFrames(clock, pump, 100))
    act(() => result.current.setBpm(240))
    act(() => pumpFrames(clock, pump, 100))
    act(() => result.current.setBpm(40))
    act(() => pumpFrames(clock, pump, 2000))

    const [first, second] = audio.clicks
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) return
    expect(second.at - first.at).toBeLessThan(1500)
    expect(second.at - first.at).toBeGreaterThan(250)
  })

  it('property: every dispatched click is scheduled at or after "now", and never dispatched twice', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 5, max: 60 }), { minLength: 5, maxLength: 40 }),
        (frameGapsMs) => {
          const clock = new FakeClock(0)
          const audio = new FakeDrumAudioOutput(clock)
          const { driver, pump } = manualDriver()
          const { result } = renderHook(() =>
            useDrumsMetronome({ clock, audio, driver, rng: seededRng(99), initialBpm: 140 }),
          )
          const originMs = clock.now()
          act(() => result.current.start())

          const seenAtMs = new Set<number>()
          for (const gap of frameGapsMs) {
            const before = audio.clicks.length
            act(() => {
              clock.advance(gap)
              pump()
            })
            const now = clock.now()
            for (const click of audio.clicks.slice(before)) {
              // Every click except the run's own opening downbeat (which IS
              // "now" at the instant `start()` was called, and is alone in
              // its batch — no collapse) must be scheduled strictly ahead of
              // the current instant, never at or behind it.
              if (click.at !== originMs) expect(click.at).toBeGreaterThanOrEqual(now)
              // Never the same wall-clock click dispatched twice.
              expect(seenAtMs.has(click.at)).toBe(false)
              seenAtMs.add(click.at)
            }
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})
