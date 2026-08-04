/**
 * Flashcard drill wiring (roadmap 2.12, REQ-3.4.5): a card is drawn from the
 * real deck, answering it (on-screen or via a real MIDI press) grades it
 * through `core/drills/flashcards.ts` + `core/srs/scheduler.ts` and writes
 * the result into `flashcardStore`, and a new card follows. Grading and SRS
 * math themselves already have their own suites — this only asserts the
 * wiring between them.
 */
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import {
  buildDeck,
  type IntervalOnStaffCard,
  type KeySignatureCard,
  type NoteNameCard,
} from '@core/drills/flashcards.ts'
import { seededRng } from '@core/ports/rng.ts'
import { midi } from '@core/shared/units.ts'
import { DAY_MS } from '@core/srs/scheduler.ts'
import { act, cleanup, renderHook } from '@testing-library/react'
import { FakeClock, FakeMidiInput, scriptedRng } from '@test/fakes.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  useFlashcardDrill,
  type DrillCard,
  type UseFlashcardDrillOptions,
} from './useFlashcardDrill.ts'

function resetStore(): void {
  useFlashcardStore.setState({ cardsById: {} })
}

/** Narrows the hook's `card` union back to its `staff-to-key` prompt midi — every
 *  test in this file that reads `.prompt.midi` is already known (by construction
 *  of its own `setup`) to be looking at a staff-to-key card. */
function staffToKeyMidi(card: DrillCard | undefined): number {
  if (card === undefined || card.kind !== 'staff-to-key') {
    throw new Error('expected a staff-to-key card')
  }
  return card.prompt.midi
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
    expect(staffToKeyMidi(result.current.card)).toBeGreaterThanOrEqual(56)
    expect(staffToKeyMidi(result.current.card)).toBeLessThanOrEqual(64)
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
    const answer = staffToKeyMidi(result.current.card)

    act(() => result.current.answerNote(midi(answer)))

    expect(result.current.lastGrade).toEqual({ correct: true, grade: 'easy' })
    expect(useFlashcardStore.getState().cardsById[firstId!]).toBeDefined()
    expect(result.current.stats.total).toBe(1)
    expect(result.current.card?.id).not.toBe(firstId)
  })

  it('a wrong answer grades again', () => {
    const { result } = setup()
    const correctMidi = staffToKeyMidi(result.current.card)
    const wrongMidi = correctMidi === 56 ? correctMidi + 1 : correctMidi - 1

    act(() => result.current.answerNote(midi(wrongMidi)))

    expect(result.current.lastGrade).toEqual({ correct: false, grade: 'again' })
  })

  it('a slow correct answer (over 8s) grades hard', () => {
    const { result, clock } = setup()
    const answer = staffToKeyMidi(result.current.card)
    act(() => clock.advance(9_000))

    act(() => result.current.answerNote(midi(answer)))

    expect(result.current.lastGrade).toEqual({ correct: true, grade: 'hard' })
  })

  it('a real MIDI press answers the current card exactly like an on-screen key press', () => {
    const { result, midiInput, clock } = setup()
    const answer = staffToKeyMidi(result.current.card)

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
    const answer = staffToKeyMidi(result.current.card)
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
    const firstAnswer = staffToKeyMidi(result.current.card)
    act(() => result.current.answerNote(midi(firstAnswer)))
    // Advanced past the just-graded card to a fresh one — confirms grading
    // took effect before the regression check below.
    expect(result.current.card?.id).not.toBe(firstId)

    act(() => clock.advance(30 * DAY_MS))

    const secondAnswer = staffToKeyMidi(result.current.card)
    act(() => result.current.answerNote(midi(secondAnswer)))

    // If scheduling used `clock.now()`, the first card's `due` — anchored to
    // the Clock's near-zero starting value — would now sit far in the past
    // relative to the jumped Clock, so `nextCard` would hand it straight back
    // out as the earliest-due card the instant a second card is answered.
    expect(result.current.card?.id).not.toBe(firstId)
  })
})

