import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { at } from '@core/shared/invariant.ts'
import { isErr, isOk, unwrap } from '@core/shared/result.ts'
import { makeInterval, transposeSpelled } from './intervals.ts'
import {
  type Alter,
  LETTERS,
  type Letter,
  spell,
  type SpelledPitch,
  spelledPitchClass,
} from './pitch.ts'
import {
  accidentalsOf,
  alterFor,
  CIRCLE_OF_FIFTHS,
  closelyRelatedKeys,
  enharmonicKey,
  FLAT_ORDER,
  type Key,
  keyFromFifths,
  keyName,
  keyOf,
  keySignatureForTonic,
  type KeySignature,
  type Mode,
  relativeKey,
  SHARP_ORDER,
} from './keys.ts'

// ---------------------------------------------------------------------------
// arbitraries and helpers
// ---------------------------------------------------------------------------

const MAX = 7
const arbFifths = fc.integer({ min: -MAX, max: MAX })
const arbMode = fc.constantFrom<Mode>('major', 'minor')
const arbKey: fc.Arbitrary<Key> = fc
  .tuple(arbFifths, arbMode)
  .map(([fifths, mode]) => keyFromFifths(fifths, mode))
const arbMajorKey: fc.Arbitrary<Key> = arbFifths.map((fifths) => keyFromFifths(fifths, 'major'))
const arbLetter = fc.constantFrom<Letter>(...LETTERS)

/** Every standard key, both modes — thirty of them. Cheap enough to loop over directly. */
const ALL_KEYS: readonly Key[] = [
  ...Array.from({ length: 15 }, (_, i) => keyFromFifths(i - MAX, 'major')),
  ...Array.from({ length: 15 }, (_, i) => keyFromFifths(i - MAX, 'minor')),
]

const PERFECT_FIFTH = unwrap(makeInterval(5, 'perfect'))
const MINOR_THIRD = unwrap(makeInterval(3, 'minor'))

const name = (k: Key): string => keyName(k)
const names = (keys: readonly Key[]): string[] => keys.map(name)

/**
 * Builds a key from a name like 'Eb major' for compact test fixtures. Deliberately
 * local and minimal: the production parser (`parseKeyName`) was deleted at roadmap
 * 2.32 for having no production caller, but the tests still want short names for
 * the many keys exercised below.
 */
