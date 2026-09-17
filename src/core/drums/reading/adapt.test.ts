/**
 * `adaptReadingLevel` examples plus the two properties the contract promises:
 * it never moves more than one level per call, and raising every accuracy in
 * the window never produces a lower result (monotone in accuracy) — both are
 * the kind of thing an example-only suite can miss on an unlucky boundary.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  adaptReadingLevel,
  READING_ADAPT_BAND,
  READING_ADAPT_WINDOW,
  type ReadingRunRecord,
} from './adapt.ts'
import { MAX_READING_LEVEL, MIN_READING_LEVEL, type ReadingLevel } from './levels.ts'

const levelArb = fc.integer({ min: MIN_READING_LEVEL, max: MAX_READING_LEVEL }) as fc.Arbitrary<ReadingLevel>
const accuracyArb = fc.float({ min: 0, max: 1, noNaN: true })

function runsAt(level: ReadingLevel, accuracies: readonly number[]): ReadingRunRecord[] {
  return accuracies.map((accuracy) => ({ level, accuracy }))
}

describe('adaptReadingLevel', () => {
  it('advances one level when the window all clears the high band', () => {
    const runs = runsAt(3, [0.95, 0.92, 0.99])
    expect(adaptReadingLevel(3, runs)).toBe(4)
  })

  it('drops one level when the window all falls below the low band', () => {
    const runs = runsAt(3, [0.5, 0.4, 0.55])
    expect(adaptReadingLevel(3, runs)).toBe(2)
  })

  it('stays put when the window is mixed', () => {
    const runs = runsAt(3, [0.95, 0.5, 0.95])
    expect(adaptReadingLevel(3, runs)).toBe(3)
  })

  it('stays put with fewer than WINDOW runs at the current level', () => {
    const runs = runsAt(3, [0.95, 0.95])
    expect(adaptReadingLevel(3, runs)).toBe(3)
  })

  it('ignores runs at a different level', () => {
    const runs = [...runsAt(2, [0.99, 0.99, 0.99]), ...runsAt(3, [0.95, 0.92])]
    // Only two runs at the current level (3) — not enough to move.
    expect(adaptReadingLevel(3, runs)).toBe(3)
  })

  it('only counts the most recent WINDOW same-level runs', () => {
    // Older bad runs at level 3, but the most recent WINDOW all clear the high band.
    const runs = [...runsAt(3, [0.1, 0.1, 0.1]), ...runsAt(3, [0.95, 0.92, 0.99])]
    expect(adaptReadingLevel(3, runs)).toBe(4)
  })

  it('clamps at MAX_READING_LEVEL', () => {
    expect(adaptReadingLevel(MAX_READING_LEVEL, runsAt(MAX_READING_LEVEL, [0.95, 0.95, 0.95]))).toBe(
      MAX_READING_LEVEL,
    )
  })

  it('clamps at MIN_READING_LEVEL', () => {
    expect(adaptReadingLevel(MIN_READING_LEVEL, runsAt(MIN_READING_LEVEL, [0.1, 0.1, 0.1]))).toBe(
      MIN_READING_LEVEL,
    )
  })

  it('never moves more than one level (property)', () => {
    fc.assert(
      fc.property(
        levelArb,
        fc.array(fc.record({ level: levelArb, accuracy: accuracyArb }), { minLength: 0, maxLength: 10 }),
        (current, recent) => {
          const result = adaptReadingLevel(current, recent)
          expect(Math.abs(result - current)).toBeLessThanOrEqual(1)
        },
      ),
    )
  })

  it('is monotone in accuracy: raising every accuracy never lowers the result (property)', () => {
    fc.assert(
      fc.property(
        levelArb,
        fc.array(fc.record({ level: levelArb, accuracy: accuracyArb }), {
          minLength: READING_ADAPT_WINDOW,
          maxLength: 10,
        }),
        fc.float({ min: 0, max: Math.fround(0.3), noNaN: true }),
        (current, recent, bump) => {
          const boosted = recent.map((run) => ({
            ...run,
            accuracy: Math.min(1, run.accuracy + bump),
          }))
          const before = adaptReadingLevel(current, recent)
          const after = adaptReadingLevel(current, boosted)
          expect(after).toBeGreaterThanOrEqual(before)
        },
      ),
    )
  })

  it('READING_ADAPT_BAND is ordered low < high, both within 0..1', () => {
    const [low, high] = READING_ADAPT_BAND
    expect(low).toBeLessThan(high)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThanOrEqual(1)
  })
})
