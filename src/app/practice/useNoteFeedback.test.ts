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
import { makeScore, type Hand, type Score } from '@core/notation/score.ts'
import { at } from '@core/shared/invariant.ts'
import { midi, millis, ticks } from '@core/shared/units.ts'
import { act, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput } from '@test/fakes.ts'
import type { RefObject } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useNoteFeedback, type NoteFeedbackOptions } from './useNoteFeedback.ts'
import { usePracticeEngine } from './usePracticeEngine.ts'
import type { FrameDriver } from './useTransportLoop.ts'

/** Same shape as `usePracticeEngine.test.ts`'s helper: a manually-pumped `FrameDriver`. */
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

const CORRECT_COLOR = '#1c7c3c'
const WRONG_PITCH_COLOR = '#c22f2c'
const MISSED_COLOR = '#666e78'

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
  readonly setNoteHidden: ReturnType<typeof vi.fn>
  readonly clearHiddenNotes: ReturnType<typeof vi.fn>
}

function fakeScoreViewerRef(): RefObject<ScoreViewerHandle | null> & { current: FakeHandle } {
  return {
    current: {
      moveCursorTo: vi.fn(),
      setNoteColor: vi.fn(),
      clearNoteColors: vi.fn(),
      setNoteHidden: vi.fn(),
      clearHiddenNotes: vi.fn(),
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

  it('a wrap into a mid-score loop does not report the notes before the loop start as missed', () => {
    // roadmap 1.22. Looping bar-half two (tick 480 onwards): the wrap restarts
    // the matcher AT tick 480, so C4 at tick 0 is retired silently. Before
    // `reset(fromTick)` existed this rewound to bar one and the very next
    // cursor move reported EVERY earlier note as missed, once per wrap.
    const { result, score, scoreViewerRef } = setup()
    const [c4, d4] = [at(score?.notes ?? [], 0), at(score?.notes ?? [], 1)]

    act(() => result.current.cursorRef.current?.moveCursorTo(0, 480))
    act(() => result.current.cursorRef.current?.moveCursorTo(0, 960))
    // The transport wrapped back to the loop start — a backward jump.
    act(() => result.current.cursorRef.current?.moveCursorTo(0, 480))
    expect(result.current.summary.missed).toBe(0)
    scoreViewerRef.current.setNoteColor.mockClear()

    // Play nothing and let the loop run to its end: only D4, inside the loop,
    // can be missed. C4 lies before the loop start and is no longer expected.
    act(() => result.current.cursorRef.current?.moveCursorTo(0, 960))

    expect(result.current.summary.missed).toBe(1)
    expect(scoreViewerRef.current.setNoteColor).toHaveBeenCalledWith(d4.id, MISSED_COLOR)
    expect(scoreViewerRef.current.setNoteColor).not.toHaveBeenCalledWith(c4.id, MISSED_COLOR)
  })

  it('does not judge a MIDI press before the cursor has advanced even once', () => {
    const midiInput = new FakeMidiInput()
    const { result, scoreViewerRef } = setup({ midiInput })

    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))

    expect(scoreViewerRef.current.setNoteColor).not.toHaveBeenCalled()
    expect(result.current.summary.correct).toBe(0)
  })

  describe('lastJudgement (roadmap 2.23, REQ-3.3.2 timing feedback)', () => {
    it('a late press produces a positive deviationMs and reports "late"', () => {
      const midiInput = new FakeMidiInput()
      const { result } = setup({ midiInput })

      act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
      // D4 is due at 500ms (tick 480, 120bpm); played 120ms behind it, still
      // inside the 150ms tolerance window.
      act(() => midiInput.emit({ type: 'noteOn', note: midi(62), velocity: 80, time: millis(620) }))

      expect(result.current.lastJudgement).toEqual({
        midi: midi(62),
        timing: 'late',
        deviationMs: 120,
        correct: true,
      })
    })

    it('an early press produces the mirror-image negative deviationMs and reports "early"', () => {
      const midiInput = new FakeMidiInput()
      const { result } = setup({ midiInput })

      act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
      // E4 is due at 1000ms (tick 960); played 120ms ahead of it.
      act(() => midiInput.emit({ type: 'noteOn', note: midi(64), velocity: 80, time: millis(880) }))

      expect(result.current.lastJudgement).toEqual({
        midi: midi(64),
        timing: 'early',
        deviationMs: -120,
        correct: true,
      })
    })

    it('a wrong-pitch press does not silently become an on-time correct one', () => {
      const midiInput = new FakeMidiInput()
      const { result } = setup({ midiInput })

      act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
      // C4 (60) was due, dead on time; the learner played C#4 (61) instead.
      act(() => midiInput.emit({ type: 'noteOn', note: midi(61), velocity: 80, time: millis(0) }))

      // The timing band alone says "on-time" — only `correct: false` proves this
      // was a wrong-pitch charge, not a clean hit that happened to land on time.
      expect(result.current.lastJudgement).toEqual({
        midi: midi(61),
        timing: 'on-time',
        deviationMs: 0,
        correct: false,
      })
    })

    it('is undefined before any press is judged', () => {
      const { result } = setup()
      expect(result.current.lastJudgement).toBeUndefined()
    })

    it('clear() forgets the last judgement along with the counters', () => {
      const midiInput = new FakeMidiInput()
      const { result } = setup({ midiInput })

      act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
      act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
      expect(result.current.lastJudgement).toBeDefined()

      act(() => result.current.clear())

      expect(result.current.lastJudgement).toBeUndefined()
    })

    it('clears on a loop wrap (a backward tick jump), exactly as the counters do', () => {
      const midiInput = new FakeMidiInput()
      const { result } = setup({ midiInput })

      act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
      act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
      expect(result.current.lastJudgement).toBeDefined()

      act(() => result.current.cursorRef.current?.moveCursorTo(0, 960))
      // The transport wrapped back to tick 0 — a backward jump.
      act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))

      expect(result.current.lastJudgement).toBeUndefined()
    })

    it('a missed note alone does not overwrite a prior judgement', () => {
      const midiInput = new FakeMidiInput()
      const { result } = setup({ midiInput })

      act(() => result.current.cursorRef.current?.moveCursorTo(0, 0))
      act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
      const afterCorrect = result.current.lastJudgement
      expect(afterCorrect).toBeDefined()

      // Advance well past D4's window with no press: only a `missed` verdict is
      // produced, which must leave the last attributed judgement untouched.
      act(() => result.current.cursorRef.current?.moveCursorTo(0, 700))

      expect(result.current.lastJudgement).toEqual(afterCorrect)
      expect(result.current.summary.missed).toBe(1)
    })
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

  // These two drive `cursorRef` through a REAL `usePracticeEngine`, wired to
  // this hook's `cursorRef` exactly as `PracticeScreen` wires them, instead of
  // hand-feeding ticks — so a fix to `usePracticeEngine.onFrame`'s stop-race
  // guard (roadmap: the record-replay counters race) that is scoped too
  // broadly, and swallows a legitimate backward tick along with the rewound
  // one, fails here even though it would pass every hand-fed-tick test above.
  describe('integration with the real usePracticeEngine (the stop-race guard must not be too broad)', () => {
    it('a genuine loop wrap while playing still resets the matcher, through the real engine', () => {
      const clock = new FakeClock()
      const score = testScore()
      const scoreViewerRef = fakeScoreViewerRef()
      const manual = manualDriver()
      const loop = { startTick: ticks(0), endTick: ticks(960) } // C4 and D4 only
      // Hoisted OUTSIDE the render callback, like `score`/`loop` above: a
      // fresh array literal on every render would defeat usePracticeEngine's
      // `filteredScore` memo and rebuild the transport on every render,
      // looping forever — see that hook's module comment.
      const activeHands: readonly Hand[] = ['right']
      const { result } = renderHook(() => {
        const feedback = useNoteFeedback({
          score,
          activeHands,
          midiInput: undefined,
          clock,
          scoreViewerRef,
        })
        const engine = usePracticeEngine({
          score,
          activeHands,
          tempoScale: 1,
          loop,
          metronomeEnabled: false,
          metronomeSubdivision: 1,
          waitModeEnabled: false,
          clock,
          audioOutput: undefined,
          midiInput: undefined,
          scoreViewerRef: feedback.cursorRef,
          frameDriver: manual.driver,
        })
        return { feedback, engine }
      })

      act(() => result.current.engine.play())
      act(() => manual.pump()) // anchors the matcher at tick 0

      act(() => {
        clock.advance(700) // past C4's (150ms) and D4's (650ms) windows: both missed
        manual.pump()
      })
      expect(result.current.feedback.summary.missed).toBe(2)

      act(() => {
        clock.advance(400) // crosses the loop end (960 ticks / 1000ms): a real wrap
        manual.pump()
      })

      // The wrap reported itself to useNoteFeedback as a real backward tick,
      // exactly as the hand-fed one above does — resetting the summary. The
      // transport's own `state` stays `'playing'` throughout a wrap, so the
      // stop-race guard in `onFrame` must not have suppressed this frame.
      expect(result.current.feedback.summary.missed).toBe(0)
    })

    it('a genuine seek backwards while playing (playLoop) still resets the matcher, through the real engine', () => {
      const clock = new FakeClock()
      const score = testScore()
      const scoreViewerRef = fakeScoreViewerRef()
      const manual = manualDriver()
      // See the comment on the identical line in the test above.
      const activeHands: readonly Hand[] = ['right']
      const { result } = renderHook(() => {
        const feedback = useNoteFeedback({
          score,
          activeHands,
          midiInput: undefined,
          clock,
          scoreViewerRef,
        })
        const engine = usePracticeEngine({
          score,
          activeHands,
          tempoScale: 1,
          loop: undefined,
          metronomeEnabled: false,
          metronomeSubdivision: 1,
          waitModeEnabled: false,
          clock,
          audioOutput: undefined,
          midiInput: undefined,
          scoreViewerRef: feedback.cursorRef,
          frameDriver: manual.driver,
        })
        return { feedback, engine }
      })

      act(() => result.current.engine.play())
      act(() => manual.pump())
      act(() => {
        clock.advance(700) // past C4's and D4's windows: both missed, nothing played
        manual.pump()
      })
      expect(result.current.feedback.summary.missed).toBe(2)

      // A seek backward WHILE the transport keeps running — `playLoop` seeks
      // to `range.startTick` and plays, atomically, on the SAME transport
      // instance; `Transport.state` never touches `'stopped'` here, unlike
      // `stop()`/`rewindToTop()`.
      act(() => result.current.engine.playLoop({ startTick: ticks(0), endTick: ticks(480) }))
      act(() => manual.pump())

      // The seek reported itself as a backward tick just like the loop wrap
      // above, proving the guard in `onFrame` is scoped to an
      // actually-stopped transport, not to "the tick decreased."
      expect(result.current.feedback.summary.missed).toBe(0)
    })
  })
})
