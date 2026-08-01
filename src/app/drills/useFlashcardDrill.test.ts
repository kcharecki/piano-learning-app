/**
 * Flashcard drill wiring (roadmap 2.12, REQ-3.4.5): a card is drawn from the
 * real deck, answering it (on-screen or via a real MIDI press) grades it
 * through `core/drills/flashcards.ts` + `core/srs/scheduler.ts` and writes
 * the result into `flashcardStore`, and a new card follows. Grading and SRS
 * math themselves already have their own suites — this only asserts the
 * wiring between them.
 */
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { seededRng } from '@core/ports/rng.ts'
import { midi } from '@core/shared/units.ts'
import { act, cleanup, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useFlashcardDrill, type UseFlashcardDrillOptions } from './useFlashcardDrill.ts'

function resetStore(): void {
  useFlashcardStore.setState({ cardsById: {} })
}

beforeEach(resetStore)
afterEach(() => {
  cleanup()
  resetStore()
})

function setup(overrides: Partial<UseFlashcardDrillOptions> = {}) {
  const clock = new FakeClock()
  const midiInput = new FakeMidiInput()
  const options: UseFlashcardDrillOptions = {
    level: 1,
    clock,
    midiInput,
    rng: seededRng(7),
    ...overrides,
  }
  const { result, rerender } = renderHook((p: UseFlashcardDrillOptions) => useFlashcardDrill(p), {
    initialProps: options,
  })
  return { result, rerender, clock, midiInput, options }
}

describe('useFlashcardDrill — showing a card', () => {
  it('draws a staff-to-key card from level 1s note range (a 9th around middle C)', () => {
    const { result } = setup()

    expect(result.current.card).toBeDefined()
    expect(result.current.card?.kind).toBe('staff-to-key')
    expect(result.current.card?.prompt.midi).toBeGreaterThanOrEqual(56)
    expect(result.current.card?.prompt.midi).toBeLessThanOrEqual(64)
    expect(result.current.deckSize).toBe(9)
    expect(result.current.range).toEqual({ low: 56, high: 64 })
  })

  it('starts with no history, so retention stats are all zero', () => {
    const { result } = setup()
    expect(result.current.stats).toEqual({ total: 0, due: 0, young: 0, mature: 0, averageEase: 0 })
  })
})

describe('useFlashcardDrill — answering', () => {
  it('a correct, fast answer grades easy, schedules the card, and advances to a new one', () => {
    const { result } = setup()
    const firstId = result.current.card?.id
    const answer = result.current.card?.prompt.midi

    act(() => result.current.answerNote(midi(answer!)))

    expect(result.current.lastGrade).toEqual({ correct: true, grade: 'easy' })
    expect(useFlashcardStore.getState().cardsById[firstId!]).toBeDefined()
    expect(result.current.stats.total).toBe(1)
    expect(result.current.card?.id).not.toBe(firstId)
  })

  it('a wrong answer grades again', () => {
    const { result } = setup()
    const correctMidi = result.current.card?.prompt.midi as number
    const wrongMidi = correctMidi === 56 ? correctMidi + 1 : correctMidi - 1

    act(() => result.current.answerNote(midi(wrongMidi)))

    expect(result.current.lastGrade).toEqual({ correct: false, grade: 'again' })
  })

  it('a slow correct answer (over 8s) grades hard', () => {
    const { result, clock } = setup()
    const answer = result.current.card?.prompt.midi as number
    act(() => clock.advance(9_000))

    act(() => result.current.answerNote(midi(answer)))

    expect(result.current.lastGrade).toEqual({ correct: true, grade: 'hard' })
  })

  it('a real MIDI press answers the current card exactly like an on-screen key press', () => {
    const { result, midiInput, clock } = setup()
    const answer = result.current.card?.prompt.midi as number

    act(() =>
      midiInput.emit({ type: 'noteOn', note: midi(answer), velocity: 80, time: clock.now() }),
    )

    expect(result.current.lastGrade).toEqual({ correct: true, grade: 'easy' })
  })
})

describe('useFlashcardDrill — changing level', () => {
  it('rebuilds the deck and range when the level changes', () => {
    const { result, rerender, options } = setup({ level: 1 })
    expect(result.current.range).toEqual({ low: 56, high: 64 })

    rerender({ ...options, level: 2 })

    // Level 2 widens the radius by a major sixth (9 semitones) each side.
    expect(result.current.range).toEqual({ low: 47, high: 73 })
    expect(result.current.deckSize).toBe(27)
  })
})
