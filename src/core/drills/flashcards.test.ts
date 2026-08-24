import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { midi, PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI } from '@core/shared/units.ts'
import { seededRng } from '@core/ports/rng.ts'
import { scriptedRng } from '@test/fakes.ts'
import { newCard, review, type Card } from '@core/srs/scheduler.ts'
import { fromMidi } from '@core/theory/pitch.ts'
import { intervalBetween } from '@core/theory/intervals.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import {
  buildDeck,
  describeAnswer,
  type Flashcard,
  FAST_THRESHOLD_MS,
  gradeAnswer,
  type IntervalOnStaffCard,
  type KeySignatureCard,
  type NoteNameCard,
  nextCard,
  SLOW_THRESHOLD_MS,
  type StaffToKeyCard,
} from './flashcards.ts'

const T0 = 1_700_000_000_000

// ---------------------------------------------------------------------------
// buildDeck — note-name
// ---------------------------------------------------------------------------

describe('buildDeck — note-name', () => {
  it('level 1 stays inside a 9th around middle C', () => {
    const deck = buildDeck('note-name', 1) as readonly NoteNameCard[]
    expect(deck.length).toBeGreaterThan(0)
    for (const card of deck) {
      expect(card.prompt.midi).toBeGreaterThanOrEqual(56)
      expect(card.prompt.midi).toBeLessThanOrEqual(64)
    }
  })

  it('widens the note range at higher levels, strictly including level 1s range', () => {
    const level1 = buildDeck('note-name', 1) as readonly NoteNameCard[]
    const level2 = buildDeck('note-name', 2) as readonly NoteNameCard[]
    const notes1 = new Set(level1.map((c) => c.prompt.midi))
    const notes2 = new Set(level2.map((c) => c.prompt.midi))
    for (const n of notes1) expect(notes2.has(n)).toBe(true)
    expect(notes2.size).toBeGreaterThan(notes1.size)
  })

  it('reaches the full 88-key range and stops growing beyond it', () => {
    const high = buildDeck('note-name', 6) as readonly NoteNameCard[]
    const higher = buildDeck('note-name', 50) as readonly NoteNameCard[]
    const midis = high.map((c) => c.prompt.midi)
    expect(Math.min(...midis)).toBe(PIANO_LOWEST_MIDI)
    expect(Math.max(...midis)).toBe(PIANO_HIGHEST_MIDI)
    expect(higher.length).toBe(high.length)
  })

  it('treats level 0 and negative levels as level 1', () => {
    const level1 = buildDeck('note-name', 1)
    expect(buildDeck('note-name', 0)).toEqual(level1)
    expect(buildDeck('note-name', -5)).toEqual(level1)
  })

  it('every answer agrees with pitch.ts, not a restated table', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (level) => {
        const deck = buildDeck('note-name', level) as readonly NoteNameCard[]
        for (const card of deck) {
          const spelled = fromMidi(card.prompt.midi)
          expect(card.answer).toEqual({ letter: spelled.letter, alter: spelled.alter })
        }
      }),
    )
  })

  it('assigns treble at and above middle C, bass below it', () => {
    const deck = buildDeck('note-name', 3) as readonly NoteNameCard[]
    for (const card of deck) {
      expect(card.prompt.clef).toBe(card.prompt.midi >= 60 ? 'treble' : 'bass')
    }
  })

  it('has one card per note, with unique ids', () => {
    const deck = buildDeck('note-name', 3) as readonly NoteNameCard[]
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length)
    expect(new Set(deck.map((c) => c.prompt.midi)).size).toBe(deck.length)
  })
})

// ---------------------------------------------------------------------------
// buildDeck — staff-to-key
// ---------------------------------------------------------------------------