function named(text: string): Key {
  const match = /^([A-Ga-g])([#sSbB]*)\s*(major|minor)$/.exec(text.trim())
  if (match === null) throw new Error(`bad fixture key name '${text}'`)
  const letter = at(match, 1).toUpperCase() as Letter
  const accidentals = at(match, 2).toLowerCase()
  const flats = [...accidentals].filter((c) => c === 'b').length
  const sharps = accidentals.length - flats
  const mode = at(match, 3) as Mode
  return unwrap(keyOf(spell(letter, (sharps - flats) as Alter, 4), mode))
}

const tonicOf = (text: string): SpelledPitch => named(text).tonic

/** `enharmonicKey` where the twin is known to exist — keeps the assertions readable. */
function twinOf(k: Key): Key {
  const twin = enharmonicKey(k)
  if (twin === null) throw new Error(`expected ${keyName(k)} to have an enharmonic twin`)
  return twin
}

/** Major key names in fifths order, Cb (-7) to C# (+7). The reference table for this module. */
const MAJOR_NAMES: readonly string[] = [
  'Cb major',
  'Gb major',
  'Db major',
  'Ab major',
  'Eb major',
  'Bb major',
  'F major',
  'C major',
  'G major',
  'D major',
  'A major',
  'E major',
  'B major',
  'F# major',
  'C# major',
]

/** Minor key names in fifths order. Ab minor (-7) has seven flats; A# minor (+7) seven sharps. */
const MINOR_NAMES: readonly string[] = [
  'Ab minor',
  'Eb minor',
  'Bb minor',
  'F minor',
  'C minor',
  'G minor',
  'D minor',
  'A minor',
  'E minor',
  'B minor',
  'F# minor',
  'C# minor',
  'G# minor',
  'D# minor',
  'A# minor',
]

// ---------------------------------------------------------------------------
// SHARP_ORDER / FLAT_ORDER
// ---------------------------------------------------------------------------

describe('accidental orders', () => {
  it('writes sharps F C G D A E B', () => {
    expect(SHARP_ORDER).toEqual(['F', 'C', 'G', 'D', 'A', 'E', 'B'])
  })

  it('writes flats B E A D G C F', () => {
    expect(FLAT_ORDER).toEqual(['B', 'E', 'A', 'D', 'G', 'C', 'F'])
  })

  it('are the reverse of each other', () => {
    expect([...FLAT_ORDER].reverse()).toEqual([...SHARP_ORDER])
  })

  it('each list every letter exactly once', () => {
    expect([...SHARP_ORDER].sort()).toEqual([...LETTERS].sort())
    expect([...FLAT_ORDER].sort()).toEqual([...LETTERS].sort())
  })

  it('steps by a fifth: each sharp is a fifth above the previous', () => {
    for (let i = 1; i < SHARP_ORDER.length; i++) {
      const previous = spelledPitchClass(spell(at(SHARP_ORDER, i - 1), 0, 4))
      const current = spelledPitchClass(spell(at(SHARP_ORDER, i), 0, 4))
      expect(current).toBe((previous + 7) % 12)
    }
  })
})

// ---------------------------------------------------------------------------
// CIRCLE_OF_FIFTHS
// ---------------------------------------------------------------------------

describe('CIRCLE_OF_FIFTHS', () => {
  it('holds the fifteen major keys from Cb to C#', () => {
    expect(names(CIRCLE_OF_FIFTHS)).toEqual(MAJOR_NAMES)
  })

  it('runs from -7 to +7 in order', () => {
    expect(CIRCLE_OF_FIFTHS.map((k) => k.signature.fifths)).toEqual([
      -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7,
    ])
  })

  it('is entirely major', () => {
    for (const key of CIRCLE_OF_FIFTHS) {
      expect(key.mode).toBe('major')
      expect(key.signature.mode).toBe('major')
    }
  })

  it('stores every tonic in the key octave, with no register meaning', () => {
    for (const key of CIRCLE_OF_FIFTHS) expect(key.tonic.octave).toBe(4)
  })

  it('agrees with stacking perfect fifths up from C (independent derivation)', () => {
    // C G D A E B F# C# — the sharp side, one P5 at a time.
    let tonic = spell('C', 0, 4)
    for (let fifths = 0; fifths <= MAX; fifths++) {
      const key = keyFromFifths(fifths, 'major')
      expect(key.tonic.letter).toBe(tonic.letter)
      expect(key.tonic.alter).toBe(tonic.alter)
      tonic = transposeSpelled(tonic, PERFECT_FIFTH, 1)
    }
  })

  it('agrees with stacking perfect fifths down from C (independent derivation)', () => {
    // C F Bb Eb Ab Db Gb Cb — the flat side.
    let tonic = spell('C', 0, 4)
    for (let fifths = 0; fifths >= -MAX; fifths--) {
      const key = keyFromFifths(fifths, 'major')
      expect(key.tonic.letter).toBe(tonic.letter)
      expect(key.tonic.alter).toBe(tonic.alter)
      tonic = transposeSpelled(tonic, PERFECT_FIFTH, -1)
    }
  })

  it('places every minor tonic a minor third below the major sharing its signature', () => {
    for (const major of CIRCLE_OF_FIFTHS) {
      const expected = transposeSpelled(major.tonic, MINOR_THIRD, -1)
      const minor = keyFromFifths(major.signature.fifths, 'minor')
      expect(minor.tonic.letter).toBe(expected.letter)
      expect(minor.tonic.alter).toBe(expected.alter)
    }
  })
})

// ---------------------------------------------------------------------------
// keyFromFifths
// ---------------------------------------------------------------------------

describe('keyFromFifths', () => {
  it('names the fifteen minor keys, Ab minor to A# minor', () => {
    expect(names(Array.from({ length: 15 }, (_, i) => keyFromFifths(i - MAX, 'minor')))).toEqual(
      MINOR_NAMES,
    )
  })

  it('builds a key whose signature carries its own mode', () => {
    const key = keyFromFifths(-2, 'minor')
    expect(key).toEqual({
      tonic: { letter: 'G', alter: 0, octave: 4 },
      mode: 'minor',
      signature: { fifths: -2, mode: 'minor' },
    })
  })

  it('rejects signatures beyond seven accidentals', () => {
    expect(() => keyFromFifths(8, 'major')).toThrow(RangeError)
    expect(() => keyFromFifths(-8, 'major')).toThrow(RangeError)
    expect(() => keyFromFifths(100, 'minor')).toThrow(/-7\.\.7/)
  })

  it('rejects a fractional number of fifths', () => {
    expect(() => keyFromFifths(1.5, 'major')).toThrow(RangeError)
    expect(() => keyFromFifths(Number.NaN, 'major')).toThrow(RangeError)
  })

  it('round-trips its argument for every standard signature', () => {
    fc.assert(
      fc.property(arbFifths, arbMode, (fifths, mode) => {
        const key = keyFromFifths(fifths, mode)
        expect(key.signature.fifths).toBe(fifths)
        expect(key.signature.mode).toBe(mode)
        expect(key.mode).toBe(mode)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// keyOf / keySignatureForTonic
// ---------------------------------------------------------------------------

describe('keySignatureForTonic', () => {
  it('gives the textbook signatures', () => {
    // C major 0, G major 1 sharp, F major 1 flat, B major 5 sharps, Cb major 7 flats.
    expect(unwrap(keySignatureForTonic(spell('C', 0, 4), 'major')).fifths).toBe(0)
    expect(unwrap(keySignatureForTonic(spell('G', 0, 4), 'major')).fifths).toBe(1)
    expect(unwrap(keySignatureForTonic(spell('F', 0, 4), 'major')).fifths).toBe(-1)
    expect(unwrap(keySignatureForTonic(spell('B', 0, 4), 'major')).fifths).toBe(5)
    expect(unwrap(keySignatureForTonic(spell('C', -1, 4), 'major')).fifths).toBe(-7)
    // A minor 0, E minor 1 sharp, Bb minor 5 flats, F# minor 3 sharps.
    expect(unwrap(keySignatureForTonic(spell('A', 0, 4), 'minor')).fifths).toBe(0)
    expect(unwrap(keySignatureForTonic(spell('E', 0, 4), 'minor')).fifths).toBe(1)
    expect(unwrap(keySignatureForTonic(spell('B', -1, 4), 'minor')).fifths).toBe(-5)
    expect(unwrap(keySignatureForTonic(spell('F', 1, 4), 'minor')).fifths).toBe(3)
  })

  it('carries the mode into the signature', () => {
    expect(unwrap(keySignatureForTonic(spell('A', 0, 4), 'minor'))).toEqual({
      fifths: 0,
      mode: 'minor',
    })
  })

  it('rejects tonics with no standard signature, saying how many accidentals it would need', () => {
    const gSharp = keySignatureForTonic(spell('G', 1, 4), 'major')
    expect(isErr(gSharp)).toBe(true)
    if (isErr(gSharp)) {
      expect(gSharp.error).toContain('G# major')
      expect(gSharp.error).toContain('8 sharps')
    }
    const fFlat = keySignatureForTonic(spell('F', -1, 4), 'minor')
    expect(isErr(fFlat)).toBe(true)
    if (isErr(fFlat)) expect(fFlat.error).toContain('11 flats')
  })

  it('rejects double accidentals on the tonic', () => {
    expect(isErr(keySignatureForTonic(spell('C', 2, 4), 'major'))).toBe(true)
    expect(isErr(keySignatureForTonic(spell('C', -2, 4), 'minor'))).toBe(true)
  })

  it('accepts exactly the boundary keys, and nothing past them', () => {
    expect(isOk(keySignatureForTonic(spell('C', 1, 4), 'major'))).toBe(true) // C# major, +7
    expect(isErr(keySignatureForTonic(spell('G', 1, 4), 'major'))).toBe(true) // G# major, +8
    expect(isOk(keySignatureForTonic(spell('C', -1, 4), 'major'))).toBe(true) // Cb major, -7
    expect(isErr(keySignatureForTonic(spell('F', -1, 4), 'major'))).toBe(true) // Fb major, -8
    expect(isOk(keySignatureForTonic(spell('A', 1, 4), 'minor'))).toBe(true) // A# minor, +7
    expect(isErr(keySignatureForTonic(spell('E', 1, 4), 'minor'))).toBe(true) // E# minor, +8
  })
})

describe('keyOf', () => {
  it('builds the named keys', () => {
    expect(name(unwrap(keyOf(spell('B', -1, 4), 'major')))).toBe('Bb major')
    expect(name(unwrap(keyOf(spell('F', 1, 4), 'minor')))).toBe('F# minor')
  })

  it('rejects G# major, which has no standard signature', () => {
    expect(isErr(keyOf(spell('G', 1, 4), 'major'))).toBe(true)
  })

  it('discards the tonic octave — a key has no register', () => {
    const low = unwrap(keyOf(spell('D', 0, 1), 'major'))
    const high = unwrap(keyOf(spell('D', 0, 7), 'major'))
    expect(low).toEqual(high)
    expect(low.tonic.octave).toBe(4)
  })

  it('round-trips every standard key through its own tonic', () => {
    for (const key of ALL_KEYS) {
      expect(unwrap(keyOf(key.tonic, key.mode))).toEqual(key)
    }
  })

  it('agrees with keySignatureForTonic', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        expect(unwrap(keySignatureForTonic(key.tonic, key.mode))).toEqual(key.signature)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// accidentalsOf / alterFor
// ---------------------------------------------------------------------------

describe('accidentalsOf', () => {
  it('gives nothing for C major', () => {
    expect(accidentalsOf({ fifths: 0, mode: 'major' })).toEqual([])
  })

  it('gives F# for G major and Bb for F major', () => {
    expect(accidentalsOf({ fifths: 1, mode: 'major' })).toEqual([{ letter: 'F', alter: 1 }])
    expect(accidentalsOf({ fifths: -1, mode: 'major' })).toEqual([{ letter: 'B', alter: -1 }])
  })

  it('gives B major five sharps: F# C# G# D# A#', () => {
    expect(accidentalsOf({ fifths: 5, mode: 'major' }).map((a) => a.letter)).toEqual([
      'F',
      'C',
      'G',
      'D',
      'A',
    ])
  })

  it('gives Cb major all seven flats: Bb Eb Ab Db Gb Cb Fb', () => {
    const flats = accidentalsOf({ fifths: -7, mode: 'major' })
    expect(flats.map((a) => a.letter)).toEqual(['B', 'E', 'A', 'D', 'G', 'C', 'F'])
    expect(flats.every((a) => a.alter === -1)).toBe(true)
  })

  it('gives Bb minor five flats: Bb Eb Ab Db Gb', () => {
    expect(accidentalsOf({ fifths: -5, mode: 'minor' }).map((a) => a.letter)).toEqual([
      'B',
      'E',
      'A',
      'D',
      'G',
    ])
  })

  it('throws on a theoretical signature that cannot be written', () => {
    expect(() => accidentalsOf({ fifths: -10, mode: 'minor' })).toThrow(RangeError)
    expect(() => accidentalsOf({ fifths: 8, mode: 'major' })).toThrow(/cannot be written/)
    expect(() => accidentalsOf({ fifths: 0.5, mode: 'major' })).toThrow(RangeError)
  })

  it('returns exactly abs(fifths) accidentals, all the same direction', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        const accidentals = accidentalsOf(key.signature)
        expect(accidentals).toHaveLength(Math.abs(key.signature.fifths))
        const expected = key.signature.fifths > 0 ? 1 : -1
        expect(accidentals.every((a) => a.alter === expected)).toBe(true)
      }),
    )
  })

  it('is always a prefix of SHARP_ORDER or FLAT_ORDER', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        const letters = accidentalsOf(key.signature).map((a) => a.letter)
        const order = key.signature.fifths > 0 ? SHARP_ORDER : FLAT_ORDER
        expect(letters).toEqual(order.slice(0, letters.length))
      }),
    )
  })
})

describe('alterFor', () => {
  it('sharpens F in G major and flattens B in F major', () => {
    expect(alterFor({ fifths: 1, mode: 'major' }, 'F')).toBe(1)
    expect(alterFor({ fifths: -1, mode: 'major' }, 'B')).toBe(-1)
  })

  it('leaves untouched letters natural', () => {
    expect(alterFor({ fifths: 1, mode: 'major' }, 'C')).toBe(0)
    for (const letter of LETTERS) expect(alterFor({ fifths: 0, mode: 'major' }, letter)).toBe(0)
  })

  it('reads D major correctly: F# and C#, everything else natural', () => {
    const d: KeySignature = { fifths: 2, mode: 'major' }
    // LETTERS is C D E F G A B; D major sharpens C and F only.
    expect(LETTERS.map((l) => alterFor(d, l))).toEqual([1, 0, 0, 1, 0, 0, 0])
  })

  it('throws on a theoretical signature', () => {
    expect(() => alterFor({ fifths: -10, mode: 'minor' }, 'C')).toThrow(RangeError)
  })

  it('agrees with accidentalsOf for every letter', () => {
    fc.assert(
      fc.property(arbKey, arbLetter, (key, letter) => {
        const listed = accidentalsOf(key.signature).find((a) => a.letter === letter)
        expect(alterFor(key.signature, letter)).toBe(listed?.alter ?? 0)
      }),
    )
  })

  it('agrees with accidentalsOf for every letter of every writable signature', () => {
    // Exhaustive rather than sampled: alterFor no longer goes through
    // accidentalsOf, so the two implementations have to be pinned together.
    for (let fifths = -MAX; fifths <= MAX; fifths++) {
      for (const mode of ['major', 'minor'] as const) {
        const signature: KeySignature = { fifths, mode }
        const listed = accidentalsOf(signature)
        for (const letter of LETTERS) {
          const expected = listed.find((a) => a.letter === letter)?.alter ?? 0
          expect(alterFor(signature, letter)).toBe(expected)
        }
      }
    }
  })

  it('alters exactly abs(fifths) of the seven letters', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        const altered = LETTERS.filter((l) => alterFor(key.signature, l) !== 0)
        expect(altered).toHaveLength(Math.abs(key.signature.fifths))
      }),
    )
  })

  it('spells its own tonic: the signature already supplies the tonic accidental', () => {
    for (const key of ALL_KEYS) {
      expect(alterFor(key.signature, key.tonic.letter)).toBe(key.tonic.alter)
    }
  })
})

