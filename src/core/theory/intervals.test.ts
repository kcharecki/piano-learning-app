import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { at, InvariantError } from '@core/shared/invariant.ts'
import { isErr, isOk, unwrap } from '@core/shared/result.ts'
import {
  type Alter,
  type Letter,
  parsePitch,
  pitchName,
  type SpelledPitch,
  toMidi,
} from './pitch.ts'
import {
  type Interval,
  type IntervalQuality,
  intervalBetween,
  intervalDirection,
  intervalFromSemitones,
  intervalLongName,
  intervalName,
  intervalOrdinalName,
  makeInterval,
  parseInterval,
  SIMPLE_INTERVALS,
  transposeSpelled,
  tryIntervalBetween,
  tryTransposeSpelled,
} from './intervals.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Build an interval that is known to be legal. */
const iv = (n: number, q: IntervalQuality): Interval => unwrap(makeInterval(n, q))
/** Parse a pitch name that is known to be legal: `p('C#4')`. */
const p = (text: string): SpelledPitch => unwrap(parsePitch(text))

const PERFECT_QUALITIES: readonly IntervalQuality[] = [
  'doublyDiminished',
  'diminished',
  'perfect',
  'augmented',
  'doublyAugmented',
]
const IMPERFECT_QUALITIES: readonly IntervalQuality[] = [
  'doublyDiminished',
  'diminished',
  'minor',
  'major',
  'augmented',
  'doublyAugmented',
]

const qualitiesFor = (n: number): readonly IntervalQuality[] => {
  const simple = ((n - 1) % 7) + 1
  return simple === 1 || simple === 4 || simple === 5 ? PERFECT_QUALITIES : IMPERFECT_QUALITIES
}

// ---------------------------------------------------------------------------
// arbitraries
// ---------------------------------------------------------------------------

const arbLetter = fc.constantFrom<Letter>('C', 'D', 'E', 'F', 'G', 'A', 'B')
/**
 * Single accidentals only. Double sharps and double flats can put two pitches
 * more than a doubly augmented interval apart (Fbb4 to B##4), which is outside
 * what any quality can name.
 */
const arbAlter = fc.constantFrom<Alter>(-1, 0, 1)
const arbPitch: fc.Arbitrary<SpelledPitch> = fc.record({
  letter: arbLetter,
  alter: arbAlter,
  octave: fc.integer({ min: -1, max: 9 }),
})
/** Pitches that also sound inside the MIDI range, for cross-checks against `toMidi`. */
const arbPlayable: fc.Arbitrary<SpelledPitch> = fc.record({
  letter: arbLetter,
  alter: arbAlter,
  octave: fc.integer({ min: 0, max: 8 }),
})

/**
 * Every spelling MusicXML can carry, double accidentals included — the input the
 * Result-returning variants have to survive. Fb and B# alone are enough: a real
 * score can hold both, and no quality names the interval between them.
 */
const arbWildPitch: fc.Arbitrary<SpelledPitch> = fc.record({
  letter: arbLetter,
  alter: fc.constantFrom<Alter>(-2, -1, 0, 1, 2),
  octave: fc.integer({ min: -1, max: 9 }),
})

const arbNumber = fc.integer({ min: 1, max: 22 })
const arbInterval: fc.Arbitrary<Interval> = arbNumber.chain((n) =>
  fc.constantFrom(...qualitiesFor(n)).map((q) => iv(n, q)),
)
const arbDrillInterval = fc.constantFrom(...SIMPLE_INTERVALS)

