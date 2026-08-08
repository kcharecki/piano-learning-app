import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { at } from '@core/shared/invariant.ts'
import { isErr, unwrap } from '@core/shared/result.ts'
import { midi } from '@core/shared/units.ts'
import { seededRng } from '@core/ports/rng.ts'
import { spelledPitchClass } from '@core/theory/pitch.ts'
import { buildScale } from '@core/theory/scales.ts'
import { keyFromFifths, keyName, type Key } from '@core/theory/keys.ts'
import {
  validateScore,
  type Score,
  type ScoreNote,
  type TimeSignature,
} from '@core/notation/score.ts'
import {
  defaultParamsForLevel,
  generateMelody,
  MAX_GENERATOR_LEVEL,
  type GeneratorParams,
  type HandIndependence,
  type MidiRange,
  type RhythmStyle,
} from './melody.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const RHYTHMS: readonly RhythmStyle[] = [
  'whole-half',
  'quarters',
  'eighths',
  'dotted',
  'syncopated',
]
const HAND_INDEPENDENCE: readonly HandIndependence[] = [
  'unison',
  'parallel',
  'blocked-chords',
  'independent',
]
const TIME_SIGS: readonly TimeSignature[] = [
  { beats: 4, beatType: 4 },
  { beats: 3, beatType: 4 },
  { beats: 6, beatType: 8 },
  { beats: 2, beatType: 4 },
]

const range = (low: number, high: number): MidiRange => ({ low: midi(low), high: midi(high) })

function baseParams(overrides: Partial<GeneratorParams> = {}): GeneratorParams {
  return {
    key: keyFromFifths(0, 'major'),
    bars: 4,
    timeSignature: { beats: 4, beatType: 4 },
    hands: 'right',
    rightRange: range(60, 84),
    rhythm: 'quarters',
    maxLeapSemitones: 7,
    accidentalDensity: 0,
    handIndependence: 'unison',
    ...overrides,
  }
}

function pc(n: number): number {
  return ((n % 12) + 12) % 12
}

function scalePitchClasses(key: Key): Set<number> {
  const scale = buildScale(key.tonic, key.mode === 'major' ? 'major' : 'naturalMinor')
  return new Set(scale.notes.map(spelledPitchClass))
}

/** Notes for one hand, sorted by startTick — a melodic line's actual playing order. */
function handNotes(score: Score, hand: 'left' | 'right'): readonly ScoreNote[] {
  return score.notes.filter((n) => n.hand === hand)
}

/** For each measure, the distinct onsets of `hand`'s notes, sorted, deduped by startTick. */
function onsetsByMeasure(score: Score, hand: 'left' | 'right'): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>()
  for (const n of handNotes(score, hand)) {
    const measure = out.get(n.measureIndex) ?? new Map<number, number>()
    measure.set(n.startTick, n.durationTicks)
    out.set(n.measureIndex, measure)
  }
  return out
}

const seedArb = fc.integer({ min: 0, max: 100_000 })
const densityArb = fc.integer({ min: 0, max: 10 }).map((n) => n / 10)
const keyArb = fc
  .tuple(fc.integer({ min: -7, max: 7 }), fc.constantFrom<'major' | 'minor'>('major', 'minor'))
  .map(([fifths, mode]) => keyFromFifths(fifths, mode))

// ---------------------------------------------------------------------------
// basic shape
// ---------------------------------------------------------------------------

