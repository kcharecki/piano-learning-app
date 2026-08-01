/**
 * The trainer's own state machine wiring (roadmap 2.12, REQ-3.4.1/3/4/6):
 * generating an exercise, the preview discipline (timeout AND early skip),
 * grading a played-through run with no shadowing audio, and adapting the
 * level from the store's history. Per-hook-dependency behaviour
 * (`usePracticeEngine`, `useAssessment`) already has its own suite — this
 * only asserts THIS hook wires them together correctly.
 */
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { seededRng } from '@core/ports/rng.ts'
import { act, cleanup, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import {
  useSightReadingTrainer,
  type UseSightReadingTrainerOptions,
} from './useSightReadingTrainer.ts'

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

function resetStore(): void {
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  resetStore()
})

/**
 * `seededRng(42)` at level 1 deterministically draws the untransposed level-1
 * default params (verified against `nextExerciseParams`/`generateMelody`
 * directly) — a 4-bar, right-hand-only, 120bpm C major exercise ending at
 * tick 7680, i.e. 8000ms of play. Re-derived here as a constant instead of a
 * magic number so a change to the generator's own weighting shows up as a
 * loud, obvious test failure rather than a silently wrong wait time.
 */
const SEEDED_SCORE_ID = 'generated:C major:4b:4-4:whole-half:right:unison'
const SEEDED_SCORE_DURATION_MS = 8_000

function setup(overrides: Partial<UseSightReadingTrainerOptions> = {}) {
  const clock = new FakeClock()
  const audio = new RecordingAudioOutput(clock)
  const manual = manualDriver()
  const options: UseSightReadingTrainerOptions = {
    clock,
    date: clock,
    audioOutput: audio,
    midiInput: new FakeMidiInput(),
    frameDriver: manual.driver,
    rng: seededRng(42),
    ...overrides,
  }
  const { result } = renderHook(() => useSightReadingTrainer(options))
  return { result, clock, audio, manual, options }
}

describe('useSightReadingTrainer — generating an exercise', () => {
  it('starts idle, with nothing generated', () => {
    const { result } = setup()
    expect(result.current.phase).toBe('idle')
    expect(result.current.score).toBeUndefined()
    expect(result.current.level).toBe(MIN_LEVEL)
  })

  it('start() draws a fresh exercise at the current level and begins the preview', () => {
    const { result } = setup()

    act(() => result.current.start())

    expect(result.current.phase).toBe('preview')
    expect(result.current.score?.id).toBe(SEEDED_SCORE_ID)
    expect(result.current.activeHands).toEqual(['right'])
    expect(result.current.previewRemainingMs).toBe(30_000)
    expect(result.current.error).toBeUndefined()
  })
})

describe('useSightReadingTrainer — the preview discipline (REQ-3.4.4)', () => {
  it('counts the preview down and moves to playing on its own once the timer runs out', () => {
    const { result, clock, manual } = setup()
    act(() => result.current.start())

    act(() => {
      clock.advance(12_000)
      manual.pump()
    })
    expect(result.current.phase).toBe('preview')
    expect(result.current.previewRemainingMs).toBe(18_000)

    act(() => {
      clock.advance(18_000)
      manual.pump()
    })
    expect(result.current.phase).toBe('playing')
    expect(result.current.previewRemainingMs).toBe(0)
  })

  it('skipPreview ends the preview immediately, without waiting for the timer', () => {
    const { result } = setup()
    act(() => result.current.start())

    act(() => result.current.skipPreview())

    expect(result.current.phase).toBe('playing')
    expect(result.current.previewRemainingMs).toBe(0)
  })

  it('skipPreview is a no-op once the run has already begun', () => {
    const { result } = setup()
    act(() => result.current.start())
    act(() => result.current.skipPreview())

    expect(() => act(() => result.current.skipPreview())).not.toThrow()
    expect(result.current.phase).toBe('playing')
  })
})

describe('useSightReadingTrainer — playing the exercise (REQ-3.4.4)', () => {
  it('sounds only the metronome, never the exercise itself, while it plays', () => {
    const { result, clock, manual, audio } = setup()
    act(() => result.current.start())
    act(() => result.current.skipPreview())

    act(() => {
      clock.advance(2_000)
      manual.pump()
    })

    expect(audio.playedNotes).toEqual([])
    expect(audio.clicks.length).toBeGreaterThan(0)
  })

  it('finishes the run at the end of the piece, grades it, and retires it', () => {
    const { result, clock, manual } = setup()
    act(() => result.current.start())
    const score = result.current.score
    expect(score).toBeDefined()
    act(() => result.current.skipPreview())

    act(() => {
      clock.advance(SEEDED_SCORE_DURATION_MS + 500)
      manual.pump()
    })

    expect(result.current.phase).toBe('finished')
    expect(result.current.result).toBeDefined()
    expect(result.current.lastRecord?.pieceId).toBe(score?.id)
    expect(result.current.lastRecord?.level).toBe(MIN_LEVEL)

    const history = useSightReadingStore.getState().history
    expect(history).toHaveLength(1)
    expect(history[0]?.pieceId).toBe(score?.id)
  })

  it('does not move the level after a single run — adaptLevel needs a run of agreeing reads', () => {
    const { result, clock, manual } = setup()
    act(() => result.current.start())
    act(() => result.current.skipPreview())

    act(() => {
      clock.advance(SEEDED_SCORE_DURATION_MS + 500)
      manual.pump()
    })

    expect(result.current.level).toBe(MIN_LEVEL)
    expect(result.current.previousLevel).toBe(MIN_LEVEL)
  })

  it('starting the next exercise never redraws a retired piece', () => {
    const { result, clock, manual } = setup()
    act(() => result.current.start())
    const firstId = result.current.score?.id
    act(() => result.current.skipPreview())
    act(() => {
      clock.advance(SEEDED_SCORE_DURATION_MS + 500)
      manual.pump()
    })
    expect(result.current.phase).toBe('finished')

    act(() => result.current.start())

    expect(result.current.phase).toBe('preview')
    expect(result.current.score?.id).not.toBe(firstId)
  })
})
