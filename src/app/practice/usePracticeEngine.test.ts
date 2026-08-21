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
import { measureRange } from '@core/notation/scoreQueries.ts'
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

  it('play() returns the same instant the transport anchored to, under FakeClock', () => {
    // Advancing the clock BEFORE play() is what kills a stub that returns
    // "the clock reading at hook construction" (would be 0) or a stub that
    // just returns 0: the real anchor must reflect this advance.
    const clock = new FakeClock()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock),
    })
    clock.advance(12_345)

    let anchor: number | undefined
    act(() => {
      anchor = result.current.play()
    })

    expect(anchor).toBe(12_345)
    // And the anchor is exactly what a note played at tick 0 would use: the
    // instant the transport reports it sounded at through the audio output.
    expect(clock.now()).toBe(12_345) // sanity: play() itself does not consume time
  })

  it('play() returns the true anchor at a non-zero position, not a fabricated reconstruction from the current tick', () => {
    // At tick 0 the correct anchor is numerically identical to clock.now(),
    // so a test that only checks tick 0 cannot distinguish the real anchor
    // from a mutant that just returns clock.now() verbatim. Advancing,
    // pausing (which does NOT reanchor), then advancing further with no pump
    // before calling play() again proves the returned value is the anchor
    // from the ORIGINAL play(), not clock.now() at the second call.
    const clock = new FakeClock()
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { frameDriver: manual.driver }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(700) // position 672 ticks = 700ms at 120bpm
      manual.pump()
    })
    act(() => result.current.pause())
    act(() => clock.advance(5000)) // no pump: nothing reanchors while paused

    let anchor: number | undefined
    act(() => {
      anchor = result.current.play()
    })

    // True anchor: resuming from tick 672 at clock 5700 anchors tick 0 to
    // 5700 - 700 = 5000. A mutant that returns `clock.now()` (5700) fails this.
    expect(anchor).toBe(5000)
  })

  it('rewindToTop() leaves the position at tick 0, in one synchronous call with no commit in between', () => {
    const clock = new FakeClock()
    const manual = manualDriver()
    const loop = measureRange(C_MAJOR_SCALE_RH, 1, 1) // second measure
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { loop, frameDriver: manual.driver }),
    })
    act(() => result.current.play())
    act(() => {
      clock.advance(700) // well off tick 0
      manual.pump()
    })
    expect(result.current.position).not.toEqual({ measureNumber: 1, beat: 1, beatsPerMeasure: 4 })

    act(() => result.current.rewindToTop())

    // A single call, synchronous: no `act`-flushed effect had to run for the
    // position to already read tick 0 here.
    expect(result.current.position).toEqual({ measureNumber: 1, beat: 1, beatsPerMeasure: 4 })
    expect(result.current.phase).toBe('stopped')
  })

  it('rewindToTop() silences whatever is sounding, instead of leaving it to drone', () => {
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

    act(() => result.current.rewindToTop())

    // Kills the mutant that drops the `allNotesOff()` panic from `rewindToTop`.
    expect(audio.calls.at(-1)).toMatchObject({ kind: 'allNotesOff' })
  })

  it('rewindToTop() resets wait mode, releasing whatever note it was parked on', () => {
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

    act(() => result.current.rewindToTop())

    // Kills the mutant that drops the `waitController?.reset()` call from
    // `rewindToTop`: the controller would still think it is parked on C4.
    expect(result.current.wait?.requiredNotes).toEqual([])
  })

  it('rewindToTop() clears the loop on the transport itself, not just the store value', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const loop = measureRange(C_MAJOR_SCALE_RH, 0, 0) // first measure only: C4 D4 E4 F4
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { loop, audioOutput: audio, frameDriver: manual.driver }),
    })

    act(() => result.current.rewindToTop())
    act(() => result.current.play())
    act(() => {
      clock.advance(2500) // past measure 1 (2000ms) into measure 2, if the loop is truly gone
      manual.pump()
    })

    // Kills the mutant that calls `transport.stop()` without first calling
    // `transport.setLoop(null)` (or omits the clear altogether): the OLD loop
    // (measure 1 only) would still be armed on the transport, so playback
    // would wrap back to C4 at 2000ms and G4 (measure 2) would never sound.
    expect(audio.playedNotes).toContain(67) // G4, measure 2
  })

  it('playLoop(range) leaves the position AT range.startTick, not 0 and not wherever it was', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const range = measureRange(C_MAJOR_SCALE_RH, 1, 1) // second measure: G4 A4 B4 C5
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { audioOutput: audio, frameDriver: manual.driver }),
    })
    // Start somewhere else first, so landing on range.startTick could only
    // happen because playLoop actually seeked there.
    act(() => result.current.play())
    act(() => {
      clock.advance(200)
      manual.pump()
    })
    expect(result.current.position).toEqual({ measureNumber: 1, beat: 1, beatsPerMeasure: 4 })

    act(() => result.current.playLoop(range))

    // Kills the mutant that sets the loop and plays without seeking (the
    // roadmap 2.11a defect): position would stay at measure 1 instead of
    // jumping into measure 2.
    expect(result.current.position).toEqual({ measureNumber: 2, beat: 1, beatsPerMeasure: 4 })
    expect(result.current.phase).toBe('playing')

    act(() => {
      clock.advance(50)
      manual.pump()
    })
    // The very first note heard after playLoop is the loop's own first note,
    // not a leftover from wherever the playhead used to be.
    expect(audio.playedNotes.at(-1)).toBe(67) // G4
  })

  it('playLoop(range) returns the anchor the transport actually used, under FakeClock', () => {
    const clock = new FakeClock()
    const range = measureRange(C_MAJOR_SCALE_RH, 1, 1)
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock),
    })
    clock.advance(9_999)

    let anchor: number | undefined
    act(() => {
      anchor = result.current.playLoop(range)
    })

    // The loop starts at measure 2 (tick 1920, 2000ms at 120bpm), so the
    // anchor is the instant tick 0 WOULD have sounded — 2000ms before this
    // seeked-and-playing position, not `clock.now()` itself. Kills the
    // mutant that returns `clock.now()` verbatim (a subtly wrong anchor:
    // every event in the run would be timed 2000ms early).
    expect(anchor).toBe(9_999 - 2_000)
  })

  it('moves the score cursor imperatively through the ref every frame, not through props or state', () => {
    const clock = new FakeClock()
    const audio = new RecordingAudioOutput(clock)
    const manual = manualDriver()
    const moveCursorTo = vi.fn()
    const scoreViewerRef: RefObject<ScoreViewerHandle | null> = {
      current: {
        moveCursorTo,
        setNoteColor: vi.fn(),
        clearNoteColors: vi.fn(),
        setNoteHidden: vi.fn(),
        clearHiddenNotes: vi.fn(),
      },
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

  it('a frame that runs after the transport has already stopped does not move the cursor to the rewound tick', () => {
    // Reproduces the roadmap-2.14 replay race: a sibling `useTransportLoop`
    // subscriber (in production, `useRecorder`'s replay-end path) calls this
    // engine's `stop()` synchronously, and THIS already-scheduled frame then
    // runs in the SAME animation frame, before React has re-rendered and
    // torn the pump down. Calling `stop()` and pumping inside the same `act`
    // reproduces exactly that ordering: `manual.pump()` still invokes the
    // closure captured while `active` was true, exactly as an already-queued
    // rAF callback would in the browser.
    //
    // Kills the mutant that deletes the `transport.state !== 'playing' &&
    // transport.state !== 'waiting'` guard at the top of `onFrame`: without
    // it, `moveCursorTo` is called with the just-rewound tick 0.
    const clock = new FakeClock()
    const manual = manualDriver()
    const moveCursorTo = vi.fn()
    const scoreViewerRef: RefObject<ScoreViewerHandle | null> = {
      current: {
        moveCursorTo,
        setNoteColor: vi.fn(),
        clearNoteColors: vi.fn(),
        setNoteHidden: vi.fn(),
        clearHiddenNotes: vi.fn(),
      },
    }
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { frameDriver: manual.driver, scoreViewerRef }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(700)
      manual.pump()
    })
    expect(result.current.position).not.toEqual({ measureNumber: 1, beat: 1, beatsPerMeasure: 4 })
    moveCursorTo.mockClear()

    act(() => {
      result.current.stop()
      manual.pump()
    })

    expect(moveCursorTo).not.toHaveBeenCalled()
  })

  it('stop() returns undefined with no score', () => {
    const clock = new FakeClock()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { score: undefined }),
    })

    let target: { measureIndex: number; tick: number } | undefined
    act(() => {
      target = result.current.stop()
    })

    expect(target).toBeUndefined()
  })

  it('stop() returns measureIndex 0 / tick 0 after the transport has advanced into a later measure', () => {
    const clock = new FakeClock()
    const manual = manualDriver()
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { frameDriver: manual.driver }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(2500) // well into measure 2 of C_MAJOR_SCALE_RH
      manual.pump()
    })
    expect(result.current.position?.measureNumber).toBeGreaterThan(1)

    let target: { measureIndex: number; tick: number } | undefined
    act(() => {
      target = result.current.stop()
    })

    // `Transport.stop()` with no loop rewinds to tick 0, measure index 0 —
    // kills a mutant that reports the PRE-stop position instead of reading
    // `transport.currentMeasure`/`positionTicks` AFTER `stop()` ran.
    expect(target).toEqual({ measureIndex: 0, tick: 0 })
  })

  it("stop() returns the loop's start when a loop is armed — Transport.stop() rewinds to loopRange.startTick, not 0", () => {
    const clock = new FakeClock()
    const manual = manualDriver()
    const loop = measureRange(C_MAJOR_SCALE_RH, 1, 1) // second measure: tick 1920
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { loop, frameDriver: manual.driver }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(2200) // into the loop, off its start tick
      manual.pump()
    })

    let target: { measureIndex: number; tick: number } | undefined
    act(() => {
      target = result.current.stop()
    })

    expect(target).toEqual({ measureIndex: 1, tick: loop.startTick })
  })

  it("a stop this frame's OWN tick() causes (reaching the end of the piece) still reports the final position", () => {
    // The guard above reads `transport.state` ONCE, before this frame's own
    // `tick()` — so a stop this very pump causes by reaching the end of the
    // score must still move the cursor to the final position. Kills a
    // mutant that widens the guard to check `transport.state` AFTER `tick()`
    // instead of before, which would wrongly swallow this legitimate frame.
    const clock = new FakeClock()
    const manual = manualDriver()
    const moveCursorTo = vi.fn()
    const scoreViewerRef: RefObject<ScoreViewerHandle | null> = {
      current: {
        moveCursorTo,
        setNoteColor: vi.fn(),
        clearNoteColors: vi.fn(),
        setNoteHidden: vi.fn(),
        clearHiddenNotes: vi.fn(),
      },
    }
    const { result } = renderHook((p: PracticeEngineOptions) => usePracticeEngine(p), {
      initialProps: makeOptions(clock, { frameDriver: manual.driver, scoreViewerRef }),
    })

    act(() => result.current.play())
    act(() => {
      clock.advance(10_000) // well past the end of C_MAJOR_SCALE_RH
      manual.pump()
    })

    expect(result.current.phase).toBe('stopped')
    expect(moveCursorTo).toHaveBeenCalled()
  })
})
