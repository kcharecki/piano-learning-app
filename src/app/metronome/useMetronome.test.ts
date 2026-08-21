/**
 * `useMetronome` (roadmap 2.28, REQ-3.9.1): the acceptance sentence itself —
 * 7/8 at 100bpm with accents on 1 and 4, clicks at the right gaps with the
 * right accent flags — plus running with no score at all, and a bpm change
 * mid-run changing the subsequent gap without re-firing a past click.
 */
import { act, renderHook } from '@testing-library/react'
import { FakeClock, RecordingAudioOutput } from '@test/fakes.ts'
import { describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { AccentPattern } from '@core/timing/metronome.ts'
import { MAX_BPM, MIN_BPM } from '@core/timing/metronome.ts'
import { bpm } from '@core/shared/units.ts'
import { useMetronome, type UseMetronomeOptions } from './useMetronome.ts'

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

describe('useMetronome', () => {
  it('runs with no score at all: default settings, start, and a click is heard', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook(() =>
      useMetronome({ clock, audioOutput: audio, frameDriver: manual.driver }),
    )

    expect(result.current.error).toBeUndefined()
    act(() => result.current.start())
    act(() => {
      clock.advance(700)
      manual.pump()
    })

    expect(audio.clicks.length).toBeGreaterThan(0)
  })

  it('7/8 at 100bpm with accents on 1 and 4: clicks land at the right gaps with the right accent flags', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const accents: AccentPattern = [true, false, false, true, false, false, false]
    const options: UseMetronomeOptions = {
      clock,
      audioOutput: audio,
      frameDriver: manual.driver,
      initialBpm: bpm(100),
      initialTimeSignature: { beats: 7, beatType: 8 },
      initialSubdivision: 1,
      initialAccents: accents,
    }
    const { result } = renderHook(() => useMetronome(options))

    act(() => result.current.start())
    // One eighth note at 100bpm (quarter-note bpm) is 300ms; advancing 1000ms
    // crosses exactly four of them (0, 300, 600, 900) and not the fifth (1200).
    act(() => {
      clock.advance(1000)
      manual.pump()
    })

    expect(audio.clicks).toEqual([
      { accented: true, at: 1000 },
      { accented: false, at: 1300 },
      { accented: false, at: 1600 },
      { accented: true, at: 1900 },
    ])
  })

  it('changing bpm mid-run changes the subsequent gaps and does not re-fire past clicks', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const options: UseMetronomeOptions = {
      clock,
      audioOutput: audio,
      frameDriver: manual.driver,
      initialBpm: bpm(100),
      initialTimeSignature: { beats: 4, beatType: 4 },
      initialSubdivision: 1,
    }
    const { result } = renderHook(() => useMetronome(options))

    act(() => result.current.start())
    // A quarter note at 100bpm is 600ms — advancing exactly one beat fires
    // only the downbeat (the next click, at tick 480, is still due). Clicks
    // are anchored on the window START (see `useMetronome`'s module note),
    // so the downbeat lands at the pump instant (600ms), not at tick 0's
    // true past ms — the whole point being every scheduled time is >= "now".
    act(() => {
      clock.advance(600)
      manual.pump()
    })
    expect(audio.clicks).toEqual([{ accented: true, at: 600 }])

    // Doubling the tempo right at that instant must not re-fire the click at
    // tick 0, and must not skip or duplicate the one still due at tick 480.
    act(() => result.current.setBpm(200))
    expect(audio.clicks).toEqual([{ accented: true, at: 600 }])
    expect(result.current.bpm).toBe(200)

    act(() => {
      clock.advance(300)
      manual.pump()
    })
    // The click at tick 480 was already due at the moment of the change.
    expect(audio.clicks).toEqual([
      { accented: true, at: 600 },
      { accented: false, at: 900 },
    ])

    act(() => {
      clock.advance(300)
      manual.pump()
    })
    // The NEXT click is the first one entirely inside the new tempo: at
    // 200bpm a quarter note is 300ms, half the 600ms gap before the change.
    expect(audio.clicks).toEqual([
      { accented: true, at: 600 },
      { accented: false, at: 900 },
      { accented: false, at: 1200 },
    ])
  })

  it('every scheduled click lands at or after the clock instant it was scheduled from, never in the past', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook(() =>
      useMetronome({ clock, audioOutput: audio, frameDriver: manual.driver }),
    )

    act(() => result.current.start())
    const checkpoints: number[] = []
    for (const gapMs of [700, 600, 600]) {
      act(() => {
        clock.advance(gapMs)
        manual.pump()
      })
      checkpoints.push(clock.now())
    }

    // Every recorded click must be at or after SOME pump's clock instant —
    // concretely, no click may be scheduled before the earliest checkpoint
    // that had already elapsed when it was recorded. Since clicks are only
    // ever appended in pump order, checking against the running clock at
    // each pump covers every click emitted by that pump.
    let clickIndex = 0
    let prevCount = 0
    for (const now of checkpoints) {
      const clicksThisPump = audio.clicks.slice(prevCount)
      for (const click of clicksThisPump) expect(click.at).toBeGreaterThanOrEqual(now)
      prevCount = audio.clicks.length
      clickIndex++
    }
    expect(clickIndex).toBe(checkpoints.length)
  })

  it('caps catch-up after a large frame gap instead of replaying the whole backlog', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook(() =>
      useMetronome({ clock, audioOutput: audio, frameDriver: manual.driver }),
    )

    act(() => result.current.start())
    // A hidden tab: 60s pass between pumps at the default 100bpm 4/4, far
    // more than one bar (2.4s) of backlog.
    act(() => {
      clock.advance(60_000)
      manual.pump()
    })

    expect(audio.clicks.length).toBeLessThanOrEqual(1)
  })

  it('stopping silences any clicks already scheduled ahead', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook(() =>
      useMetronome({ clock, audioOutput: audio, frameDriver: manual.driver }),
    )

    act(() => result.current.start())
    act(() => {
      clock.advance(700)
      manual.pump()
    })

    act(() => result.current.stop())

    expect(audio.calls[audio.calls.length - 1]).toMatchObject({ kind: 'allNotesOff' })
  })

  it('clamps bpm to the 20-300 range', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook(() =>
      useMetronome({ clock, audioOutput: audio, frameDriver: manual.driver }),
    )

    act(() => result.current.setBpm(9999))
    expect(result.current.bpm).toBe(MAX_BPM)

    act(() => result.current.setBpm(-5))
    expect(result.current.bpm).toBe(MIN_BPM)
    expect(result.current.error).toBeUndefined()
  })

  it('rejects a subdivision/tempo combination whose clicks would be too fast to hear apart, leaving settings unchanged', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook(() =>
      useMetronome({ clock, audioOutput: audio, frameDriver: manual.driver }),
    )

    act(() => result.current.setBpm(MAX_BPM))
    expect(result.current.error).toBeUndefined()

    // 4/4 with subdivision 8 at 300bpm is the metronome module's own example
    // of an unusable rate: a click every 25ms, under the 50ms floor.
    act(() => result.current.setSubdivision(8))
    expect(result.current.error).toBeDefined()
    expect(result.current.subdivision).toBe(1)
  })

  // roadmap T.9: every setter used to rebuild its draft from the RENDER
  // closure, so a second setter in the same tick overwrote the first with the
  // pre-tick value it had captured. Nothing called two setters in one tick at
  // the time, which is exactly why it was worth closing before something did.
  it('applies two setters called in the same tick: neither silently undoes the other', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook(() =>
      useMetronome({ clock, audioOutput: audio, frameDriver: manual.driver }),
    )

    act(() => {
      result.current.setBpm(72)
      result.current.setSubdivision(3)
    })

    expect(result.current.bpm).toBe(72)
    expect(result.current.subdivision).toBe(3)
    expect(result.current.error).toBeUndefined()
  })

  it('validates the second in-tick setter against the first one’s value, not the pre-tick one', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook(() =>
      useMetronome({ clock, audioOutput: audio, frameDriver: manual.driver }),
    )

    // 4/4 subdivision 8 is fine at the default 100bpm (75ms a click) and
    // unusable at 300 (25ms, under the 50ms floor). Raising bpm first has to
    // make the subdivision that follows it in the SAME tick illegal.
    act(() => {
      result.current.setBpm(MAX_BPM)
      result.current.setSubdivision(8)
    })

    expect(result.current.bpm).toBe(MAX_BPM)
    expect(result.current.subdivision).toBe(1)
    expect(result.current.error).toBeDefined()
  })

  it('keeps a resized accent pattern when beats and accents are set in the same tick', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook(() =>
      useMetronome({ clock, audioOutput: audio, frameDriver: manual.driver }),
    )

    act(() => {
      result.current.setTimeSignature({ beats: 3, beatType: 4 })
      result.current.setAccents([false, true, false] as unknown as AccentPattern)
    })

    expect(result.current.timeSignature.beats).toBe(3)
    expect(result.current.accents).toEqual([false, true, false])
    expect(result.current.error).toBeUndefined()
  })
})