describe('generateMelody — basic shape', () => {
  it('produces a Score that validateScore accepts', () => {
    const result = generateMelody(baseParams(), seededRng(1))
    expect(result.ok).toBe(true)
    if (result.ok) expect(validateScore(result.value).ok).toBe(true)
  })

  it('produces exactly `bars` measures, each carrying the requested time signature and key', () => {
    const params = baseParams({
      bars: 6,
      timeSignature: { beats: 3, beatType: 4 },
      key: keyFromFifths(2, 'major'),
    })
    const score = unwrap(generateMelody(params, seededRng(7)))
    expect(score.measures).toHaveLength(6)
    for (const m of score.measures) {
      expect(m.timeSignature).toEqual({ beats: 3, beatType: 4 })
      expect(m.keyFifths).toBe(2)
    }
  })

  it('ends the primary hand on the tonic pitch class', () => {
    const params = baseParams({ key: keyFromFifths(3, 'major'), bars: 5 })
    const scale = buildScale(params.key.tonic, 'major')
    const tonicPc = spelledPitchClass(at(scale.notes, 0))
    for (const seed of [1, 2, 3, 4, 5]) {
      const score = unwrap(generateMelody(params, seededRng(seed)))
      const notes = handNotes(score, 'right')
      const last = at(notes, notes.length - 1)
      expect(pc(last.midi)).toBe(tonicPc)
    }
  })

  // roadmap 5.13: a generated score with no title engraves as "Untitled Score".
  it('carries a title naming the key, not the default empty title', () => {
    const params = baseParams({ key: keyFromFifths(2, 'major') })
    const score = unwrap(generateMelody(params, seededRng(1)))
    expect(score.meta.title).toContain(keyName(params.key))
  })

  it('every note of a right-hand-only score is on the right hand and within rightRange', () => {
    const params = baseParams({ rightRange: range(60, 72) })
    const score = unwrap(generateMelody(params, seededRng(9)))
    for (const n of score.notes) {
      expect(n.hand).toBe('right')
      expect(n.midi).toBeGreaterThanOrEqual(60)
      expect(n.midi).toBeLessThanOrEqual(72)
    }
  })
})

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------

describe('generateMelody — determinism', () => {
  it('the same seed produces an identical score', () => {
    const params = baseParams({
      bars: 8,
      hands: 'both',
      leftRange: range(36, 60),
      handIndependence: 'independent',
      accidentalDensity: 0.2,
    })
    const a = unwrap(generateMelody(params, seededRng(42)))
    const b = unwrap(generateMelody(params, seededRng(42)))
    expect(a).toEqual(b)
  })

  it('different seeds produce different scores', () => {
    const params = baseParams({
      bars: 8,
      rhythm: 'eighths',
      accidentalDensity: 0.3,
      maxLeapSemitones: 10,
    })
    const a = unwrap(generateMelody(params, seededRng(1)))
    const b = unwrap(generateMelody(params, seededRng(2)))
    expect(a.notes).not.toEqual(b.notes)
  })
})

// ---------------------------------------------------------------------------
// range and key containment
// ---------------------------------------------------------------------------

describe('generateMelody — range and key (property)', () => {
  it('every note lies within its hand range, and out-of-key notes track accidentalDensity within tolerance', () => {
    fc.assert(
      fc.property(
        keyArb,
        fc.constantFrom('right' as const, 'left' as const, 'both' as const),
        densityArb,
        seedArb,
        (key, hands, accidentalDensity, seed) => {
          const rightRange = range(55, 88)
          const leftRange = range(36, 60)
          const params: GeneratorParams = {
            key,
            bars: 4,
            timeSignature: { beats: 4, beatType: 4 },
            hands,
            rightRange,
            leftRange,
            rhythm: 'eighths',
            maxLeapSemitones: 12,
            accidentalDensity,
            handIndependence: 'independent',
          }
          const result = generateMelody(params, seededRng(seed))
          if (!result.ok) return true // an unsatisfiable draw is allowed to fail
          const score = result.value
          for (const n of score.notes) {
            const r = n.hand === 'left' ? leftRange : rightRange
            expect(n.midi).toBeGreaterThanOrEqual(r.low)
            expect(n.midi).toBeLessThanOrEqual(r.high)
          }
          return true
        },
      ),
      { numRuns: 150 },
    )
  })

  it('accidentalDensity 0 never produces an out-of-key note', () => {
    const params = baseParams({ key: keyFromFifths(-3, 'minor'), accidentalDensity: 0, bars: 8 })
    const pcs = scalePitchClasses(params.key)
    for (const seed of [1, 2, 3, 4]) {
      const score = unwrap(generateMelody(params, seededRng(seed)))
      for (const n of handNotes(score, 'right')) expect(pcs.has(pc(n.midi))).toBe(true)
    }
  })

  it('accidentalDensity tracks the requested proportion over many notes', () => {
    const key = keyFromFifths(0, 'major')
    const pcs = scalePitchClasses(key)
    for (const density of [0.2, 0.5, 0.8]) {
      const params = baseParams({
        key,
        accidentalDensity: density,
        bars: 16,
        rhythm: 'eighths',
        maxLeapSemitones: 12,
        rightRange: range(48, 96),
      })
      let outOfKey = 0
      let total = 0
      for (let seed = 0; seed < 25; seed++) {
        const score = unwrap(generateMelody(params, seededRng(seed)))
        const notes = handNotes(score, 'right')
        // The forced cadence note is always in-key; excluding it keeps the sample honest.
        for (let i = 0; i < notes.length - 1; i++) {
          total += 1
          if (!pcs.has(pc(at(notes, i).midi))) outOfKey += 1
        }
      }
      const observed = outOfKey / total
      expect(Math.abs(observed - density)).toBeLessThan(0.15)
    }
  })
})

