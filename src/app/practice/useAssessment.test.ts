/**
 * Roadmap 2.11, REQ-3.3.4/3.3.5 — hook-level wiring for the end-of-run story.
 * `start()`'s effect on the transport (fixed tempo, no wait mode, no loop,
 * play from the top), the reduction of a finished run into a real
 * `AssessmentResult` via `assess()`, and — the requirement's own one-click
 * bar — `practiceLoop()` actually setting the transport's loop range and
 * starting playback are all driven end to end here, the way
 * `usePracticeEngine`'s `phase` and a real `FakeMidiInput` would drive them.
 */
import { buildTestScore } from '@test/fixtures.ts'
import { measureRange, type Score } from '@core/notation/score.ts'
import { at } from '@core/shared/invariant.ts'
import { midi, millis, QUARTER, WHOLE } from '@core/shared/units.ts'
import { suggestedTempoScale } from '@core/practice/review.ts'
import type { TransportState } from '@core/timing/transport.ts'
import { act, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput } from '@test/fakes.ts'
import { describe, expect, it, vi } from 'vitest'
import { useAssessment, type UseAssessmentOptions } from './useAssessment.ts'

/** One 4/4 bar, right hand, 120bpm: C4@0ms, D4@500ms, E4@1000ms. */
const FLAWLESS_SCORE: Score = buildTestScore(
  [
    { midi: 60, startTick: 0 },
    { midi: 62, startTick: QUARTER },
    { midi: 64, startTick: 2 * QUARTER },
  ],
  { id: 'assessment-hook-flawless', bpm: 120 },
)

/**
 * Two 4/4 bars at 120bpm: measure 0 spans [0, 2000)ms, measure 1 [2000, 4000)ms.
 *   measure 0: C4 (0ms), D4 (500ms)
 *   measure 1: E4 (2000ms), F4 (2500ms)
 */
const TWO_MEASURE_SCORE: Score = buildTestScore(
  [
    { midi: 60, startTick: 0 },
    { midi: 62, startTick: QUARTER },
    { midi: 64, startTick: WHOLE },
    { midi: 65, startTick: WHOLE + QUARTER },
  ],
  { id: 'assessment-hook-two-measures', bpm: 120 },
)

function makeOptions(
  score: Score | undefined,
  overrides: Partial<UseAssessmentOptions> = {},
): UseAssessmentOptions {
  // Every test uses the same FakeClock for both `clock` and `date` — like
  // `assessment.test.ts`'s own `dateAt` helper, since `FakeClock` implements both ports.
  const clock = new FakeClock()
  return {
    score,
    activeHands: ['left', 'right'],
    midiInput: undefined,
    clock,
    date: clock,
    phase: 'stopped',
    play: vi.fn(),
    rewindToTop: vi.fn(),
    playLoop: vi.fn(),
    setTempoScale: vi.fn(),
    setWaitModeEnabled: vi.fn(),
    setLoop: vi.fn(),
    ...overrides,
  }
}

function setup(score: Score | undefined, overrides: Partial<UseAssessmentOptions> = {}) {
  const options = makeOptions(score, overrides)
  const { result, rerender } = renderHook((p: UseAssessmentOptions) => useAssessment(p), {
    initialProps: options,
  })
  return { result, rerender, options }
}

/** `rerender` needs a whole new props object; this keeps the mocks intact while changing `phase`. */
function withPhase(options: UseAssessmentOptions, phase: TransportState): UseAssessmentOptions {
  return { ...options, phase }
}

