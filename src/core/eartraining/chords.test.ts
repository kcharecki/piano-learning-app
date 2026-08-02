import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { at } from '@core/shared/invariant.ts'
import { seededRng } from '@core/ports/rng.ts'
import { scriptedRng } from '@test/fakes.ts'
import { WHOLE } from '@core/shared/units.ts'
import { CHORD_INTERVALS, CHORD_QUALITIES, type ChordQuality, isTriad } from '@core/theory/chords.ts'
import { SCALE_INTERVALS, SCALE_TYPES, type ScaleType } from '@core/theory/scales.ts'
import {
  chordQualitiesForLevel,
  generateChordQualityItem,
  generateScaleModeItem,
  gradeChordQualityAnswer,
  gradeScaleModeAnswer,
  scaleTypesForLevel,
} from './chords.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const LEVEL_RANGE = { min: 1, max: 7 } // past EAR_MAX_LEVEL (5), to exercise the ladder's clamp too
const SEED_RANGE = { min: 0, max: 1_000_000 }

const levelArb = fc.integer(LEVEL_RANGE)
const seedArb = fc.integer(SEED_RANGE)

const pitchClassSet = (notes: readonly number[]): ReadonlySet<number> =>
  new Set(notes.map((n) => n % 12))

const setEquals = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x))

