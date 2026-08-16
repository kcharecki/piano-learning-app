import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { at } from '@core/shared/invariant.ts'
import { seededRng } from '@core/ports/rng.ts'
import { buildBarDurations, GRID, RHYTHM_POOLS, type RhythmStyle } from './rhythmPools.ts'

const STYLES: readonly RhythmStyle[] = [
  'whole-half',
  'quarter-half',
  'quarters',
  'eighths',
  'dotted',
  'syncopated',
]

/** The units named in `style`'s pool (index 0, 2, 4, … of the flat pairs). */
function unitsOf(style: RhythmStyle): readonly number[] {
  const pool = RHYTHM_POOLS[style]
  const out: number[] = []
  for (let i = 0; i < pool.length; i += 2) out.push(at(pool, i))
  return out
}

// Every real bar length this generator ever builds (`levelDefaults.test.ts`'s
// own `BAR_UNITS`: 4/4 -> 16, 3/4 -> 12, 6/8 -> 12), all multiples of 4.
const REAL_BAR_UNITS: readonly number[] = [16, 12, 8]

describe('buildBarDurations', () => {
  it('always sums to exactly barUnits, for every style and a range of bar lengths', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STYLES),
        fc.constantFrom(...REAL_BAR_UNITS),
        fc.integer({ min: 0, max: 10_000 }),
        (style, barUnits, seed) => {
          const durations = buildBarDurations(barUnits, style, seededRng(seed))
          const sum = durations.reduce((a, b) => a + b, 0)
          expect(sum).toBe(barUnits)
          expect(durations.length).toBeGreaterThan(0)
          for (const units of durations) expect(unitsOf(style)).toContain(units)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('rejects a remainder none of the pool fits (mutant check: an odd barUnits against quarter-half)', () => {
    // quarter-half's own units {4, 8} can never fit a remainder of 1 — the
    // exact case the module doc says buildBarDurations should fail loudly on
    // rather than silently drawing a shorter note this style excludes.
    expect(() => buildBarDurations(1, 'quarter-half', seededRng(1))).toThrow(
      /nothing in the 'quarter-half' pool fits a remainder of 1/,
    )
  })
})

// ---------------------------------------------------------------------------
// quarter-half (roadmap 5.54) — level 1's own default style
// ---------------------------------------------------------------------------

describe("RHYTHM_POOLS['quarter-half'] (roadmap 5.54)", () => {
  it('names exactly quarter (4 units) and half (8 units) — no whole note, no filler shorter than a quarter', () => {
    expect(unitsOf('quarter-half').slice().sort((a, b) => a - b)).toEqual([4, 8])
  })

  it('over every real bar length, only ever draws quarter- or half-note units, and draws both over many seeds', () => {
    for (const barUnits of REAL_BAR_UNITS) {
      const seen = new Set<number>()
      for (let seed = 0; seed < 200; seed++) {
        for (const units of buildBarDurations(barUnits, 'quarter-half', seededRng(seed))) {
          expect([4, 8]).toContain(units)
          seen.add(units)
        }
      }
      expect(seen.has(4)).toBe(true)
      expect(seen.has(8)).toBe(true)
    }
  })

  it('tiles every real bar length exactly, never leaving a remainder', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REAL_BAR_UNITS),
        fc.integer({ min: 0, max: 10_000 }),
        (barUnits, seed) => {
          const durations = buildBarDurations(barUnits, 'quarter-half', seededRng(seed))
          expect(durations.reduce((a, b) => a + b, 0)).toBe(barUnits)
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('GRID', () => {
  it('is a quarter of TICKS_PER_QUARTER (sixteenth-note units)', () => {
    expect(GRID).toBe(120)
  })
})