describe('useAssessment — start()', () => {
  it('forces fixed tempo, no wait mode, no loop, and plays from the top', () => {
    const { result, options } = setup(FLAWLESS_SCORE)

    act(() => result.current.start())

    expect(options.setWaitModeEnabled).toHaveBeenCalledWith(false)
    expect(options.setLoop).toHaveBeenCalledWith(undefined)
    expect(options.setTempoScale).toHaveBeenCalledWith(1)
    expect(options.play).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('running')
    expect(result.current.result).toBeUndefined()
  })

  it('does nothing without a loaded score', () => {
    const { result, options } = setup(undefined)

    act(() => result.current.start())

    expect(options.play).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('idle')
  })

  it('does nothing if a run is already in progress', () => {
    const { result, options } = setup(FLAWLESS_SCORE)

    act(() => result.current.start())
    act(() => result.current.start())

    expect(options.play).toHaveBeenCalledTimes(1)
  })

  it('rewinds an already-playing transport with rewindToTop() before play(), producing the same result as starting from stopped', () => {
    // A fresh reference run, started the ordinary way (phase already 'stopped').
    const referenceMidi = new FakeMidiInput()
    const reference = setup(FLAWLESS_SCORE, { midiInput: referenceMidi })
    act(() => reference.result.current.start())
    reference.rerender(withPhase(reference.options, 'playing'))
    act(() => referenceMidi.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    act(() => referenceMidi.emit({ type: 'noteOn', note: midi(62), velocity: 80, time: millis(500) }))
    act(() => referenceMidi.emit({ type: 'noteOn', note: midi(64), velocity: 80, time: millis(1000) }))
    reference.rerender(withPhase(reference.options, 'stopped'))
    const expected = reference.result.current.result
    expect(expected).not.toBeUndefined()

    // The "Start assessment" button is enabled while the transport is already
    // playing (AssessmentPanel disables it only for phase === 'running') — so
    // `start()` is invoked with the transport mid-piece, phase 'playing'.
    const midPlaybackMidi = new FakeMidiInput()
    const midPlayback = setup(FLAWLESS_SCORE, { midiInput: midPlaybackMidi, phase: 'playing' })

    act(() => midPlayback.result.current.start())

    // Kills the mutant that drops the `rewindToTop()` call, or that calls it
    // after `play()` instead of before.
    expect(midPlayback.options.rewindToTop).toHaveBeenCalledTimes(1)
    const stopOrder = vi.mocked(midPlayback.options.rewindToTop).mock.invocationCallOrder[0]
    const playOrder = vi.mocked(midPlayback.options.play).mock.invocationCallOrder[0]
    expect(stopOrder).toBeDefined()
    expect(playOrder).toBeDefined()
    expect(stopOrder as number).toBeLessThan(playOrder as number)

    // React 18 batches `start()`'s own `rewindToTop()` + `play()` into a
    // single commit, so the phase prop goes 'playing' -> 'playing' with no
    // intervening 'stopped' commit — this is the only sequence real batching
    // can produce (see the module comment's "Detecting the run's end").
    midPlayback.rerender(withPhase(midPlayback.options, 'playing'))
    act(() => midPlaybackMidi.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    act(() => midPlaybackMidi.emit({ type: 'noteOn', note: midi(62), velocity: 80, time: millis(500) }))
    act(() => midPlaybackMidi.emit({ type: 'noteOn', note: midi(64), velocity: 80, time: millis(1000) }))
    midPlayback.rerender(withPhase(midPlayback.options, 'stopped'))

    // NOTE: this does NOT prove the anchor is taken from `play()`'s return
    // value rather than a guessed `clock.now()` — `play` here is the default
    // mock (`vi.fn()`, returns `undefined`), so `start()` falls back to
    // `clock.now()`, and `FakeClock` never advances in this file, so
    // `anchorMs` is 0 in both runs either way. It only proves the run still
    // finalizes into a correct result after the extra `rewindToTop()` call,
    // i.e. that the note events line up the same way. The dedicated anchor
    // test below ("uses the anchor play() returned...") is what actually
    // exercises `play()`'s return value.
    expect(midPlayback.result.current.result).toEqual(expected)
  })
})

// The old "a 'stopped' phase arriving before the run was ever seen playing
// does not finalize" test is gone: it simulated `start()`'s own rewind
// `stop()` committing as a separate, observable 'stopped' phase before
// `play()` — a sequence React 18's batching of `start()`'s `stop()` + `play()`
// into one commit never actually produces (see the "rewinds an already-
// playing transport" test above, and the module comment's "Detecting the
// run's end"). `sawPlaying` is now armed synchronously in `start()` itself
// rather than inferred from a later 'playing' sighting, so there is no
// window in which a genuine 'stopped' commit should be ignored.

describe('useAssessment — reducing a finished run', () => {
  it('turns a flawless pass into a perfect AssessmentResult with no problem measures', () => {
    const midiInput = new FakeMidiInput()
    const { result, rerender, options } = setup(FLAWLESS_SCORE, { midiInput })

    act(() => result.current.start())
    rerender(withPhase(options, 'playing'))

    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(62), velocity: 80, time: millis(500) }))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(64), velocity: 80, time: millis(1000) }))

    // The transport plays off the end of the score — REQ-3.3.4's run
    // finishing. Kills the mutant that never arms `sawPlaying` in `start()`
    // (which would make this normal path never finalize).
    rerender(withPhase(options, 'stopped'))

    expect(result.current.phase).toBe('complete')
    expect(result.current.result?.accuracy).toBe(1)
    expect(result.current.result?.timingConsistency).toBe(1)
    expect(result.current.result?.counts).toEqual({
      correct: 3,
      wrongPitch: 0,
      missed: 0,
      extra: 0,
    })
    expect(result.current.problems).toEqual([])
    expect(result.current.loops).toEqual([])
  })

  it('counts a note nobody pressed as missed, closing the window at the end of the run', () => {
    const midiInput = new FakeMidiInput()
    const { result, rerender, options } = setup(FLAWLESS_SCORE, { midiInput })

    act(() => result.current.start())
    rerender(withPhase(options, 'playing'))
    // Only C4 is played; D4 and E4 are left silent.
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    rerender(withPhase(options, 'stopped'))

    expect(result.current.result?.counts).toEqual({
      correct: 1,
      wrongPitch: 0,
      missed: 2,
      extra: 0,
    })
  })

  it('resets to idle, clearing any run or result, when the score changes', () => {
    const midiInput = new FakeMidiInput()
    const { result, rerender, options } = setup(FLAWLESS_SCORE, { midiInput })

    act(() => result.current.start())
    rerender(withPhase(options, 'playing'))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    rerender(withPhase(options, 'stopped'))
    expect(result.current.phase).toBe('complete')

    const otherScore = buildTestScore([{ midi: 60, startTick: 0 }], { id: 'a-different-score' })
    rerender({ ...withPhase(options, 'stopped'), score: otherScore })

    expect(result.current.phase).toBe('idle')
    expect(result.current.result).toBeUndefined()
  })
})