/** Does some transposition of `template` (semitones above an unknown root) equal `observed`? */
function matchesSomeTransposition(template: readonly number[], observed: ReadonlySet<number>): boolean {
  for (let shift = 0; shift < 12; shift++) {
    const shifted = new Set(template.map((iv) => (iv + shift) % 12))
    if (setEquals(shifted, observed)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// level ladders
// ---------------------------------------------------------------------------

describe('chordQualitiesForLevel', () => {
  it('is monotonic in level and eventually covers every chord quality', () => {
    let prev: readonly ChordQuality[] = []
    for (let level = 1; level <= 8; level++) {
      const set = chordQualitiesForLevel(level)
      for (const q of prev) expect(set).toContain(q)
      prev = set
    }
    expect(new Set(prev)).toEqual(new Set(CHORD_QUALITIES))
  })

  it('draws only triads before sevenths appear', () => {
    for (const quality of chordQualitiesForLevel(1)) expect(isTriad(quality)).toBe(true)
    for (const quality of chordQualitiesForLevel(2)) expect(isTriad(quality)).toBe(true)
  })

  it('clamps a level below 1 to level 1', () => {
    expect(chordQualitiesForLevel(0)).toEqual(chordQualitiesForLevel(1))
    expect(chordQualitiesForLevel(-5)).toEqual(chordQualitiesForLevel(1))
  })
})

describe('scaleTypesForLevel', () => {
  it('is monotonic in level and stabilises once every tier has been drawn', () => {
    let prev: readonly ScaleType[] = []
    for (let level = 1; level <= 8; level++) {
      const set = scaleTypesForLevel(level)
      for (const t of prev) expect(set).toContain(t)
      prev = set
    }
    expect(scaleTypesForLevel(8)).toEqual(scaleTypesForLevel(5))
  })

  it('starts with exactly major and natural minor', () => {
    expect(new Set(scaleTypesForLevel(1))).toEqual(new Set(['major', 'naturalMinor']))
  })
})

// ---------------------------------------------------------------------------
// chord-quality generation
// ---------------------------------------------------------------------------

describe('generateChordQualityItem', () => {
  it('property: the prompt is exactly the chord quality\'s pitch classes, on any level/seed/voicing', () => {
    fc.assert(
      fc.property(levelArb, seedArb, fc.boolean(), (level, seed, arpeggiated) => {
        const item = generateChordQualityItem(level, { arpeggiated }, seededRng(seed))
        const observed = pitchClassSet(item.prompt.notes.map((n) => n.midi))
        const template = CHORD_INTERVALS[item.answerKey as ChordQuality]
        expect(matchesSomeTransposition(template, observed)).toBe(true)
      }),
    )
  })

  it('property: every generated item grades itself correct', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const item = generateChordQualityItem(level, {}, seededRng(seed))
        const grade = gradeChordQualityAnswer(item, item.answerKey as ChordQuality)
        expect(grade).toEqual({ correct: true, expected: item.answerKey, given: item.answerKey })
      }),
    )
  })

  it('property: any other quality grades wrong, reporting both sides', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const item = generateChordQualityItem(level, {}, seededRng(seed))
        const other = at(
          CHORD_QUALITIES.filter((q) => q !== item.answerKey),
          0,
        )
        const grade = gradeChordQualityAnswer(item, other)
        expect(grade).toEqual({ correct: false, expected: item.answerKey, given: other })
      }),
    )
  })

  /**
   * The root pitch class that reproduces `observed` as a rotation of
   * `template`, if that root is unique. Some qualities (augmented triad,
   * diminished7) are themselves rotationally symmetric and have more than one
   * valid root for a given set — those are skipped by the caller below.
   */
  function uniqueRootPc(template: readonly number[], observed: ReadonlySet<number>): number | null {
    const matches: number[] = []
    for (let r = 0; r < 12; r++) {
      const shifted = new Set(template.map((iv) => (iv + r) % 12))
      if (setEquals(shifted, observed)) matches.push(r)
    }
    return matches.length === 1 ? at(matches, 0) : null
  }

  it('property: an inverted chord still grades correct on its quality, never its root, and inversions actually occur', () => {
    let sawNonRootBass = false
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const item = generateChordQualityItem(level, { allowInversions: true }, seededRng(seed))
        expect(gradeChordQualityAnswer(item, item.answerKey as ChordQuality).correct).toBe(true)

        const sorted = [...item.prompt.notes].sort((a, b) => a.midi - b.midi)
        const bassPc = at(sorted, 0).midi % 12
        const observed = pitchClassSet(item.prompt.notes.map((n) => n.midi))
        const template = CHORD_INTERVALS[item.answerKey as ChordQuality]
        const rootPc = uniqueRootPc(template, observed)
        if (rootPc !== null && rootPc !== bassPc) sawNonRootBass = true
      }),
    )
    expect(sawNonRootBass).toBe(true)
  })

  it('is deterministic: same level, opts and seed reproduce the identical item', () => {
    const a = generateChordQualityItem(3, { arpeggiated: true }, seededRng(42))
    const b = generateChordQualityItem(3, { arpeggiated: true }, seededRng(42))
    expect(a).toEqual(b)
  })

  it('two roots of the same quality share an answerKey but differ in id', () => {
    // First rng.next() picks the quality (level 1 = ['major', 'minor'], so 0 -> 'major');
    // the second picks the root out of the candidates in range. Only the root draw differs.
    const a = generateChordQualityItem(1, {}, scriptedRng([0, 0]))
    const b = generateChordQualityItem(1, {}, scriptedRng([0, 0.9]))
    expect(a.answerKey).toBe('major')
    expect(b.answerKey).toBe('major')
    expect(a.id).not.toBe(b.id)
  })

  it('forces root position when allowInversions is false, even above level 3', () => {
    fc.assert(
      fc.property(seedArb, fc.boolean(), (seed, arpeggiated) => {
        const item = generateChordQualityItem(5, { allowInversions: false, arpeggiated }, seededRng(seed))
        // Root position: the bass note IS the written root, so the observed
        // pitch-class set is exactly the template transposed by the bass, not
        // merely *some* transposition of it (which root position also is, but
        // so is every other inversion — this must pin down the actual shift).
        const notes = [...item.prompt.notes].sort((a, b) => a.midi - b.midi)
        const bassPc = at(notes, 0).midi % 12
        const template = CHORD_INTERVALS[item.answerKey as ChordQuality]
        const expectedSet = new Set(template.map((iv) => (iv + bassPc) % 12))
        const observed = pitchClassSet(item.prompt.notes.map((n) => n.midi))
        expect(setEquals(observed, expectedSet)).toBe(true)
      }),
    )
  })

  it('property: block chords sound as one whole note; arpeggiated chords ascend in eighths with the top note held out', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const block = generateChordQualityItem(level, { arpeggiated: false }, seededRng(seed))
        for (const n of block.prompt.notes) {
          expect(n.startTick).toBe(0)
          expect(n.durationTicks).toBe(WHOLE)
        }

        const arp = generateChordQualityItem(level, { arpeggiated: true }, seededRng(seed))
        const sorted = [...arp.prompt.notes].sort((a, b) => a.startTick - b.startTick)
        for (let i = 0; i < sorted.length - 1; i++) {
          expect(at(sorted, i).startTick).toBe(i * 240)
          expect(at(sorted, i).durationTicks).toBe(240)
        }
        // strictly ascending pitch, tone by tone
        for (let i = 0; i < sorted.length - 1; i++) {
          expect(at(sorted, i + 1).midi).toBeGreaterThan(at(sorted, i).midi)
        }
        const last = at(sorted, sorted.length - 1)
        expect(last.startTick + last.durationTicks).toBe(WHOLE)
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// scale/mode generation
// ---------------------------------------------------------------------------

describe('generateScaleModeItem', () => {
  it('property: the prompt is exactly the scale type\'s pitch classes, on any level/seed', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const item = generateScaleModeItem(level, {}, seededRng(seed))
        const observed = pitchClassSet(item.prompt.notes.map((n) => n.midi))
        const template = SCALE_INTERVALS[item.answerKey as ScaleType]
        expect(matchesSomeTransposition(template, observed)).toBe(true)
      }),
    )
  })

  it('property: every generated item grades itself correct', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const item = generateScaleModeItem(level, {}, seededRng(seed))
        const grade = gradeScaleModeAnswer(item, item.answerKey as ScaleType)
        expect(grade).toEqual({ correct: true, expected: item.answerKey, given: item.answerKey })
      }),
    )
  })

  it('property: any other scale type grades wrong, reporting both sides', () => {
    fc.assert(
      fc.property(levelArb, seedArb, (level, seed) => {
        const item = generateScaleModeItem(level, {}, seededRng(seed))
        const other = at(
          SCALE_TYPES.filter((t) => t !== item.answerKey),
          0,
        )
        const grade = gradeScaleModeAnswer(item, other)
        expect(grade).toEqual({ correct: false, expected: item.answerKey, given: other })
      }),
    )
  })

  it('renders one octave ascending, tonic to tonic, in eighth notes filling one 4/4 bar', () => {
    const item = generateScaleModeItem(1, {}, seededRng(7))
    expect(item.prompt.notes).toHaveLength(8)
    const sorted = [...item.prompt.notes].sort((a, b) => a.startTick - b.startTick)
    expect(at(sorted, 0).midi % 12).toBe(at(sorted, 7).midi % 12)
    for (let i = 0; i < sorted.length; i++) {
      expect(at(sorted, i).startTick).toBe(i * 240)
      expect(at(sorted, i).durationTicks).toBe(240)
    }
  })

  it('is deterministic: same level, opts and seed reproduce the identical item', () => {
    const a = generateScaleModeItem(4, {}, seededRng(99))
    const b = generateScaleModeItem(4, {}, seededRng(99))
    expect(a).toEqual(b)
  })

  it('two tonics of the same type share an answerKey but differ in id', () => {
    const a = generateScaleModeItem(1, {}, scriptedRng([0, 0]))
    const b = generateScaleModeItem(1, {}, scriptedRng([0, 0.9]))
    expect(a.answerKey).toBe('major')
    expect(b.answerKey).toBe('major')
    expect(a.id).not.toBe(b.id)
  })
})
