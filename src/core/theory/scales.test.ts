import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { at, InvariantError } from '@core/shared/invariant.ts'
import { unwrap } from '@core/shared/result.ts'
import { intervalBetween } from './intervals.ts'
import {
  type Alter,
  type Letter,
  LETTERS,
  parsePitch,
  pitchName,
  type SpelledPitch,
  spelledPitchClass,
  toMidi,
} from './pitch.ts'
import {
  buildScale,
  degreeName,
  degreeOf,
  melodicMinorDescending,
  noteAtDegree,
  type Scale,
  SCALE_INTERVALS,
  SCALE_TYPES,
  scaleFingering,
  scaleName,
  scaleNotes,
  type ScaleType,
} from './scales.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Parse a pitch name that is known to be legal: `p('C#4')`. */
const p = (text: string): SpelledPitch => unwrap(parsePitch(text))

/** Spelling without the octave — `'F#'`, `'Bbb'` — which is how scales are quoted. */
const spelling = (n: SpelledPitch): string =>
  `${n.letter}${n.alter < 0 ? 'b'.repeat(-n.alter) : '#'.repeat(n.alter)}`

const spellings = (notes: readonly SpelledPitch[]): string[] => notes.map(spelling)

const scale = (tonic: string, type: ScaleType): Scale => buildScale(p(tonic), type)

/** The scale of `tonic` as octave-less spellings: `degrees('C4', 'major')`. */
const degrees = (tonic: string, type: ScaleType): string[] => spellings(scale(tonic, type).notes)

const HEPTATONIC: readonly ScaleType[] = SCALE_TYPES.filter((t) => SCALE_INTERVALS[t].length === 7)

/** The seven modes, in the order of the major-scale degrees they start on. */
const MODES: readonly ScaleType[] = [
  'ionian',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'aeolian',
  'locrian',
]

// ---------------------------------------------------------------------------
// arbitraries
// ---------------------------------------------------------------------------

/** Every accidental a tonic can carry, and the subset that is not a double. */
const ALL_ALTERS: readonly Alter[] = [-2, -1, 0, 1, 2]
const SIMPLE_ALTERS: readonly Alter[] = [-1, 0, 1]

const arbLetter = fc.constantFrom<Letter>('C', 'D', 'E', 'F', 'G', 'A', 'B')
const arbAlter = fc.constantFrom<Alter>(...ALL_ALTERS)
const arbSimpleAlter = fc.constantFrom<Alter>(...SIMPLE_ALTERS)
const arbType = fc.constantFrom<ScaleType>(...SCALE_TYPES)
const arbHeptatonicType = fc.constantFrom<ScaleType>(...HEPTATONIC)

/** Tonics in one fixed octave, so every degree stays inside the MIDI range. */
const arbTonic: fc.Arbitrary<SpelledPitch> = fc.record({
  letter: arbLetter,
  alter: arbSimpleAlter,
  octave: fc.constant(4),
})

/** Tonics across every key, double accidentals included — some are unwritable. */
const arbAnyTonic: fc.Arbitrary<SpelledPitch> = fc.record({
  letter: arbLetter,
  alter: arbAlter,
  octave: fc.integer({ min: 2, max: 6 }),
})

/**
 * The complete list of keys `buildScale` is allowed to refuse, written out by
 * hand so that it is an allow-list and not a catch-all. A scale is unwritable
 * only when it needs a *triple* accidental, which needs two things at once: a
 * tonic that already carries a double accidental, and a type that pushes one of
 * its degrees a further semitone the same way. `sharp` lists the tonic letters
 * that fail with a `##` tonic, `flat` those that fail with a `bb` tonic — so
 * `major.sharp` containing G is the classic G## major, whose leading tone wants
 * F###. A tonic with at most one accidental is always writable, in every type.
 *
 * {@link isUnwritable} is asserted to be exactly right (in both directions) by
 * "refuses exactly the keys in the unwritable table" below.
 */
const UNWRITABLE: Readonly<Record<ScaleType, { readonly sharp: string; readonly flat: string }>> = {
  major: { sharp: 'DEGAB', flat: 'F' },
  naturalMinor: { sharp: 'EB', flat: 'CDFG' },
  harmonicMinor: { sharp: 'DEGAB', flat: 'CDFG' },
  melodicMinor: { sharp: 'DEGAB', flat: 'CFG' },
  ionian: { sharp: 'DEGAB', flat: 'F' },
  dorian: { sharp: 'EAB', flat: 'CFG' },
  phrygian: { sharp: 'B', flat: 'CDFGA' },
  lydian: { sharp: 'CDEGAB', flat: '' },
  mixolydian: { sharp: 'DEAB', flat: 'CF' },
  aeolian: { sharp: 'EB', flat: 'CDFG' },
  locrian: { sharp: '', flat: 'CDEFGA' },
  chromatic: { sharp: '', flat: '' },
  majorPentatonic: { sharp: 'DEAB', flat: '' },
  minorPentatonic: { sharp: 'B', flat: 'CFG' },
  blues: { sharp: 'B', flat: 'CDEFGA' },
  wholeTone: { sharp: '', flat: '' },
}

function isUnwritable(tonic: SpelledPitch, type: ScaleType): boolean {
  const entry = UNWRITABLE[type]
  if (tonic.alter === 2) return entry.sharp.includes(tonic.letter)
  if (tonic.alter === -2) return entry.flat.includes(tonic.letter)
  return false
}

/**
 * Build a scale, or return null for one of the handful of keys in
 * {@link UNWRITABLE}. Every property that sweeps all the keys goes through this,
 * and it deliberately does **not** swallow unexpected throws: a key outside the
 * table that stops building fails the property that asked for it, which is how a
 * regression in the spelling of, say, A# chromatic gets noticed.
 */
