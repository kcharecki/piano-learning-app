import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { at, InvariantError } from '@core/shared/invariant.ts'
import { isErr, isOk, unwrap } from '@core/shared/result.ts'
import { midi, type Midi } from '@core/shared/units.ts'
import {
  type Alter,
  fromMidi,
  LETTERS,
  parsePitch,
  pitchClass,
  pitchName,
  spell,
  type SpelledPitch,
} from './pitch.ts'
import {
  buildChord,
  type Chord,
  CHORD_INTERVALS,
  CHORD_QUALITIES,
  type ChordQuality,
  chordMidi,
  chordSymbol,
  chordTones,
  figuredBass,
  identifyChord,
  type Inversion,
  invertChord,
  isTriad,
  matchesChord,
  parseChordSymbol,
  SEVENTHS,
  TRIADS,
} from './chords.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Parse a pitch name that is known to be legal: `p('C#4')`. */
const p = (text: string): SpelledPitch => unwrap(parsePitch(text))

/** The written notes of a chord, as names: `['C4', 'E4', 'G4']`. */
const names = (chord: Chord): readonly string[] => chord.notes.map(pitchName)

const m = (...notes: readonly number[]): readonly Midi[] => notes.map(midi)

/** Every letter with a flat, a natural and a sharp — 21 practical roots. */
const ALL_ROOTS: readonly SpelledPitch[] = LETTERS.flatMap((letter) =>
  ([-1, 0, 1] as readonly Alter[]).map((alter) => spell(letter, alter, 4)),
)

/** The twelve default spellings `identifyChord` answers with. */
const SHARP_ROOTS: readonly SpelledPitch[] = Array.from({ length: 12 }, (_, i) =>
  fromMidi(midi(60 + i)),
)

/** Can this root/quality pair be written without a triple accidental? */
function spellable(root: SpelledPitch, quality: ChordQuality): boolean {
  try {
    buildChord(root, quality)
    return true
  } catch {
    return false
  }
}

const inversionsOf = (quality: ChordQuality): readonly Inversion[] =>
  isTriad(quality) ? [0, 1, 2] : [0, 1, 2, 3]

/** What `buildChord` was *asked for*, kept separate from what it returned. */
type ChordSpec = {
  readonly root: SpelledPitch
  readonly quality: ChordQuality
  readonly inversion: Inversion
}

/** Every legal (root, quality, inversion) over ALL_ROOTS. */
function* everySpec(): Generator<ChordSpec> {
  for (const root of ALL_ROOTS) {
    for (const quality of CHORD_QUALITIES) {
      if (!spellable(root, quality)) continue
      for (const inversion of inversionsOf(quality)) {
        yield { root, quality, inversion }
      }
    }
  }
}

function* everyChord(): Generator<Chord> {
  for (const spec of everySpec()) yield buildChord(spec.root, spec.quality, spec.inversion)
}

const classesOf = (notes: readonly Midi[]): ReadonlySet<number> => new Set(notes.map(pitchClass))

const rootArb = fc.constantFrom(...ALL_ROOTS)
const qualityArb = fc.constantFrom(...CHORD_QUALITIES)
const inversionArb = fc.constantFrom<Inversion>(0, 1, 2, 3)

// ---------------------------------------------------------------------------
// the interval table
// ---------------------------------------------------------------------------

/**
 * Compile-time half of the "the table is the source of truth" guarantee.
 * `TRIADS`/`SEVENTHS` must be tuples of literals, because `Triad`/`Seventh` are
 * read off them and every per-quality table is keyed by the resulting union.
 * Typed as `readonly Triad[]` — the shape before the fix — `IsTuple` is false
 * and `tsc` rejects this file.
 */
type Assert<T extends true> = T
type IsTuple<T> = T extends readonly unknown[] ? (number extends T['length'] ? false : true) : false
export type EnumerationsAreTuples = [
  Assert<IsTuple<typeof TRIADS>>,
  Assert<IsTuple<typeof SEVENTHS>>,
  Assert<IsTuple<typeof CHORD_QUALITIES>>,
]