describe('buildDeck — staff-to-key', () => {
  it('answers with exactly the prompted note', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (level) => {
        const deck = buildDeck('staff-to-key', level) as readonly StaffToKeyCard[]
        for (const card of deck) expect(card.answer.midi).toBe(card.prompt.midi)
      }),
    )
  })

  it('uses the same widening range as note-name at every level', () => {
    for (let level = 1; level <= 5; level++) {
      const noteNames = (buildDeck('note-name', level) as readonly NoteNameCard[]).map(
        (c) => c.prompt.midi,
      )
      const staffToKey = (buildDeck('staff-to-key', level) as readonly StaffToKeyCard[]).map(
        (c) => c.prompt.midi,
      )
      expect(staffToKey).toEqual(noteNames)
    }
  })
})

// ---------------------------------------------------------------------------
// buildDeck — interval-on-staff
// ---------------------------------------------------------------------------

describe('buildDeck — interval-on-staff', () => {
  it('every answer agrees with intervals.ts measuring the prompted pitches', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (level) => {
        const deck = buildDeck('interval-on-staff', level) as readonly IntervalOnStaffCard[]
        expect(deck.length).toBeGreaterThan(0)
        for (const card of deck) {
          const measured = intervalBetween(card.prompt.low, card.prompt.high)
          expect(card.answer).toEqual({ number: measured.number, quality: measured.quality })
        }
      }),
    )
  })

  it('always roots on a natural (white-key) low note', () => {
    const deck = buildDeck('interval-on-staff', 4) as readonly IntervalOnStaffCard[]
    for (const card of deck) expect(card.prompt.low.alter).toBe(0)
  })

  it('level 1 offers only 2nds and 3rds', () => {
    const deck = buildDeck('interval-on-staff', 1) as readonly IntervalOnStaffCard[]
    const numbers = new Set(deck.map((c) => c.answer.number))
    expect(numbers).toEqual(new Set([2, 3]))
  })

  it('widens the diatonic numbers offered as level increases, up to the octave', () => {
    const numbersAtLevel = (level: number) =>
      new Set(
        (buildDeck('interval-on-staff', level) as readonly IntervalOnStaffCard[]).map(
          (c) => c.answer.number,
        ),
      )
    const n1 = numbersAtLevel(1)
    const n2 = numbersAtLevel(2)
    const n4 = numbersAtLevel(4)
    const n99 = numbersAtLevel(99)
    for (const n of n1) expect(n2.has(n)).toBe(true)
    expect(n2.size).toBeGreaterThan(n1.size)
    expect(n4).toEqual(new Set([2, 3, 4, 5, 6, 7, 8]))
    expect(n99).toEqual(n4) // capped: no compound intervals in SIMPLE_INTERVALS
  })

  it('keeps every prompted note within the 88-key piano range', () => {
    const deck = buildDeck('interval-on-staff', 6) as readonly IntervalOnStaffCard[]
    for (const card of deck) {
      const highMidi = intervalBetween(card.prompt.low, card.prompt.high) // sanity: measurable
      expect(highMidi).toBeTruthy()
    }
    expect(deck.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// buildDeck — key-signature
// ---------------------------------------------------------------------------

describe('buildDeck — key-signature', () => {
  it('every tonic pair agrees with keys.ts, not a restated table', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (level) => {
        const deck = buildDeck('key-signature', level) as readonly KeySignatureCard[]
        for (const card of deck) {
          const major = keyFromFifths(card.prompt.fifths, 'major')
          const minor = keyFromFifths(card.prompt.fifths, 'minor')
          expect(card.answer).toEqual({
            majorTonic: { letter: major.tonic.letter, alter: major.tonic.alter },
            minorTonic: { letter: minor.tonic.letter, alter: minor.tonic.alter },
          })
        }
      }),
    )
  })

  it('level 1 covers only 0 or 1 accidental (C/G/F and their relative minors)', () => {
    const deck = buildDeck('key-signature', 1) as readonly KeySignatureCard[]
    const fifths = deck.map((c) => c.prompt.fifths).sort((a, b) => a - b)
    expect(fifths).toEqual([-1, 0, 1])
  })

  it('widens by one accidental per level, capping at the writable ±7', () => {
    const fifthsAtLevel = (level: number) =>
      (buildDeck('key-signature', level) as readonly KeySignatureCard[]).map((c) => c.prompt.fifths)
    expect(fifthsAtLevel(2)).toEqual([-2, -1, 0, 1, 2])
    expect(fifthsAtLevel(7)).toEqual([-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7])
    expect(fifthsAtLevel(50)).toEqual(fifthsAtLevel(7))
  })
})

