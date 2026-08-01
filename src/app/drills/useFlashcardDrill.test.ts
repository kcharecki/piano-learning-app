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
import { DAY_MS } from '@core/srs/scheduler.ts'
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

describe('useFlashcardDrill — SRS scheduling uses a DateSource, not the Clock (defect 1 fix)', () => {
  // Kills a mutant that swaps `date.epochMillis()` back for `clock.now()` in
  // `newCard`/`review`: a `Clock` starting near zero (like real
  // `performance.now()` at page load) and a `DateSource` anchored at a real
  // epoch value are nowhere near each other, so a card scheduled off the
  // wrong one is trivially distinguishable.
  it('a newly introduced card is scheduled off date.epochMillis(), not clock.now()', () => {
    const date = new FakeClock(1_700_000_000_000)
    const clock = new FakeClock(0)
    const { result } = setup({ clock, date, rng: seededRng(7) })

    const firstId = result.current.card?.id
    const answer = result.current.card?.prompt.midi as number
    act(() => result.current.answerNote(midi(answer)))

    const graded = useFlashcardStore.getState().cardsById[firstId!]
    expect(graded).toBeDefined()
    expect(graded!.introducedAt).toBe(1_700_000_000_000)
    // Nowhere near the Clock's near-zero domain — proves `due` was computed
    // from the DateSource, not the Clock.
    expect(graded!.due).toBeGreaterThan(1_699_999_000_000)
  })

  // The important one for defect 1: a card graded `good` must not come back
  // due just because the monotonic Clock has moved on a long way, which is
  // exactly what happened across a real reload under the old
  // `performance.now()`-based scheduling — see `useFlashcardDrill.ts`'s
  // module comment. `date` (the persisted, reload-surviving source of "now")
  // stays put here; only `clock` jumps, simulating either a fresh
  // `performance.now()` after a reload or the same tab staying open a long
  // time. Kills the same "used clock.now() for scheduling" mutant as above,
  // but through the actual due-date comparison rather than a raw field read.
  it('a card graded good is not due again just because the Clock (not the DateSource) has moved on', () => {
    const date = new FakeClock(1_700_000_000_000)
    const clock = new FakeClock(0)
    const { result } = setup({ clock, date, rng: seededRng(7) })

    const firstId = result.current.card?.id
    const firstAnswer = result.current.card?.prompt.midi as number
    act(() => result.current.answerNote(midi(firstAnswer)))
    // Advanced past the just-graded card to a fresh one — confirms grading
    // took effect before the regression check below.
    expect(result.current.card?.id).not.toBe(firstId)

    act(() => clock.advance(30 * DAY_MS))

    const secondAnswer = result.current.card?.prompt.midi as number
    act(() => result.current.answerNote(midi(secondAnswer)))

    // If scheduling used `clock.now()`, the first card's `due` — anchored to
    // the Clock's near-zero starting value — would now sit far in the past
    // relative to the jumped Clock, so `nextCard` would hand it straight back
    // out as the earliest-due card the instant a second card is answered.
    expect(result.current.card?.id).not.toBe(firstId)
  })
})