function tryBuild(tonic: SpelledPitch, type: ScaleType): Scale | null {
  if (!isUnwritable(tonic, type)) return buildScale(tonic, type)
  expect(() => buildScale(tonic, type)).toThrow(InvariantError)
  expect(() => buildScale(tonic, type)).toThrow(/beyond the double sharp\/flat range/)
  return null
}

// ---------------------------------------------------------------------------
// the interval tables
// ---------------------------------------------------------------------------

describe('SCALE_INTERVALS', () => {
  it('covers every scale type exactly once', () => {
    // SCALE_TYPES is the source of truth ScaleType is derived from, so it must
    // list each type once and line up with the tables keyed by it, in order.
    expect([...SCALE_TYPES]).toEqual(Object.keys(SCALE_INTERVALS))
    expect(new Set(SCALE_TYPES).size).toBe(SCALE_TYPES.length)
    expect(SCALE_TYPES).toHaveLength(16)
  })

  it('starts on the tonic, ascends strictly, and stops below the octave', () => {
    for (const type of SCALE_TYPES) {
      const offsets = SCALE_INTERVALS[type]
      expect(at(offsets, 0)).toBe(0)
      for (let i = 1; i < offsets.length; i++) {
        expect(at(offsets, i)).toBeGreaterThan(at(offsets, i - 1))
      }
      expect(offsets.every((o) => o >= 0 && o <= 11)).toBe(true)
    }
  })

  it('has the expected sizes: 7 diatonic, 5 pentatonic, 6 blues/whole tone, 12 chromatic', () => {
    expect(HEPTATONIC).toHaveLength(11)
    expect(SCALE_INTERVALS.majorPentatonic).toHaveLength(5)
    expect(SCALE_INTERVALS.minorPentatonic).toHaveLength(5)
    expect(SCALE_INTERVALS.blues).toHaveLength(6)
    expect(SCALE_INTERVALS.wholeTone).toHaveLength(6)
    expect(SCALE_INTERVALS.chromatic).toHaveLength(12)
  })

  it('names the same thing twice where tradition does: ionian = major, aeolian = natural minor', () => {
    expect(SCALE_INTERVALS.ionian).toEqual(SCALE_INTERVALS.major)
    expect(SCALE_INTERVALS.aeolian).toEqual(SCALE_INTERVALS.naturalMinor)
  })

  it('every mode is a rotation of the major scale', () => {
    const major = SCALE_INTERVALS.major
    MODES.forEach((mode, rotation) => {
      const rotated = major.map(
        (_, i) => (at(major, (i + rotation) % 7) - at(major, rotation) + 12) % 12,
      )
      expect(SCALE_INTERVALS[mode]).toEqual(rotated)
    })
  })
})

// ---------------------------------------------------------------------------
// buildScale — the named cases a musician can check by eye
// ---------------------------------------------------------------------------