describe('useAssessment — practiceLoop() (REQ-3.3.5, the one-click path)', () => {
  it('sets the transport loop to the suggestion, slows to the suggested tempo, and plays', () => {
    const midiInput = new FakeMidiInput()
    const { result, rerender, options } = setup(TWO_MEASURE_SCORE, { midiInput })

    act(() => result.current.start())
    rerender(withPhase(options, 'playing'))

    // C4 correct; D4 left silent (missed); E4 played as F#4 (wrongPitch); F4 correct.
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(66), velocity: 80, time: millis(2000) }))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(65), velocity: 80, time: millis(2500) }))
    rerender(withPhase(options, 'stopped'))

    expect(result.current.result?.counts).toEqual({
      correct: 2,
      wrongPitch: 1,
      missed: 1,
      extra: 0,
    })
    expect(result.current.problems.map((p) => p.measureIndex)).toEqual([0, 1])
    expect(result.current.loops).toHaveLength(1)
    const loop = at(result.current.loops, 0)
    expect(loop.startMeasure).toBe(0)
    expect(loop.endMeasure).toBe(1)

    const finalResult = result.current.result
    if (finalResult === undefined) throw new Error('expected a completed AssessmentResult')

    act(() => result.current.practiceLoop(loop))

    // `setLoop` on the store must STILL be called — the Loop Range control
    // reads the store, not the transport (see e2e/assessment.spec.ts) — in
    // addition to, not instead of, the new imperative `playLoop`.
    expect(options.setLoop).toHaveBeenLastCalledWith(measureRange(TWO_MEASURE_SCORE, 0, 1))
    expect(options.setTempoScale).toHaveBeenLastCalledWith(suggestedTempoScale(finalResult))
    // A slower loop for THIS run must not be the "no change" scale a flawless run gets.
    expect(suggestedTempoScale(finalResult)).toBeLessThan(1)
    expect(options.play).toHaveBeenCalledTimes(1) // only from start()
    // The one-click path plays through the atomic `playLoop` primitive, not
    // the plain `play()` — that is what actually seeks into the loop
    // (REQ-3.3.5); kills the mutant that calls `play()` here instead.
    expect(options.playLoop).toHaveBeenCalledTimes(1)
    expect(options.playLoop).toHaveBeenLastCalledWith(measureRange(TWO_MEASURE_SCORE, 0, 1))
  })

  it('is a no-op before any assessment has completed', () => {
    const { result, options } = setup(FLAWLESS_SCORE)

    act(() =>
      result.current.practiceLoop({ startMeasure: 0, endMeasure: 0, reason: 'measure 0: timing' }),
    )

    expect(options.setLoop).not.toHaveBeenCalled()
    expect(options.setTempoScale).not.toHaveBeenCalled()
    expect(options.play).not.toHaveBeenCalled()
    expect(options.playLoop).not.toHaveBeenCalled()
  })
})