// ---------------------------------------------------------------------------
// keyName
// ---------------------------------------------------------------------------

describe('keyName', () => {
  it('names keys without a register', () => {
    expect(keyName(keyFromFifths(-2, 'major'))).toBe('Bb major')
    expect(keyName(keyFromFifths(3, 'minor'))).toBe('F# minor')
    expect(keyName(keyFromFifths(0, 'major'))).toBe('C major')
    expect(keyName(keyFromFifths(-7, 'major'))).toBe('Cb major')
  })
})

// ---------------------------------------------------------------------------
// relative
// ---------------------------------------------------------------------------

describe('relativeKey', () => {
  it('pairs Eb major with C minor', () => {
    expect(name(relativeKey(named('Eb major')))).toBe('C minor')
    expect(name(relativeKey(named('C minor')))).toBe('Eb major')
  })

  it('pairs C major with A minor and G major with E minor', () => {
    expect(name(relativeKey(keyFromFifths(0, 'major')))).toBe('A minor')
    expect(name(relativeKey(keyFromFifths(1, 'major')))).toBe('E minor')
  })

  it('keeps the signature and flips the mode', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        const relative = relativeKey(key)
        expect(relative.signature.fifths).toBe(key.signature.fifths)
        expect(relative.mode).not.toBe(key.mode)
        expect(relative.signature.mode).toBe(relative.mode)
      }),
    )
  })

  it('is its own inverse', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        expect(relativeKey(relativeKey(key))).toEqual(key)
      }),
    )
  })

  it('puts the relative minor tonic a minor third below the major', () => {
    fc.assert(
      fc.property(arbMajorKey, (major) => {
        const minor = relativeKey(major)
        expect(spelledPitchClass(minor.tonic)).toBe((spelledPitchClass(major.tonic) + 9) % 12)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// closely related
// ---------------------------------------------------------------------------

describe('closelyRelatedKeys', () => {
  it('gives C major its five neighbours', () => {
    // G, F, A minor, E minor, D minor — dominant, subdominant, then the three relatives.
    expect(names(closelyRelatedKeys(keyFromFifths(0, 'major')))).toEqual([
      'G major',
      'F major',
      'A minor',
      'E minor',
      'D minor',
    ])
  })

  it('gives A minor its five neighbours', () => {
    expect(names(closelyRelatedKeys(keyFromFifths(0, 'minor')))).toEqual([
      'E minor',
      'D minor',
      'C major',
      'G major',
      'F major',
    ])
  })

  it('gives C# major the sharp-side neighbours, unwrapped', () => {
    // The dominant of C# major is G# major (+8) and the mediant E# minor (+8).
    // Wrapping them round the circle to Ab major and F minor would be
    // enharmonically true and pedagogically false.
    expect(names(closelyRelatedKeys(named('C# major')))).toEqual([
      'G# major',
      'F# major',
      'A# minor',
      'E# minor',
      'D# minor',
    ])
  })

  it('gives Cb major the flat-side neighbours, unwrapped', () => {
    // Subdominant Fb major (-8), and its relative Db minor (-8).
    expect(names(closelyRelatedKeys(named('Cb major')))).toEqual([
      'Gb major',
      'Fb major',
      'Ab minor',
      'Eb minor',
      'Db minor',
    ])
  })

  it('gives A# minor and Ab minor the same treatment', () => {
    expect(names(closelyRelatedKeys(named('A# minor')))).toEqual([
      'E# minor',
      'D# minor',
      'C# major',
      'G# major',
      'F# major',
    ])
    expect(names(closelyRelatedKeys(named('Ab minor')))).toEqual([
      'Eb minor',
      'Db minor',
      'Cb major',
      'Gb major',
      'Fb major',
    ])
  })

  it('produces a theoretical signature at the edges, which enharmonicKey rescues', () => {
    const gSharpMajor = at(closelyRelatedKeys(named('C# major')), 0)
    expect(gSharpMajor.signature.fifths).toBe(8)
    expect(() => accidentalsOf(gSharpMajor.signature)).toThrow(RangeError)
    expect(name(twinOf(gSharpMajor))).toBe('Ab major')

    const fFlatMajor = at(closelyRelatedKeys(named('Cb major')), 1)
    expect(fFlatMajor.signature.fifths).toBe(-8)
    expect(name(twinOf(fFlatMajor))).toBe('E major')
  })

  it('moves at most one raw station, never the long way round the circle', () => {
    // The distinguishing property: an unwrapped neighbourhood differs by ±1 in
    // the *raw* fifths, where a wrapped one jumps by 11 at the edges.
    fc.assert(
      fc.property(arbKey, (key) => {
        for (const related of closelyRelatedKeys(key)) {
          expect(Math.abs(related.signature.fifths - key.signature.fifths)).toBeLessThanOrEqual(1)
        }
      }),
    )
  })

  it('keeps every neighbour writable except at the two edge signatures', () => {
    for (const key of ALL_KEYS) {
      const theoretical = closelyRelatedKeys(key).filter((k) => Math.abs(k.signature.fifths) > MAX)
      expect(theoretical).toHaveLength(Math.abs(key.signature.fifths) === MAX ? 2 : 0)
    }
  })

  it('always returns five distinct keys', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        const related = closelyRelatedKeys(key)
        expect(related).toHaveLength(5)
        expect(new Set(names(related)).size).toBe(5)
      }),
    )
  })

  it('never includes the key itself', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        expect(names(closelyRelatedKeys(key))).not.toContain(keyName(key))
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// enharmonicKey
// ---------------------------------------------------------------------------

describe('enharmonicKey', () => {
  it('pairs the three enharmonic major keys', () => {
    expect(name(twinOf(named('C# major')))).toBe('Db major')
    expect(name(twinOf(named('Db major')))).toBe('C# major')
    expect(name(twinOf(named('B major')))).toBe('Cb major')
    expect(name(twinOf(named('F# major')))).toBe('Gb major')
  })

  it('pairs the enharmonic minor keys', () => {
    expect(name(twinOf(named('G# minor')))).toBe('Ab minor')
    expect(name(twinOf(named('D# minor')))).toBe('Eb minor')
    expect(name(twinOf(named('A# minor')))).toBe('Bb minor')
  })

  it('returns null for keys with fewer than five accidentals', () => {
    for (let fifths = -4; fifths <= 4; fifths++) {
      expect(enharmonicKey(keyFromFifths(fifths, 'major'))).toBeNull()
      expect(enharmonicKey(keyFromFifths(fifths, 'minor'))).toBeNull()
    }
  })

  it('exists for exactly the six most remote keys of each mode', () => {
    const withTwin = ALL_KEYS.filter((k) => enharmonicKey(k) !== null)
    expect(withTwin).toHaveLength(12)
    expect(withTwin.every((k) => Math.abs(k.signature.fifths) >= 5)).toBe(true)
  })

  it('keeps the mode, sounds the same and is spelled differently', () => {
    for (const key of ALL_KEYS) {
      const twin = enharmonicKey(key)
      if (twin === null) continue
      expect(twin.mode).toBe(key.mode)
      expect(spelledPitchClass(twin.tonic)).toBe(spelledPitchClass(key.tonic))
      expect(twin.tonic.letter).not.toBe(key.tonic.letter)
      expect(twin.signature.fifths).not.toBe(key.signature.fifths)
    }
  })

  it('is its own inverse wherever it exists', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        const twin = enharmonicKey(key)
        if (twin === null) return
        expect(enharmonicKey(twin)).toEqual(key)
      }),
    )
  })

  it('rescues every theoretical key closelyRelatedKeys produces', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        for (const related of closelyRelatedKeys(key)) {
          if (Math.abs(related.signature.fifths) <= 7) continue
          const twin = enharmonicKey(related)
          expect(twin).not.toBeNull()
          if (twin === null) continue
          expect(Math.abs(twin.signature.fifths)).toBeLessThanOrEqual(7)
          expect(spelledPitchClass(twin.tonic)).toBe(spelledPitchClass(related.tonic))
        }
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// cross-module sanity: the signature really spells the scale
// ---------------------------------------------------------------------------

describe('key signatures against the music', () => {
  it('spells the D major scale as D E F# G A B C#', () => {
    const d: KeySignature = { fifths: 2, mode: 'major' }
    const scale = ['D', 'E', 'F', 'G', 'A', 'B', 'C'] as const
    expect(scale.map((l) => `${l}${alterFor(d, l) === 1 ? '#' : ''}`)).toEqual([
      'D',
      'E',
      'F#',
      'G',
      'A',
      'B',
      'C#',
    ])
  })

  it('spells the Eb major scale as Eb F G Ab Bb C D', () => {
    const eb: KeySignature = { fifths: -3, mode: 'major' }
    const scale = ['E', 'F', 'G', 'A', 'B', 'C', 'D'] as const
    expect(scale.map((l) => `${l}${alterFor(eb, l) === -1 ? 'b' : ''}`)).toEqual([
      'Eb',
      'F',
      'G',
      'Ab',
      'Bb',
      'C',
      'D',
    ])
  })

  it('agrees with the tonic parsed from its own name', () => {
    expect(tonicOf('Gb major')).toEqual(spell('G', -1, 4))
    expect(tonicOf('A# minor')).toEqual(spell('A', 1, 4))
  })
})
