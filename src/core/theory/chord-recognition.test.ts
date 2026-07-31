import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { at } from '@core/shared/invariant.ts'
import { unwrap } from '@core/shared/result.ts'
import { midi, type Midi } from '@core/shared/units.ts'
import {
  type Alter,
  LETTERS,
  parsePitch,
  spell,
  type SpelledPitch,
  spelledPitchClass,
} from './pitch.ts'
import {
  buildChord,
  type Chord,
  CHORD_INTERVALS,
  CHORD_QUALITIES,
  type ChordQuality,
  chordMidi,
  chordSymbol,
  figuredBass,
  type Inversion,
  isTriad,
} from './chords.ts'
import { identifyChord, matchesChord } from './chord-recognition.ts'

// ---------------------------------------------------------------------------
// helpers (deliberately duplicated from chords.test.ts — a shared fixture file
// under src/core would be counted by the coverage gate)
// ---------------------------------------------------------------------------

/** Parse a pitch name that is known to be legal: `p('C#4')`. */
const p = (text: string): SpelledPitch => unwrap(parsePitch(text))

const m = (...notes: readonly number[]): readonly Midi[] => notes.map(midi)

/** Every letter with a flat, a natural and a sharp — 21 practical roots. */
const ALL_ROOTS: readonly SpelledPitch[] = LETTERS.flatMap((letter) =>
  ([-1, 0, 1] as readonly Alter[]).map((alter) => spell(letter, alter, 4)),
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

/** Every legal (root, quality, inversion) over ALL_ROOTS. */
function* everyChord(): Generator<Chord> {
  for (const root of ALL_ROOTS) {
    for (const quality of CHORD_QUALITIES) {
      if (!spellable(root, quality)) continue
      for (const inversion of inversionsOf(quality)) {
        yield buildChord(root, quality, inversion)
      }
    }
  }
}

const rootArb = fc.constantFrom(...ALL_ROOTS)
const qualityArb = fc.constantFrom(...CHORD_QUALITIES)
const inversionArb = fc.constantFrom<Inversion>(0, 1, 2, 3)

// ---------------------------------------------------------------------------
// identifyChord
// ---------------------------------------------------------------------------

describe('identifyChord', () => {
  const top = (notes: readonly Midi[]): Chord => at(identifyChord(notes), 0).chord

  it('recognises a root-position C major triad', () => {
    // C4 E4 G4
    const matches = identifyChord(m(60, 64, 67))
    const best = at(matches, 0)
    expect(chordSymbol(best.chord)).toBe('C')
    expect(best.confidence).toBe(1)
  })

  it('recognises inversions from the bass note', () => {
    expect(chordSymbol(top(m(64, 67, 72)))).toBe('C/E') // E4 G4 C5
    expect(figuredBass(top(m(64, 67, 72)))).toBe('6')
    expect(chordSymbol(top(m(67, 72, 76)))).toBe('C/G') // G4 C5 E5
    expect(figuredBass(top(m(67, 72, 76)))).toBe('6/4')
  })

  it('ignores octave doubling', () => {
    // C2 with C4 E4 G4 C5 — still just C major.
    const matches = identifyChord(m(36, 60, 64, 67, 72))
    expect(chordSymbol(at(matches, 0).chord)).toBe('C')
    expect(at(matches, 0).confidence).toBe(1)
  })

  it('does not care what order the notes arrive in', () => {
    // The bass is the lowest sounding note, not the first one played.
    expect(chordSymbol(top(m(72, 64, 67)))).toBe('C/E')
    expect(chordSymbol(top(m(67, 64, 72)))).toBe('C/E')
  })

  it('handles notes spread over three octaves', () => {
    // E2 G3 C6 — a widely spaced C major, third in the bass.
    expect(chordSymbol(top(m(40, 55, 84)))).toBe('C/E')
  })

  // B D F Ab is a diminished 7th: stacked minor thirds, so every note can be
  // heard as the root. All four readings are equally valid.
  it('returns all four roots of a diminished 7th', () => {
    const matches = identifyChord(m(59, 62, 65, 68))
    const exact = matches.filter((x) => x.confidence === 1)
    expect(exact.every((x) => x.chord.quality === 'diminished7')).toBe(true)
    expect(new Set(exact.map((x) => spelledPitchClass(x.chord.root)))).toEqual(
      new Set([11, 2, 5, 8]),
    )
    expect(exact).toHaveLength(4)
  })

  // C E G# divides the octave evenly too: C+, E+ and G#+ are the same keys.
  it('returns all three roots of an augmented triad', () => {
    const exact = identifyChord(m(60, 64, 68)).filter((x) => x.confidence === 1)
    expect(exact.map((x) => x.chord.quality)).toEqual(['augmented', 'augmented', 'augmented'])
    expect(new Set(exact.map((x) => spelledPitchClass(x.chord.root)))).toEqual(new Set([0, 4, 8]))
  })

  // C D G is Csus2 and Gsus4 at the same time; the bass breaks the tie.
  it('lets the bass note break the sus2/sus4 tie', () => {
    expect(chordSymbol(top(m(60, 62, 67)))).toBe('Csus2')
    expect(chordSymbol(top(m(55, 60, 62)))).toBe('Gsus4')
    expect(identifyChord(m(60, 62, 67)).filter((x) => x.confidence === 1)).toHaveLength(2)
  })

  it('prefers an exact match over a superset or subset reading', () => {
    // B3 C4 E4 G4 is Cmaj7 in third inversion — exact. C major is also present
    // as a subset reading, but ranked below it.
    const matches = identifyChord(m(59, 60, 64, 67))
    expect(chordSymbol(at(matches, 0).chord)).toBe('Cmaj7/B')
    expect(at(matches, 0).confidence).toBe(1)
    const plain = matches.find((x) => chordSymbol(x.chord) === 'C')
    expect(plain?.confidence).toBeCloseTo(0.75)
    // The bass B is not a C major chord tone, so that reading is root position.
    expect(plain?.chord.inversion).toBe(0)
  })

  it('offers plausible readings of an incomplete chord', () => {
    // C and E alone: a major third, which five triads contain. Readings rooted
    // on the sounding bass come first. E+ and G#+ spell that bass as B#, which
    // is what those chords genuinely call it.
    const matches = identifyChord(m(60, 64))
    expect(matches.map((x) => chordSymbol(x.chord))).toEqual(['C', 'C+', 'Am/C', 'E+/B#', 'G#+/B#'])
    expect(matches.every((x) => x.confidence > 0.5 && x.confidence < 1)).toBe(true)
    expect(at(matches, 0).confidence).toBeCloseTo(2 / 3)
  })

  it.each([
    ['no notes', [] as number[]],
    ['a single note', [60]],
    ['a chromatic cluster', [60, 61, 62]],
  ])('returns nothing for %s', (_label, notes) => {
    expect(identifyChord(m(...notes))).toEqual([])
  })

  it('always ranks by descending confidence, all above the floor', () => {
    for (const chord of everyChord()) {
      const matches = identifyChord(chordMidi(chord))
      const confidences = matches.map((x) => x.confidence)
      expect(confidences).toEqual([...confidences].sort((a, b) => b - a))
      expect(confidences.every((c) => c > 0.5 && c <= 1)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// matchesChord
// ---------------------------------------------------------------------------

describe('matchesChord', () => {
  const cMajor = buildChord(p('C4'), 'major')

  it('accepts the exact voicing in any order', () => {
    expect(matchesChord(m(60, 64, 67), cMajor)).toBe(true)
    expect(matchesChord(m(67, 60, 64), cMajor)).toBe(true)
  })

  it('rejects a missing, extra or wrong note', () => {
    expect(matchesChord(m(60, 64), cMajor)).toBe(false)
    expect(matchesChord(m(60, 64, 67, 69), cMajor)).toBe(false)
    expect(matchesChord(m(60, 63, 67), cMajor)).toBe(false)
    expect(matchesChord([], cMajor)).toBe(false)
  })

  // "Note for note" counts notes. Four keys struck against a three-note voicing
  // is not the voicing, even when one of them is a repeat of a note in it.
  it('counts a repeated note as an extra note, not as a no-op', () => {
    expect(matchesChord(m(60, 60, 64, 67), cMajor)).toBe(false)
    expect(matchesChord(m(60, 64, 67, 67), cMajor)).toBe(false)
    expect(matchesChord(m(60, 60, 64, 64, 67, 67), cMajor)).toBe(false)
  })

  it('rejects a short voicing padded out with repeats', () => {
    // Three notes played, but only two distinct pitches — the G is missing.
    expect(matchesChord(m(60, 60, 64), cMajor)).toBe(false)
  })

  it('forgives a repeated note only under allowDoubling', () => {
    expect(matchesChord(m(60, 60, 64, 67), cMajor, { allowDoubling: true })).toBe(true)
    expect(matchesChord(m(60, 60, 64, 67), cMajor, { ignoreOctave: true })).toBe(true)
  })

  it('rejects a different inversion unless octaves are ignored', () => {
    const inverted = m(64, 67, 72)
    expect(matchesChord(inverted, cMajor)).toBe(false)
    expect(matchesChord(inverted, cMajor, { ignoreOctave: true })).toBe(true)
  })

  it('ignoreOctave still requires the right notes', () => {
    expect(matchesChord(m(64, 67), cMajor, { ignoreOctave: true })).toBe(false)
    expect(matchesChord(m(64, 67, 72, 74), cMajor, { ignoreOctave: true })).toBe(false)
  })

  it('allowDoubling forgives an octave double but not a wrong note', () => {
    expect(matchesChord(m(48, 60, 64, 67), cMajor, { allowDoubling: true })).toBe(true)
    expect(matchesChord(m(60, 64, 67, 69), cMajor, { allowDoubling: true })).toBe(false)
  })

  it('allowDoubling still requires the written voicing to be present', () => {
    // The right pitch classes, but an octave too high — the voicing is missing.
    expect(matchesChord(m(72, 76, 79), cMajor, { allowDoubling: true })).toBe(false)
  })

  it('defaults both options to off', () => {
    const doubled = m(48, 60, 64, 67)
    expect(matchesChord(doubled, cMajor)).toBe(false)
    expect(matchesChord(doubled, cMajor, {})).toBe(false)
    expect(matchesChord(doubled, cMajor, { ignoreOctave: false, allowDoubling: false })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// properties
// ---------------------------------------------------------------------------

describe('properties', () => {
  it('every built chord is identified with its own root and quality', () => {
    // The big one: exhaustive over roots, qualities and inversions.
    for (const chord of everyChord()) {
      const matches = identifyChord(chordMidi(chord))
      const best = at(matches, 0).confidence
      expect(best).toBe(1)
      const tied = matches.filter((x) => x.confidence === 1)
      const found = tied.some(
        (x) =>
          spelledPitchClass(x.chord.root) === spelledPitchClass(chord.root) &&
          x.chord.quality === chord.quality,
      )
      expect({ symbol: chordSymbol(chord), found }).toEqual({
        symbol: chordSymbol(chord),
        found: true,
      })
    }
  })

  it('a root-position chord is identified unambiguously as itself', () => {
    fc.assert(
      fc.property(rootArb, qualityArb, (root, quality) => {
        fc.pre(spellable(root, quality))
        const best = at(identifyChord(chordMidi(buildChord(root, quality, 0))), 0).chord
        expect(spelledPitchClass(best.root)).toBe(spelledPitchClass(root))
        expect(best.quality).toBe(quality)
        expect(best.inversion).toBe(0)
      }),
    )
  })

  it('the identified chord sounds the same pitch classes as the notes played', () => {
    for (const chord of everyChord()) {
      const played = chordMidi(chord)
      for (const match of identifyChord(played)) {
        if (match.confidence !== 1) continue
        expect(matchesChord(played, match.chord, { ignoreOctave: true })).toBe(true)
      }
    }
  })

  it('a chord always matches its own MIDI notes under every option set', () => {
    fc.assert(
      fc.property(rootArb, qualityArb, inversionArb, (root, quality, inversion) => {
        fc.pre(spellable(root, quality))
        fc.pre(inversion < CHORD_INTERVALS[quality].length)
        const chord = buildChord(root, quality, inversion)
        const played = chordMidi(chord)
        expect(matchesChord(played, chord)).toBe(true)
        expect(matchesChord(played, chord, { ignoreOctave: true })).toBe(true)
        expect(matchesChord(played, chord, { allowDoubling: true })).toBe(true)
      }),
    )
  })

  it('repeating any one note of a chord breaks the default match', () => {
    fc.assert(
      fc.property(rootArb, qualityArb, inversionArb, fc.nat(), (root, quality, inversion, i) => {
        fc.pre(spellable(root, quality))
        fc.pre(inversion < CHORD_INTERVALS[quality].length)
        const chord = buildChord(root, quality, inversion)
        const played = chordMidi(chord)
        const repeated = [...played, at(played, i % played.length)]
        expect(matchesChord(repeated, chord)).toBe(false)
        expect(matchesChord(repeated, chord, { allowDoubling: true })).toBe(true)
        expect(matchesChord(repeated, chord, { ignoreOctave: true })).toBe(true)
      }),
    )
  })

  it('doubling the bass an octave down is only accepted when allowed', () => {
    fc.assert(
      fc.property(rootArb, qualityArb, (root, quality) => {
        fc.pre(spellable(root, quality))
        const chord = buildChord(root, quality, 0)
        const played = chordMidi(chord)
        const doubled = [...played, midi(at(played, 0) - 12)]
        expect(matchesChord(doubled, chord)).toBe(false)
        expect(matchesChord(doubled, chord, { allowDoubling: true })).toBe(true)
        expect(matchesChord(doubled, chord, { ignoreOctave: true })).toBe(true)
      }),
    )
  })
})