/** Extreme spellings (Fb to B#) exceed every quality; skip those pairs. */
function measurable(a: SpelledPitch, b: SpelledPitch): boolean {
  try {
    intervalBetween(a, b)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// makeInterval
// ---------------------------------------------------------------------------

describe('makeInterval', () => {
  it('gives the standard semitone count for every simple interval', () => {
    const table: readonly [number, IntervalQuality, number][] = [
      [1, 'perfect', 0],
      [2, 'minor', 1],
      [2, 'major', 2],
      [3, 'minor', 3],
      [3, 'major', 4],
      [4, 'perfect', 5],
      [4, 'augmented', 6],
      [5, 'diminished', 6],
      [5, 'perfect', 7],
      [6, 'minor', 8],
      [6, 'major', 9],
      [7, 'minor', 10],
      [7, 'major', 11],
      [8, 'perfect', 12],
    ]
    for (const [number, quality, semitones] of table) {
      expect(unwrap(makeInterval(number, quality))).toEqual({ number, quality, semitones })
    }
  })

  it('accepts perfect quality on 1, 4, 5, 8 and their compounds', () => {
    for (const n of [1, 4, 5, 8, 11, 12, 15, 18]) {
      expect(isOk(makeInterval(n, 'perfect'))).toBe(true)
    }
  })

  it('accepts major and minor on 2, 3, 6, 7 and their compounds', () => {
    for (const n of [2, 3, 6, 7, 9, 10, 13, 14, 16]) {
      expect(isOk(makeInterval(n, 'major'))).toBe(true)
      expect(isOk(makeInterval(n, 'minor'))).toBe(true)
    }
  })

  it('accepts augmented and diminished on any number', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(isOk(makeInterval(n, 'augmented'))).toBe(true)
      expect(isOk(makeInterval(n, 'diminished'))).toBe(true)
      expect(isOk(makeInterval(n, 'doublyAugmented'))).toBe(true)
      expect(isOk(makeInterval(n, 'doublyDiminished'))).toBe(true)
    }
  })

  it('rejects major or minor on a perfect number, and says why', () => {
    const r = makeInterval(5, 'major')
    expect(isErr(r)).toBe(true)
    if (isErr(r)) {
      expect(r.error).toContain('fifth')
      expect(r.error).toContain('major')
      expect(r.error).toContain('perfect')
    }
    for (const [n, q] of [
      [1, 'major'],
      [1, 'minor'],
      [4, 'major'],
      [5, 'minor'],
      [8, 'major'],
      [11, 'minor'],
      [15, 'major'],
    ] as const) {
      expect(isErr(makeInterval(n, q))).toBe(true)
    }
  })

  it('rejects perfect on a major/minor number, and says why', () => {
    const r = makeInterval(3, 'perfect')
    expect(isErr(r)).toBe(true)
    if (isErr(r)) {
      expect(r.error).toContain('third')
      expect(r.error).toContain('major or minor')
    }
    for (const n of [2, 3, 6, 7, 9, 13]) {
      expect(isErr(makeInterval(n, 'perfect'))).toBe(true)
    }
  })

  it('rejects numbers below 1 and non-integers', () => {
    for (const n of [0, -1, -8]) {
      const r = makeInterval(n, 'perfect')
      expect(isErr(r)).toBe(true)
      if (isErr(r)) expect(r.error).toContain('at least 1')
    }
    for (const n of [1.5, NaN, Infinity]) {
      const r = makeInterval(n, 'perfect')
      expect(isErr(r)).toBe(true)
      if (isErr(r)) expect(r.error).toContain('whole number')
    }
  })

  it('counts compound intervals an octave at a time', () => {
    expect(iv(9, 'major').semitones).toBe(14) // M9 = M2 + an octave
    expect(iv(9, 'minor').semitones).toBe(13)
    expect(iv(11, 'perfect').semitones).toBe(17)
    expect(iv(12, 'perfect').semitones).toBe(19)
    expect(iv(13, 'major').semitones).toBe(21)
    expect(iv(15, 'perfect').semitones).toBe(24) // two octaves
  })

  it('allows the degenerate diminished unison, which spans -1 semitones', () => {
    expect(iv(1, 'diminished').semitones).toBe(-1)
    expect(iv(1, 'doublyDiminished').semitones).toBe(-2)
    expect(iv(1, 'augmented').semitones).toBe(1) // the chromatic semitone C-C#
  })

  it('always returns the number and quality it was given', () => {
    fc.assert(
      fc.property(arbInterval, (i) => {
        const rebuilt = unwrap(makeInterval(i.number, i.quality))
        expect(rebuilt).toEqual(i)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// the two quality families
// ---------------------------------------------------------------------------

/**
 * Semitones spanned by the major or perfect form of a number, restated here
 * independently of the module so the family tables are pinned in absolute terms.
 * Shifting a whole family by a constant would be invisible to offsets measured
 * against the module's own major/perfect form.
 */
const majorOrPerfect = (n: number): number => {
  const octaves = Math.floor((n - 1) / 7)
  return at([0, 2, 4, 5, 7, 9, 11], n - 1 - octaves * 7) + octaves * 12
}

describe('quality families', () => {
  it('offsets every perfect-family quality from the perfect form, and admits no other', () => {
    const offsets: readonly [IntervalQuality, number][] = [
      ['doublyDiminished', -2],
      ['diminished', -1],
      ['perfect', 0],
      ['augmented', 1],
      ['doublyAugmented', 2],
    ]
    for (const n of [1, 4, 5, 8, 11, 12, 15, 18, 22]) {
      for (const [quality, offset] of offsets) {
        expect(iv(n, quality).semitones).toBe(majorOrPerfect(n) + offset)
      }
      expect(isErr(makeInterval(n, 'major'))).toBe(true)
      expect(isErr(makeInterval(n, 'minor'))).toBe(true)
    }
  })

  it('offsets every imperfect-family quality from the major form, and admits no other', () => {
    const offsets: readonly [IntervalQuality, number][] = [
      ['doublyDiminished', -3],
      ['diminished', -2],
      ['minor', -1],
      ['major', 0],
      ['augmented', 1],
      ['doublyAugmented', 2],
    ]
    for (const n of [2, 3, 6, 7, 9, 10, 13, 14, 16, 21]) {
      for (const [quality, offset] of offsets) {
        expect(iv(n, quality).semitones).toBe(majorOrPerfect(n) + offset)
      }
      expect(isErr(makeInterval(n, 'perfect'))).toBe(true)
    }
  })

  it('recovers the quality from the offset it produced, in both families', () => {
    // The reverse lookup intervalBetween depends on: measuring a transposed
    // pitch has to name the same quality the transposition was built from.
    fc.assert(
      fc.property(arbWildPitch, arbInterval, (from, i) => {
        const moved = tryTransposeSpelled(from, i, 1)
        fc.pre(isOk(moved))
        // A diminished unison moves *down* in sound, so it comes back as the
        // augmented unison it is from the other end. Every other case round-trips.
        fc.pre(intervalDirection(from, unwrap(moved)) >= 0)
        const measured = tryIntervalBetween(from, unwrap(moved))
        fc.pre(isOk(measured))
        expect(unwrap(measured).quality).toBe(i.quality)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// intervalDirection
// ---------------------------------------------------------------------------

describe('intervalDirection', () => {
  it('reports up, down and same', () => {
    expect(intervalDirection(p('C4'), p('G4'))).toBe(1)
    expect(intervalDirection(p('G4'), p('C4'))).toBe(-1)
    expect(intervalDirection(p('C4'), p('C4'))).toBe(0)
    expect(intervalDirection(p('C4'), p('C5'))).toBe(1)
    expect(intervalDirection(p('C4'), p('B3'))).toBe(-1)
  })

  it('uses staff position first: B#3 is written below C4 although they sound alike', () => {
    expect(toMidi(p('B#3'))).toBe(toMidi(p('C4')))
    expect(intervalDirection(p('C4'), p('B#3'))).toBe(-1)
    expect(intervalDirection(p('B#3'), p('C4'))).toBe(1)
  })

  it('falls back to sounding pitch when the staff position is the same', () => {
    expect(intervalDirection(p('C4'), p('Cb4'))).toBe(-1)
    expect(intervalDirection(p('C4'), p('C#4'))).toBe(1)
    expect(intervalDirection(p('Cb4'), p('C#4'))).toBe(1)
  })

  it('is zero only for an identical spelling', () => {
    fc.assert(
      fc.property(arbPitch, arbPitch, (a, b) => {
        expect(intervalDirection(a, b) === 0).toBe(pitchName(a) === pitchName(b))
      }),
    )
  })

  it('is antisymmetric', () => {
    fc.assert(
      fc.property(arbPitch, arbPitch, (a, b) => {
        // Written as a sum so that the 0/-0 pair compares equal.
        expect(intervalDirection(a, b) + intervalDirection(b, a)).toBe(0)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// intervalBetween
// ---------------------------------------------------------------------------

describe('intervalBetween', () => {
  it('names the intervals of well-known tunes', () => {
    // 'Twinkle, Twinkle' opens with the leap C-G: a perfect fifth.
    expect(intervalName(intervalBetween(p('C4'), p('G4')))).toBe('P5')
    // 'Over the Rainbow' opens with an octave leap.
    expect(intervalName(intervalBetween(p('C4'), p('C5')))).toBe('P8')
    // The Beethoven 5 motif falls G-Eb: a descending major third.
    expect(intervalName(intervalBetween(p('G4'), p('Eb4')))).toBe('M3')
    expect(intervalDirection(p('G4'), p('Eb4'))).toBe(-1)
    // 'Maria' opens C-F#: the tritone, spelled as an augmented fourth.
    expect(intervalName(intervalBetween(p('C4'), p('F#4')))).toBe('A4')
    // The tritone inside a G7 chord is B-F, spelled as a diminished fifth.
    expect(intervalName(intervalBetween(p('B3'), p('F4')))).toBe('d5')
    // The order of the arguments does not matter: G4 down to C4 is still a fifth.
    expect(intervalName(intervalBetween(p('G4'), p('C4')))).toBe('P5')
  })

  it('is spelling aware: same six semitones, different interval', () => {
    expect(toMidi(p('Gb4'))).toBe(toMidi(p('F#4')))
    expect(intervalName(intervalBetween(p('C4'), p('Gb4')))).toBe('d5')
    expect(intervalName(intervalBetween(p('C4'), p('F#4')))).toBe('A4')
  })

  it('measures thirds and sixths correctly', () => {
    expect(intervalName(intervalBetween(p('Bb3'), p('D4')))).toBe('M3') // Bb major triad
    expect(intervalName(intervalBetween(p('Eb4'), p('Gb4')))).toBe('m3') // Eb minor triad
    expect(intervalName(intervalBetween(p('E4'), p('C5')))).toBe('m6')
    expect(intervalName(intervalBetween(p('C4'), p('A4')))).toBe('M6')
    expect(intervalName(intervalBetween(p('A3'), p('F4')))).toBe('m6')
  })

  it('handles unisons, octaves and compounds', () => {
    expect(intervalName(intervalBetween(p('C4'), p('C4')))).toBe('P1')
    expect(intervalName(intervalBetween(p('F#4'), p('F#4')))).toBe('P1')
    expect(intervalName(intervalBetween(p('C4'), p('C5')))).toBe('P8')
    expect(intervalName(intervalBetween(p('C4'), p('D5')))).toBe('M9')
    expect(intervalName(intervalBetween(p('C3'), p('E5')))).toBe('M17')
    expect(intervalName(intervalBetween(p('C2'), p('C5')))).toBe('P22')
  })

  it('measures the chromatic and enharmonic edge cases', () => {
    // C to C# is an augmented unison — one semitone, but no letter change.
    expect(intervalName(intervalBetween(p('C4'), p('C#4')))).toBe('A1')
    expect(intervalName(intervalBetween(p('C4'), p('Cb4')))).toBe('A1')
    // B# and C sound alike but are a (zero-semitone) diminished second apart.
    const d2 = intervalBetween(p('B#3'), p('C4'))
    expect(intervalName(d2)).toBe('d2')
    expect(d2.semitones).toBe(0)
    // Doubly augmented and doubly diminished are reachable.
    expect(intervalName(intervalBetween(p('Cb4'), p('E#4')))).toBe('AA3')
    expect(intervalName(intervalBetween(p('C#4'), p('Eb4')))).toBe('d3')
    expect(intervalName(intervalBetween(p('C#4'), p('Ebb4')))).toBe('dd3')
  })

  it('ignores the order of its arguments', () => {
    fc.assert(
      fc.property(arbPitch, arbPitch, (a, b) => {
        fc.pre(measurable(a, b))
        expect(intervalBetween(a, b)).toEqual(intervalBetween(b, a))
      }),
    )
  })

  it('always returns a number of at least 1', () => {
    fc.assert(
      fc.property(arbPitch, arbPitch, (a, b) => {
        fc.pre(measurable(a, b))
        expect(intervalBetween(a, b).number).toBeGreaterThanOrEqual(1)
      }),
    )
  })

  it('agrees with sounding pitch: direction times semitones is the MIDI distance', () => {
    fc.assert(
      fc.property(arbPlayable, arbPlayable, (a, b) => {
        fc.pre(measurable(a, b))
        const i = intervalBetween(a, b)
        // `|| 0` normalises -0 (a descending d2, say), which toBe treats as distinct from 0.
        expect(intervalDirection(a, b) * i.semitones || 0).toBe(toMidi(b) - toMidi(a))
      }),
    )
  })

  it('throws when the spelling is further apart than any quality can name', () => {
    // Fb to B# spans eight semitones over four letters: a triply augmented fourth.
    expect(() => intervalBetween(p('Fb4'), p('B#4'))).toThrow(/no interval quality/)
    expect(() => intervalBetween(p('Cbb4'), p('C##4'))).toThrow(/unison/)
    expect(() => intervalBetween(p('B#3'), p('Fb4'))).toThrow(/fifth/)
  })
})

// ---------------------------------------------------------------------------
// tryIntervalBetween
// ---------------------------------------------------------------------------

describe('tryIntervalBetween', () => {
  it('measures Fb4 to B#4, which the throwing variant refuses', () => {
    // Both spellings occur in real MusicXML, so an imported score can hand this
    // pair to roman-numeral analysis. It must not take the analysis down.
    const measured = tryIntervalBetween(p('Fb4'), p('B#4'))
    expect(isErr(measured)).toBe(true)
    if (isErr(measured)) {
      expect(measured.error).toContain('no interval quality')
      expect(measured.error).toContain('Fb4')
      expect(measured.error).toContain('B#4')
    }
    expect(() => intervalBetween(p('Fb4'), p('B#4'))).toThrow(InvariantError)
  })

  it('never throws, for any pair of spellings a score can hold', () => {
    fc.assert(
      fc.property(arbWildPitch, arbWildPitch, (a, b) => {
        const measured = tryIntervalBetween(a, b)
        expect(typeof measured.ok).toBe('boolean')
      }),
    )
  })

  it('agrees with intervalBetween exactly wherever intervalBetween succeeds', () => {
    fc.assert(
      fc.property(arbWildPitch, arbWildPitch, (a, b) => {
        const measured = tryIntervalBetween(a, b)
        if (isOk(measured)) {
          expect(measured.value).toEqual(intervalBetween(a, b))
        } else {
          expect(() => intervalBetween(a, b)).toThrow(InvariantError)
        }
      }),
    )
  })

  it('is unordered, like intervalBetween — only the error names the pair in order', () => {
    fc.assert(
      fc.property(arbWildPitch, arbWildPitch, (a, b) => {
        const forward = tryIntervalBetween(a, b)
        const backward = tryIntervalBetween(b, a)
        expect(forward.ok).toBe(backward.ok)
        if (isOk(forward) && isOk(backward)) expect(forward.value).toEqual(backward.value)
        if (isErr(forward) && isErr(backward)) {
          expect(forward.error).toContain(`(${pitchName(a)} to ${pitchName(b)})`)
          expect(backward.error).toContain(`(${pitchName(b)} to ${pitchName(a)})`)
        }
      }),
    )
  })

  it('names the ordinary intervals just as intervalBetween does', () => {
    expect(intervalName(unwrap(tryIntervalBetween(p('C4'), p('G4'))))).toBe('P5')
    expect(intervalName(unwrap(tryIntervalBetween(p('C4'), p('Gb4'))))).toBe('d5')
    expect(intervalName(unwrap(tryIntervalBetween(p('C2'), p('C5'))))).toBe('P22')
  })
})

// ---------------------------------------------------------------------------
// naming
// ---------------------------------------------------------------------------

describe('intervalName', () => {
  it('abbreviates every quality', () => {
    expect(intervalName(iv(5, 'perfect'))).toBe('P5')
    expect(intervalName(iv(3, 'minor'))).toBe('m3')
    expect(intervalName(iv(3, 'major'))).toBe('M3')
    expect(intervalName(iv(7, 'major'))).toBe('M7')
    expect(intervalName(iv(4, 'augmented'))).toBe('A4')
    expect(intervalName(iv(5, 'diminished'))).toBe('d5')
    expect(intervalName(iv(8, 'perfect'))).toBe('P8')
    expect(intervalName(iv(9, 'major'))).toBe('M9')
    expect(intervalName(iv(3, 'doublyDiminished'))).toBe('dd3')
    expect(intervalName(iv(4, 'doublyAugmented'))).toBe('AA4')
  })
})

describe('intervalLongName', () => {
  it('spells out quality and number', () => {
    expect(intervalLongName(iv(5, 'perfect'))).toBe('perfect fifth')
    expect(intervalLongName(iv(3, 'minor'))).toBe('minor third')
    expect(intervalLongName(iv(4, 'augmented'))).toBe('augmented fourth')
    expect(intervalLongName(iv(1, 'perfect'))).toBe('perfect unison')
    expect(intervalLongName(iv(2, 'major'))).toBe('major second')
    expect(intervalLongName(iv(6, 'minor'))).toBe('minor sixth')
    expect(intervalLongName(iv(7, 'diminished'))).toBe('diminished seventh')
    expect(intervalLongName(iv(8, 'perfect'))).toBe('perfect octave')
    expect(intervalLongName(iv(9, 'major'))).toBe('major ninth')
    expect(intervalLongName(iv(10, 'minor'))).toBe('minor tenth')
    expect(intervalLongName(iv(11, 'perfect'))).toBe('perfect eleventh')
    expect(intervalLongName(iv(12, 'perfect'))).toBe('perfect twelfth')
    expect(intervalLongName(iv(13, 'major'))).toBe('major thirteenth')
    expect(intervalLongName(iv(14, 'minor'))).toBe('minor fourteenth')
    expect(intervalLongName(iv(15, 'perfect'))).toBe('perfect fifteenth')
    expect(intervalLongName(iv(3, 'doublyDiminished'))).toBe('doubly diminished third')
    expect(intervalLongName(iv(4, 'doublyAugmented'))).toBe('doubly augmented fourth')
  })

  it('falls back to numerals above a fifteenth, with the right ordinal suffix', () => {
    expect(intervalLongName(iv(16, 'major'))).toBe('major 16th')
    expect(intervalLongName(iv(18, 'perfect'))).toBe('perfect 18th')
    expect(intervalLongName(iv(21, 'major'))).toBe('major 21st')
    expect(intervalLongName(iv(22, 'perfect'))).toBe('perfect 22nd')
    expect(intervalLongName(iv(23, 'major'))).toBe('major 23rd')
    expect(intervalLongName(iv(111, 'major'))).toBe('major 111th') // 111, not 111st
  })

  it('does not throw on a hand-built interval with a nonsense number', () => {
    expect(intervalLongName({ number: 0, quality: 'major', semitones: 0 })).toBe('major 0th')
  })
})

describe('intervalOrdinalName', () => {
  it('writes the quality capitalised and the number as an ordinal numeral', () => {
    expect(intervalOrdinalName(iv(5, 'perfect'))).toBe('Perfect 5th')
    expect(intervalOrdinalName(iv(3, 'minor'))).toBe('Minor 3rd')
    expect(intervalOrdinalName(iv(2, 'major'))).toBe('Major 2nd')
    expect(intervalOrdinalName(iv(4, 'augmented'))).toBe('Augmented 4th')
    expect(intervalOrdinalName(iv(5, 'diminished'))).toBe('Diminished 5th')
    // 'octave' and 'unison' are prose; this form is a grid label, so 8 is 8th.
    expect(intervalOrdinalName(iv(8, 'perfect'))).toBe('Perfect 8th')
    expect(intervalOrdinalName(iv(1, 'perfect'))).toBe('Perfect 1st')
    expect(intervalOrdinalName(iv(3, 'doublyDiminished'))).toBe('Doubly diminished 3rd')
    expect(intervalOrdinalName(iv(4, 'doublyAugmented'))).toBe('Doubly augmented 4th')
  })

  it('needs only the number and quality — a bare answer, with no semitone count', () => {
    expect(intervalOrdinalName({ number: 6, quality: 'minor' })).toBe('Minor 6th')
  })

  it('keeps the ordinal suffix right past the teens, where naive rules break', () => {
    expect(intervalOrdinalName(iv(11, 'perfect'))).toBe('Perfect 11th') // not 11st
    expect(intervalOrdinalName(iv(12, 'perfect'))).toBe('Perfect 12th') // not 12nd
    expect(intervalOrdinalName(iv(13, 'major'))).toBe('Major 13th') // not 13rd
    expect(intervalOrdinalName(iv(21, 'major'))).toBe('Major 21st')
  })

  it('names every drawable interval distinctly — the reveal must not be ambiguous', () => {
    const names = SIMPLE_INTERVALS.map(intervalOrdinalName)
    expect(new Set(names).size).toBe(SIMPLE_INTERVALS.length)
  })

  it('is total over every legal number and quality', () => {
    const qualityArb = fc.constantFrom<IntervalQuality>(
      'perfect',
      'major',
      'minor',
      'augmented',
      'diminished',
      'doublyAugmented',
      'doublyDiminished',
    )
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 15 }), qualityArb, (number, quality) => {
        const text = intervalOrdinalName({ number, quality })
        expect(text).toMatch(/^[A-Z][a-z ]+ \d+(st|nd|rd|th)$/)
        // The number in the label is the number asked for, not a near miss.
        expect(text.split(' ').at(-1)).toMatch(new RegExp(`^${number}(st|nd|rd|th)$`))
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// parseInterval
// ---------------------------------------------------------------------------

describe('parseInterval', () => {
  it('reads every abbreviation back', () => {
    expect(unwrap(parseInterval('P5'))).toEqual(iv(5, 'perfect'))
    expect(unwrap(parseInterval('m3'))).toEqual(iv(3, 'minor'))
    expect(unwrap(parseInterval('M3'))).toEqual(iv(3, 'major'))
    expect(unwrap(parseInterval('A4'))).toEqual(iv(4, 'augmented'))
    expect(unwrap(parseInterval('d5'))).toEqual(iv(5, 'diminished'))
    expect(unwrap(parseInterval('P8'))).toEqual(iv(8, 'perfect'))
    expect(unwrap(parseInterval('M9'))).toEqual(iv(9, 'major'))
    expect(unwrap(parseInterval('dd3'))).toEqual(iv(3, 'doublyDiminished'))
    expect(unwrap(parseInterval('AA4'))).toEqual(iv(4, 'doublyAugmented'))
    expect(unwrap(parseInterval('P15'))).toEqual(iv(15, 'perfect'))
  })

  it('ignores surrounding whitespace', () => {
    expect(unwrap(parseInterval('  M6\t'))).toEqual(iv(6, 'major'))
  })

  it('is case sensitive, because m and M are different intervals', () => {
    expect(unwrap(parseInterval('m7')).quality).toBe('minor')
    expect(unwrap(parseInterval('M7')).quality).toBe('major')
    expect(isErr(parseInterval('p5'))).toBe(true)
    expect(isErr(parseInterval('D5'))).toBe(true)
  })

  it('rejects empty and malformed text', () => {
    const empty = parseInterval('   ')
    expect(isErr(empty)).toBe(true)
    if (isErr(empty)) expect(empty.error).toContain('empty')

    for (const bad of [
      '',
      'X5',
      '5',
      'P',
      'PP5',
      'M',
      'm-3',
      'P5.5',
      'perfect fifth',
      'P 5',
      '#5',
    ]) {
      expect(isErr(parseInterval(bad))).toBe(true)
    }
    const nonsense = parseInterval('X5')
    expect(isErr(nonsense)).toBe(true)
    if (isErr(nonsense)) expect(nonsense.error).toContain('not an interval name')
  })

  it('rejects impossible quality/number pairs and number zero', () => {
    expect(isErr(parseInterval('M5'))).toBe(true)
    expect(isErr(parseInterval('P3'))).toBe(true)
    const zero = parseInterval('P0')
    expect(isErr(zero)).toBe(true)
    if (isErr(zero)) expect(zero.error).toContain('at least 1')
  })

  it('never throws, whatever text it is given', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const r = parseInterval(text)
        expect(typeof r.ok).toBe('boolean')
      }),
    )
  })

  it('round-trips every interval name', () => {
    fc.assert(
      fc.property(arbInterval, (i) => {
        expect(unwrap(parseInterval(intervalName(i)))).toEqual(i)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// transposeSpelled
// ---------------------------------------------------------------------------

describe('transposeSpelled', () => {
  it('spells the tritone according to the interval it was given', () => {
    expect(pitchName(transposeSpelled(p('C4'), iv(4, 'augmented')))).toBe('F#4')
    expect(pitchName(transposeSpelled(p('C4'), iv(5, 'diminished')))).toBe('Gb4')
  })

  it('transposes upward by default', () => {
    expect(pitchName(transposeSpelled(p('C4'), iv(5, 'perfect')))).toBe('G4')
    expect(pitchName(transposeSpelled(p('C4'), iv(3, 'major')))).toBe('E4')
    expect(pitchName(transposeSpelled(p('C4'), iv(3, 'minor')))).toBe('Eb4')
    expect(pitchName(transposeSpelled(p('Eb4'), iv(3, 'major')))).toBe('G4')
    expect(pitchName(transposeSpelled(p('Eb4'), iv(3, 'minor')))).toBe('Gb4')
    expect(pitchName(transposeSpelled(p('Bb3'), iv(3, 'major')))).toBe('D4')
    expect(pitchName(transposeSpelled(p('F#4'), iv(3, 'minor')))).toBe('A4')
    expect(pitchName(transposeSpelled(p('Db4'), iv(5, 'perfect')))).toBe('Ab4')
  })

  it('carries the octave across the B-C boundary', () => {
    expect(pitchName(transposeSpelled(p('B4'), iv(2, 'minor')))).toBe('C5')
    expect(pitchName(transposeSpelled(p('B3'), iv(2, 'major')))).toBe('C#4')
    expect(pitchName(transposeSpelled(p('A4'), iv(3, 'minor')))).toBe('C5')
    expect(pitchName(transposeSpelled(p('F#4'), iv(5, 'perfect')))).toBe('C#5')
    expect(pitchName(transposeSpelled(p('C4'), iv(8, 'perfect')))).toBe('C5')
    expect(pitchName(transposeSpelled(p('C4'), iv(9, 'major')))).toBe('D5')
  })

  it('transposes downward when asked', () => {
    expect(pitchName(transposeSpelled(p('C4'), iv(5, 'perfect'), -1))).toBe('F3')
    expect(pitchName(transposeSpelled(p('C4'), iv(3, 'minor'), -1))).toBe('A3')
    expect(pitchName(transposeSpelled(p('C4'), iv(8, 'perfect'), -1))).toBe('C3')
    expect(pitchName(transposeSpelled(p('C5'), iv(2, 'minor'), -1))).toBe('B4')
    expect(pitchName(transposeSpelled(p('G4'), iv(4, 'augmented'), -1))).toBe('Db4')
  })

  it('leaves the pitch alone for a perfect unison, in either direction', () => {
    expect(pitchName(transposeSpelled(p('F#4'), iv(1, 'perfect')))).toBe('F#4')
    expect(pitchName(transposeSpelled(p('F#4'), iv(1, 'perfect'), -1))).toBe('F#4')
  })

  it('builds a whole major scale by stacking intervals from the tonic', () => {
    // D major: D E F# G A B C# D — every accidental has to come out of the interval.
    const names = ['P1', 'M2', 'M3', 'P4', 'P5', 'M6', 'M7', 'P8'].map((n) =>
      pitchName(transposeSpelled(p('D4'), unwrap(parseInterval(n)))),
    )
    expect(names).toEqual(['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C#5', 'D5'])
  })

  it('throws when the result would need a triple accidental', () => {
    expect(() => transposeSpelled(p('C##4'), iv(2, 'augmented'))).toThrow(/beyond the double/)
    expect(() => transposeSpelled(p('Cbb4'), iv(2, 'diminished'), 1)).toThrow(/double/)
    expect(() => transposeSpelled(p('C##4'), iv(2, 'augmented'))).toThrow(/up/)
    expect(() => transposeSpelled(p('Cbb4'), iv(7, 'augmented'), -1)).toThrow(/down/)
  })

  it('refuses a hand-built interval with a fractional semitone count', () => {
    // -0.5 is inside the accidental range but is not an accidental.
    expect(() =>
      transposeSpelled(p('C4'), { number: 2, quality: 'major', semitones: 1.5 }),
    ).toThrow(/accidental of -0.5/)
  })

  it('up then down returns the original spelling', () => {
    fc.assert(
      fc.property(arbPitch, arbDrillInterval, (a, i) => {
        expect(transposeSpelled(transposeSpelled(a, i, 1), i, -1)).toEqual(a)
      }),
    )
  })

  it('down then up returns the original spelling', () => {
    fc.assert(
      fc.property(arbPitch, arbDrillInterval, (a, i) => {
        expect(transposeSpelled(transposeSpelled(a, i, -1), i, 1)).toEqual(a)
      }),
    )
  })

  it('moves by exactly the interval it was given', () => {
    fc.assert(
      fc.property(arbPlayable, arbDrillInterval, (a, i) => {
        const up = transposeSpelled(a, i, 1)
        expect(intervalBetween(a, up)).toEqual(i)
        // P1 is the one interval with no direction to speak of.
        expect(intervalDirection(a, up)).toBe(i.semitones === 0 && i.number === 1 ? 0 : 1)
      }),
    )
  })

  it('is the exact inverse of intervalBetween, direction included', () => {
    fc.assert(
      fc.property(arbPitch, arbPitch, (a, b) => {
        fc.pre(measurable(a, b))
        const direction = intervalDirection(a, b)
        fc.pre(direction !== 0)
        expect(transposeSpelled(a, intervalBetween(a, b), direction)).toEqual(b)
      }),
    )
  })

  it('reproduces the pitch in the degenerate case the central law excludes', () => {
    // `intervalDirection` is 0 for an identical spelling, which
    // `transposeSpelled` cannot take; either direction reproduces the pitch.
    fc.assert(
      fc.property(arbPitch, (a) => {
        expect(transposeSpelled(a, intervalBetween(a, a), 1)).toEqual(a)
        expect(transposeSpelled(a, intervalBetween(a, a), -1)).toEqual(a)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// tryTransposeSpelled
// ---------------------------------------------------------------------------

describe('tryTransposeSpelled', () => {
  it('reports a triple accidental instead of throwing', () => {
    const up = tryTransposeSpelled(p('C##4'), iv(2, 'augmented'))
    expect(isErr(up)).toBe(true)
    if (isErr(up)) {
      expect(up.error).toContain('C##4')
      expect(up.error).toContain('up')
      expect(up.error).toContain('beyond the double')
    }
    const down = tryTransposeSpelled(p('Cbb4'), iv(7, 'augmented'), -1)
    expect(isErr(down)).toBe(true)
    if (isErr(down)) expect(down.error).toContain('down')
    // The throwing variant is still available for internal callers.
    expect(() => transposeSpelled(p('C##4'), iv(2, 'augmented'))).toThrow(InvariantError)
  })

  it('transposes exactly like transposeSpelled wherever that succeeds', () => {
    expect(pitchName(unwrap(tryTransposeSpelled(p('C4'), iv(4, 'augmented'))))).toBe('F#4')
    expect(pitchName(unwrap(tryTransposeSpelled(p('C4'), iv(5, 'perfect'), -1)))).toBe('F3')
    fc.assert(
      fc.property(arbWildPitch, arbDrillInterval, fc.constantFrom<1 | -1>(1, -1), (a, i, dir) => {
        const moved = tryTransposeSpelled(a, i, dir)
        if (isOk(moved)) {
          expect(moved.value).toEqual(transposeSpelled(a, i, dir))
        } else {
          expect(() => transposeSpelled(a, i, dir)).toThrow(InvariantError)
        }
      }),
    )
  })

  it('never throws on any spelling a score can hold', () => {
    fc.assert(
      fc.property(arbWildPitch, arbInterval, fc.constantFrom<1 | -1>(1, -1), (a, i, dir) => {
        expect(typeof tryTransposeSpelled(a, i, dir).ok).toBe('boolean')
      }),
    )
  })

  it('round-trips: transposing back returns the original spelling', () => {
    fc.assert(
      fc.property(arbWildPitch, arbDrillInterval, (a, i) => {
        const up = tryTransposeSpelled(a, i, 1)
        fc.pre(isOk(up))
        expect(unwrap(tryTransposeSpelled(unwrap(up), i, -1))).toEqual(a)
      }),
    )
  })

  it('measures back to the interval it was given', () => {
    fc.assert(
      fc.property(arbWildPitch, arbDrillInterval, (a, i) => {
        const up = tryTransposeSpelled(a, i, 1)
        fc.pre(isOk(up))
        expect(unwrap(tryIntervalBetween(a, unwrap(up)))).toEqual(i)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// intervalFromSemitones / SIMPLE_INTERVALS
// ---------------------------------------------------------------------------

describe('intervalFromSemitones', () => {
  it('gives the common spelling for every distance inside an octave', () => {
    const names = Array.from({ length: 13 }, (_, s) => intervalName(intervalFromSemitones(s)))
    expect(names).toEqual([
      'P1',
      'm2',
      'M2',
      'm3',
      'M3',
      'P4',
      'A4',
      'P5',
      'm6',
      'M6',
      'm7',
      'M7',
      'P8',
    ])
  })

  it("spells the tritone as a diminished fifth when asked for 'diatonic'", () => {
    expect(intervalName(intervalFromSemitones(6, 'diatonic'))).toBe('d5')
    expect(intervalName(intervalFromSemitones(18, 'diatonic'))).toBe('d12')
    // Every other distance is unaffected by the preference.
    for (let s = 0; s <= 12; s++) {
      if (s === 6) continue
      expect(intervalFromSemitones(s, 'diatonic')).toEqual(intervalFromSemitones(s))
    }
  })

  it('extends past the octave', () => {
    expect(intervalName(intervalFromSemitones(13))).toBe('m9')
    expect(intervalName(intervalFromSemitones(14))).toBe('M9')
    expect(intervalName(intervalFromSemitones(17))).toBe('P11')
    expect(intervalName(intervalFromSemitones(19))).toBe('P12')
    expect(intervalName(intervalFromSemitones(24))).toBe('P15')
    expect(intervalName(intervalFromSemitones(28))).toBe('M17')
  })

  it('throws on a negative or fractional count', () => {
    expect(() => intervalFromSemitones(-1)).toThrow(RangeError)
    expect(() => intervalFromSemitones(1.5)).toThrow(/non-negative/)
    expect(() => intervalFromSemitones(NaN)).toThrow(RangeError)
  })

  it('returns an interval of exactly the requested size', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), (s) => {
        expect(intervalFromSemitones(s).semitones).toBe(s)
        expect(intervalFromSemitones(s, 'diatonic').semitones).toBe(s)
      }),
    )
  })

  it('agrees with SIMPLE_INTERVALS inside the octave', () => {
    for (let s = 0; s <= 12; s++) {
      expect(intervalFromSemitones(s)).toEqual(at(SIMPLE_INTERVALS, s))
    }
  })
})

describe('SIMPLE_INTERVALS', () => {
  it('is the thirteen-interval drill vocabulary, indexed by semitone', () => {
    expect(SIMPLE_INTERVALS).toHaveLength(13)
    expect(SIMPLE_INTERVALS.map(intervalName)).toEqual([
      'P1',
      'm2',
      'M2',
      'm3',
      'M3',
      'P4',
      'A4',
      'P5',
      'm6',
      'M6',
      'm7',
      'M7',
      'P8',
    ])
    SIMPLE_INTERVALS.forEach((i, index) => {
      expect(i.semitones).toBe(index)
    })
  })

  it('is strictly ascending and entirely simple', () => {
    for (let index = 1; index < SIMPLE_INTERVALS.length; index++) {
      expect(at(SIMPLE_INTERVALS, index).semitones).toBeGreaterThan(
        at(SIMPLE_INTERVALS, index - 1).semitones,
      )
    }
    for (const i of SIMPLE_INTERVALS) expect(i.number).toBeLessThanOrEqual(8)
  })

  it('names every one of them in full', () => {
    expect(SIMPLE_INTERVALS.map(intervalLongName)).toEqual([
      'perfect unison',
      'minor second',
      'major second',
      'minor third',
      'major third',
      'perfect fourth',
      'augmented fourth',
      'perfect fifth',
      'minor sixth',
      'major sixth',
      'minor seventh',
      'major seventh',
      'perfect octave',
    ])
  })
})
