import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { at } from '@core/shared/invariant.ts'
import { type Midi } from '@core/shared/units.ts'
import { seededRng } from '@core/ports/rng.ts'
import { pitchDisplayName } from '@core/theory/pitch.ts'
import { buildTheoryQuiz, theoryQuizFromId, type TheoryQuizItem, type TheoryQuizKind } from './theory.ts'
import { describeTheoryAnswer } from './theoryFeedback.ts'

const KINDS: readonly TheoryQuizKind[] = [
  'build-scale',
  'build-chord',
  'build-interval',
  'name-key-signature',
  'build-cadence',
]

/** Letter names in scale order, for the one-letter-per-degree property below. */
const LETTER_ORDER = 'CDEFGAB'

const arbKind = fc.constantFrom(...KINDS)
const arbLevel = fc.integer({ min: 1, max: 10 })
const arbSeed = fc.integer({ min: 0, max: 2 ** 31 - 1 })

// ---------------------------------------------------------------------------
// describeTheoryAnswer
// ---------------------------------------------------------------------------

describe('describeTheoryAnswer', () => {
  it('lists a sequence comma-separated and a chord plus-separated', () => {
    const scale = buildTheoryQuiz('build-scale', 1, seededRng(1))
    const scaleText = describeTheoryAnswer(scale)
    expect(scaleText).not.toContain(' + ')
    expect(scaleText.split(', ')).toHaveLength(scale.answer.length)

    const chord = buildTheoryQuiz('build-chord', 1, seededRng(1))
    const chordText = describeTheoryAnswer(chord)
    expect(chordText).not.toContain(', ')
    expect(chordText.split(' + ')).toHaveLength((chord.answer[0] as readonly Midi[]).length)
  })

  // This block replaces a test that asserted the reveal matched
  // `pitchDisplayName(fromMidi(n))` — i.e. that it re-derived a name from the
  // MIDI number. That is exactly the defect the 2026-08-24-1 panel found: the
  // assertion held only because its seed drew a sharp-free chord, and it
  // certified the sharp spelling for every key that is not. The contract is
  // the item's OWN spelling, and these are the cases that tell the two apart.

  it('spells a flat key with flats — the fourth degree of F major is B♭, never A♯', () => {
    const item = theoryQuizFromId('build-scale-F-major')
    expect(item).toBeDefined()
    const text = describeTheoryAnswer(item as TheoryQuizItem)
    expect(text).toBe('F4, G4, A4, B♭4, C5, D5, E5, F5')
    expect(text).not.toContain('♯')
  })

  it('spells an interval as the one the prompt asked for — a minor 3rd above C is E♭, not D♯', () => {
    // C–D♯ is an augmented second. Printed under a prompt that asked for a
    // minor third, it names an interval the app did not ask for.
    const item = theoryQuizFromId('build-interval-C-3-minor')
    expect(item).toBeDefined()
    expect(describeTheoryAnswer(item as TheoryQuizItem)).toBe('C4, E♭4')
  })

  it("spells a key signature's tonic the way the key names it — G♭ major, not F♯ major", () => {
    const item = theoryQuizFromId('name-key-signature--6-major')
    expect(item).toBeDefined()
    expect(describeTheoryAnswer(item as TheoryQuizItem)).toBe('6 flats, tonic G♭4')
  })

  // The prompt asks "How many flats has B♭ major?" and is answered at the keys,
  // so naming only the note replies to the instruction and never to the
  // question (panel r2 2026-08-24-1, Teacher MAJOR).
  it('answers the key-signature question with the COUNT it asked for, not only the tonic', () => {
    const two = theoryQuizFromId('name-key-signature--2-major')
    expect(describeTheoryAnswer(two as TheoryQuizItem)).toBe('2 flats, tonic B♭4')
    const one = theoryQuizFromId('name-key-signature-1-major')
    expect(describeTheoryAnswer(one as TheoryQuizItem)).toBe('1 sharp, tonic G4')
    const none = theoryQuizFromId('name-key-signature-0-major')
    expect(describeTheoryAnswer(none as TheoryQuizItem)).toBe('no sharps or flats, tonic C4')
  })

  it("spells a cadence's doubled soprano like its tonic — E♭5 on top, not D♯5, and the tonic chord keeps its fifth", () => {
    const item = theoryQuizFromId('build-cadence-perfect-authentic-Eb')
    expect(item).toBeDefined()
    // The doubled tonic is ADDED above the triad, not swapped in for its top
    // note — B♭4 is the fifth, and deleting it was roadmap `T.23`.
    expect(describeTheoryAnswer(item as TheoryQuizItem)).toBe('B♭4 + D5 + F5, E♭4 + G4 + B♭4 + E♭5')
  })

  it('property: a scale answer steps one letter name per degree', () => {
    fc.assert(
      fc.property(arbLevel, arbSeed, (level, seed) => {
        const item = buildTheoryQuiz('build-scale', level, seededRng(seed))
        const letters = describeTheoryAnswer(item)
          .split(', ')
          .map((token) => token.slice(0, 1))
        // Every scale this drill builds is seven-letter diatonic, so each
        // degree moves up exactly one letter. A spelling re-derived from MIDI
        // repeats a letter and skips the next one (F major as "A, A♯" instead
        // of "A, B♭"), which is what this catches.
        for (let i = 1; i < letters.length; i++) {
          const prev = LETTER_ORDER.indexOf(at(letters, i - 1))
          const here = LETTER_ORDER.indexOf(at(letters, i))
          expect(prev).toBeGreaterThanOrEqual(0)
          expect((here - prev + LETTER_ORDER.length) % LETTER_ORDER.length).toBe(1)
        }
      }),
    )
  })

  it('property: the printed names are the item own spelling, never re-derived', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        const own = item.spelledAnswer
          .map((group) => group.map(pitchDisplayName).join(' + '))
          .join(', ')
        // `name-key-signature` answers a COUNT and carries its own summary; every
        // other kind is answered by the notes and must print exactly its own
        // spelling. Either way the spelling shown is the item's, never re-derived.
        if (item.answerSummary === undefined) expect(describeTheoryAnswer(item)).toBe(own)
        else expect(describeTheoryAnswer(item)).toContain(own)
      }),
    )
  })

  it('property: mentions exactly as many pitches as the answer has notes', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        const noteCount = item.answer.reduce((n, group) => n + group.length, 0)
        const text = describeTheoryAnswer(item)
        // A summary is prose about the answer, not a list of it — counted below
        // by its own test rather than by this one.
        if (item.answerSummary !== undefined) return
        // Every printed token is a real pitch name and there is one per note.
        const tokens = text.split(/, | \+ /)
        expect(tokens).toHaveLength(noteCount)
        for (const token of tokens) expect(token).toMatch(/^[A-G][♯♭]*-?\d+$/)
      }),
    )
  })

  it('property: never empty, for any item any kind and level can generate', () => {
    fc.assert(
      fc.property(arbKind, arbLevel, arbSeed, (kind, level, seed) => {
        const item = buildTheoryQuiz(kind, level, seededRng(seed))
        expect(describeTheoryAnswer(item).length).toBeGreaterThan(0)
      }),
    )
  })
})
