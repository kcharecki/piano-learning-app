/**
 * REQ-3.3.2 wiring: before this hook existed, nothing connected MIDI input to
 * the matcher and nothing coloured the score — `grep -rn "matcher" src/app`
 * returned nothing. Every test here drives the hook exactly the way
 * `usePracticeEngine` and a real `MidiInput` would: intercept `moveCursorTo`
 * through `cursorRef` (the imperative cursor path, never props/state) and
 * `emit` MIDI events through `FakeMidiInput`.
 *
 * `renderHook` is always given `initialProps` computed ONCE outside the
 * render callback (as `usePracticeEngine.test.ts` does) rather than building
 * options inline — building a fresh `Score` object on every render would
 * change `options.score`'s identity on every internal state update and
 * retrigger the "rebuild the matcher" effect, wiping the very verdicts a test
 * just asserted on.
 */
import type { ScoreViewerHandle } from '@app/score/ScoreViewer.tsx'
import { makeScore, type Score } from '@core/notation/score.ts'
import { midi, millis } from '@core/shared/units.ts'
import { act, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput } from '@test/fakes.ts'
import type { RefObject } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useNoteFeedback, type NoteFeedbackOptions } from './useNoteFeedback.ts'

const CORRECT_COLOR = '#4caf50'
const WRONG_PITCH_COLOR = '#ef5350'
const MISSED_COLOR = '#ffb300'

/** Three quarter notes, right hand, 120 bpm: C4@0ms, D4@500ms, E4@1000ms. */
function testScore(): Score {
  return makeScore({
    id: 'note-feedback-test',
    measures: [{}],
    notes: [
      { midi: 60, startTick: 0, durationTicks: 480, hand: 'right' },
      { midi: 62, startTick: 480, durationTicks: 480, hand: 'right' },
      { midi: 64, startTick: 960, durationTicks: 480, hand: 'right' },
    ],
  })
}

type FakeHandle = ScoreViewerHandle & {
  readonly moveCursorTo: ReturnType<typeof vi.fn>
  readonly setNoteColor: ReturnType<typeof vi.fn>
  readonly clearNoteColors: ReturnType<typeof vi.fn>
}

function fakeScoreViewerRef(): RefObject<ScoreViewerHandle | null> & { current: FakeHandle } {
  return {
    current: {
      moveCursorTo: vi.fn(),
      setNoteColor: vi.fn(),
      clearNoteColors: vi.fn(),
    },
  }
}

function makeOptions(overrides: Partial<NoteFeedbackOptions> = {}): NoteFeedbackOptions {
  return {
    score: testScore(),
    activeHands: ['left', 'right'],
    midiInput: undefined,
    clock: new FakeClock(),
    scoreViewerRef: fakeScoreViewerRef(),
    ...overrides,
  }
}

function setup(overrides: Partial<NoteFeedbackOptions> = {}) {
  const options = makeOptions(overrides)
  const { result } = renderHook((p: NoteFeedbackOptions) => useNoteFeedback(p), {
    initialProps: options,
  })
  return {
    result,
    ...options,
    scoreViewerRef: options.scoreViewerRef as ReturnType<typeof fakeScoreViewerRef>,
  }
}

describe('useNoteFeedback', () => {
  it('colours a correctly played note green and counts it in the summary', () => {
    const midiInput = new FakeMidiInput()
    const { result, scoreViewerRef } = setup({ midiInput })

    // Prime the anchor at tick 0 — the cursor's very first frame.
    act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))

    expect(scoreViewerRef.current.setNoteColor).toHaveBeenCalledWith('m0.r.0.60', CORRECT_COLOR)
    expect(result.current.summary.correct).toBe(1)
    expect(result.current.summary.accuracy).toBe(1)
  })

  it('colours a wrong-pitch press red and charges it to the note that was due', () => {
    const midiInput = new FakeMidiInput()
    const { result, scoreViewerRef } = setup({ midiInput })

    act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
    // C4 (60) was due; the learner played C#4 (61) instead.
    act(() => midiInput.emit({ type: 'noteOn', note: midi(61), velocity: 80, time: millis(0) }))

    expect(scoreViewerRef.current.setNoteColor).toHaveBeenCalledWith('m0.r.0.60', WRONG_PITCH_COLOR)
    expect(result.current.summary.wrongPitch).toBe(1)
    expect(result.current.summary.accuracy).toBe(0)
  })

  it('colours a missed note amber once its window closes, with no key press', () => {
    const { result, scoreViewerRef } = setup()

    // Tick 200 -> 208.3ms, past C4's window (0ms + 150ms tolerance).
    act(() => result.current.cursorRef.current?.moveCursorTo(0, 200))

    expect(scoreViewerRef.current.setNoteColor).toHaveBeenCalledWith('m0.r.0.60', MISSED_COLOR)
    expect(result.current.summary.missed).toBe(1)
  })

  it('forwards every moveCursorTo call to the real ScoreViewer handle, unchanged', () => {
    const { result, scoreViewerRef } = setup()

    act(() => result.current.cursorRef.current?.moveCursorTo(2, 555))

    expect(scoreViewerRef.current.moveCursorTo).toHaveBeenCalledWith(2, 555)
  })

  it('clear() forgets every verdict and clears the score colouring — REQ-3.3.2 on stop', () => {
    const midiInput = new FakeMidiInput()
    const { result, scoreViewerRef } = setup({ midiInput })

    act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    expect(result.current.summary.correct).toBe(1)

    act(() => result.current.clear())

    expect(scoreViewerRef.current.clearNoteColors).toHaveBeenCalled()
    expect(result.current.summary).toEqual({
      correct: 0,
      wrongPitch: 0,
      missed: 0,
      extra: 0,
      accuracy: 1,
      meanAbsDeviationMs: 0,
    })

    // The matcher itself was reset, not just the display: the same note can be
    // judged correct again after a stop, exactly as a fresh pass should allow.
    act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    expect(result.current.summary.correct).toBe(1)
  })

  it('clears the colouring and resets the matcher on a loop wrap (a backward tick jump)', () => {
    const midiInput = new FakeMidiInput()
    const { result, scoreViewerRef } = setup({ midiInput })

    act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    expect(result.current.summary.correct).toBe(1)

    // Ordinary forward progress first, so the wrap below is an actual regression.
    act(() => result.current.cursorRef.current?.moveCursorTo(0, 960))
    scoreViewerRef.current.clearNoteColors.mockClear()

    // The transport wrapped back to tick 0 — a backward jump.
    act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))

    expect(scoreViewerRef.current.clearNoteColors).toHaveBeenCalled()
    expect(result.current.summary.correct).toBe(0)

    // C4 is matchable again after the wrap.
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    expect(result.current.summary.correct).toBe(1)
  })

  it('does not judge a MIDI press before the cursor has advanced even once', () => {
    const midiInput = new FakeMidiInput()
    const { result, scoreViewerRef } = setup({ midiInput })

    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))

    expect(scoreViewerRef.current.setNoteColor).not.toHaveBeenCalled()
    expect(result.current.summary.correct).toBe(0)
  })

  it('a press on a muted hand produces no verdict at all', () => {
    const midiInput = new FakeMidiInput()
    const { result, scoreViewerRef } = setup({ midiInput, activeHands: ['left'] })

    act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))

    expect(scoreViewerRef.current.setNoteColor).not.toHaveBeenCalled()
    expect(result.current.summary.correct).toBe(0)
    expect(result.current.summary.extra).toBe(0)
  })
})