describe('CHORD_INTERVALS', () => {
  it('matches the semitone table exactly', () => {
    expect(CHORD_INTERVALS).toEqual({
      major: [0, 4, 7],
      minor: [0, 3, 7],
      diminished: [0, 3, 6],
      augmented: [0, 4, 8],
      sus2: [0, 2, 7],
      sus4: [0, 5, 7],
      dominant7: [0, 4, 7, 10],
      major7: [0, 4, 7, 11],
      minor7: [0, 3, 7, 10],
      halfDiminished7: [0, 3, 6, 10],
      diminished7: [0, 3, 6, 9],
      minorMajor7: [0, 3, 7, 11],
      augmentedMajor7: [0, 4, 8, 11],
    })
  })

  it('covers every quality exactly once', () => {
    expect(CHORD_QUALITIES).toHaveLength(13)
    expect(new Set(CHORD_QUALITIES).size).toBe(13)
    expect([...TRIADS, ...SEVENTHS]).toEqual([...CHORD_QUALITIES])
  })

  it('is keyed by exactly the qualities that exist, with nothing derived away', () => {
    // The table is built by copying the spelling table's own keys, so the key
    // set here is evidence that no quality was dropped on the way through.
    expect(Object.keys(CHORD_INTERVALS).sort()).toEqual([...CHORD_QUALITIES].sort())
    for (const quality of CHORD_QUALITIES) {
      expect(CHORD_INTERVALS[quality]).toBeDefined()
    }
  })

  it('is frozen, values included', () => {
    expect(Object.isFrozen(CHORD_INTERVALS)).toBe(true)
    for (const quality of CHORD_QUALITIES) {
      expect(Object.isFrozen(CHORD_INTERVALS[quality])).toBe(true)
    }
  })

  it('is strictly ascending and starts on the root for every quality', () => {
    for (const quality of CHORD_QUALITIES) {
      const semis = CHORD_INTERVALS[quality]
      expect(at(semis, 0)).toBe(0)
      expect([...semis]).toEqual([...semis].sort((a, b) => a - b))
      expect(new Set(semis).size).toBe(semis.length)
      expect(at(semis, semis.length - 1)).toBeLessThan(12)
    }
  })

  it('agrees with the notes buildChord actually produces', () => {
    for (const chord of everyChord()) {
      if (chord.inversion !== 0) continue
      const midis = chordMidi(chord)
      const root = at(midis, 0)
      expect(midis.map((n) => n - root)).toEqual([...CHORD_INTERVALS[chord.quality]])
    }
  })
})

describe('isTriad', () => {
  it('is true for the six triads and false for the seven sevenths', () => {
    for (const quality of TRIADS) expect(isTriad(quality)).toBe(true)
    for (const quality of SEVENTHS) expect(isTriad(quality)).toBe(false)
  })

  it('agrees with the note count', () => {
    for (const quality of CHORD_QUALITIES) {
      expect(isTriad(quality)).toBe(CHORD_INTERVALS[quality].length === 3)
    }
  })
})

// ---------------------------------------------------------------------------
// spelling — the named music-theory cases
// ---------------------------------------------------------------------------