describe('buildScale — major keys', () => {
  it('C major has no accidentals', () => {
    expect(degrees('C4', 'major')).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B'])
  })

  it('G major has one sharp, F#', () => {
    expect(degrees('G4', 'major')).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F#'])
  })

  it('F major has one flat, Bb', () => {
    expect(degrees('F4', 'major')).toEqual(['F', 'G', 'A', 'Bb', 'C', 'D', 'E'])
  })

  it('F# major spells its leading tone E#, not F', () => {
    // F# G# A# B C# D# E# — six sharps. Writing F would give the scale two Fs
    // and no E at all, which cannot be notated on a staff.
    expect(degrees('F#4', 'major')).toEqual(['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#'])
  })

  it('Cb major is all flats, including Fb', () => {
    // Cb Db Eb Fb Gb Ab Bb — seven flats, the enharmonic of B major.
    expect(degrees('Cb4', 'major')).toEqual(['Cb', 'Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bb'])
  })

  it('C# major spells B# as its leading tone', () => {
    expect(degrees('C#4', 'major')).toEqual(['C#', 'D#', 'E#', 'F#', 'G#', 'A#', 'B#'])
  })

  it('G# major needs a double sharp (F##) and is still writable', () => {
    expect(degrees('G#4', 'major')).toEqual(['G#', 'A#', 'B#', 'C#', 'D#', 'E#', 'F##'])
  })

  it('keeps the tonic as the first note and reports what it was asked for', () => {
    const tonic = p('Eb3')
    const built = buildScale(tonic, 'major')
    expect(built.notes[0]).toEqual(tonic)
    expect(built.tonic).toEqual(tonic)
    expect(built.type).toBe('major')
  })

  it('carries the octave at the B–C boundary', () => {
    expect(buildScale(p('A4'), 'major').notes.map(pitchName)).toEqual([
      'A4',
      'B4',
      'C#5',
      'D5',
      'E5',
      'F#5',
      'G#5',
    ])
  })

  it('refuses a key that would need a triple sharp', () => {
    // G## major would want F###. The answer is "use A major", not a wrong spelling.
    expect(() => buildScale(p('G##4'), 'major')).toThrow(InvariantError)
    expect(() => buildScale(p('G##4'), 'major')).toThrow(/beyond the double sharp\/flat range/)
    expect(() => buildScale(p('G##4'), 'major')).toThrow(/G##4 major/)
  })
})

describe('buildScale — minor forms', () => {
  it('A natural minor is the white keys from A', () => {
    expect(degrees('A4', 'naturalMinor')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
  })

  it('A harmonic minor raises the 7th to G#', () => {
    // A B C D E F G# — the augmented second F–G# is the sound of the scale.
    expect(degrees('A4', 'harmonicMinor')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G#'])
  })

  it('A melodic minor ascending raises the 6th and the 7th', () => {
    // A B C D E F# G#
    expect(degrees('A4', 'melodicMinor')).toEqual(['A', 'B', 'C', 'D', 'E', 'F#', 'G#'])
  })

  it('D harmonic minor is D E F G A Bb C#', () => {
    expect(degrees('D4', 'harmonicMinor')).toEqual(['D', 'E', 'F', 'G', 'A', 'Bb', 'C#'])
  })

  it('C harmonic minor keeps three flats and a B natural', () => {
    expect(degrees('C4', 'harmonicMinor')).toEqual(['C', 'D', 'Eb', 'F', 'G', 'Ab', 'B'])
  })
})

describe('buildScale — modes', () => {
  it('D dorian has no accidentals', () => {
    expect(degrees('D4', 'dorian')).toEqual(['D', 'E', 'F', 'G', 'A', 'B', 'C'])
  })

  it('B locrian has no accidentals', () => {
    expect(degrees('B3', 'locrian')).toEqual(['B', 'C', 'D', 'E', 'F', 'G', 'A'])
  })

  it('F lydian has a B natural — the raised 4th is the whole point', () => {
    expect(degrees('F4', 'lydian')).toEqual(['F', 'G', 'A', 'B', 'C', 'D', 'E'])
  })

  it('E phrygian, G mixolydian and A aeolian sit on white keys too', () => {
    expect(degrees('E4', 'phrygian')).toEqual(['E', 'F', 'G', 'A', 'B', 'C', 'D'])
    expect(degrees('G4', 'mixolydian')).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F'])
    expect(degrees('A4', 'aeolian')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
  })

  it('C ionian is C major', () => {
    expect(degrees('C4', 'ionian')).toEqual(degrees('C4', 'major'))
  })

  it('transposes a mode correctly: Eb dorian is the Db major collection', () => {
    expect(degrees('Eb4', 'dorian')).toEqual(['Eb', 'F', 'Gb', 'Ab', 'Bb', 'C', 'Db'])
  })
})

describe('buildScale — non-heptatonic scales', () => {
  it('C major pentatonic drops the 4th and the 7th', () => {
    expect(degrees('C4', 'majorPentatonic')).toEqual(['C', 'D', 'E', 'G', 'A'])
  })

  it('A minor pentatonic is A C D E G', () => {
    expect(degrees('A4', 'minorPentatonic')).toEqual(['A', 'C', 'D', 'E', 'G'])
  })

  it('C blues writes the b5 on the same letter as the 5th', () => {
    // C Eb F Gb G Bb — Gb and G share the letter G, exactly as it is engraved.
    expect(degrees('C4', 'blues')).toEqual(['C', 'Eb', 'F', 'Gb', 'G', 'Bb'])
  })

  it('E blues is E G A Bb B D', () => {
    expect(degrees('E4', 'blues')).toEqual(['E', 'G', 'A', 'Bb', 'B', 'D'])
  })

  it('C whole tone is C D E F# G# A#', () => {
    expect(degrees('C4', 'wholeTone')).toEqual(['C', 'D', 'E', 'F#', 'G#', 'A#'])
  })

  it('Db whole tone comes out natural above the tonic', () => {
    // Db Eb F G A B — the same six sounds as C whole tone, spelled from Db.
    expect(degrees('Db4', 'wholeTone')).toEqual(['Db', 'Eb', 'F', 'G', 'A', 'B'])
  })

  it('C chromatic ascends with sharps', () => {
    expect(degrees('C4', 'chromatic')).toEqual([
      'C',
      'C#',
      'D',
      'D#',
      'E',
      'F',
      'F#',
      'G',
      'G#',
      'A',
      'A#',
      'B',
    ])
  })

  it('Eb chromatic keeps the flats of the key and sharpens the passing notes', () => {
    // Eb E F F# G Ab A Bb B C C# D — the diatonic degrees are Eb major's own.
    expect(degrees('Eb4', 'chromatic')).toEqual([
      'Eb',
      'E',
      'F',
      'F#',
      'G',
      'Ab',
      'A',
      'Bb',
      'B',
      'C',
      'C#',
      'D',
    ])
  })

  it('the chromatic scale spans the octave without repeating a sound', () => {
    const notes = buildScale(p('C4'), 'chromatic').notes
    expect(new Set(notes.map((n) => toMidi(n))).size).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// the symmetric scales — chromatic and whole tone choose their letters per key
// ---------------------------------------------------------------------------

/** Every tonic spelling with the given accidentals, in one octave. */
const tonicsWith = (alters: readonly Alter[]): readonly SpelledPitch[] =>
  LETTERS.flatMap((letter) => alters.map((alter): SpelledPitch => ({ letter, alter, octave: 4 })))

const SYMMETRIC: readonly ScaleType[] = ['chromatic', 'wholeTone']

describe('buildScale — the symmetric scales', () => {
  it('writes B whole tone as B C# D# F G A, not B C# D# E# F## G##', () => {
    // Six notes over seven letters must skip a letter. C skips B (C D E F# G#
    // A#); B skips E, because writing E# there would force F## and G## after it.
    expect(degrees('B4', 'wholeTone')).toEqual(['B', 'C#', 'D#', 'F', 'G', 'A'])
  })

  it('skips whichever letter the key needs it to', () => {
    const skipped = (tonic: string): Letter[] => {
      const used = new Set(scale(tonic, 'wholeTone').notes.map((n) => n.letter))
      return LETTERS.filter((l) => !used.has(l))
    }
    expect(skipped('C4')).toEqual(['B'])
    expect(skipped('Db4')).toEqual(['C'])
    expect(skipped('B4')).toEqual(['E'])
    expect(skipped('A#4')).toEqual(['B'])
    expect(skipped('Gb4')).toEqual(['F'])
  })

  it('spells whole tone from a sharp tonic without a double accidental', () => {
    expect(degrees('A#4', 'wholeTone')).toEqual(['A#', 'C', 'D', 'E', 'F#', 'G#'])
    expect(degrees('C#4', 'wholeTone')).toEqual(['C#', 'D#', 'F', 'G', 'A', 'B'])
    // B# whole tone used to be quoted as unwritable; it only needed the right letters.
    expect(degrees('B#4', 'wholeTone')).toEqual(['B#', 'D', 'E', 'F#', 'G#', 'A#'])
  })

  it('spells chromatic from a sharp tonic without a double accidental', () => {
    // C# would want C##, D##, E##, F##, G## if the letters were fixed to the key.
    expect(degrees('C#4', 'chromatic')).toEqual([
      'C#',
      'D',
      'D#',
      'E',
      'E#',
      'F#',
      'G',
      'G#',
      'A',
      'A#',
      'B',
      'B#',
    ])
    expect(degrees('A#4', 'chromatic')).toEqual([
      'A#',
      'B',
      'B#',
      'C#',
      'D',
      'D#',
      'E',
      'E#',
      'F#',
      'G',
      'G#',
      'A',
    ])
  })

  it('moves a degree the other way when the tonic is flat enough to need it', () => {
    // Fb chromatic: the fixed pattern would write the 6th degree on B, as Bbb.
    expect(degrees('Fb4', 'chromatic')).toEqual([
      'Fb',
      'F',
      'Gb',
      'G',
      'Ab',
      'A',
      'Bb',
      'Cb',
      'C',
      'Db',
      'D',
      'Eb',
    ])
  })

  it('never needs a double accidental in a key with a single-accidental tonic', () => {
    const offenders: string[] = []
    for (const tonic of tonicsWith(SIMPLE_ALTERS)) {
      for (const type of SYMMETRIC) {
        const built = buildScale(tonic, type)
        const doubled = built.notes.slice(1).filter((n) => Math.abs(n.alter) > 1)
        if (doubled.length > 0) {
          offenders.push(`${spelling(tonic)} ${type}: ${spellings(doubled).join(' ')}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('accepts one double accidental rather than refusing a double-accidental tonic', () => {
    // A documented decision, not an accident: six whole tones above D## simply
    // run out of letters, and C## is the least bad of the six possible spellings.
    expect(degrees('D##4', 'wholeTone')).toEqual(['D##', 'F#', 'G#', 'A#', 'B#', 'C##'])
    expect(degrees('D##4', 'chromatic')).toEqual([
      'D##',
      'E#',
      'F#',
      'G',
      'G#',
      'A',
      'A#',
      'B',
      'B#',
      'C#',
      'D',
      'D#',
    ])
  })

  it('sounds the right notes from every tonic there is, doubles included', () => {
    for (const tonic of tonicsWith(ALL_ALTERS)) {
      for (const type of SYMMETRIC) {
        const built = buildScale(tonic, type)
        expect(built.notes.map(spelledPitchClass)).toEqual(
          SCALE_INTERVALS[type].map((o) => (spelledPitchClass(tonic) + o) % 12),
        )
      }
    }
  })
})

// ---------------------------------------------------------------------------
// the keys that cannot be written at all
// ---------------------------------------------------------------------------

describe('buildScale — unwritable keys', () => {
  const label = (tonic: SpelledPitch, type: ScaleType): string => `${spelling(tonic)} ${type}`

  it('refuses exactly the keys in the unwritable table, and builds every other one', () => {
    const refused: string[] = []
    const listed: string[] = []
    for (const tonic of tonicsWith(ALL_ALTERS)) {
      for (const type of SCALE_TYPES) {
        if (isUnwritable(tonic, type)) listed.push(label(tonic, type))
        try {
          buildScale(tonic, type)
        } catch (error) {
          expect(error).toBeInstanceOf(InvariantError)
          refused.push(label(tonic, type))
        }
      }
    }
    expect([...refused].sort()).toEqual([...listed].sort())
    expect(refused.length).toBeGreaterThan(0)
  })

  it('never refuses a tonic that carries at most one accidental', () => {
    for (const tonic of tonicsWith(SIMPLE_ALTERS)) {
      for (const type of SCALE_TYPES) {
        expect(() => buildScale(tonic, type)).not.toThrow()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// scaleNotes
// ---------------------------------------------------------------------------

describe('scaleNotes', () => {
  it('returns one octave, tonic to tonic, by default', () => {
    expect(scaleNotes(p('C4'), 'major').map(pitchName)).toEqual([
      'C4',
      'D4',
      'E4',
      'F4',
      'G4',
      'A4',
      'B4',
      'C5',
    ])
  })

  it('repeats the pattern for more octaves and still ends on the tonic', () => {
    const two = scaleNotes(p('G3'), 'major', 2)
    expect(two).toHaveLength(15)
    expect(pitchName(at(two, 0))).toBe('G3')
    expect(pitchName(at(two, 7))).toBe('G4')
    expect(pitchName(at(two, 14))).toBe('G5')
  })

  it('sizes non-heptatonic scales from their own length', () => {
    expect(scaleNotes(p('C4'), 'chromatic')).toHaveLength(13)
    expect(scaleNotes(p('C4'), 'majorPentatonic')).toHaveLength(6)
    expect(scaleNotes(p('C4'), 'blues')).toHaveLength(7)
    expect(scaleNotes(p('C4'), 'wholeTone', 2)).toHaveLength(13)
  })

  it('rejects a non-positive or fractional octave count', () => {
    expect(() => scaleNotes(p('C4'), 'major', 0)).toThrow(RangeError)
    expect(() => scaleNotes(p('C4'), 'major', -1)).toThrow(RangeError)
    expect(() => scaleNotes(p('C4'), 'major', 1.5)).toThrow(/positive whole number/)
  })
})

// ---------------------------------------------------------------------------
// membership
// ---------------------------------------------------------------------------

describe('degreeOf', () => {
  const cMajor = scale('C4', 'major')

  it('finds the 1-based degree', () => {
    expect(degreeOf(cMajor, p('C4'))).toBe(1)
    expect(degreeOf(cMajor, p('E4'))).toBe(3)
    expect(degreeOf(cMajor, p('B4'))).toBe(7)
  })

  it('ignores the octave', () => {
    expect(degreeOf(cMajor, p('E7'))).toBe(3)
    expect(degreeOf(cMajor, p('E1'))).toBe(3)
  })

  it('returns null for a note outside the scale', () => {
    expect(degreeOf(cMajor, p('F#4'))).toBeNull()
  })

  it('is spelling-sensitive: Fb is not in C major even though it sounds like E', () => {
    expect(degreeOf(cMajor, p('Fb4'))).toBeNull()
    expect(degreeOf(cMajor, p('B#3'))).toBeNull()
  })

  it('distinguishes the two Gs of a blues scale', () => {
    const cBlues = scale('C4', 'blues')
    expect(degreeOf(cBlues, p('Gb4'))).toBe(4)
    expect(degreeOf(cBlues, p('G4'))).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// noteAtDegree
// ---------------------------------------------------------------------------

describe('noteAtDegree', () => {
  const cMajor = scale('C4', 'major')

  it('returns the degrees of the octave the scale was built in', () => {
    expect(pitchName(noteAtDegree(cMajor, 1))).toBe('C4')
    expect(pitchName(noteAtDegree(cMajor, 5))).toBe('G4')
    expect(pitchName(noteAtDegree(cMajor, 7))).toBe('B4')
  })

  it('wraps upward with an octave adjustment', () => {
    expect(pitchName(noteAtDegree(cMajor, 8))).toBe('C5')
    expect(pitchName(noteAtDegree(cMajor, 9))).toBe('D5')
    expect(pitchName(noteAtDegree(cMajor, 15))).toBe('C6')
  })

  it('wraps downward for degrees at or below zero', () => {
    expect(pitchName(noteAtDegree(cMajor, 0))).toBe('B3')
    expect(pitchName(noteAtDegree(cMajor, -6))).toBe('C3')
  })

  it('wraps on the scale length, not on seven', () => {
    const pent = scale('C4', 'majorPentatonic')
    expect(pitchName(noteAtDegree(pent, 6))).toBe('C5')
    expect(pitchName(noteAtDegree(pent, 7))).toBe('D5')
  })

  it('keeps the accidental when it wraps', () => {
    const fsMajor = scale('F#4', 'major')
    expect(pitchName(noteAtDegree(fsMajor, 7))).toBe('E#5')
    expect(pitchName(noteAtDegree(fsMajor, 14))).toBe('E#6')
  })

  it('rejects a fractional degree', () => {
    expect(() => noteAtDegree(cMajor, 2.5)).toThrow(RangeError)
    expect(() => noteAtDegree(cMajor, Number.NaN)).toThrow(/whole number/)
  })
})

// ---------------------------------------------------------------------------
// melodic minor descending
// ---------------------------------------------------------------------------

describe('melodicMinorDescending', () => {
  it('is the natural minor, top to bottom', () => {
    // Classical practice: A melodic minor descends A G F E D C B A — the raised
    // 6th and 7th of the ascending form are cancelled on the way down.
    expect(melodicMinorDescending(p('A4')).map(pitchName)).toEqual([
      'A5',
      'G5',
      'F5',
      'E5',
      'D5',
      'C5',
      'B4',
      'A4',
    ])
  })

  it('cancels the raised 6th and 7th of the ascending form', () => {
    expect(spellings(scaleNotes(p('C4'), 'melodicMinor'))).toEqual([
      'C',
      'D',
      'Eb',
      'F',
      'G',
      'A',
      'B',
      'C',
    ])
    expect(spellings(melodicMinorDescending(p('C4')))).toEqual([
      'C',
      'Bb',
      'Ab',
      'G',
      'F',
      'Eb',
      'D',
      'C',
    ])
  })

  it('descends strictly in sounding pitch', () => {
    const down = melodicMinorDescending(p('F#3'))
    for (let i = 1; i < down.length; i++) {
      expect(toMidi(at(down, i))).toBeLessThan(toMidi(at(down, i - 1)))
    }
  })
})

// ---------------------------------------------------------------------------
// naming
// ---------------------------------------------------------------------------

describe('scaleName', () => {
  it('names the tonic without its octave', () => {
    expect(scaleName(scale('F#4', 'harmonicMinor'))).toBe('F# harmonic minor')
    expect(scaleName(scale('C4', 'major'))).toBe('C major')
    expect(scaleName(scale('Bb2', 'wholeTone'))).toBe('Bb whole tone')
    expect(scaleName(scale('D5', 'dorian'))).toBe('D dorian')
    expect(scaleName(scale('A4', 'naturalMinor'))).toBe('A natural minor')
    expect(scaleName(scale('G4', 'minorPentatonic'))).toBe('G minor pentatonic')
  })

  it('handles double accidentals', () => {
    expect(scaleName(scale('Bbb4', 'major'))).toBe('Bbb major')
    expect(scaleName(scale('C##4', 'majorPentatonic'))).toBe('C## major pentatonic')
  })

  it('names every type', () => {
    for (const type of SCALE_TYPES) {
      expect(scaleName(scale('C4', type)).startsWith('C ')).toBe(true)
    }
  })
})

describe('degreeName', () => {
  it('uses the classical names for a major scale', () => {
    expect(SCALE_INTERVALS.major.map((_, i) => degreeName('major', i + 1))).toEqual([
      'tonic',
      'supertonic',
      'mediant',
      'subdominant',
      'dominant',
      'submediant',
      'leading tone',
    ])
  })

  it('calls the 7th a subtonic when it is a whole step below the tonic', () => {
    // G in A natural minor is a subtonic: it does not pull to the tonic the way
    // the G# of A harmonic minor does.
    expect(degreeName('naturalMinor', 7)).toBe('subtonic')
    expect(degreeName('dorian', 7)).toBe('subtonic')
    expect(degreeName('mixolydian', 7)).toBe('subtonic')
    expect(degreeName('phrygian', 7)).toBe('subtonic')
    expect(degreeName('locrian', 7)).toBe('subtonic')
    expect(degreeName('aeolian', 7)).toBe('subtonic')
  })

  it('calls the 7th a leading tone when it is a half step below the tonic', () => {
    expect(degreeName('harmonicMinor', 7)).toBe('leading tone')
    expect(degreeName('melodicMinor', 7)).toBe('leading tone')
    expect(degreeName('lydian', 7)).toBe('leading tone')
    expect(degreeName('ionian', 7)).toBe('leading tone')
  })

  it('agrees with SCALE_INTERVALS about every heptatonic 7th', () => {
    for (const type of HEPTATONIC) {
      const seventh = at(SCALE_INTERVALS[type], 6)
      expect(degreeName(type, 7)).toBe(seventh === 11 ? 'leading tone' : 'subtonic')
    }
  })

  it('will not call an altered 4th a subdominant or an altered 5th a dominant', () => {
    // Lydian's 4th is augmented and locrian's 5th is diminished: neither carries
    // the function the classical name claims, so neither gets the name.
    expect(degreeName('lydian', 4)).toBe('degree 4')
    expect(degreeName('locrian', 5)).toBe('degree 5')
    // The unaltered ones in the same two scales keep their names.
    expect(degreeName('lydian', 5)).toBe('dominant')
    expect(degreeName('locrian', 4)).toBe('subdominant')
  })

  it('agrees with SCALE_INTERVALS about every heptatonic 4th and 5th', () => {
    for (const type of HEPTATONIC) {
      expect(degreeName(type, 4)).toBe(
        at(SCALE_INTERVALS[type], 3) === 5 ? 'subdominant' : 'degree 4',
      )
      expect(degreeName(type, 5)).toBe(at(SCALE_INTERVALS[type], 4) === 7 ? 'dominant' : 'degree 5')
    }
  })

  it('falls back to a plain label for scales with no traditional degree names', () => {
    expect(degreeName('blues', 1)).toBe('tonic')
    expect(degreeName('blues', 4)).toBe('degree 4')
    expect(degreeName('chromatic', 12)).toBe('degree 12')
    expect(degreeName('majorPentatonic', 5)).toBe('degree 5')
    expect(degreeName('wholeTone', 2)).toBe('degree 2')
  })

  it('rejects a degree outside the scale', () => {
    expect(() => degreeName('major', 0)).toThrow(RangeError)
    expect(() => degreeName('major', 8)).toThrow(/outside 1\.\.7/)
    expect(() => degreeName('majorPentatonic', 6)).toThrow(/outside 1\.\.5/)
    expect(() => degreeName('major', 3.5)).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------
// fingering
// ---------------------------------------------------------------------------

describe('scaleFingering', () => {
  it('gives the C-major pattern to C, G, D, A and E', () => {
    // RH 1-2-3-1-2-3-4-5, LH 5-4-3-2-1-3-2-1.
    for (const key of ['C4', 'G4', 'D4', 'A4', 'E4']) {
      expect(scaleFingering(p(key), 'major')).toEqual({
        rightHand: [1, 2, 3, 1, 2, 3, 4, 5],
        leftHand: [5, 4, 3, 2, 1, 3, 2, 1],
      })
    }
  })

  it('gives F major the 1-2-3-4 right hand', () => {
    // The RH thumb has to land on C, so F major turns after the fourth finger.
    expect(scaleFingering(p('F4'), 'major')).toEqual({
      rightHand: [1, 2, 3, 4, 1, 2, 3, 4],
      leftHand: [5, 4, 3, 2, 1, 3, 2, 1],
    })
  })

  it('gives B major the 4-3-2-1-4-3-2-1 left hand', () => {
    expect(scaleFingering(p('B3'), 'major')).toEqual({
      rightHand: [1, 2, 3, 1, 2, 3, 4, 5],
      leftHand: [4, 3, 2, 1, 4, 3, 2, 1],
    })
  })

  it('encodes the flat keys and F# exactly', () => {
    expect(scaleFingering(p('Bb3'), 'major')).toEqual({
      rightHand: [4, 1, 2, 3, 1, 2, 3, 4],
      leftHand: [3, 2, 1, 4, 3, 2, 1, 3],
    })
    expect(scaleFingering(p('Eb4'), 'major')).toEqual({
      rightHand: [3, 1, 2, 3, 4, 1, 2, 3],
      leftHand: [3, 2, 1, 4, 3, 2, 1, 3],
    })
    expect(scaleFingering(p('Ab3'), 'major')).toEqual({
      rightHand: [3, 4, 1, 2, 3, 1, 2, 3],
      leftHand: [3, 2, 1, 4, 3, 2, 1, 3],
    })
    // F# major is F#-G#-A#-B-C#-D#-E#-F#: the thumb waits for B (the 4th) and
    // then for E# (the 7th), the only two white keys in the scale. Db's white
    // keys fall a degree earlier, which is why the two are *not* the same.
    expect(scaleFingering(p('F#4'), 'major')).toEqual({
      rightHand: [2, 3, 4, 1, 2, 3, 1, 2],
      leftHand: [4, 3, 2, 1, 3, 2, 1, 4],
    })
    expect(scaleFingering(p('Db4'), 'major')).toEqual({
      rightHand: [2, 3, 1, 2, 3, 4, 1, 2],
      leftHand: [3, 2, 1, 4, 3, 2, 1, 3],
    })
    expect(scaleFingering(p('F#4'), 'major')?.rightHand).not.toEqual(
      scaleFingering(p('Db4'), 'major')?.rightHand,
    )
  })

  it('puts the right thumb on the white key after each group of black keys', () => {
    const thumbNotes = (key: string): string[] => {
      const fingering = scaleFingering(p(key), 'major')
      expect(fingering).not.toBeNull()
      const rh = fingering === null ? [] : fingering.rightHand
      return spellings(scaleNotes(p(key), 'major')).filter((_, i) => rh[i] === 1)
    }
    // Bb: Bb-C-D-Eb-F-G-A-Bb, thumb on C and F. Eb: thumb on F and C.
    expect(thumbNotes('Bb3')).toEqual(['C', 'F'])
    expect(thumbNotes('Eb4')).toEqual(['F', 'C'])
    expect(thumbNotes('Ab3')).toEqual(['C', 'F'])
    expect(thumbNotes('Db4')).toEqual(['F', 'C'])
    // The two white keys of F# major are B and E#; written as Gb they are Cb and F.
    expect(thumbNotes('F#4')).toEqual(['B', 'E#'])
    expect(thumbNotes('Gb4')).toEqual(['Cb', 'F'])
  })

  it('never puts either thumb on a black key, in any major key', () => {
    // The real oracle for the whole table: the thumb is too short to play
    // between the other fingers, so no standard fingering ever asks it to.
    const BLACK = new Set([1, 3, 6, 8, 10])
    const offenders: string[] = []
    for (const tonic of tonicsWith(SIMPLE_ALTERS)) {
      const fingering = scaleFingering(tonic, 'major')
      expect(fingering).not.toBeNull()
      if (fingering === null) continue
      const notes = scaleNotes(tonic, 'major')
      for (const [hand, fingers] of [
        ['RH', fingering.rightHand],
        ['LH', fingering.leftHand],
      ] as const) {
        notes.forEach((note, i) => {
          if (at(fingers, i) === 1 && BLACK.has(spelledPitchClass(note))) {
            offenders.push(`${spelling(tonic)} major ${hand} thumb on ${spelling(note)}`)
          }
        })
      }
    }
    expect(offenders).toEqual([])
  })

  it('shares a fingering between enharmonic keys — they are the same keys under the hand', () => {
    expect(scaleFingering(p('Cb4'), 'major')).toEqual(scaleFingering(p('B3'), 'major'))
    expect(scaleFingering(p('Gb4'), 'major')).toEqual(scaleFingering(p('F#4'), 'major'))
    expect(scaleFingering(p('C#4'), 'major')).toEqual(scaleFingering(p('Db4'), 'major'))
    expect(scaleFingering(p('D#4'), 'major')).toEqual(scaleFingering(p('Eb4'), 'major'))
  })

  it('treats ionian as major', () => {
    expect(scaleFingering(p('D4'), 'ionian')).toEqual(scaleFingering(p('D4'), 'major'))
  })

  it('returns null where no standard fingering is defined', () => {
    for (const type of SCALE_TYPES) {
      if (type === 'major' || type === 'ionian') continue
      expect(scaleFingering(p('C4'), type)).toBeNull()
    }
  })

  it('gives one finger per note of the one-octave scale, all within 1..5', () => {
    for (const letter of LETTERS) {
      for (const alter of [-1, 0, 1] as const) {
        const tonic: SpelledPitch = { letter, alter, octave: 4 }
        const fingering = scaleFingering(tonic, 'major')
        expect(fingering).not.toBeNull()
        if (fingering === null) continue
        const noteCount = scaleNotes(tonic, 'major').length
        expect(fingering.rightHand).toHaveLength(noteCount)
        expect(fingering.leftHand).toHaveLength(noteCount)
        for (const finger of [...fingering.rightHand, ...fingering.leftHand]) {
          expect(finger).toBeGreaterThanOrEqual(1)
          expect(finger).toBeLessThanOrEqual(5)
        }
      }
    }
  })

  it('never jumps by more than a thumb-under between consecutive notes', () => {
    // Adjacent fingers move by 1 except where the thumb passes under (3->1 or
    // 4->1) or crosses over. A gap of 4 would be unplayable.
    for (const key of [
      'C4',
      'Db4',
      'D4',
      'Eb4',
      'E4',
      'F4',
      'F#4',
      'G4',
      'Ab4',
      'A4',
      'Bb4',
      'B4',
    ]) {
      const fingering = scaleFingering(p(key), 'major')
      expect(fingering).not.toBeNull()
      if (fingering === null) continue
      for (const hand of [fingering.rightHand, fingering.leftHand]) {
        for (let i = 1; i < hand.length; i++) {
          const step = Math.abs(at(hand, i) - at(hand, i - 1))
          expect(step).toBeGreaterThanOrEqual(1)
          expect(step).toBeLessThanOrEqual(3)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// properties
// ---------------------------------------------------------------------------

describe('properties', () => {
  it('a seven-note scale uses each letter exactly once, in every key', () => {
    fc.assert(
      fc.property(arbAnyTonic, arbHeptatonicType, (tonic, type) => {
        const built = tryBuild(tonic, type)
        if (built === null) return
        const letters = built.notes.map((n) => n.letter)
        expect(new Set(letters).size).toBe(7)
        expect([...letters].sort()).toEqual([...LETTERS].sort())
      }),
    )
  })

  it('the semitone gaps of a built scale are exactly SCALE_INTERVALS', () => {
    fc.assert(
      fc.property(arbTonic, arbType, (tonic, type) => {
        const built = tryBuild(tonic, type)
        if (built === null) return
        const base = toMidi(tonic)
        built.notes.forEach((note, i) => {
          expect(toMidi(note) - base).toBe(at(SCALE_INTERVALS[type], i))
        })
      }),
    )
  })

  it('agrees with intervals.ts about every diatonic degree', () => {
    fc.assert(
      fc.property(arbTonic, arbHeptatonicType, (tonic, type) => {
        const built = tryBuild(tonic, type)
        if (built === null) return
        built.notes.forEach((note, i) => {
          const interval = intervalBetween(tonic, note)
          expect(interval.number).toBe(i + 1)
          expect(interval.semitones).toBe(at(SCALE_INTERVALS[type], i))
        })
      }),
    )
  })

  it('degreeOf(noteAtDegree(s, d)) is d wrapped into the scale', () => {
    fc.assert(
      fc.property(arbAnyTonic, arbType, fc.integer({ min: 1, max: 40 }), (tonic, type, degree) => {
        const built = tryBuild(tonic, type)
        if (built === null) return
        const period = built.notes.length
        expect(degreeOf(built, noteAtDegree(built, degree))).toBe(((degree - 1) % period) + 1)
      }),
    )
  })

  it('noteAtDegree(d + length) is exactly one octave above noteAtDegree(d)', () => {
    fc.assert(
      fc.property(arbTonic, arbType, fc.integer({ min: 1, max: 20 }), (tonic, type, degree) => {
        const built = tryBuild(tonic, type)
        if (built === null) return
        const low = noteAtDegree(built, degree)
        const high = noteAtDegree(built, degree + built.notes.length)
        expect(high.letter).toBe(low.letter)
        expect(high.alter).toBe(low.alter)
        expect(high.octave).toBe(low.octave + 1)
      }),
    )
  })

  it('scaleNotes ascends strictly and ends on the tonic', () => {
    fc.assert(
      fc.property(arbTonic, arbType, fc.integer({ min: 1, max: 3 }), (tonic, type, octaves) => {
        if (tryBuild(tonic, type) === null) return
        const notes = scaleNotes(tonic, type, octaves)
        expect(notes).toHaveLength(SCALE_INTERVALS[type].length * octaves + 1)
        for (let i = 1; i < notes.length; i++) {
          expect(toMidi(at(notes, i))).toBeGreaterThan(toMidi(at(notes, i - 1)))
        }
        const last = at(notes, notes.length - 1)
        expect(last.letter).toBe(tonic.letter)
        expect(last.alter).toBe(tonic.alter)
        expect(last.octave).toBe(tonic.octave + octaves)
      }),
    )
  })

  it('melodic minor ascending differs from natural minor in exactly the 6th and 7th', () => {
    fc.assert(
      fc.property(arbAnyTonic, (tonic) => {
        const natural = tryBuild(tonic, 'naturalMinor')
        const melodic = tryBuild(tonic, 'melodicMinor')
        if (natural === null || melodic === null) return
        const differing = natural.notes
          .map((n, i) => (spelling(n) === spelling(at(melodic.notes, i)) ? null : i + 1))
          .filter((d): d is number => d !== null)
        expect(differing).toEqual([6, 7])
      }),
    )
  })

  it('harmonic minor differs from natural minor in exactly the 7th', () => {
    fc.assert(
      fc.property(arbAnyTonic, (tonic) => {
        const natural = tryBuild(tonic, 'naturalMinor')
        const harmonic = tryBuild(tonic, 'harmonicMinor')
        if (natural === null || harmonic === null) return
        const differing = natural.notes
          .map((n, i) => (spelling(n) === spelling(at(harmonic.notes, i)) ? null : i + 1))
          .filter((d): d is number => d !== null)
        expect(differing).toEqual([7])
      }),
    )
  })

  it('every mode of C major contains exactly the white keys', () => {
    const tonics = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']
    MODES.forEach((mode, i) => {
      const notes = scale(at(tonics, i), mode).notes
      expect(notes.every((n) => n.alter === 0)).toBe(true)
      expect([...notes.map((n) => n.letter)].sort()).toEqual([...LETTERS].sort())
    })
  })

  it('a mode built on a degree of the major scale uses that major scale’s sounds', () => {
    const pitchClasses = (s: Scale): number[] => [...s.notes.map((n) => toMidi(n) % 12)].sort()
    fc.assert(
      fc.property(arbTonic, (tonic) => {
        const major = tryBuild(tonic, 'major')
        if (major === null) return
        MODES.forEach((mode, i) => {
          const modal = tryBuild(noteAtDegree(major, i + 1), mode)
          if (modal === null) return
          expect(pitchClasses(modal)).toEqual(pitchClasses(major))
        })
      }),
    )
  })

  it('a scale is fully determined by its tonic and type', () => {
    fc.assert(
      fc.property(arbTonic, arbType, (tonic, type) => {
        const built = tryBuild(tonic, type)
        if (built === null) return
        expect(buildScale(built.tonic, built.type)).toEqual(built)
        expect(built.notes).toHaveLength(SCALE_INTERVALS[type].length)
      }),
    )
  })
})
