import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { at } from '@core/shared/invariant.ts'
import { unwrap } from '@core/shared/result.ts'
import { buildChord, type Chord, chordSymbol, type Inversion } from './chords.ts'
import { CIRCLE_OF_FIFTHS, keyFromFifths, type Key, relativeKey } from './keys.ts'
import { spell, toMidi } from './pitch.ts'
import {
  chordForRomanNumeral,
  classifyCadence,
  COMMON_PROGRESSIONS,
  diatonicChords,
  functionOf,
  matchProgression,
  romanNumeralFor,
} from './harmony.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const MAJOR_KEYS: readonly Key[] = [...CIRCLE_OF_FIFTHS]
const MINOR_KEYS: readonly Key[] = MAJOR_KEYS.map(relativeKey)
const ALL_KEYS: readonly Key[] = [...MAJOR_KEYS, ...MINOR_KEYS]

const C_MAJOR = keyFromFifths(0, 'major')
const A_MINOR = relativeKey(C_MAJOR)

const inversionsFor = (chord: Chord): readonly Inversion[] =>
  chord.notes.length === 4 ? [0, 1, 2, 3] : [0, 1, 2]

// ---------------------------------------------------------------------------
// diatonicChords / romanNumeralFor / chordForRomanNumeral — round trip
// ---------------------------------------------------------------------------

