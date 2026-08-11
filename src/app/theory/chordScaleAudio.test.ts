/**
 * `chordScaleAudio.ts` (roadmap 3.15a) is the leaf module `ChordScaleReference.tsx`
 * and `ChordLookup.tsx` both import instead of each carrying its own copy.
 * These tests are the direct successor to the playback assertions that used
 * to live only in those two files' own test suites — exact pitches, exact
 * timestamps, a note-off per note-on, an audible velocity — proving the
 * extraction changed nothing about what a learner actually hears. See those
 * two files' own test suites for the end-to-end proof that the extracted
 * helpers are still actually wired up.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spell, toMidi } from '@core/theory/pitch.ts'
import { FakeClock, RecordingAudioOutput } from '@test/fakes.ts'
import type { RecordedAudioCall } from '@test/fakes.ts'
import {
  CHORD_DURATION_MS,
  noteLabel,
  PLAY_VELOCITY,
  playChordTones,
  playScaleAscending,
  ROOT_OPTIONS,
  SCALE_NOTE_DURATION_MS,
  SCALE_NOTE_SPACING_MS,
  stopRingingAudio,
  useSharedAudioOutput,
} from './chordScaleAudio.ts'

afterEach(cleanup)

function isNoteOn(c: RecordedAudioCall): c is Extract<RecordedAudioCall, { kind: 'noteOn' }> {
  return c.kind === 'noteOn'
}

describe('playScaleAscending', () => {
  it('sends every note ascending, spaced SCALE_NOTE_SPACING_MS apart, each with a note-off and an audible velocity', () => {
    const clock = new FakeClock(0)
    const audioOutput = new RecordingAudioOutput(clock)
    const notes = [spell('C', 0, 4), spell('D', 0, 4), spell('E', 0, 4)]

    playScaleAscending(audioOutput, notes)

    const noteOnCalls = audioOutput.calls.filter(isNoteOn)
    const noteOffCalls = audioOutput.calls.filter((c) => c.kind === 'noteOff')
    expect(noteOnCalls.map((c) => c.note)).toEqual(notes.map(toMidi))
    expect(noteOnCalls.map((c) => c.at)).toEqual(notes.map((_, i) => i * SCALE_NOTE_SPACING_MS))
    expect(noteOffCalls.map((c) => c.at)).toEqual(
      notes.map((_, i) => i * SCALE_NOTE_SPACING_MS + SCALE_NOTE_DURATION_MS),
    )
    for (const call of noteOnCalls) {
      expect(call.velocity).toBe(PLAY_VELOCITY)
      expect(call.velocity).toBeGreaterThan(0)
    }
  })

  it('panics (allNotesOff) before scheduling any note, so a second press restarts instead of stacking', () => {
    const clock = new FakeClock(0)
    const audioOutput = new RecordingAudioOutput(clock)
    playScaleAscending(audioOutput, [spell('C', 0, 4)])
    expect(audioOutput.calls[0]?.kind).toBe('allNotesOff')
  })
})

describe('playChordTones', () => {
  it('sends every tone at the exact same timestamp — a simultaneity, not an arpeggio — ringing for CHORD_DURATION_MS', () => {
    const clock = new FakeClock(0)
    const audioOutput = new RecordingAudioOutput(clock)
    const tones = [spell('C', 0, 4), spell('E', 0, 4), spell('G', 0, 4)]

    playChordTones(audioOutput, tones)

    const noteOnCalls = audioOutput.calls.filter(isNoteOn)
    const noteOffCalls = audioOutput.calls.filter((c) => c.kind === 'noteOff')
    expect(noteOnCalls.map((c) => c.note)).toEqual(tones.map(toMidi))
    const onTimestamps = new Set(noteOnCalls.map((c) => c.at))
    expect(onTimestamps.size).toBe(1)
    expect(noteOffCalls.map((c) => c.at)).toEqual(
      noteOnCalls.map(() => ([...onTimestamps][0] ?? 0) + CHORD_DURATION_MS),
    )
    for (const call of noteOnCalls) {
      expect(call.velocity).toBeGreaterThan(0)
    }
  })

  it('panics before scheduling, same discipline as playScaleAscending', () => {
    const clock = new FakeClock(0)
    const audioOutput = new RecordingAudioOutput(clock)
    playChordTones(audioOutput, [spell('C', 0, 4)])
    expect(audioOutput.calls[0]?.kind).toBe('allNotesOff')
  })
})

describe('ROOT_OPTIONS / noteLabel', () => {
  it('offers all twelve pitch classes, spelled the way a learner actually writes them — flat for Db/Eb/Ab/Bb, sharp for the rest', () => {
    expect(ROOT_OPTIONS).toHaveLength(12)
    const labels = ROOT_OPTIONS.map(noteLabel)
    expect(labels).toEqual(
      expect.arrayContaining(['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']),
    )
    expect(labels).not.toEqual(expect.arrayContaining(['C#', 'D#', 'Gb', 'G#', 'A#']))
  })

  it('noteLabel formats sharps and flats with no octave', () => {
    expect(noteLabel(spell('F', 1, 4))).toBe('F#')
    expect(noteLabel(spell('B', -1, 3))).toBe('Bb')
    expect(noteLabel(spell('C', 0, 5))).toBe('C')
  })
})

describe('useSharedAudioOutput / stopRingingAudio', () => {
  it('with an injected audioOutput, getAudioOutput always returns that exact instance, never building a real one', () => {
    const clock = new FakeClock(0)
    const injected = new RecordingAudioOutput(clock)
    const { result } = renderHook(() => useSharedAudioOutput(injected))
    expect(result.current.getAudioOutput()).toBe(injected)
    expect(result.current.getAudioOutput()).toBe(injected)
  })

  it('with no audioOutput, lazily builds a real output on first call and reuses it thereafter', () => {
    class FakeAudioContext {
      currentTime = 0
      readonly destination = {}
      createGain(): { connect: () => void } {
        return { connect: () => {} }
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    try {
      const { result } = renderHook(() => useSharedAudioOutput(undefined))
      const first = result.current.getAudioOutput()
      const second = result.current.getAudioOutput()
      expect(second).toBe(first)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('switches from a lazily-built real output to a later-injected one, rather than keeping the one it built for itself', () => {
    const clock = new FakeClock(0)
    const injected = new RecordingAudioOutput(clock)
    const { result, rerender } = renderHook<
      ReturnType<typeof useSharedAudioOutput>,
      { readonly audioOutput: RecordingAudioOutput | undefined }
    >(({ audioOutput }) => useSharedAudioOutput(audioOutput), {
      initialProps: { audioOutput: undefined },
    })
    expect(result.current.getAudioOutput()).not.toBe(injected)

    rerender({ audioOutput: injected })
    expect(result.current.getAudioOutput()).toBe(injected)
  })

  it('stopRingingAudio cancels the injected output when one is provided', () => {
    const clock = new FakeClock(0)
    const injected = new RecordingAudioOutput(clock)
    const { result } = renderHook(() => useSharedAudioOutput(injected))

    act(() => {
      stopRingingAudio(injected, result.current.audioRef)
    })

    expect(injected.calls).toHaveLength(1)
    expect(injected.calls[0]?.kind).toBe('allNotesOff')
  })

  it('stopRingingAudio cancels whatever the lazy ref already holds when no audioOutput is injected', () => {
    const clock = new FakeClock(0)
    const injected = new RecordingAudioOutput(clock)
    const { result } = renderHook(() => useSharedAudioOutput(undefined))

    // Nothing built yet — the ref is still empty, so this must not throw or
    // force-construct a real AudioContext.
    act(() => {
      stopRingingAudio(undefined, result.current.audioRef)
    })

    act(() => {
      result.current.audioRef.current = injected
    })
    act(() => {
      stopRingingAudio(undefined, result.current.audioRef)
    })
    expect(injected.calls).toHaveLength(1)
    expect(injected.calls[0]?.kind).toBe('allNotesOff')
  })
})
