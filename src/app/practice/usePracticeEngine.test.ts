/**
 * Engine wiring: pressing play advances the transport and sounds notes: tempo
 * scale changes what the audio output is asked to play and when; loop range
 * restricts the played range; hand mute drops one hand's notes; wait mode
 * holds until the fake keyboard plays the right note. The domain behind each
 * of these already has its own suite (`transport.test.ts`, `waitmode.test.ts`,
 * `metronome.test.ts`) — this file only asserts the engine calls it correctly.
 */
import type { ScoreViewerHandle } from '@app/score/ScoreViewer.tsx'
import { C_MAJOR_SCALE_RH, TWO_HAND_CHORDS } from '@test/fixtures.ts'
import { measureRange } from '@core/notation/score.ts'
import { midi } from '@core/shared/units.ts'
import { act, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import type { RefObject } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { usePracticeEngine, type PracticeEngineOptions } from './usePracticeEngine.ts'
import type { FrameDriver } from './useTransportLoop.ts'

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

function makeOptions(
  clock: FakeClock,
  overrides: Partial<Omit<PracticeEngineOptions, 'clock'>> = {},
): PracticeEngineOptions {
  return {
    score: C_MAJOR_SCALE_RH,
    activeHands: ['left', 'right'],
    tempoScale: 1,
    loop: undefined,
    metronomeEnabled: false,
    metronomeSubdivision: 1,
    waitModeEnabled: false,
    clock,
    audioOutput: undefined,
    midiInput: undefined,
    ...overrides,
  }
}

describe('usePracticeEngine', () => {
  it('is idle, and safe to control, when no score is loaded', () => {
    const clock = new FakeClock()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { score: undefined }),
    })

    expect(result.current.phase).toBe('stopped')
    expect(result.current.position).toBeUndefined()
    expect(() => act(() => result.current.play())).not.toThrow()
    expect(result.current.phase).toBe('stopped')
  })

  it('play advances the transport and sounds notes through the audio output', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { audioOutput: audio, frameDriver: manual.driver }),
    })

    act(() => result.current.play())
    expect(result.current.phase).toBe('playing')

    act(() => {
      clock.advance(700) // < 2 quarters at 120bpm: C4, D4
      manual.pump()
    })

    expect(audio.playedNotes).toEqual([60, 62])
    expect(result.current.position).toEqual({ measureNumber: 1, beat: 2, beatsPerMeasure: 4 })
  })

  it('pressing pause freezes the position and stops the pump', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { audioOutput: audio, frameDriver: manual.driver }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(700)
      manual.pump()
    })
    act(() => result.current.pause())
    expect(result.current.phase).toBe('paused')

    act(() => {
      clock.advance(10_000)
      manual.pump()
    })
    expect(audio.playedNotes).toEqual([60, 62])
  })

  it('tempo scale changes what is asked to play, and when', () => {
    const clockSlow = new FakeClock()
    const audioSlow = new RecordingAudioOutput(clockSlow)
    const manualSlow = manualDriver()
    const { result: slow } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clockSlow, {
        audioOutput: audioSlow,
        frameDriver: manualSlow.driver,
        tempoScale: 1,
      }),
    })
    act(() => slow.current.play())
    act(() => {
      clockSlow.advance(700)
      manualSlow.pump()
    })

    const clockFast = new FakeClock()
    const audioFast = new RecordingAudioOutput(clockFast)
    const manualFast = manualDriver()
    const { result: fast } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clockFast, {
        audioOutput: audioFast,
        frameDriver: manualFast.driver,
        tempoScale: 2,
      }),
    })
    act(() => fast.current.play())
    act(() => {
      clockFast.advance(700)
      manualFast.pump()
    })

    expect(audioFast.playedNotes.length).toBeGreaterThan(audioSlow.playedNotes.length)
  })

  it('loop range restricts the played range', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    // First measure only: C4 D4 E4 F4 — G4 (measure 2) must never sound.
    const loop = measureRange(C_MAJOR_SCALE_RH, 0, 0)
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { audioOutput: audio, frameDriver: manual.driver, loop }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(2500) // one full loop pass (2000ms) plus a bit of the repeat
      manual.pump()
    })

    expect(audio.playedNotes).not.toContain(67)
    expect(audio.playedNotes.filter((n) => n === 60).length).toBeGreaterThan(1)
  })

  it("hand mute drops the muted hand's notes from what the transport plays", () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, {
        score: TWO_HAND_CHORDS,
        activeHands: ['right'],
        audioOutput: audio,
        frameDriver: manual.driver,
      }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(4000) // past all of bar 1
      manual.pump()
    })

    expect(audio.playedNotes).not.toContain(48) // left-hand C3 triad note
    expect(audio.playedNotes).not.toContain(52)
    expect(audio.playedNotes).not.toContain(55)
    expect(audio.playedNotes).toContain(72) // right-hand melody, unaffected
  })

  it('metronome, enabled, sounds clicks driven by core/timing/metronome', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, {
        audioOutput: audio,
        frameDriver: manual.driver,
        metronomeEnabled: true,
        metronomeSubdivision: 1,
      }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(2000) // 4 quarter-note beats at 120bpm
      manual.pump()
    })

    expect(audio.clicks.length).toBeGreaterThanOrEqual(4)
    expect(audio.clicks[0]?.accented).toBe(true)
  })

  it('wait mode holds until the fake keyboard plays the right note, then continues', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const midiInput = new FakeMidiInput()
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, {
        audioOutput: audio,
        midiInput,
        waitModeEnabled: true,
        frameDriver: manual.driver,
      }),
    })

    act(() => result.current.play())
    act(() => manual.pump()) // parks on the first onset (C4)

    expect(result.current.phase).toBe('waiting')
    expect(result.current.wait?.requiredNotes.map((n) => n.midi)).toEqual([60])
    expect(audio.playedNotes).toEqual([60])

    // Time passing does not advance the wait.
    act(() => clock.advance(5000))
    act(() => manual.pump())
    expect(result.current.phase).toBe('waiting')
    expect(audio.playedNotes).toEqual([60])

    act(() => midiInput.play(midi(60), 5000)) // the correct key
    act(() => {
      clock.advance(600)
      manual.pump()
    })

    // Wait mode gates every onset, so it is now parked on D4 — but D4, not C4
    // again, proving the transport actually moved on.
    expect(result.current.phase).toBe('waiting')
    expect(result.current.wait?.requiredNotes.map((n) => n.midi)).toEqual([62])
    expect(audio.playedNotes).toContain(62)
  })

  it('pause silences whatever is sounding, instead of leaving it to drone through the pause', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { audioOutput: audio, frameDriver: manual.driver }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(200) // mid C4, well before its release
      manual.pump()
    })
    expect(audio.calls.some((c) => c.kind === 'allNotesOff')).toBe(false)

    act(() => result.current.pause())

    expect(audio.calls.at(-1)).toMatchObject({ kind: 'allNotesOff' })
  })

  it('stop silences whatever is sounding immediately, instead of only queuing the release for the next pump', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { audioOutput: audio, frameDriver: manual.driver }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(200) // mid C4, well before its release
      manual.pump()
    })
    expect(audio.calls.some((c) => c.kind === 'allNotesOff')).toBe(false)

    act(() => result.current.stop())

    expect(audio.calls.at(-1)).toMatchObject({ kind: 'allNotesOff' })
  })

  it('notes sound at their own written time within the frame, not collapsed onto the frame boundary', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { audioOutput: audio, frameDriver: manual.driver }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(700) // one late pump spanning C4 (tick 0) and D4 (tick 480, 500ms in)
      manual.pump()
    })

    const noteOns = audio.calls.filter((c) => c.kind === 'noteOn')
    // The pump crossed the window [tick 0, tick 672], so its two notes are
    // scheduled from the instant the window STARTED, which is now: 700 and
    // 1200. Two properties matter, and the second is why the app once could
    // not play at all — Web Audio throws on a time in the past:
    expect(noteOns.map((c) => c.at)).toEqual([700, 1200])
    //  - the 500ms written gap between C4 and D4 survives the frame;
    expect(noteOns[1]!.at - noteOns[0]!.at).toBe(500)
    //  - nothing is scheduled before the moment it was scheduled at.
    for (const call of noteOns) expect(call.at).toBeGreaterThanOrEqual(clock.now())
  })

  it('metronome clicks land at their own musical time within the frame, not all at the frame boundary', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, {
        audioOutput: audio,
        frameDriver: manual.driver,
        metronomeEnabled: true,
        metronomeSubdivision: 1,
      }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(2000) // one late pump spanning all 4 beats of bar 1 at 120bpm
      manual.pump()
    })

    // Anchored on the tick the pump started from — tick 0, i.e. now — so the
    // bar's four beats are laid out across the next 2000ms at their written
    // spacing, rather than all landing on the frame boundary (the bug) or all
    // in the past (the bug the first fix introduced).
    expect(audio.clicks.map((c) => c.at)).toEqual([2000, 2500, 3000, 3500])
    for (const click of audio.clicks) expect(click.at).toBeGreaterThanOrEqual(clock.now())
  })

  it('hand mute mid-playback carries the transport position and phase to the rebuilt transport, and panics the audio instead of orphaning what was ringing', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const { result, rerender } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, {
        score: TWO_HAND_CHORDS,
        activeHands: ['left', 'right'],
        audioOutput: audio,
        frameDriver: manual.driver,
      }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(1200) // measure 1 beat 3: LH triad 48/52/55 and RH 76 all sounding
      manual.pump()
    })
    expect(result.current.phase).toBe('playing')
    expect(result.current.position).toEqual({ measureNumber: 1, beat: 3, beatsPerMeasure: 4 })

    audio.reset() // only care about what the mute itself does

    act(() => {
      rerender(
        makeOptions(clock, {
          score: TWO_HAND_CHORDS,
          activeHands: ['right'], // mute the left hand mid-playback
          audioOutput: audio,
          frameDriver: manual.driver,
        }),
      )
    })

    expect(result.current.phase).toBe('playing') // not reset to stopped
    expect(result.current.position).toEqual({ measureNumber: 1, beat: 3, beatsPerMeasure: 4 }) // not rewound to bar 1
    expect(audio.calls.some((c) => c.kind === 'allNotesOff')).toBe(true) // orphaned chord panicked
  })

  it('moves the score cursor imperatively through the ref every frame, not through props or state', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const moveCursorTo = vi.fn()
    const scoreViewerRef: RefObject<ScoreViewerHandle | null> = {
      current: { moveCursorTo, setNoteColor: vi.fn(), clearNoteColors: vi.fn() },
    }
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, {
        audioOutput: audio,
        frameDriver: manual.driver,
        scoreViewerRef,
      }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(700)
      manual.pump()
    })

    expect(moveCursorTo).toHaveBeenCalledWith(0, 672)
  })
})