describe('useFlashcardDrill — kind selection (roadmap 2.25)', () => {
  it('defaults to a staff-to-key card when kind is omitted', () => {
    const { result } = setup()
    expect(result.current.card?.kind).toBe('staff-to-key')
  })

  it('draws an interval-on-staff card when kind is interval-on-staff', () => {
    const { result } = setup({ kind: 'interval-on-staff' })

    expect(result.current.card).toBeDefined()
    expect(result.current.card?.kind).toBe('interval-on-staff')
    expect(result.current.deckSize).toBe(buildDeck('interval-on-staff', 1).length)
  })

  it('switching kind rebuilds the deck and picks a fresh card of the new kind', () => {
    const { result, rerender, options } = setup({ kind: 'staff-to-key' })
    expect(result.current.card?.kind).toBe('staff-to-key')

    rerender({ ...options, kind: 'interval-on-staff' })

    expect(result.current.card?.kind).toBe('interval-on-staff')
  })

  it('SRS state from one kind survives a switch to the other kind (no wipe)', () => {
    const { result, rerender, options } = setup({ kind: 'staff-to-key' })
    const firstId = result.current.card?.id
    const answer = staffToKeyMidi(result.current.card)
    act(() => result.current.answerNote(midi(answer)))
    expect(useFlashcardStore.getState().cardsById[firstId!]).toBeDefined()

    rerender({ ...options, kind: 'interval-on-staff' })
    act(() => result.current.answerInterval({ number: 2, quality: 'minor' }))

    // The staff-to-key card graded before the switch is still in the store —
    // switching kind never wiped `cardsById`.
    expect(useFlashcardStore.getState().cardsById[firstId!]).toBeDefined()
  })
})

describe('useFlashcardDrill — answering an interval card', () => {
  it('a correct interval answer grades correctly and advances to a new card', () => {
    const rng = scriptedRng([0])
    const { result } = setup({ kind: 'interval-on-staff', rng })
    const expected = buildDeck('interval-on-staff', 1)[0] as IntervalOnStaffCard
    expect(result.current.card?.id).toBe(expected.id)

    act(() => result.current.answerInterval(expected.answer))

    expect(result.current.lastGrade).toEqual({ correct: true, grade: 'easy' })
    expect(result.current.stats.total).toBe(1)
    expect(result.current.card?.id).not.toBe(expected.id)
  })

  it('a wrong interval answer grades again', () => {
    const rng = scriptedRng([0])
    const { result } = setup({ kind: 'interval-on-staff', rng })

    act(() => result.current.answerInterval({ number: 8, quality: 'perfect' }))

    expect(result.current.lastGrade).toEqual({ correct: false, grade: 'again' })
  })

  it('answerNote is a no-op while an interval card is showing', () => {
    const rng = scriptedRng([0])
    const { result } = setup({ kind: 'interval-on-staff', rng })
    const cardId = result.current.card?.id

    act(() => result.current.answerNote(midi(60)))

    expect(result.current.lastGrade).toBeUndefined()
    expect(result.current.card?.id).toBe(cardId)
  })

  it('answerInterval is a no-op while a staff-to-key card is showing', () => {
    const { result } = setup({ kind: 'staff-to-key' })
    const cardId = result.current.card?.id

    act(() => result.current.answerInterval({ number: 3, quality: 'major' }))

    expect(result.current.lastGrade).toBeUndefined()
    expect(result.current.card?.id).toBe(cardId)
  })
})

// roadmap 3.11 (REQ-3.5.2): before this task, `DrillKind` only ever narrowed to
// two of `core/drills/flashcards.ts`'s four decks, so the `note-name` and
// `key-signature` decks were fully built and graded by core but unreachable
// from this hook. Every test below fails against the pre-3.11 `DrillKind`
// union (a stub that keeps only 'staff-to-key' | 'interval-on-staff' does not
// even type-check `kind: 'note-name'`), which is the point: it proves the two
// decks are now actually wired, not just present in core.
describe('useFlashcardDrill — kind selection includes note-name and key-signature (roadmap 3.11)', () => {
  it('draws a note-name card when kind is note-name', () => {
    const { result } = setup({ kind: 'note-name' })

    expect(result.current.card).toBeDefined()
    expect(result.current.card?.kind).toBe('note-name')
    expect(result.current.deckSize).toBe(buildDeck('note-name', 1).length)
  })

  it('draws a key-signature card when kind is key-signature', () => {
    const { result } = setup({ kind: 'key-signature' })

    expect(result.current.card).toBeDefined()
    expect(result.current.card?.kind).toBe('key-signature')
    expect(result.current.deckSize).toBe(buildDeck('key-signature', 1).length)
  })
})

