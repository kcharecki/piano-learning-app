import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { isErr, isOk, unwrap } from '@core/shared/result.ts'
import { midi, type Midi } from '@core/shared/units.ts'
import {
  type Alter,
  compareSpelled,
  diatonicStep,
  fromMidi,
  isEnharmonic,
  type Letter,
  LETTERS,
  letterIndex,
  midiToName,
  octaveOf,
  parsePitch,
  pitchClass,
  pitchName,
  spell,
  type SpelledPitch,
  spelledPitchClass,
  toMidi,
  transposeMidi,
  tryToMidi,
} from './pitch.ts'

// ---------------------------------------------------------------------------
// arbitraries
// ---------------------------------------------------------------------------

const arbLetter = fc.constantFrom<Letter>('C', 'D', 'E', 'F', 'G', 'A', 'B')
const arbAlter = fc.constantFrom<Alter>(-2, -1, 0, 1, 2)
/** Octaves that both `parsePitch` and scientific notation accept. */
const arbOctave = fc.integer({ min: -1, max: 9 })
const arbSpelled: fc.Arbitrary<SpelledPitch> = fc.record({
  letter: arbLetter,
  alter: arbAlter,
  octave: arbOctave,
})
/** Spellings that actually sound inside the MIDI range. */
const arbPlayable = arbSpelled.filter((p) => isOk(tryToMidi(p)))
const arbMidi: fc.Arbitrary<Midi> = fc.integer({ min: 0, max: 127 }).map(midi)

const ALL_MIDI: readonly Midi[] = Array.from({ length: 128 }, (_, i) => midi(i))

// ---------------------------------------------------------------------------
// LETTERS / letterIndex
// ---------------------------------------------------------------------------