describe('buildChord spelling', () => {
  // D minor is D F A. Adding 3 semitones to D would give E#, which is the same
  // key on the piano and the wrong note on the page.
  it('spells D minor as D F A', () => {
    expect(names(buildChord(p('D4'), 'minor'))).toEqual(['D4', 'F4', 'A4'])
  })

  // C augmented raises the fifth: the G becomes G#, never Ab — the chord is
  // still a kind of fifth above C.
  it('spells C augmented as C E G#', () => {
    expect(names(buildChord(p('C4'), 'augmented'))).toEqual(['C4', 'E4', 'G#4'])
  })

  // Db major: a major third and perfect fifth above Db.
  it('spells Db major as Db F Ab', () => {
    expect(names(buildChord(p('Db4'), 'major'))).toEqual(['Db4', 'F4', 'Ab4'])
  })

  // B diminished 7 stacks minor thirds: B–D–F–Ab. The seventh is a *diminished*
  // seventh, so it is written Ab and not G#.
  it('spells B diminished 7 as B D F Ab', () => {
    expect(names(buildChord(p('B4'), 'diminished7'))).toEqual(['B4', 'D5', 'F5', 'Ab5'])
  })

  it.each([
    ['C4', 'major', ['C4', 'E4', 'G4']],
    ['G4', 'dominant7', ['G4', 'B4', 'D5', 'F5']],
    ['F4', 'major7', ['F4', 'A4', 'C5', 'E5']],
    ['B4', 'halfDiminished7', ['B4', 'D5', 'F5', 'A5']], // the ii-of-A-minor sound
    ['C#4', 'minor', ['C#4', 'E4', 'G#4']], // Moonlight Sonata's opening triad
    ['Eb4', 'minor', ['Eb4', 'Gb4', 'Bb4']],
    ['F#4', 'major', ['F#4', 'A#4', 'C#5']],
    ['Cb4', 'major', ['Cb4', 'Eb4', 'Gb4']],
    ['C4', 'diminished', ['C4', 'Eb4', 'Gb4']],
    ['C4', 'sus2', ['C4', 'D4', 'G4']],
    ['G4', 'sus4', ['G4', 'C5', 'D5']],
    ['C4', 'minor7', ['C4', 'Eb4', 'G4', 'Bb4']],
    ['C4', 'minorMajor7', ['C4', 'Eb4', 'G4', 'B4']],
    ['C4', 'augmentedMajor7', ['C4', 'E4', 'G#4', 'B4']],
    ['A4', 'diminished7', ['A4', 'C5', 'Eb5', 'Gb5']],
  ] as const)('spells %s %s correctly', (root, quality, expected) => {
    expect(names(buildChord(p(root), quality))).toEqual([...expected])
  })

  it('never invents a triple accidental — it refuses instead', () => {
    // The only impossible combinations among flat/natural/sharp roots.
    const impossible = ALL_ROOTS.flatMap((root) =>
      CHORD_QUALITIES.filter((q) => !spellable(root, q)).map(
        (q) => `${pitchName(root).slice(0, -1)} ${q}`,
      ),
    )
    expect(impossible.sort()).toEqual([
      'B# augmented',
      'B# augmentedMajor7',
      'Cb diminished7',
      'Fb diminished7',
    ])
  })

  it('throws an InvariantError rather than writing Bbbb', () => {
    expect(() => buildChord(p('Cb4'), 'diminished7')).toThrow(InvariantError)
  })

  it('can spell every quality on all twelve sharp-side roots', () => {
    // identifyChord answers with these spellings, so they must all be writable.
    for (const root of SHARP_ROOTS) {
      for (const quality of CHORD_QUALITIES) {
        expect(spellable(root, quality)).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// inversions
// ---------------------------------------------------------------------------

describe('inversions', () => {
  it('puts the third in the bass for a first inversion', () => {
    expect(names(buildChord(p('C4'), 'major', 1))).toEqual(['E4', 'G4', 'C5'])
  })

  it('puts the fifth in the bass for a second inversion', () => {
    expect(names(buildChord(p('C4'), 'major', 2))).toEqual(['G4', 'C5', 'E5'])
  })

  // G7 in third inversion: the seventh, F, is in the bass — the classic
  // preparation for a C major first inversion.
  it('puts the seventh in the bass for a third inversion', () => {
    expect(names(buildChord(p('G4'), 'dominant7', 3))).toEqual(['F5', 'G5', 'B5', 'D6'])
  })

  it('defaults to root position', () => {
    expect(buildChord(p('C4'), 'major')).toEqual(buildChord(p('C4'), 'major', 0))
    expect(buildChord(p('C4'), 'major').inversion).toBe(0)
  })

  it('reports back the exact root, quality and inversion it was asked for', () => {
    // Compared against the *request*, not against the chord's own fields: an
    // implementation that dropped or rewrote the root would pass the latter.
    for (const spec of everySpec()) {
      const chord = buildChord(spec.root, spec.quality, spec.inversion)
      expect(chord.notes).toHaveLength(CHORD_INTERVALS[spec.quality].length)
      expect(chord.root).toEqual(spec.root)
      expect(pitchName(chord.root)).toBe(pitchName(spec.root))
      expect(chord.quality).toBe(spec.quality)
      expect(chord.inversion).toBe(spec.inversion)
    }
  })

  it('keeps the root even when the root is not the bass note', () => {
    // Eb4 minor7 in second inversion sounds Bb4 lowest; the root is still Eb4.
    const chord = buildChord(p('Eb4'), 'minor7', 2)
    expect(pitchName(chord.root)).toBe('Eb4')
    expect(pitchName(at(chord.notes, 0))).toBe('Bb4')
  })

  it('rejects a third inversion of a triad instead of clamping it', () => {
    const c = buildChord(p('C4'), 'major')
    expect(() => invertChord(c, 3)).toThrow(InvariantError)
    expect(() => invertChord(c, 3)).toThrow(/inversion 3 does not exist/)
    expect(() => buildChord(p('C4'), 'sus4', 3)).toThrow(InvariantError)
  })

  it('allows a third inversion of a seventh', () => {
    expect(() => invertChord(buildChord(p('C4'), 'dominant7'), 3)).not.toThrow()
  })

  it('re-voices without changing the root or quality', () => {
    const first = buildChord(p('Eb4'), 'minor7', 1)
    const third = invertChord(first, 3)
    expect(third.root).toEqual(first.root)
    expect(third.quality).toBe('minor7')
    expect(third.inversion).toBe(3)
    expect(names(third)).toEqual(['Db5', 'Eb5', 'Gb5', 'Bb5'])
  })
})

describe('chordTones', () => {
  it('returns root position within one octave whatever the inversion', () => {
    const inverted = buildChord(p('C4'), 'major', 2)
    expect(chordTones(inverted).map(pitchName)).toEqual(['C4', 'E4', 'G4'])
  })

  it('always spans less than an octave', () => {
    for (const chord of everyChord()) {
      const tones = chordTones(chord)
      expect(tones.map(pitchName)).toEqual(names(buildChord(chord.root, chord.quality, 0)))
      expect(at(tones, 0)).toEqual(chord.root)
    }
  })
})

describe('figuredBass', () => {
  it.each([
    ['major', 0, ''],
    ['major', 1, '6'],
    ['major', 2, '6/4'],
    ['dominant7', 0, '7'],
    ['dominant7', 1, '6/5'],
    ['dominant7', 2, '4/3'],
    ['dominant7', 3, '4/2'],
  ] as const)('figures a %s in inversion %i as %s', (quality, inversion, expected) => {
    expect(figuredBass(buildChord(p('C4'), quality, inversion))).toBe(expected)
  })

  it('is a bijection from inversion to figure within a chord', () => {
    for (const quality of CHORD_QUALITIES) {
      const figures = inversionsOf(quality).map((i) => figuredBass(buildChord(p('C4'), quality, i)))
      expect(new Set(figures).size).toBe(figures.length)
    }
  })
})

// ---------------------------------------------------------------------------
// symbols
// ---------------------------------------------------------------------------

describe('chordSymbol', () => {
  it.each([
    ['D4', 'minor', 0, 'Dm'],
    ['G4', 'dominant7', 0, 'G7'],
    ['C#4', 'diminished', 0, 'C#dim'],
    ['Bb4', 'augmented', 0, 'Bb+'],
    ['F4', 'major7', 0, 'Fmaj7'],
    ['B4', 'halfDiminished7', 0, 'Bm7b5'],
    ['C4', 'minor', 1, 'Cm/Eb'],
    ['C4', 'major', 0, 'C'],
    ['C4', 'sus2', 0, 'Csus2'],
    ['C4', 'sus4', 0, 'Csus4'],
    ['C4', 'diminished7', 0, 'Cdim7'],
    ['C4', 'minorMajor7', 0, 'CmMaj7'],
    ['C4', 'augmentedMajor7', 0, 'C+maj7'],
    ['C4', 'minor7', 0, 'Cm7'],
    ['G4', 'dominant7', 3, 'G7/F'],
    ['C4', 'major', 2, 'C/G'],
    ['Cb4', 'major', 1, 'Cb/Eb'],
  ] as const)('names %s %s inversion %i as %s', (root, quality, inversion, expected) => {
    expect(chordSymbol(buildChord(p(root), quality, inversion))).toBe(expected)
  })

  it('omits the slash in root position', () => {
    for (const chord of everyChord()) {
      expect(chordSymbol(chord).includes('/')).toBe(chord.inversion !== 0)
    }
  })
})

describe('parseChordSymbol', () => {
  it.each([
    ['Dm', 'D', 'minor', 0],
    ['G7', 'G', 'dominant7', 0],
    ['C#dim', 'C#', 'diminished', 0],
    ['Bb+', 'Bb', 'augmented', 0],
    ['Fmaj7', 'F', 'major7', 0],
    ['Bm7b5', 'B', 'halfDiminished7', 0],
    ['Cm/Eb', 'C', 'minor', 1],
    ['C', 'C', 'major', 0],
    ['C/G', 'C', 'major', 2],
    ['G7/F', 'G', 'dominant7', 3],
    ['Cbb', 'Cbb', 'major', 0],
  ] as const)('parses %s', (text, root, quality, inversion) => {
    const chord = unwrap(parseChordSymbol(text))
    expect(pitchName(chord.root)).toBe(`${root}4`)
    expect(chord.quality).toBe(quality)
    expect(chord.inversion).toBe(inversion)
  })

  it.each([
    ['CM', 'major'],
    ['Cmaj', 'major'],
    ['Cmin', 'minor'],
    ['C-', 'minor'],
    ['C°', 'diminished'],
    ['Caug', 'augmented'],
    ['Csus', 'sus4'],
    ['Cdom7', 'dominant7'],
    ['CM7', 'major7'],
    ['Cmin7', 'minor7'],
    ['C-7', 'minor7'],
    ['Cø', 'halfDiminished7'],
    ['Cø7', 'halfDiminished7'],
    ['C°7', 'diminished7'],
    ['CmM7', 'minorMajor7'],
    ['CminMaj7', 'minorMajor7'],
    ['C+M7', 'augmentedMajor7'],
    ['CaugMaj7', 'augmentedMajor7'],
    ['Cmaj7#5', 'augmentedMajor7'],
  ] as const)('accepts the alias %s as %s', (text, quality) => {
    expect(unwrap(parseChordSymbol(text)).quality).toBe(quality)
  })

  it('is case sensitive where it matters: CM7 is major, Cm7 is minor', () => {
    expect(unwrap(parseChordSymbol('CM7')).quality).toBe('major7')
    expect(unwrap(parseChordSymbol('Cm7')).quality).toBe('minor7')
  })

  it('accepts a lower-case root letter and surrounding whitespace', () => {
    expect(chordSymbol(unwrap(parseChordSymbol('  bb+  ')))).toBe('Bb+')
    expect(chordSymbol(unwrap(parseChordSymbol('f#m7')))).toBe('F#m7')
  })

  it.each([
    ['', 'empty chord symbol'],
    ['   ', 'empty chord symbol'],
    ['H7', 'not a chord symbol'],
    ['7', 'not a chord symbol'],
    ['C/E/G', 'not a chord symbol'],
    ['Cm/H', 'not a chord symbol'],
    ['C#b', 'mixed sharps and flats'],
    ['C###', 'too many accidentals'],
    ['Cbbb', 'too many accidentals'],
    ['Cwat', 'unknown chord quality'],
    ['CDIM', 'unknown chord quality'],
    ['C/F#', 'is not a member'],
    ['Cm/Ebb', 'is not a member'],
    ['C/E#b', 'mixed sharps and flats'],
    ['C/E###', 'too many accidentals'],
    ['Cbdim7', 'cannot spell'],
  ])('rejects %s', (text, reason) => {
    const result = parseChordSymbol(text)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error).toContain(reason)
  })

  // The bass is matched on the written note, letter and accidental. Every case
  // below sounds like a chord tone, so a parser that compared pitch classes
  // would accept it and hand back a chord the caller never typed.
  it.each([
    ['C/Fb', 'C/E inversion 1'],
    ['C/B#', 'root-position C'],
    ['Cm/D#', 'Cm/Eb inversion 1'],
    ['C7/A#', 'C7/Bb inversion 3'],
    ['C/Dbb', 'root-position C'],
    ['Cdim/D#', 'Cdim/Eb inversion 1'],
  ])('rejects the enharmonic bass %s rather than rewriting it as %s', (text) => {
    const result = parseChordSymbol(text)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error).toContain('is not a member')
  })

  it('still accepts the correctly spelled bass of each of those', () => {
    expect(chordSymbol(unwrap(parseChordSymbol('C/E')))).toBe('C/E')
    expect(chordSymbol(unwrap(parseChordSymbol('C/C')))).toBe('C')
    expect(chordSymbol(unwrap(parseChordSymbol('Cm/Eb')))).toBe('Cm/Eb')
    expect(chordSymbol(unwrap(parseChordSymbol('C7/Bb')))).toBe('C7/Bb')
    expect(chordSymbol(unwrap(parseChordSymbol('Cdim/Eb')))).toBe('Cdim/Eb')
  })

  it('never throws on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = parseChordSymbol(text)
        expect(typeof result.ok).toBe('boolean')
      }),
    )
  })

  it('accepts a bass only when the exact spelling is one of the chord tones', () => {
    // Exhaustive over every chord and every practical bass spelling: the parse
    // succeeds precisely when that letter+alter appears in the root-position
    // stack, and it never returns a chord whose bass is spelled differently.
    for (const root of ALL_ROOTS) {
      for (const quality of CHORD_QUALITIES) {
        if (!spellable(root, quality)) continue
        const symbol = chordSymbol(buildChord(root, quality, 0))
        const tones = chordTones(buildChord(root, quality, 0))
        for (const bass of ALL_ROOTS) {
          const text = `${symbol}/${pitchName(bass).slice(0, -1)}`
          const isMember = tones.some((t) => t.letter === bass.letter && t.alter === bass.alter)
          const result = parseChordSymbol(text)
          expect({ text, ok: isOk(result) }).toEqual({ text, ok: isMember })
          if (isOk(result)) {
            const bassNote = at(unwrap(result).notes, 0)
            expect({ letter: bassNote.letter, alter: bassNote.alter }).toEqual({
              letter: bass.letter,
              alter: bass.alter,
            })
          }
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// the recognition re-export — callers may import either module
// ---------------------------------------------------------------------------

describe('re-exports from chord-recognition', () => {
  it('exposes identifyChord and matchesChord under the chords entry point', () => {
    expect(chordSymbol(at(identifyChord(m(60, 64, 67)), 0).chord)).toBe('C')
    expect(matchesChord(m(60, 64, 67), buildChord(p('C4'), 'major'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// properties
// ---------------------------------------------------------------------------

describe('properties', () => {
  it('chordMidi is strictly ascending for every chord', () => {
    for (const chord of everyChord()) {
      const midis = chordMidi(chord)
      expect(midis).toHaveLength(chord.notes.length)
      for (let i = 1; i < midis.length; i++) {
        expect(at(midis, i)).toBeGreaterThan(at(midis, i - 1))
      }
    }
  })

  it('the pitch-class set is invariant under inversion', () => {
    fc.assert(
      fc.property(rootArb, qualityArb, inversionArb, (root, quality, inversion) => {
        fc.pre(spellable(root, quality))
        fc.pre(inversion < CHORD_INTERVALS[quality].length)
        const rooted = classesOf(chordMidi(buildChord(root, quality, 0)))
        const voiced = classesOf(chordMidi(buildChord(root, quality, inversion)))
        expect(voiced).toEqual(rooted)
        expect(voiced.size).toBe(CHORD_INTERVALS[quality].length)
      }),
    )
  })

  it('invertChord round-trips back to root position', () => {
    fc.assert(
      fc.property(rootArb, qualityArb, inversionArb, (root, quality, inversion) => {
        fc.pre(spellable(root, quality))
        fc.pre(inversion < CHORD_INTERVALS[quality].length)
        const rooted = buildChord(root, quality, 0)
        expect(invertChord(invertChord(rooted, inversion), 0)).toEqual(rooted)
      }),
    )
  })

  it('chordSymbol round-trips through parseChordSymbol', () => {
    fc.assert(
      fc.property(rootArb, qualityArb, inversionArb, (root, quality, inversion) => {
        fc.pre(spellable(root, quality))
        fc.pre(inversion < CHORD_INTERVALS[quality].length)
        const chord = buildChord(root, quality, inversion)
        const symbol = chordSymbol(chord)
        const parsed = parseChordSymbol(symbol)
        expect(isOk(parsed)).toBe(true)
        expect(unwrap(parsed)).toEqual(chord)
        expect(chordSymbol(unwrap(parsed))).toBe(symbol)
      }),
    )
  })

  it('chordSymbol round-trips exhaustively too', () => {
    for (const chord of everyChord()) {
      expect(unwrap(parseChordSymbol(chordSymbol(chord)))).toEqual(chord)
    }
  })

  it('figuredBass and inversion determine each other', () => {
    fc.assert(
      fc.property(rootArb, qualityArb, inversionArb, (root, quality, inversion) => {
        fc.pre(spellable(root, quality))
        fc.pre(inversion < CHORD_INTERVALS[quality].length)
        const figure = figuredBass(buildChord(root, quality, inversion))
        const others = inversionsOf(quality)
          .filter((i) => i !== inversion)
          .map((i) => figuredBass(buildChord(root, quality, i)))
        expect(others).not.toContain(figure)
      }),
    )
  })
})