describe('useFlashcardDrill — answering a note-name card (roadmap 3.11)', () => {
  it('a correct note-name answer grades correctly and advances to a new card', () => {
    const rng = scriptedRng([0])
    const { result } = setup({ kind: 'note-name', rng })
    const expected = buildDeck('note-name', 1)[0] as NoteNameCard
    expect(result.current.card?.id).toBe(expected.id)

    act(() => result.current.answerNoteName(expected.answer))

    // Kills a mutant that always grades a note-name answer wrong (or always
    // 'again'), and one that fails to advance `current` after grading.
    expect(result.current.lastGrade).toEqual({ correct: true, grade: 'easy' })
    expect(result.current.stats.total).toBe(1)
    expect(result.current.card?.id).not.toBe(expected.id)
  })

  it('a wrong note-name answer grades again', () => {
    const rng = scriptedRng([0])
    const { result } = setup({ kind: 'note-name', rng })
    const expected = buildDeck('note-name', 1)[0] as NoteNameCard
    const wrongLetter = expected.answer.letter === 'C' ? 'D' : 'C'

    // Kills a mutant that grades a note-name answer by alter alone (ignoring
    // letter) or that always reports 'correct: true'.
    act(() =>
      result.current.answerNoteName({ letter: wrongLetter, alter: expected.answer.alter }),
    )

    expect(result.current.lastGrade).toEqual({ correct: false, grade: 'again' })
  })

  it('answerNoteName is a no-op while a staff-to-key card is showing', () => {
    const { result } = setup({ kind: 'staff-to-key' })
    const cardId = result.current.card?.id

    act(() => result.current.answerNoteName({ letter: 'C', alter: 0 }))

    // Kills a mutant that drops the `card.kind !== 'note-name'` guard and
    // grades whatever card happens to be showing.
    expect(result.current.lastGrade).toBeUndefined()
    expect(result.current.card?.id).toBe(cardId)
  })
})

describe('useFlashcardDrill — answering a key-signature card (roadmap 3.11)', () => {
  it('a correct key-signature answer grades correctly and advances to a new card', () => {
    const rng = scriptedRng([0])
    const { result } = setup({ kind: 'key-signature', rng })
    const expected = buildDeck('key-signature', 1)[0] as KeySignatureCard
    expect(result.current.card?.id).toBe(expected.id)

    act(() => result.current.answerKeySignature(expected.answer))

    // Kills a mutant that only compares majorTonic (or only minorTonic) when
    // grading a key-signature answer, and one that fails to advance `current`.
    expect(result.current.lastGrade).toEqual({ correct: true, grade: 'easy' })
    expect(result.current.stats.total).toBe(1)
    expect(result.current.card?.id).not.toBe(expected.id)
  })

  it('a wrong key-signature answer grades again', () => {
    const rng = scriptedRng([0])
    const { result } = setup({ kind: 'key-signature', rng })

    act(() =>
      result.current.answerKeySignature({
        majorTonic: { letter: 'C', alter: 2 },
        minorTonic: { letter: 'A', alter: 2 },
      }),
    )

    expect(result.current.lastGrade).toEqual({ correct: false, grade: 'again' })
  })

  it('answerKeySignature is a no-op while an interval-on-staff card is showing', () => {
    const rng = scriptedRng([0])
    const { result } = setup({ kind: 'interval-on-staff', rng })
    const cardId = result.current.card?.id

    act(() =>
      result.current.answerKeySignature({
        majorTonic: { letter: 'C', alter: 0 },
        minorTonic: { letter: 'A', alter: 0 },
      }),
    )

    // Kills a mutant that drops the `card.kind !== 'key-signature'` guard.
    expect(result.current.lastGrade).toBeUndefined()
    expect(result.current.card?.id).toBe(cardId)
  })
})