describe('diatonicChords + romanNumeralFor + chordForRomanNumeral round trip', () => {
  it('every diatonic triad and seventh, every inversion, every key, round-trips through its text', () => {
    for (const key of ALL_KEYS) {
      for (const seventh of [false, true]) {
        const chords = diatonicChords(key, seventh)
        expect(chords).toHaveLength(7)
        for (const chord of chords) {
          for (const inversion of inversionsFor(chord)) {
            const inverted = buildChord(chord.root, chord.quality, inversion)
            const numeral = romanNumeralFor(inverted, key)
            expect(numeral, `${chord.quality} in ${key.tonic.letter} ${key.mode}`).not.toBeNull()
            if (numeral === null) continue
            const rebuilt = chordForRomanNumeral(numeral.text, key)
            expect(rebuilt.ok, numeral.text).toBe(true)
            if (rebuilt.ok) expect(rebuilt.value).toEqual(inverted)
          }
        }
      }
    }
  })

  it('spells the concrete diatonic triads and sevenths of C major and A minor', () => {
    // Grounded against literal expected spellings, independent of the internal quality
    // tables — a mutated table (e.g. NATURAL_MINOR_QUALITIES[2] 'major' -> 'minor') fails
    // this even though it would still round-trip consistently against itself.
    expect(diatonicChords(C_MAJOR).map(chordSymbol)).toEqual([
      'C',
      'Dm',
      'Em',
      'F',
      'G',
      'Am',
      'Bdim',
    ])
    expect(diatonicChords(A_MINOR).map(chordSymbol)).toEqual([
      'Am',
      'Bdim',
      'C',
      'Dm',
      'Em',
      'F',
      'G',
    ])
    expect(diatonicChords(C_MAJOR, true).map(chordSymbol)).toEqual([
      'Cmaj7',
      'Dm7',
      'Em7',
      'Fmaj7',
      'G7',
      'Am7',
      'Bm7b5',
    ])
    expect(diatonicChords(A_MINOR, true).map(chordSymbol)).toEqual([
      'Am7',
      'Bm7b5',
      'Cmaj7',
      'Dm7',
      'Em7',
      'Fmaj7',
      'G7',
    ])
  })

  it('degree 1 of a major key is always the major tonic triad', () => {
    for (const key of MAJOR_KEYS) {
      const tonic = at(diatonicChords(key), 0)
      expect(tonic.quality).toBe('major')
      const numeral = romanNumeralFor(buildChord(tonic.root, 'major', 0), key)
      expect(numeral?.degree).toBe(1)
      expect(numeral?.text).toBe('I')
    }
  })

  it('property: every diatonic degree of every key is analysable and named consistently', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_KEYS),
        fc.boolean(),
        fc.integer({ min: 0, max: 6 }),
        (key, seventh, degreeIndex) => {
          const chord = at(diatonicChords(key, seventh), degreeIndex)
          const numeral = romanNumeralFor(chord, key)
          expect(numeral).not.toBeNull()
          if (numeral === null) return
          expect(numeral.degree).toBe(degreeIndex + 1)
          const rebuilt = chordForRomanNumeral(numeral.text, key)
          expect(rebuilt.ok).toBe(true)
          if (rebuilt.ok) expect(rebuilt.value).toEqual(chord)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('property: V/V (the applied dominant of the dominant) round-trips in every key', () => {
    // Degree 5 must always be tonicisable (it is never the tonic, and its diatonic triad is
    // always major or minor, never diminished), so this target can never fall into the
    // "unwritable in extreme keys" escape hatch a wider target range needs — every run must
    // actually assert something, unconditionally, including the printed text.
    fc.assert(
      fc.property(fc.constantFrom(...ALL_KEYS), fc.boolean(), (key, seventh) => {
        // Case carries quality: V is the dominant of a major key's V, but of a minor key's
        // v (minor), so the applied target must print lowercase there.
        const targetCase = key.mode === 'major' ? 'V' : 'v'
        const text = `V${seventh ? '7' : ''}/${targetCase}`
        const built = chordForRomanNumeral(text, key)
        expect(built.ok, text).toBe(true)
        if (!built.ok) return
        const numeral = romanNumeralFor(built.value, key)
        expect(numeral).not.toBeNull()
        if (numeral === null) return
        expect(numeral.degree).toBe(5)
        expect(numeral.appliedTo).toBe(5)
        expect(numeral.text).toBe(text)
      }),
      { numRuns: 200 },
    )
  })
})

describe('minor key: natural vs harmonic readings', () => {
  it('supports both v (natural) and V (harmonic) at degree 5', () => {
    const naturalV = unwrap(chordForRomanNumeral('v', A_MINOR))
    const harmonicV = unwrap(chordForRomanNumeral('V', A_MINOR))
    expect(naturalV.quality).toBe('minor')
    expect(harmonicV.quality).toBe('major')
    expect(naturalV.root).toEqual(harmonicV.root)
  })

  it('supports both VII (natural, subtonic) and vii° (harmonic, raised leading tone) at degree 7', () => {
    const naturalVII = unwrap(chordForRomanNumeral('VII', A_MINOR))
    const harmonicVii = unwrap(chordForRomanNumeral('vii°', A_MINOR))
    expect(naturalVII.quality).toBe('major')
    expect(harmonicVii.quality).toBe('diminished')
    expect(naturalVII.root).not.toEqual(harmonicVii.root)
  })

  it('a foreign spelling is not silently reinterpreted as the nearest diatonic chord', () => {
    // E# major triad sounds like F major (the diatonic IV) but is spelled
    // differently, and is not reachable as an applied or borrowed chord either.
    const chord = buildChord(spell('E', 1, 4), 'major', 0)
    expect(romanNumeralFor(chord, C_MAJOR)).toBeNull()
  })
})

describe('applied chords cannot tonicise the tonic or a diminished degree', () => {
  it('rejects V/I (the tonic is never a secondary-function target)', () => {
    expect(chordForRomanNumeral('V/I', C_MAJOR).ok).toBe(false)
  })

  it('rejects an applied chord targeting vii° in a major key', () => {
    expect(chordForRomanNumeral('V/VII', C_MAJOR).ok).toBe(false)
  })

  it('rejects an applied chord targeting ii° in a minor key', () => {
    expect(chordForRomanNumeral('V/II', A_MINOR).ok).toBe(false)
  })

  it('romanNumeralFor never reports an applied chord tonicising the tonic', () => {
    // B diminished 7 in C major is the diatonic vii°7 (borrowed from minor), not an applied
    // chord to I - I cannot be a secondary-function target.
    const bDim7 = buildChord(spell('B', 0, 4), 'diminished7', 0)
    const numeral = romanNumeralFor(bDim7, C_MAJOR)
    expect(numeral).not.toBeNull()
    expect(numeral?.appliedTo).toBeUndefined()
    expect(numeral?.text).toBe('vii°7')
  })

  it('an applied dominant lands back in the key octave, not a drifted register', () => {
    const vOfVi = unwrap(chordForRomanNumeral('V/vi', C_MAJOR))
    const tonic = unwrap(chordForRomanNumeral('I', C_MAJOR))
    expect(vOfVi.root.octave).toBe(tonic.root.octave)
  })
})

describe('harmonic-minor mediant (III+)', () => {
  it('analyses and parses the augmented mediant triad', () => {
    const augmentedMediant = buildChord(spell('C', 0, 4), 'augmented', 0)
    const numeral = romanNumeralFor(augmentedMediant, A_MINOR)
    expect(numeral).not.toBeNull()
    expect(numeral?.degree).toBe(3)
    expect(numeral?.text).toBe('III+')
    const rebuilt = chordForRomanNumeral('III+', A_MINOR)
    expect(rebuilt.ok).toBe(true)
  })
})

describe('COMMON_PROGRESSIONS entries normalize to distinct keys', () => {
  it('every progression matches itself, not an earlier colliding entry', () => {
    // If two entries normalized to the same key, matchProgression would silently return
    // whichever comes first in the array for both of them - this catches that directly.
    for (const progression of COMMON_PROGRESSIONS) {
      expect(matchProgression(progression.numerals)?.name).toBe(progression.name)
    }
  })
})

describe('borrowed chords', () => {
  it('parses bVII, bIII, bVI in a major key', () => {
    const bVII = unwrap(chordForRomanNumeral('bVII', C_MAJOR))
    expect(bVII.root.letter).toBe('B')
    expect(bVII.root.alter).toBe(-1)
    expect(bVII.quality).toBe('major')
    const numeral = romanNumeralFor(bVII, C_MAJOR)
    expect(numeral?.alter).toBe(-1)
    expect(numeral?.text).toBe('bVII')
  })

  it('rejects borrowed chords analysed against a minor key', () => {
    expect(chordForRomanNumeral('bVII', A_MINOR).ok).toBe(false)
  })
})

describe('functionOf', () => {
  it.each([
    ['I', 'tonic'],
    ['iii', 'tonic'],
    ['vi', 'tonic'],
    ['ii', 'predominant'],
    ['IV', 'predominant'],
    ['V', 'dominant'],
    ['vii°', 'dominant'],
  ] as const)('%s is %s', (text, expected) => {
    const chord = unwrap(chordForRomanNumeral(text, C_MAJOR))
    const numeral = romanNumeralFor(chord, C_MAJOR)
    expect(numeral).not.toBeNull()
    if (numeral) expect(functionOf(numeral, C_MAJOR)).toBe(expected)
  })

  it('bVII (the borrowed subtonic) is not a dominant-function chord: it has no leading tone', () => {
    const bVII = unwrap(chordForRomanNumeral('bVII', C_MAJOR))
    const numeral = romanNumeralFor(bVII, C_MAJOR)
    expect(numeral).not.toBeNull()
    if (numeral) expect(functionOf(numeral, C_MAJOR)).toBe('predominant')
  })

  it('an applied chord takes the function of what it resolves to, not of its own root', () => {
    const chord = unwrap(chordForRomanNumeral('V/ii', C_MAJOR))
    const numeral = romanNumeralFor(chord, C_MAJOR)
    expect(numeral?.appliedTo).toBe(2)
    // V/ii resolves to ii, which is predominant — not dominant, despite reading "V".
    expect(numeral && functionOf(numeral, C_MAJOR)).toBe('predominant')
  })
})

describe('classifyCadence', () => {
  const V = buildChord(spell('G', 0, 4), 'major', 0)
  const I = buildChord(spell('C', 0, 5), 'major', 0)
  const IV = buildChord(spell('F', 0, 4), 'major', 0)
  const vi = buildChord(spell('A', 0, 4), 'minor', 0)

  it('V-I, root position, tonic in the soprano: perfect authentic', () => {
    const soprano = toMidi(spell('C', 0, 6))
    expect(classifyCadence(V, I, C_MAJOR, soprano)).toBe('perfect-authentic')
  })

  it('V-I, root position, THIRD in the soprano: imperfect, not perfect (near miss)', () => {
    const soprano = toMidi(spell('E', 0, 6))
    expect(classifyCadence(V, I, C_MAJOR, soprano)).toBe('imperfect-authentic')
  })

  it('V-I with an inversion: imperfect authentic even with tonic in the soprano', () => {
    const V6 = buildChord(spell('G', 0, 4), 'major', 1)
    const soprano = toMidi(spell('C', 0, 6))
    expect(classifyCadence(V6, I, C_MAJOR, soprano)).toBe('imperfect-authentic')
  })

  it('V-I with soprano omitted: imperfect, never guessed perfect', () => {
    expect(classifyCadence(V, I, C_MAJOR)).toBe('imperfect-authentic')
  })

  it('anything-V: half cadence', () => {
    expect(classifyCadence(IV, V, C_MAJOR)).toBe('half')
  })

  it('IV-I: plagal cadence', () => {
    expect(classifyCadence(IV, I, C_MAJOR)).toBe('plagal')
  })

  it('V-vi: deceptive cadence', () => {
    expect(classifyCadence(V, vi, C_MAJOR)).toBe('deceptive')
  })

  it('V-IV: also deceptive (V resolving to anything but I)', () => {
    expect(classifyCadence(V, IV, C_MAJOR)).toBe('deceptive')
  })

  it('ii-iii: none of the recognised cadence types', () => {
    const ii = buildChord(spell('D', 0, 4), 'minor', 0)
    const iii = buildChord(spell('E', 0, 4), 'minor', 0)
    expect(classifyCadence(ii, iii, C_MAJOR)).toBe('none')
  })

  it('an applied chord never forms a cadence, even one that shares a scale degree', () => {
    const vOfV = unwrap(chordForRomanNumeral('V/V', C_MAJOR))
    expect(classifyCadence(vOfV, I, C_MAJOR)).toBe('none')
    const ivChord = unwrap(chordForRomanNumeral('IV', C_MAJOR))
    const vOfVi = unwrap(chordForRomanNumeral('V/vi', C_MAJOR))
    expect(classifyCadence(ivChord, vOfVi, C_MAJOR)).toBe('none')
  })

  it('natural (minor) v-i is not an authentic cadence: no leading tone, no dominant function', () => {
    const naturalV = unwrap(chordForRomanNumeral('v', A_MINOR))
    const i = buildChord(spell('A', 0, 4), 'minor', 0)
    expect(classifyCadence(naturalV, i, A_MINOR)).toBe('none')
  })

  it('a minor v does not form a half cadence either', () => {
    const iv = buildChord(spell('D', 0, 4), 'minor', 0)
    const naturalV = unwrap(chordForRomanNumeral('v', A_MINOR))
    expect(classifyCadence(iv, naturalV, A_MINOR)).toBe('none')
  })
})

describe('COMMON_PROGRESSIONS / matchProgression', () => {
  it('recognises a plain listed progression', () => {
    const match = matchProgression(['I', 'IV', 'V', 'I'])
    expect(match?.name).toBe(at(COMMON_PROGRESSIONS, 0).name)
  })

  it('is case-insensitive', () => {
    // 'i-v-VI-iv' has no minor-key twin in COMMON_PROGRESSIONS, unlike 'i-iv-V-i' (which
    // shares its normalized form with 'I-IV-V-I' by design, see the next test) — so this
    // exercises case-insensitivity without also pinning down which entry a collision resolves to.
    const match = matchProgression(['i', 'v', 'VI', 'iv'])
    expect(match?.numerals).toEqual(['I', 'V', 'vi', 'IV'])
  })

  it('the authentic-cadence progression matches both its major and minor spelling', () => {
    const authentic = at(COMMON_PROGRESSIONS, 0)
    expect(matchProgression(['I', 'IV', 'V', 'I'])?.name).toBe(authentic.name)
    expect(matchProgression(['i', 'iv', 'V', 'i'])?.name).toBe(authentic.name)
  })

  it('is inversion-insensitive', () => {
    const match = matchProgression(['I6', 'IV', 'V6/4', 'I'])
    expect(match?.numerals).toEqual(['I', 'IV', 'V', 'I'])
  })

  it('returns null for an unrecognised sequence', () => {
    expect(matchProgression(['ii', 'iii', 'vi'])).toBeNull()
  })
})

describe('chordForRomanNumeral error handling', () => {
  it('rejects garbage text', () => {
    expect(chordForRomanNumeral('not a numeral', C_MAJOR).ok).toBe(false)
  })

  it('rejects a quality that does not fit the degree', () => {
    // ii is minor in a major key — asking for "II" (major) must fail, not silently coerce.
    expect(chordForRomanNumeral('II', C_MAJOR).ok).toBe(false)
  })

  it('parses figured inversions', () => {
    const first = unwrap(chordForRomanNumeral('V6', C_MAJOR))
    expect(first.inversion).toBe(1)
    const second = unwrap(chordForRomanNumeral('V6/4', C_MAJOR))
    expect(second.inversion).toBe(2)
    const seventh1 = unwrap(chordForRomanNumeral('V6/5', C_MAJOR))
    expect(seventh1.inversion).toBe(1)
    expect(seventh1.quality).toBe('dominant7')
  })

  it('parses applied and diminished-seventh secondary chords', () => {
    const viio7ofV = unwrap(chordForRomanNumeral('viio7/V', C_MAJOR))
    expect(viio7ofV.quality).toBe('diminished7')
    const numeral = romanNumeralFor(viio7ofV, C_MAJOR)
    expect(numeral?.appliedTo).toBe(5)
    expect(numeral?.degree).toBe(7)
  })
})