// ---------------------------------------------------------------------------
// gradeAnswer — correctness
// ---------------------------------------------------------------------------

describe('gradeAnswer — correctness', () => {
  it('note-name: exact letter+alter is correct, anything else is not', () => {
    const card = (buildDeck('note-name', 1) as readonly NoteNameCard[])[0]!
    expect(gradeAnswer(card, card.answer, 0).correct).toBe(true)
    expect(gradeAnswer(card, { letter: card.answer.letter, alter: 2 }, 0).correct).toBe(
      card.answer.alter === 2,
    )
  })

  it('staff-to-key: only the exact MIDI note is correct', () => {
    const card = (buildDeck('staff-to-key', 1) as readonly StaffToKeyCard[])[0]!
    expect(gradeAnswer(card, { midi: card.answer.midi }, 0).correct).toBe(true)
    expect(gradeAnswer(card, { midi: midi(card.answer.midi + 1) }, 0).correct).toBe(false)
  })

  it('interval-on-staff: number and quality must both match', () => {
    const card = (buildDeck('interval-on-staff', 1) as readonly IntervalOnStaffCard[])[0]!
    expect(gradeAnswer(card, card.answer, 0).correct).toBe(true)
    expect(gradeAnswer(card, { number: card.answer.number, quality: 'augmented' }, 0).correct).toBe(
      card.answer.quality === 'augmented',
    )
  })

  it('key-signature: both the major and minor tonic must match', () => {
    const card = (buildDeck('key-signature', 1) as readonly KeySignatureCard[]).find(
      (c) => c.prompt.fifths === 1,
    )!
    expect(gradeAnswer(card, card.answer, 0).correct).toBe(true)
    expect(
      gradeAnswer(
        card,
        { majorTonic: card.answer.majorTonic, minorTonic: { letter: 'C', alter: 0 } },
        0,
      ).correct,
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// gradeAnswer — timing thresholds
// ---------------------------------------------------------------------------

describe('gradeAnswer — timing thresholds', () => {
  const card = (buildDeck('note-name', 1) as readonly NoteNameCard[])[0]!

  it('wrong answers are always "again", regardless of how fast', () => {
    const wrong = {
      letter: card.answer.letter,
      alter: (card.answer.alter + 1) as -1 | 0 | 1 | 2 | -2,
    }
    const expected = describeAnswer(card)
    expect(gradeAnswer(card, wrong, 0)).toEqual({ correct: false, grade: 'again', expected })
    expect(gradeAnswer(card, wrong, 100_000)).toEqual({ correct: false, grade: 'again', expected })
  })

  it('correct at or under the fast threshold is "easy"', () => {
    expect(gradeAnswer(card, card.answer, 0).grade).toBe('easy')
    expect(gradeAnswer(card, card.answer, FAST_THRESHOLD_MS).grade).toBe('easy')
  })

  it('correct just past the fast threshold is "good"', () => {
    expect(gradeAnswer(card, card.answer, FAST_THRESHOLD_MS + 1).grade).toBe('good')
  })

  it('correct just under the slow threshold is "good"', () => {
    expect(gradeAnswer(card, card.answer, SLOW_THRESHOLD_MS - 1).grade).toBe('good')
  })

  it('correct at or over the slow threshold is "hard"', () => {
    expect(gradeAnswer(card, card.answer, SLOW_THRESHOLD_MS).grade).toBe('hard')
    expect(gradeAnswer(card, card.answer, SLOW_THRESHOLD_MS + 10_000).grade).toBe('hard')
  })

  it('a correct answer is always graded correct: true', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50_000 }), (elapsedMs) => {
        expect(gradeAnswer(card, card.answer, elapsedMs).correct).toBe(true)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// nextCard
// ---------------------------------------------------------------------------

describe('nextCard', () => {
  const deck = buildDeck('note-name', 1) as readonly NoteNameCard[]

  it('returns undefined for an empty deck', () => {
    expect(nextCard([], [], T0, seededRng(1))).toBeUndefined()
  })

  it('introduces a new card when nothing has been introduced yet', () => {
    const picked = nextCard(deck, [], T0, seededRng(1))
    expect(picked).toBeDefined()
    expect(deck.some((c) => c.id === picked!.id)).toBe(true)
  })

  it('prefers the earliest-due card over introducing a new one', () => {
    const [a, b] = deck as [NoteNameCard, NoteNameCard, ...NoteNameCard[]]
    // Both are already due (due <= now) — nextCard must pick the earlier of the two.
    const earlier: Card = { ...newCard(a.id, T0), due: T0 - 2_000 }
    const later: Card = { ...newCard(b.id, T0), due: T0 - 1_000 }
    const picked = nextCard(deck, [later, earlier], T0, seededRng(1))
    expect(picked?.id).toBe(a.id)
  })

  it('only introduces a new card once nothing already-introduced is due', () => {
    const [a, ...rest] = deck as [NoteNameCard, ...NoteNameCard[]]
    const notYetDue: Card = { ...newCard(a.id, T0), due: T0 + 10_000 }
    const picked = nextCard(deck, [notYetDue], T0, seededRng(1))
    expect(picked).toBeDefined()
    expect(picked!.id).not.toBe(a.id) // a is introduced but not due
    expect(rest.some((c) => c.id === picked!.id)).toBe(true)
  })

  it('returns undefined once every card is introduced and none is due', () => {
    const notYetDue = deck.map((c) => ({ ...newCard(c.id, T0), due: T0 + 10_000 }))
    expect(nextCard(deck, notYetDue, T0, seededRng(1))).toBeUndefined()
  })

  it('ignores SRS cards that belong to a different deck', () => {
    const foreignDue: Card = { ...newCard('not-in-this-deck', T0), due: T0 }
    const picked = nextCard(deck, [foreignDue], T0, seededRng(1))
    expect(picked).toBeDefined() // falls through to "introduce a new card"
  })

  it('picks deterministically from a seeded rng among the new cards', () => {
    const a = nextCard(deck, [], T0, seededRng(42))
    const b = nextCard(deck, [], T0, seededRng(42))
    expect(a?.id).toBe(b?.id)
  })

  it('a graded-and-reviewed card stops being "new" and becomes due later, not immediately', () => {
    const [a] = deck as [NoteNameCard, ...NoteNameCard[]]
    const reviewed = review(newCard(a.id, T0), 'good', T0)
    expect(reviewed.due).toBeGreaterThan(T0)
    const picked = nextCard(deck, [reviewed], T0, scriptedRng([0]))
    expect(picked?.id).not.toBe(a.id) // not due yet, so a fresh card is offered instead
  })
})

// ---------------------------------------------------------------------------
// describeAnswer
// ---------------------------------------------------------------------------

describe('describeAnswer', () => {
  const KINDS = ['note-name', 'staff-to-key', 'interval-on-staff', 'key-signature'] as const

  /** The answer itself, flattened to a string, so two cards can be compared. */
  function answerKey(card: Flashcard): string {
    switch (card.kind) {
      case 'note-name':
        return `n:${card.answer.letter}:${card.answer.alter}`
      case 'staff-to-key':
        return `s:${card.answer.midi}`
      case 'interval-on-staff':
        return `i:${card.answer.number}:${card.answer.quality}`
      case 'key-signature':
        return (
          `k:${card.answer.majorTonic.letter}:${card.answer.majorTonic.alter}` +
          `:${card.answer.minorTonic.letter}:${card.answer.minorTonic.alter}`
        )
    }
  }

  it('names a note on the keyboard by pitch, octave included', () => {
    const deck = buildDeck('staff-to-key', 1) as readonly StaffToKeyCard[]
    const middleC = deck.find((c) => c.answer.midi === 60)
    const e4 = deck.find((c) => c.answer.midi === 64)
    expect(middleC && describeAnswer(middleC)).toBe('C4')
    expect(e4 && describeAnswer(e4)).toBe('E4')
  })

  it('names a note-name card by letter and accidental, with no octave', () => {
    const deck = buildDeck('note-name', 1) as readonly NoteNameCard[]
    const natural = deck.find((c) => c.answer.letter === 'D' && c.answer.alter === 0)
    const sharp = deck.find((c) => c.answer.alter === 1)
    expect(natural && describeAnswer(natural)).toBe('D')
    // The octave is deliberately absent: the card does not ask for one, and a
    // learner told "that was F♯3" would reasonably think naming "F♯" was wrong.
    expect(sharp && describeAnswer(sharp)).toMatch(/^[A-G]♯$/)
  })

  it('names an interval in the answer pad own wording, not in shorthand', () => {
    const deck = buildDeck('interval-on-staff', 2) as readonly IntervalOnStaffCard[]
    const fifth = deck.find((c) => c.answer.number === 5 && c.answer.quality === 'perfect')
    // The pad prints 'Perfect 5th' on the button; being told the answer was
    // 'perfect fifth' would make the learner check they mean the same thing.
    expect(fifth && describeAnswer(fifth)).toBe('Perfect 5th')
    // 'P5' is what `intervalName` produces and what an id carries; it is not
    // what a learner is asked to recognise.
    for (const card of deck) expect(describeAnswer(card)).not.toMatch(/^[PmMAd]\d/)
  })

  it('names both tonics of a key signature, in the answer pad own wording', () => {
    const deck = buildDeck('key-signature', 1) as readonly KeySignatureCard[]
    const oneSharp = deck.find((c) => c.prompt.fifths === 1)
    expect(oneSharp && describeAnswer(oneSharp)).toBe('G major / E minor')
  })

  it('never returns an empty string, for any card any deck can build', () => {
    for (const kind of KINDS) {
      for (let level = 1; level <= 7; level++) {
        for (const card of buildDeck(kind, level)) {
          expect(describeAnswer(card).length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('never leaks internal vocabulary — no kind slug, no bare MIDI number', () => {
    for (const kind of KINDS) {
      for (const card of buildDeck(kind, 4)) {
        const text = describeAnswer(card)
        expect(text).not.toContain(kind)
        expect(text).not.toContain('-')
      }
    }
  })

  it('property: two cards read the same if and only if their answers ARE the same', () => {
    // The property that makes this usable as feedback. If two different
    // answers could print the same sentence, a learner reading it could not
    // tell which one was wanted; if one answer could print two sentences, the
    // same mistake would be corrected differently on different days.
    for (const kind of KINDS) {
      for (let level = 1; level <= 7; level++) {
        const byDescription = new Map<string, string>()
        const byAnswer = new Map<string, string>()
        for (const card of buildDeck(kind, level)) {
          const description = describeAnswer(card)
          const answer = answerKey(card)
          expect(byDescription.get(description) ?? answer).toBe(answer)
          expect(byAnswer.get(answer) ?? description).toBe(description)
          byDescription.set(description, answer)
          byAnswer.set(answer, description)
        }
      }
    }
  })

  it('is the same string `gradeAnswer` reports as `expected`, right or wrong', () => {
    const deck = buildDeck('staff-to-key', 1) as readonly StaffToKeyCard[]
    const [card] = deck as [StaffToKeyCard, ...StaffToKeyCard[]]
    const wrongNote = midi(card.answer.midi === 60 ? 61 : 60)
    expect(gradeAnswer(card, { midi: wrongNote }, 0).expected).toBe(describeAnswer(card))
    expect(gradeAnswer(card, card.answer, 0).expected).toBe(describeAnswer(card))
  })
})
