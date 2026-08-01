import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { seededRng } from '@core/ports/rng.ts'
import {
  defaultParamsForLevel,
  generateMelody,
  type GeneratorParams,
} from '@core/generator/melody.ts'
import { isRetired, retire, type SightReadingRecord } from './session.ts'
import { adaptLevel, MAX_LEVEL, MIN_LEVEL, nextExerciseParams } from './adaptive.ts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const record = (accuracy: number): SightReadingRecord => ({
  pieceId: 'x',
  readAt: 0,
  accuracy,
  level: 1,
})

const runOf = (n: number, accuracy: number): SightReadingRecord[] =>
  Array.from({ length: n }, () => record(accuracy))

// ---------------------------------------------------------------------------
// adaptLevel
// ---------------------------------------------------------------------------

describe('adaptLevel', () => {
  it('holds the level when there are fewer than a full window of reads', () => {
    expect(adaptLevel(2, runOf(2, 0.99))).toBe(2)
    expect(adaptLevel(2, [])).toBe(2)
  })

  it('raises the level after a run of ~95% accuracy, the full window long', () => {
    expect(adaptLevel(2, runOf(3, 0.95))).toBe(3)
  })

  it('lowers the level after a run of ~60% accuracy, the full window long', () => {
    expect(adaptLevel(3, runOf(3, 0.6))).toBe(2)
  })

  it('holds the level when the run sits inside the target band', () => {
    expect(adaptLevel(3, runOf(3, 0.85))).toBe(3)
  })

  it('a run exactly on a band edge does not count as clearing it (band is exclusive)', () => {
    expect(adaptLevel(3, runOf(3, 0.9))).toBe(3)
    expect(adaptLevel(3, runOf(3, 0.8))).toBe(3)
  })

  it('never rises above MAX_LEVEL or falls below MIN_LEVEL', () => {
    expect(adaptLevel(MAX_LEVEL, runOf(3, 0.99))).toBe(MAX_LEVEL)
    expect(adaptLevel(MIN_LEVEL, runOf(3, 0.5))).toBe(MIN_LEVEL)
  })

  it('clamps an out-of-range current level even when it holds', () => {
    expect(adaptLevel(9, runOf(3, 0.85))).toBe(MAX_LEVEL)
    expect(adaptLevel(-3, runOf(3, 0.85))).toBe(MIN_LEVEL)
  })

  it('only the most recent `window` reads matter, not the whole history', () => {
    const history = [...runOf(5, 0.5), ...runOf(3, 0.95)]
    expect(adaptLevel(2, history)).toBe(3)
  })

  it('respects a custom window and band', () => {
    expect(adaptLevel(2, runOf(1, 0.99), { window: 1 })).toBe(3)
    expect(adaptLevel(2, runOf(2, 0.7), { window: 2, band: [0.6, 0.95] })).toBe(2)
    expect(adaptLevel(2, runOf(2, 0.5), { window: 2, band: [0.6, 0.95] })).toBe(1)
  })

  it('a single outlier inside an otherwise-high run does not oscillate the level (mixed sequence)', () => {
    // Fed one read at a time, as a real caller would: level rises once a full
    // window of highs has accumulated, holds steady through one bad read
    // (never drops — the window is never unanimously low), and only rises
    // again once a fresh window of highs has re-accumulated after the
    // outlier ages out of the window.
    const accuracies = [0.95, 0.95, 0.95, 0.6, 0.95, 0.95, 0.95]
    const expectedLevels = [2, 2, 3, 3, 3, 3, 4]
    let level = 2
    let history: SightReadingRecord[] = []
    const levels: number[] = []
    for (const accuracy of accuracies) {
      history = [...history, record(accuracy)]
      level = adaptLevel(level, history)
      levels.push(level)
    }
    expect(levels).toEqual(expectedLevels)
    // The level never drops during this run — a single outlier is not a run.
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1] as number)
    }
  })

  it('property: a run entirely above the band always rises by exactly one, whatever the starting level (short of the ceiling)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_LEVEL, max: MAX_LEVEL - 1 }),
        fc.double({ min: 0.901, max: 1, noNaN: true }),
        (level, accuracy) => {
          expect(adaptLevel(level, runOf(3, accuracy))).toBe(level + 1)
        },
      ),
    )
  })

  it('property: a run entirely below the band always falls by exactly one, whatever the starting level (short of the floor)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_LEVEL + 1, max: MAX_LEVEL }),
        fc.double({ min: 0, max: 0.799, noNaN: true }),
        (level, accuracy) => {
          expect(adaptLevel(level, runOf(3, accuracy))).toBe(level - 1)
        },
      ),
    )
  })
})

// ---------------------------------------------------------------------------
// nextExerciseParams
// ---------------------------------------------------------------------------

const CANONICAL_FIELDS = [
  'bars',
  'timeSignature',
  'hands',
  'rightRange',
  'leftRange',
  'rhythm',
  'maxLeapSemitones',
  'accidentalDensity',
  'handIndependence',
] as const

describe('nextExerciseParams', () => {
  it('with no retirement history, keeps the level canonical difficulty shape (rhythm/hands/ranges/etc unchanged)', () => {
    // Only `key` and `bars` are ever varied by the search (see the module
    // doc) — everything else that actually defines the difficulty tier must
    // come through untouched.
    for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
      const canonical = defaultParamsForLevel(level)
      const params = nextExerciseParams(level, seededRng(level), [])
      for (const field of CANONICAL_FIELDS) {
        expect(params[field as keyof GeneratorParams]).toEqual(
          canonical[field as keyof GeneratorParams],
        )
      }
    }
  })

  it('never returns params whose generated id is already retired, over many draws at every level', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: MIN_LEVEL, max: MAX_LEVEL }),
        (seed, level) => {
          const rng = seededRng(seed)
          let history: readonly SightReadingRecord[] = []
          const seen = new Set<string>()
          for (let i = 0; i < 20; i++) {
            const params = nextExerciseParams(level, rng, history)
            const generated = generateMelody(params, rng)
            expect(generated.ok).toBe(true)
            if (!generated.ok) continue
            const id = generated.value.id
            expect(isRetired(history, id)).toBe(false)
            expect(seen.has(id)).toBe(false)
            seen.add(id)
            history = retire(history, { pieceId: id, readAt: i, accuracy: 0.85, level })
          }
        },
      ),
      { numRuns: 25 },
    )
  })
})