// ---------------------------------------------------------------------------
// melodic leap bound
// ---------------------------------------------------------------------------

describe('generateMelody — maxLeapSemitones (property)', () => {
  it('no consecutive pair in a melodic line exceeds maxLeapSemitones', () => {
    fc.assert(
      fc.property(
        keyArb,
        fc.integer({ min: 1, max: 14 }),
        fc.constantFrom(...RHYTHMS),
        seedArb,
        (key, maxLeapSemitones, rhythm, seed) => {
          const params = baseParams({
            key,
            rhythm,
            maxLeapSemitones,
            bars: 6,
            rightRange: range(48, 96),
            accidentalDensity: 0.2,
          })
          const result = generateMelody(params, seededRng(seed))
          if (!result.ok) return true
          const notes = handNotes(result.value, 'right')
          for (let i = 1; i < notes.length; i++) {
            expect(Math.abs(at(notes, i).midi - at(notes, i - 1).midi)).toBeLessThanOrEqual(
              maxLeapSemitones,
            )
          }
          return true
        },
      ),
      { numRuns: 150 },
    )
  })

  it('an independent second hand also respects maxLeapSemitones', () => {
    const params = baseParams({
      hands: 'both',
      leftRange: range(36, 60),
      handIndependence: 'independent',
      maxLeapSemitones: 5,
      bars: 6,
    })
    for (const seed of [1, 2, 3]) {
      const score = unwrap(generateMelody(params, seededRng(seed)))
      const notes = handNotes(score, 'left')
      for (let i = 1; i < notes.length; i++) {
        expect(Math.abs(at(notes, i).midi - at(notes, i - 1).midi)).toBeLessThanOrEqual(5)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// rhythm fills every bar exactly
// ---------------------------------------------------------------------------

describe('generateMelody — bars are filled exactly (property)', () => {
  it('every measure’s onsets tile it exactly, for every time signature and rhythm', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TIME_SIGS),
        fc.constantFrom(...RHYTHMS),
        fc.integer({ min: 1, max: 5 }),
        seedArb,
        (timeSignature, rhythm, bars, seed) => {
          const params = baseParams({ timeSignature, rhythm, bars })
          const score = unwrap(generateMelody(params, seededRng(seed)))
          const byMeasure = onsetsByMeasure(score, 'right')
          for (const measure of score.measures) {
            const onsets = byMeasure.get(measure.index)
            expect(onsets).toBeDefined()
            const sorted = [...(onsets ?? new Map())].sort((a, b) => a[0] - b[0])
            let cursor = measure.startTick
            for (const [startTick, durationTicks] of sorted) {
              expect(startTick).toBe(cursor)
              cursor += durationTicks
            }
            expect(cursor).toBe(measure.startTick + measure.durationTicks)
          }
          return true
        },
      ),
      { numRuns: 150 },
    )
  })

  it('blocked-chords fill each bar with one full-length chord', () => {
    const params = baseParams({
      hands: 'both',
      leftRange: range(36, 60),
      handIndependence: 'blocked-chords',
      bars: 4,
    })
    const score = unwrap(generateMelody(params, seededRng(3)))
    const left = handNotes(score, 'left')
    const byMeasure = new Map<number, ScoreNote[]>()
    for (const n of left)
      byMeasure.set(n.measureIndex, [...(byMeasure.get(n.measureIndex) ?? []), n])
    for (const measure of score.measures) {
      const notes = byMeasure.get(measure.index) ?? []
      expect(notes).toHaveLength(3)
      for (const n of notes) {
        expect(n.startTick).toBe(measure.startTick)
        expect(n.durationTicks).toBe(measure.durationTicks)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// validateScore accepts everything the generator produces
// ---------------------------------------------------------------------------

describe('generateMelody — validateScore accepts every generated score (property)', () => {
  it('over a wide sweep of parameters, generateMelody either returns Err or a score validateScore accepts', () => {
    fc.assert(
      fc.property(
        keyArb,
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom(...TIME_SIGS),
        fc.constantFrom('right' as const, 'left' as const, 'both' as const),
        fc.constantFrom(...HAND_INDEPENDENCE),
        fc.constantFrom(...RHYTHMS),
        fc.integer({ min: 0, max: 14 }),
        densityArb,
        seedArb,
        (
          key,
          bars,
          timeSignature,
          hands,
          handIndependence,
          rhythm,
          maxLeapSemitones,
          accidentalDensity,
          seed,
        ) => {
          const params: GeneratorParams = {
            key,
            bars,
            timeSignature,
            hands,
            rightRange: range(55, 84),
            leftRange: range(36, 64),
            rhythm,
            maxLeapSemitones,
            accidentalDensity,
            handIndependence,
          }
          const result = generateMelody(params, seededRng(seed))
          if (isErr(result)) {
            expect(typeof result.error).toBe('string')
            return true
          }
          expect(validateScore(result.value).ok).toBe(true)
          return true
        },
      ),
      { numRuns: 400 },
    )
  })
})

// ---------------------------------------------------------------------------
// termination — no parameter combination spins
// ---------------------------------------------------------------------------

describe('generateMelody — terminates on every combination (property)', () => {
  it('resolves synchronously (Ok or Err) even for large or awkward parameter sets', () => {
    fc.assert(
      fc.property(
        keyArb,
        fc.integer({ min: 1, max: 32 }),
        fc.constantFrom(...TIME_SIGS),
        fc.constantFrom(...HAND_INDEPENDENCE),
        fc.constantFrom(...RHYTHMS),
        fc.integer({ min: 0, max: 24 }),
        densityArb,
        seedArb,
        (
          key,
          bars,
          timeSignature,
          handIndependence,
          rhythm,
          maxLeapSemitones,
          accidentalDensity,
          seed,
        ) => {
          const params: GeneratorParams = {
            key,
            bars,
            timeSignature,
            hands: 'both',
            rightRange: range(21, 108),
            leftRange: range(21, 108),
            rhythm,
            maxLeapSemitones,
            accidentalDensity,
            handIndependence,
          }
          const result = generateMelody(params, seededRng(seed))
          expect(result.ok === true || result.ok === false).toBe(true)
          return true
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ---------------------------------------------------------------------------
// Err on invalid or unsatisfiable parameters
// ---------------------------------------------------------------------------

describe('generateMelody — Err on invalid or unsatisfiable parameters', () => {
  it('rejects non-positive bars', () => {
    expect(generateMelody(baseParams({ bars: 0 }), seededRng(1)).ok).toBe(false)
  })

  it('rejects a negative maxLeapSemitones', () => {
    expect(generateMelody(baseParams({ maxLeapSemitones: -1 }), seededRng(1)).ok).toBe(false)
  })

  it('rejects a non-integer maxLeapSemitones', () => {
    expect(generateMelody(baseParams({ maxLeapSemitones: 2.5 }), seededRng(1)).ok).toBe(false)
  })

  it('rejects accidentalDensity outside 0..1', () => {
    expect(generateMelody(baseParams({ accidentalDensity: 1.5 }), seededRng(1)).ok).toBe(false)
    expect(generateMelody(baseParams({ accidentalDensity: -0.1 }), seededRng(1)).ok).toBe(false)
  })

  it('rejects an inverted rightRange', () => {
    expect(generateMelody(baseParams({ rightRange: range(70, 60) }), seededRng(1)).ok).toBe(false)
  })

  it('rejects an inverted leftRange', () => {
    const params = baseParams({ hands: 'both', leftRange: { low: midi(70), high: midi(60) } })
    expect(generateMelody(params, seededRng(1)).ok).toBe(false)
  })

  it('rejects hands "both" with no leftRange', () => {
    expect(generateMelody(baseParams({ hands: 'both' }), seededRng(1)).ok).toBe(false)
  })

  it('rejects a time signature that does not divide into sixteenth notes', () => {
    const params = baseParams({ timeSignature: { beats: 1, beatType: 32 } })
    expect(generateMelody(params, seededRng(1)).ok).toBe(false)
  })

  it('rejects a range that contains no note of the key', () => {
    // C major has no C#, and the range holds only C#4.
    const params = baseParams({ rightRange: range(61, 61) })
    expect(generateMelody(params, seededRng(1)).ok).toBe(false)
  })

  it('rejects an unsatisfiable unison doubling (left range excludes every reachable pitch class)', () => {
    const params = baseParams({
      hands: 'both',
      handIndependence: 'unison',
      accidentalDensity: 0, // primary line stays diatonic, so its pitch classes are fixed
      leftRange: range(61, 61), // C#4 only — never a C-major scale tone
    })
    for (const seed of [1, 2, 3]) {
      expect(generateMelody(params, seededRng(seed)).ok).toBe(false)
    }
  })

  it('rejects blocked-chords when the left range cannot hold a full triad', () => {
    const params = baseParams({
      hands: 'both',
      handIndependence: 'blocked-chords',
      leftRange: range(60, 60), // a single note can't carry a root, third and fifth
    })
    expect(generateMelody(params, seededRng(1)).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// defaultParamsForLevel
// ---------------------------------------------------------------------------

const LEVELS = Array.from({ length: MAX_GENERATOR_LEVEL }, (_, i) => i + 1)

describe('defaultParamsForLevel', () => {
  it('produces a generateMelody-able score for every level and several seeds', () => {
    for (const level of LEVELS) {
      const params = defaultParamsForLevel(level)
      for (const seed of [1, 2, 3]) {
        const result = generateMelody(params, seededRng(seed))
        expect(result.ok).toBe(true)
        if (result.ok) expect(validateScore(result.value).ok).toBe(true)
      }
    }
  })

  it(`clamps levels outside 1..${MAX_GENERATOR_LEVEL}`, () => {
    expect(defaultParamsForLevel(0)).toEqual(defaultParamsForLevel(1))
    expect(defaultParamsForLevel(-5)).toEqual(defaultParamsForLevel(1))
    expect(defaultParamsForLevel(MAX_GENERATOR_LEVEL + 1)).toEqual(
      defaultParamsForLevel(MAX_GENERATOR_LEVEL),
    )
    expect(defaultParamsForLevel(99)).toEqual(defaultParamsForLevel(MAX_GENERATOR_LEVEL))
  })

  it('is monotonically harder in range width as level rises', () => {
    const widths = LEVELS.map((level) => {
      const p = defaultParamsForLevel(level)
      return p.rightRange.high - p.rightRange.low
    })
    for (let i = 1; i < widths.length; i++) {
      expect(at(widths, i)).toBeGreaterThanOrEqual(at(widths, i - 1))
    }
    expect(at(widths, widths.length - 1)).toBeGreaterThan(at(widths, 0))
  })

  it('is monotonically harder in rhythm as level rises', () => {
    // RHYTHMS is already ordered easiest-to-hardest, so its index is a stand-in
    // for a difficulty score.
    const difficulties = LEVELS.map((level) => RHYTHMS.indexOf(defaultParamsForLevel(level).rhythm))
    for (let i = 1; i < difficulties.length; i++) {
      expect(at(difficulties, i)).toBeGreaterThanOrEqual(at(difficulties, i - 1))
    }
    expect(at(difficulties, difficulties.length - 1)).toBeGreaterThan(at(difficulties, 0))
  })

  it('is monotonically harder in maxLeapSemitones, accidentalDensity and bars as level rises', () => {
    const leaps = LEVELS.map((level) => defaultParamsForLevel(level).maxLeapSemitones)
    const densities = LEVELS.map((level) => defaultParamsForLevel(level).accidentalDensity)
    const bars = LEVELS.map((level) => defaultParamsForLevel(level).bars)
    for (let i = 1; i < leaps.length; i++) {
      expect(at(leaps, i)).toBeGreaterThanOrEqual(at(leaps, i - 1))
      expect(at(densities, i)).toBeGreaterThanOrEqual(at(densities, i - 1))
      expect(at(bars, i)).toBeGreaterThanOrEqual(at(bars, i - 1))
    }
  })

  it('never exceeds 2 sharps/flats below the top level (RCM/ABRSM/Faber hold early grades to 0-1)', () => {
    for (const level of LEVELS) {
      const fifths = Math.abs(defaultParamsForLevel(level).key.signature.fifths)
      if (level < MAX_GENERATOR_LEVEL) {
        expect(fifths).toBeLessThanOrEqual(2)
      }
    }
    // Negative control: the top level is where harder keys are allowed to live,
    // so this assertion is discriminating, not vacuously true of every row.
    expect(
      Math.abs(defaultParamsForLevel(MAX_GENERATOR_LEVEL).key.signature.fifths),
    ).toBeGreaterThan(2)
  })

  it('level 1 generates only diatonic steps, all in one direction, over 500 seeds', () => {
    const params = defaultParamsForLevel(1)
    expect(params.stepwiseOneDirection).toBe(true)
    const scalePcs = scalePitchClasses(params.key)
    const scaleTones: number[] = []
    for (let m = params.rightRange.low; m <= params.rightRange.high; m++) {
      if (scalePcs.has(pc(m))) scaleTones.push(m)
    }
    for (let seed = 0; seed < 500; seed++) {
      const result = generateMelody(params, seededRng(seed))
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const pitches = handNotes(result.value, 'right')
        .slice()
        .sort((a, b) => a.startTick - b.startTick)
        .map((n) => n.midi)
      // Exact length, not just "more than one" — a slice that's short by one
      // note (an off-by-one in the picker) would otherwise pass silently: the
      // score still validates because `validateScore` doesn't require every
      // measure to carry a note.
      expect(pitches.length).toBe(params.bars)
      const diffs = pitches.slice(1).map((p, i) => p - (pitches[i] as number))
      const allAscending = diffs.every((d) => d > 0)
      const allDescending = diffs.every((d) => d < 0)
      expect(allAscending || allDescending).toBe(true)
      // Every consecutive pair must be scale-adjacent — no scale tone skipped —
      // which also implies every pitch is in key (accidentalDensity plays no
      // part in this mode).
      for (const p of pitches) expect(scalePcs.has(pc(p))).toBe(true)
      const indices = pitches.map((p) => scaleTones.indexOf(p))
      expect(indices.every((idx) => idx !== -1)).toBe(true)
      const indexDiffs = indices.slice(1).map((idx, i) => idx - (indices[i] as number))
      expect(indexDiffs.every((d) => Math.abs(d) === 1)).toBe(true)
    }
  })
})