describe('LETTERS', () => {
  it('lists the seven naturals in diatonic order from C', () => {
    expect(LETTERS).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B'])
  })

  it('indexes C=0 through B=6', () => {
    expect(letterIndex('C')).toBe(0)
    expect(letterIndex('D')).toBe(1)
    expect(letterIndex('E')).toBe(2)
    expect(letterIndex('F')).toBe(3)
    expect(letterIndex('G')).toBe(4)
    expect(letterIndex('A')).toBe(5)
    expect(letterIndex('B')).toBe(6)
  })

  it('letterIndex inverts LETTERS for every letter', () => {
    fc.assert(
      fc.property(arbLetter, (l) => {
        expect(LETTERS[letterIndex(l)]).toBe(l)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// spell
// ---------------------------------------------------------------------------

describe('spell', () => {
  it('builds a pitch from its three parts', () => {
    expect(spell('C', 1, 4)).toEqual({ letter: 'C', alter: 1, octave: 4 })
    expect(spell('B', -2, -1)).toEqual({ letter: 'B', alter: -2, octave: -1 })
  })

  it('rejects a non-integer octave as programmer error', () => {
    expect(() => spell('C', 0, 4.5)).toThrow(RangeError)
    expect(() => spell('C', 0, NaN)).toThrow(RangeError)
    expect(() => spell('C', 0, Infinity)).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------
// toMidi / tryToMidi
// ---------------------------------------------------------------------------

describe('toMidi', () => {
  it('anchors middle C at 60', () => {
    expect(toMidi(spell('C', 0, 4))).toBe(60)
  })

  it('matches the required reference points', () => {
    expect(toMidi(spell('C', 0, 4))).toBe(60) // middle C
    expect(toMidi(spell('A', 0, 0))).toBe(21) // lowest key of an 88-key piano
    expect(toMidi(spell('C', 0, 8))).toBe(108) // highest key of an 88-key piano
    expect(toMidi(spell('B', 1, 3))).toBe(60) // B#3 sounds as middle C
    expect(toMidi(spell('C', -1, 4))).toBe(59) // Cb4 sounds as B3
  })

  it('spans the whole MIDI range at its extremes', () => {
    expect(toMidi(spell('C', 0, -1))).toBe(0)
    expect(toMidi(spell('G', 0, 9))).toBe(127)
  })

  it('places every natural letter correctly within octave 4', () => {
    // C major scale from middle C: 60 62 64 65 67 69 71
    const scale = LETTERS.map((l) => toMidi(spell(l, 0, 4)))
    expect(scale).toEqual([60, 62, 64, 65, 67, 69, 71])
  })

  it('applies every accidental', () => {
    expect(toMidi(spell('D', -2, 4))).toBe(60) // Dbb4 = C4
    expect(toMidi(spell('D', -1, 4))).toBe(61)
    expect(toMidi(spell('D', 0, 4))).toBe(62)
    expect(toMidi(spell('D', 1, 4))).toBe(63)
    expect(toMidi(spell('D', 2, 4))).toBe(64) // Dx4 = E4
  })

  it('keeps the written octave when the accidental crosses C — the classic bug', () => {
    // Cb4 is written in octave 4 but sounds a semitone below C4.
    expect(toMidi(spell('C', -1, 4))).toBe(59)
    expect(toMidi(spell('B', 0, 3))).toBe(59)
    // B#3 is written in octave 3 but sounds as C4.
    expect(toMidi(spell('B', 1, 3))).toBe(60)
    expect(toMidi(spell('C', 0, 4))).toBe(60)
    // ...and the two do NOT collapse to the same spelled octave.
    expect(fromMidi(toMidi(spell('B', 1, 3))).octave).toBe(4)
    expect(fromMidi(toMidi(spell('C', -1, 4))).octave).toBe(3)
  })

  it('throws a RangeError below and above the MIDI range', () => {
    expect(() => toMidi(spell('C', -1, -1))).toThrow(RangeError) // sounds as -1
    expect(() => toMidi(spell('C', 0, -2))).toThrow(RangeError)
    expect(() => toMidi(spell('G', 1, 9))).toThrow(RangeError) // sounds as 128
    expect(() => toMidi(spell('C', 0, 10))).toThrow(RangeError)
  })

  it('names the offending pitch in the error message', () => {
    expect(() => toMidi(spell('G', 2, 9))).toThrow(/G##9/)
    expect(() => toMidi(spell('C', -2, -1))).toThrow(/0\.\.127/)
  })
})

describe('tryToMidi', () => {
  it('returns Ok for a playable pitch', () => {
    const r = tryToMidi(spell('A', 0, 4))
    expect(isOk(r)).toBe(true)
    expect(unwrap(r)).toBe(69)
  })

  it('returns Err instead of throwing for an unplayable one', () => {
    const r = tryToMidi(spell('C', 0, 12))
    expect(isErr(r)).toBe(true)
    if (isErr(r)) expect(r.error).toContain('C12')
  })

  it('agrees with toMidi on every spelling', () => {
    fc.assert(
      fc.property(arbSpelled, (p) => {
        const r = tryToMidi(p)
        if (isOk(r)) expect(toMidi(p)).toBe(r.value)
        else expect(() => toMidi(p)).toThrow(RangeError)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// fromMidi / midiToName
// ---------------------------------------------------------------------------

describe('fromMidi', () => {
  it('spells white keys as naturals regardless of preference', () => {
    for (const preferFlats of [false, true]) {
      expect(fromMidi(midi(60), preferFlats)).toEqual({ letter: 'C', alter: 0, octave: 4 })
      expect(fromMidi(midi(62), preferFlats)).toEqual({ letter: 'D', alter: 0, octave: 4 })
      expect(fromMidi(midi(64), preferFlats)).toEqual({ letter: 'E', alter: 0, octave: 4 })
      expect(fromMidi(midi(65), preferFlats)).toEqual({ letter: 'F', alter: 0, octave: 4 })
      expect(fromMidi(midi(67), preferFlats)).toEqual({ letter: 'G', alter: 0, octave: 4 })
      expect(fromMidi(midi(69), preferFlats)).toEqual({ letter: 'A', alter: 0, octave: 4 })
      expect(fromMidi(midi(71), preferFlats)).toEqual({ letter: 'B', alter: 0, octave: 4 })
    }
  })

  it('defaults black keys to sharps', () => {
    const blackKeys = [61, 63, 66, 68, 70].map((n) => midiToName(midi(n)))
    expect(blackKeys).toEqual(['C#4', 'D#4', 'F#4', 'G#4', 'A#4'])
  })

  it('uses flats when asked', () => {
    const blackKeys = [61, 63, 66, 68, 70].map((n) => midiToName(midi(n), true))
    expect(blackKeys).toEqual(['Db4', 'Eb4', 'Gb4', 'Ab4', 'Bb4'])
  })

  it('never produces B#, Cb, E# or Fb', () => {
    for (const preferFlats of [false, true]) {
      for (const n of ALL_MIDI) {
        const name = midiToName(n, preferFlats)
        expect(name).not.toMatch(/^(B#|Cb|E#|Fb)/)
      }
    }
  })

  it('numbers octaves from C-1 at MIDI 0', () => {
    expect(midiToName(midi(0))).toBe('C-1')
    expect(midiToName(midi(11))).toBe('B-1')
    expect(midiToName(midi(12))).toBe('C0')
    expect(midiToName(midi(21))).toBe('A0') // lowest piano key
    expect(midiToName(midi(108))).toBe('C8') // highest piano key
    expect(midiToName(midi(127))).toBe('G9')
  })

  it('round-trips every MIDI note under both preferences', () => {
    for (const preferFlats of [false, true]) {
      for (const n of ALL_MIDI) {
        expect(toMidi(fromMidi(n, preferFlats))).toBe(n)
      }
    }
  })

  it('is idempotent through toMidi (property)', () => {
    fc.assert(
      fc.property(arbMidi, fc.boolean(), (n, preferFlats) => {
        const once = fromMidi(n, preferFlats)
        expect(fromMidi(toMidi(once), preferFlats)).toEqual(once)
      }),
    )
  })

  it('toMidi(fromMidi(n)) === n (property, both preferences)', () => {
    fc.assert(
      fc.property(arbMidi, fc.boolean(), (n, preferFlats) => {
        expect(toMidi(fromMidi(n, preferFlats))).toBe(n)
      }),
    )
  })

  it('sharp and flat spellings of the same note are enharmonic (property)', () => {
    fc.assert(
      fc.property(arbMidi, (n) => {
        expect(isEnharmonic(fromMidi(n, false), fromMidi(n, true))).toBe(true)
      }),
    )
  })
})

describe('midiToName', () => {
  it('is pitchName after fromMidi (property)', () => {
    fc.assert(
      fc.property(arbMidi, fc.boolean(), (n, preferFlats) => {
        expect(midiToName(n, preferFlats)).toBe(pitchName(fromMidi(n, preferFlats)))
      }),
    )
  })

  it('defaults to sharps when the preference is omitted', () => {
    expect(midiToName(midi(61))).toBe(pitchName(fromMidi(midi(61))))
    expect(midiToName(midi(61))).toBe('C#4')
  })
})

// ---------------------------------------------------------------------------
// pitchName
// ---------------------------------------------------------------------------

describe('pitchName', () => {
  it('formats each accidental', () => {
    expect(pitchName(spell('C', 0, 4))).toBe('C4')
    expect(pitchName(spell('C', 1, 4))).toBe('C#4')
    expect(pitchName(spell('F', 2, 2))).toBe('F##2')
    expect(pitchName(spell('B', -1, 3))).toBe('Bb3')
    expect(pitchName(spell('E', -2, 5))).toBe('Ebb5')
  })

  it('writes negative octaves', () => {
    expect(pitchName(spell('C', 0, -1))).toBe('C-1')
    expect(pitchName(spell('A', -1, -1))).toBe('Ab-1')
  })
})

// ---------------------------------------------------------------------------
// parsePitch
// ---------------------------------------------------------------------------

describe('parsePitch', () => {
  it('parses the canonical forms', () => {
    expect(unwrap(parsePitch('C4'))).toEqual({ letter: 'C', alter: 0, octave: 4 })
    expect(unwrap(parsePitch('C#4'))).toEqual({ letter: 'C', alter: 1, octave: 4 })
    expect(unwrap(parsePitch('Bb3'))).toEqual({ letter: 'B', alter: -1, octave: 3 })
    expect(unwrap(parsePitch('F##2'))).toEqual({ letter: 'F', alter: 2, octave: 2 })
    expect(unwrap(parsePitch('Ebb5'))).toEqual({ letter: 'E', alter: -2, octave: 5 })
    expect(unwrap(parsePitch('C-1'))).toEqual({ letter: 'C', alter: 0, octave: -1 })
  })

  it("accepts 's' as an alias for '#'", () => {
    expect(parsePitch('Cs4')).toEqual(parsePitch('C#4'))
    expect(parsePitch('Fss2')).toEqual(parsePitch('F##2'))
  })

  it('is case-insensitive on the letter and the accidentals', () => {
    expect(parsePitch('c4')).toEqual(parsePitch('C4'))
    expect(parsePitch('bb3')).toEqual(parsePitch('Bb3'))
    expect(parsePitch('BB3')).toEqual(parsePitch('Bb3'))
    expect(parsePitch('cS4')).toEqual(parsePitch('C#4'))
  })

  it('tolerates surrounding whitespace', () => {
    expect(parsePitch('  G#5\t')).toEqual(parsePitch('G#5'))
  })

  it('rejects empty and blank input', () => {
    expect(isErr(parsePitch(''))).toBe(true)
    expect(isErr(parsePitch('   '))).toBe(true)
    const r = parsePitch('')
    if (isErr(r)) expect(r.error).toBe('empty pitch name')
  })

  it('rejects malformed input', () => {
    for (const bad of ['C', '4', 'C4.5', 'C4x', 'x', '#4', 'C 4', 'C+4', 'CC4', '--1']) {
      expect(isErr(parsePitch(bad))).toBe(true)
    }
  })

  it('rejects letters outside A–G', () => {
    const r = parsePitch('H4')
    expect(isErr(r)).toBe(true)
    if (isErr(r)) expect(r.error).toContain('H')
    expect(isErr(parsePitch('z-1'))).toBe(true)
  })

  it('rejects mixed accidentals', () => {
    const r = parsePitch('C#b4')
    expect(isErr(r)).toBe(true)
    if (isErr(r)) expect(r.error).toContain('mixed')
    expect(isErr(parsePitch('Cbs4'))).toBe(true)
  })

  it('rejects more than a double sharp or double flat', () => {
    const r = parsePitch('C###4')
    expect(isErr(r)).toBe(true)
    if (isErr(r)) expect(r.error).toContain('too many')
    expect(isErr(parsePitch('Cbbb4'))).toBe(true)
    expect(isOk(parsePitch('C##4'))).toBe(true)
    expect(isOk(parsePitch('Cbb4'))).toBe(true)
  })

  it('rejects octaves far outside the usable range', () => {
    expect(isErr(parsePitch('C11'))).toBe(true)
    expect(isErr(parsePitch('C-3'))).toBe(true)
    expect(isOk(parsePitch('C10'))).toBe(true)
    expect(isOk(parsePitch('C-2'))).toBe(true)
    const r = parsePitch('C99')
    if (isErr(r)) expect(r.error).toContain('out of range')
  })

  it('round-trips pitchName for every valid spelling (property)', () => {
    fc.assert(
      fc.property(arbSpelled, (p) => {
        expect(unwrap(parsePitch(pitchName(p)))).toEqual(p)
      }),
    )
  })

  it('round-trips through lower case and upper case (property)', () => {
    fc.assert(
      fc.property(arbSpelled, (p) => {
        const name = pitchName(p)
        expect(unwrap(parsePitch(name.toLowerCase()))).toEqual(p)
        expect(unwrap(parsePitch(name.toUpperCase()))).toEqual(p)
      }),
    )
  })

  it("treats 's' and '#' spellings identically (property)", () => {
    fc.assert(
      fc.property(arbSpelled, (p) => {
        const name = pitchName(p)
        expect(parsePitch(name.replace(/#/g, 's'))).toEqual(parsePitch(name))
      }),
    )
  })

  it('never throws, whatever the input (property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parsePitch(s)).not.toThrow()
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// pitch classes and octaves
// ---------------------------------------------------------------------------

describe('pitchClass', () => {
  it('maps C to 0 in every octave', () => {
    expect(pitchClass(midi(0))).toBe(0)
    expect(pitchClass(midi(60))).toBe(0)
    expect(pitchClass(midi(120))).toBe(0)
    expect(pitchClass(midi(69))).toBe(9) // A
    expect(pitchClass(midi(127))).toBe(7) // G
  })

  it('always lands in 0..11 (property)', () => {
    fc.assert(
      fc.property(arbMidi, (n) => {
        const pc = pitchClass(n)
        expect(pc).toBeGreaterThanOrEqual(0)
        expect(pc).toBeLessThanOrEqual(11)
      }),
    )
  })
})

describe('octaveOf', () => {
  it('puts middle C in octave 4', () => {
    expect(octaveOf(midi(60))).toBe(4)
    expect(octaveOf(midi(59))).toBe(3)
    expect(octaveOf(midi(0))).toBe(-1)
    expect(octaveOf(midi(12))).toBe(0)
    expect(octaveOf(midi(127))).toBe(9)
  })

  it('reconstructs the note from octave and pitch class (property)', () => {
    fc.assert(
      fc.property(arbMidi, (n) => {
        expect((octaveOf(n) + 1) * 12 + pitchClass(n)).toBe(n)
      }),
    )
  })
})

describe('spelledPitchClass', () => {
  it('wraps at both ends of the octave', () => {
    expect(spelledPitchClass(spell('C', 0, 4))).toBe(0)
    expect(spelledPitchClass(spell('C', -1, 4))).toBe(11) // Cb wraps down to B
    expect(spelledPitchClass(spell('C', -2, 4))).toBe(10) // Cbb wraps down to Bb
    expect(spelledPitchClass(spell('B', 1, 3))).toBe(0) // B# wraps up to C
    expect(spelledPitchClass(spell('B', 2, 3))).toBe(1) // Bx wraps up to C#
  })

  it('ignores the octave (property)', () => {
    fc.assert(
      fc.property(arbLetter, arbAlter, arbOctave, arbOctave, (letter, alter, o1, o2) => {
        expect(spelledPitchClass(spell(letter, alter, o1))).toBe(
          spelledPitchClass(spell(letter, alter, o2)),
        )
      }),
    )
  })

  it('agrees with pitchClass of the sounding note (property)', () => {
    fc.assert(
      fc.property(arbPlayable, (p) => {
        expect(spelledPitchClass(p)).toBe(pitchClass(toMidi(p)))
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// diatonicStep
// ---------------------------------------------------------------------------

describe('diatonicStep', () => {
  it('carries the octave at the B→C boundary', () => {
    expect(diatonicStep(spell('B', 0, 4), 1)).toEqual({ letter: 'C', alter: 0, octave: 5 })
    expect(diatonicStep(spell('C', 0, 4), -1)).toEqual({ letter: 'B', alter: 0, octave: 3 })
  })

  it('is the identity for zero steps', () => {
    expect(diatonicStep(spell('E', -1, 3), 0)).toEqual({ letter: 'E', alter: -1, octave: 3 })
  })

  it('walks up the C major scale', () => {
    const notes = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => pitchName(diatonicStep(spell('C', 0, 4), s)))
    expect(notes).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'])
  })

  it('keeps the accidental, which is letter arithmetic not scale spelling', () => {
    // F#4 up three letter-steps is B, and the sharp rides along: B#4.
    expect(diatonicStep(spell('F', 1, 4), 3)).toEqual({ letter: 'B', alter: 1, octave: 4 })
  })

  it('crosses several octaves in either direction', () => {
    expect(diatonicStep(spell('C', 0, 4), 14)).toEqual({ letter: 'C', alter: 0, octave: 6 })
    expect(diatonicStep(spell('C', 0, 4), -14)).toEqual({ letter: 'C', alter: 0, octave: 2 })
    expect(diatonicStep(spell('A', 0, 4), -6)).toEqual({ letter: 'B', alter: 0, octave: 3 })
  })

  it('rejects non-integer steps', () => {
    expect(() => diatonicStep(spell('C', 0, 4), 1.5)).toThrow(RangeError)
    expect(() => diatonicStep(spell('C', 0, 4), NaN)).toThrow(RangeError)
  })

  it('is invertible (property)', () => {
    fc.assert(
      fc.property(arbSpelled, fc.integer({ min: -30, max: 30 }), (p, steps) => {
        expect(diatonicStep(diatonicStep(p, steps), -steps)).toEqual(p)
      }),
    )
  })

  it('moves exactly one octave per seven steps (property)', () => {
    fc.assert(
      fc.property(arbSpelled, fc.integer({ min: -4, max: 4 }), (p, octaves) => {
        const moved = diatonicStep(p, octaves * 7)
        expect(moved.letter).toBe(p.letter)
        expect(moved.alter).toBe(p.alter)
        expect(moved.octave).toBe(p.octave + octaves)
      }),
    )
  })

  it('composes additively (property)', () => {
    fc.assert(
      fc.property(
        arbSpelled,
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        (p, a, b) => {
          expect(diatonicStep(diatonicStep(p, a), b)).toEqual(diatonicStep(p, a + b))
        },
      ),
    )
  })

  it('is strictly increasing in the number of steps (property)', () => {
    fc.assert(
      fc.property(arbSpelled, fc.integer({ min: -20, max: 20 }), (p, steps) => {
        const lower = diatonicStep(p, steps)
        const upper = diatonicStep(p, steps + 1)
        expect(compareSpelled(lower, upper)).toBeLessThan(0)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// transposeMidi
// ---------------------------------------------------------------------------

describe('transposeMidi', () => {
  it('moves by semitones', () => {
    expect(transposeMidi(midi(60), 12)).toBe(72)
    expect(transposeMidi(midi(60), -12)).toBe(48)
    expect(transposeMidi(midi(60), 0)).toBe(60)
    expect(transposeMidi(midi(60), 7)).toBe(67) // up a perfect fifth
  })

  it('throws when the result leaves the MIDI range', () => {
    expect(() => transposeMidi(midi(0), -1)).toThrow(RangeError)
    expect(() => transposeMidi(midi(127), 1)).toThrow(RangeError)
    expect(() => transposeMidi(midi(60), 0.5)).toThrow(RangeError)
  })

  it('allows the exact boundaries', () => {
    expect(transposeMidi(midi(1), -1)).toBe(0)
    expect(transposeMidi(midi(126), 1)).toBe(127)
  })

  it('is inverted by the opposite interval (property)', () => {
    fc.assert(
      fc.property(arbMidi, fc.integer({ min: -127, max: 127 }), (n, i) => {
        const moved = n + i
        if (moved < 0 || moved > 127) {
          expect(() => transposeMidi(n, i)).toThrow(RangeError)
          return
        }
        expect(transposeMidi(transposeMidi(n, i), -i)).toBe(n)
      }),
    )
  })

  it('preserves pitch class when transposing by octaves (property)', () => {
    fc.assert(
      fc.property(arbMidi, fc.integer({ min: -4, max: 4 }), (n, octaves) => {
        const moved = n + octaves * 12
        fc.pre(moved >= 0 && moved <= 127)
        expect(pitchClass(transposeMidi(n, octaves * 12))).toBe(pitchClass(n))
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// isEnharmonic
// ---------------------------------------------------------------------------

describe('isEnharmonic', () => {
  it('matches different spellings of the same sounding note', () => {
    expect(isEnharmonic(spell('C', 1, 4), spell('D', -1, 4))).toBe(true)
    expect(isEnharmonic(spell('B', 1, 3), spell('C', 0, 4))).toBe(true)
    expect(isEnharmonic(spell('C', -1, 4), spell('B', 0, 3))).toBe(true)
    expect(isEnharmonic(spell('E', 1, 4), spell('F', 0, 4))).toBe(true)
    expect(isEnharmonic(spell('F', 2, 2), spell('G', 0, 2))).toBe(true)
  })

  it('separates notes an octave apart', () => {
    expect(isEnharmonic(spell('C', 0, 4), spell('C', 0, 5))).toBe(false)
    expect(isEnharmonic(spell('C', 1, 4), spell('D', -1, 5))).toBe(false)
  })

  it('is reflexive (property)', () => {
    fc.assert(
      fc.property(arbSpelled, (p) => {
        expect(isEnharmonic(p, p)).toBe(true)
      }),
    )
  })

  it('is symmetric (property)', () => {
    fc.assert(
      fc.property(arbSpelled, arbSpelled, (a, b) => {
        expect(isEnharmonic(a, b)).toBe(isEnharmonic(b, a))
      }),
    )
  })

  it('is transitive (property)', () => {
    // Biased towards collisions: all three share a sounding pitch class.
    fc.assert(
      fc.property(arbSpelled, arbSpelled, arbSpelled, (a, b, c) => {
        if (isEnharmonic(a, b) && isEnharmonic(b, c)) expect(isEnharmonic(a, c)).toBe(true)
      }),
    )
    fc.assert(
      fc.property(arbMidi, fc.boolean(), fc.boolean(), (n, f1, f2) => {
        const a = fromMidi(n, f1)
        const b = fromMidi(n, f2)
        const c = fromMidi(n, !f1)
        expect(isEnharmonic(a, b) && isEnharmonic(b, c)).toBe(true)
        expect(isEnharmonic(a, c)).toBe(true)
      }),
    )
  })

  it('agrees with equality of sounding MIDI (property)', () => {
    fc.assert(
      fc.property(arbPlayable, arbPlayable, (a, b) => {
        expect(isEnharmonic(a, b)).toBe(toMidi(a) === toMidi(b))
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// compareSpelled
// ---------------------------------------------------------------------------

describe('compareSpelled', () => {
  it('orders by sounding pitch first', () => {
    expect(compareSpelled(spell('C', 0, 4), spell('D', 0, 4))).toBeLessThan(0)
    expect(compareSpelled(spell('D', 0, 4), spell('C', 0, 4))).toBeGreaterThan(0)
    expect(compareSpelled(spell('C', 0, 4), spell('C', 0, 4))).toBe(0)
    expect(compareSpelled(spell('B', 0, 3), spell('C', 0, 4))).toBeLessThan(0)
  })

  it('breaks enharmonic ties by letter', () => {
    // All three sound as MIDI 60; the order is C4 < Dbb4 < B#3.
    const sorted = [spell('B', 1, 3), spell('D', -2, 4), spell('C', 0, 4)].sort(compareSpelled)
    expect(sorted.map(pitchName)).toEqual(['C4', 'Dbb4', 'B#3'])
  })

  it('sorts a chord into pitch order', () => {
    // C major triad, deliberately scrambled.
    const chord = [spell('G', 0, 4), spell('C', 0, 4), spell('E', 0, 4)]
    expect([...chord].sort(compareSpelled).map(pitchName)).toEqual(['C4', 'E4', 'G4'])
  })

  it('is consistent with toMidi (property)', () => {
    fc.assert(
      fc.property(arbPlayable, arbPlayable, (a, b) => {
        const cmp = compareSpelled(a, b)
        const diff = toMidi(a) - toMidi(b)
        if (diff !== 0) expect(Math.sign(cmp)).toBe(Math.sign(diff))
        else expect(cmp).toBe(letterIndex(a.letter) - letterIndex(b.letter))
      }),
    )
  })

  it('is antisymmetric (property)', () => {
    fc.assert(
      fc.property(arbSpelled, arbSpelled, (a, b) => {
        const ab = Math.sign(compareSpelled(a, b))
        const ba = Math.sign(compareSpelled(b, a))
        // Asserted as a sum rather than `ab === -ba`: when a and b are the same
        // pitch both signs are 0, and `-Math.sign(0)` is -0, which `toBe` treats
        // as different from 0 (it compares with Object.is). Since both values
        // are in {-1, 0, 1}, summing to zero says exactly the same thing.
        expect(ab + ba).toBe(0)
        expect(ab === 0).toBe(ba === 0)
      }),
    )
  })

  it('returns 0 only for identical spellings (property)', () => {
    fc.assert(
      fc.property(arbSpelled, arbSpelled, (a, b) => {
        if (compareSpelled(a, b) === 0) expect(a).toEqual(b)
      }),
    )
  })

  it('is transitive (property)', () => {
    fc.assert(
      fc.property(arbSpelled, arbSpelled, arbSpelled, (a, b, c) => {
        if (compareSpelled(a, b) <= 0 && compareSpelled(b, c) <= 0) {
          expect(compareSpelled(a, c)).toBeLessThanOrEqual(0)
        }
      }),
    )
  })

  it('produces a stable sort of an arbitrary set (property)', () => {
    fc.assert(
      fc.property(fc.array(arbSpelled, { maxLength: 20 }), (pitches) => {
        const sorted = [...pitches].sort(compareSpelled)
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1]
          const cur = sorted[i]
          if (prev === undefined || cur === undefined) continue
          expect(compareSpelled(prev, cur)).toBeLessThanOrEqual(0)
        }
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// named real-music cases — check the theory, not the code
// ---------------------------------------------------------------------------

describe('real music', () => {
  it('puts concert A (A440) at MIDI 69 and middle C at 60', () => {
    expect(toMidi(unwrap(parsePitch('A4')))).toBe(69)
    expect(toMidi(unwrap(parsePitch('C4')))).toBe(60)
  })

  it('spans an 88-key piano from A0 to C8', () => {
    expect(toMidi(unwrap(parsePitch('A0')))).toBe(21)
    expect(toMidi(unwrap(parsePitch('C8')))).toBe(108)
    expect(108 - 21 + 1).toBe(88)
  })

  it('spells the opening of Für Elise', () => {
    // Beethoven, WoO 59, right hand: E5 D#5 E5 D#5 E5 B4 D5 C5 A4
    const opening = ['E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4']
    const notes = opening.map((n) => toMidi(unwrap(parsePitch(n))))
    expect(notes).toEqual([76, 75, 76, 75, 76, 71, 74, 72, 69])
  })

  it('spells the Bb major scale with flats, not sharps', () => {
    // Bb major: Bb C D Eb F G A Bb — one flat per letter name, no repeats.
    const scale = ['Bb3', 'C4', 'D4', 'Eb4', 'F4', 'G4', 'A4', 'Bb4']
    const parsed = scale.map((n) => unwrap(parsePitch(n)))
    expect(parsed.map(toMidi)).toEqual([58, 60, 62, 63, 65, 67, 69, 70])
    // Each degree uses the next letter — that is what makes it a scale spelling.
    const letters = parsed.slice(0, 7).map((p) => p.letter)
    expect(new Set(letters).size).toBe(7)
  })

  it('spells Cb in Gb major, where it sounds as B', () => {
    // Gb major: Gb Ab Bb Cb Db Eb F — the fourth degree must be Cb, not B.
    const cFlat = unwrap(parsePitch('Cb4'))
    expect(toMidi(cFlat)).toBe(59)
    expect(cFlat.octave).toBe(4) // written octave 4 even though it sounds as B3
    expect(isEnharmonic(cFlat, unwrap(parsePitch('B3')))).toBe(true)
  })

  it('spells the leading tone of C# minor as B#, not C', () => {
    // Harmonic C# minor raises the 7th: B natural becomes B#, sounding as C.
    const leadingTone = unwrap(parsePitch('B#3'))
    expect(toMidi(leadingTone)).toBe(60)
    expect(leadingTone.octave).toBe(3) // written octave 3 even though it sounds as C4
    expect(isEnharmonic(leadingTone, unwrap(parsePitch('C4')))).toBe(true)
    expect(compareSpelled(leadingTone, unwrap(parsePitch('C4')))).toBeGreaterThan(0)
  })

  it('spells the C harmonic minor scale', () => {
    // C D Eb F G Ab B C — the seventh is B natural, never Cb.
    const scale = ['C4', 'D4', 'Eb4', 'F4', 'G4', 'Ab4', 'B4', 'C5']
    expect(scale.map((n) => toMidi(unwrap(parsePitch(n))))).toEqual([
      60, 62, 63, 65, 67, 68, 71, 72,
    ])
  })

  it('walks the C major scale by letter steps from middle C', () => {
    const names = Array.from({ length: 8 }, (_, i) => pitchName(diatonicStep(spell('C', 0, 4), i)))
    expect(names).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'])
  })
})