describe('useAssessment — start() uses the anchor play() returned, not its own clock.now()', () => {
  it('scores a note played exactly on time as correct, even though clock.now() moves between the true anchor and when start() returns', () => {
    // `play()` is stubbed to behave like the real `usePracticeEngine.play()`
    // firing at the CURRENT instant (the true anchor, captured first) and then
    // — standing in for whatever runs between the transport re-anchoring and
    // `start()`'s own trailing statements returning control, e.g. the commit
    // usePracticeEngine.play() doesn't actually wait on but a real scheduler
    // might — the clock moves on another 300ms before `start()` is done. Any
    // code that reads `clock.now()` AFTER calling `play()`, instead of using
    // the value `play()` itself returned, reads that later 300ms instant
    // instead of the true anchor.
    const clock = new FakeClock()
    const midiInput = new FakeMidiInput()
    const play = vi.fn(() => {
      const trueAnchor = clock.now() // 0 — this is the instant tick 0 really anchored to
      clock.advance(300) // time visibly moves on after the anchor was fixed
      return trueAnchor
    })
    const { result, rerender, options } = setup(FLAWLESS_SCORE, { midiInput, clock, date: clock, play })

    act(() => result.current.start())
    rerender(withPhase(options, 'playing'))

    // C4/D4/E4 are written at 0/500/1000ms. Timed against the TRUE anchor (0)
    // they arrive exactly on the beat; timed against the wrong, later anchor
    // (300, what a `clock.now()`-after-`play()` mutant would use) every one of
    // them would look like it arrived 300ms EARLY.
    act(() => midiInput.emit({ type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) }))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(62), velocity: 80, time: millis(500) }))
    act(() => midiInput.emit({ type: 'noteOn', note: midi(64), velocity: 80, time: millis(1000) }))
    rerender(withPhase(options, 'stopped'))

    // Kills the mutant that reads `optionsRef.current.clock.now()` instead of
    // using `play()`'s return value (defect (b)): that mutant's anchorMs would
    // be 300, not 0, so every note here would score 300ms early — well outside
    // the matcher's tolerance — instead of `correct`.
    expect(result.current.result?.counts).toEqual({
      correct: 3,
      wrongPitch: 0,
      missed: 0,
      extra: 0,
    })
  })
})
