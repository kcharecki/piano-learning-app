import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ticks } from '@core/shared/units.ts'
import { subdivisionCellTick } from './grid.ts'
import { swungTick } from './swing.ts'

/** One 4/4 bar. */
const MEASURE_TICKS = 1920

describe('swungTick', () => {
  it('leaves a straight groove (50%) untouched', () => {
    expect(swungTick(ticks(0), 50, 'eighth', MEASURE_TICKS)).toBe(0)
    expect(swungTick(ticks(240), 50, 'eighth', MEASURE_TICKS)).toBe(240)
    expect(swungTick(ticks(720), 50, 'eighth', MEASURE_TICKS)).toBe(720)
  })

  it('leaves a downbeat (the first cell of a pair) unmoved at 67% eighth swing', () => {
    expect(swungTick(ticks(0), 67, 'eighth', MEASURE_TICKS)).toBe(0)
    expect(swungTick(ticks(480), 67, 'eighth', MEASURE_TICKS)).toBe(480)
  })

  /**
   * The second cell of each pair moves to `round(pairSpan * swingPercent /
   * 100)` past the pair start — 480 * 0.67 = 321.6, rounds to 322. This is
   * the same arithmetic `grid.test.ts` already proves for `subdivisionCellTick`
   * (its own worked example is 75%: pair (0,240) -> round(480*0.75)=360).
   */
  it('moves the second (off-beat) cell of each pair to round(pairSpan * swingPercent / 100), eighth', () => {
    expect(swungTick(ticks(240), 67, 'eighth', MEASURE_TICKS)).toBe(322)
    expect(swungTick(ticks(720), 67, 'eighth', MEASURE_TICKS)).toBe(802)
  })

  it('a tick that is not on the eighth grid at all (e.g. a sixteenth) is unchanged', () => {
    expect(swungTick(ticks(120), 67, 'eighth', MEASURE_TICKS)).toBe(120)
  })

  it('sixteenth swing: the pair-start ("&" at sixteenth level) is unmoved, the second cell moves', () => {
    expect(swungTick(ticks(240), 67, 'sixteenth', MEASURE_TICKS)).toBe(240)
    expect(swungTick(ticks(120), 67, 'sixteenth', MEASURE_TICKS)).toBe(161)
    expect(swungTick(ticks(360), 67, 'sixteenth', MEASURE_TICKS)).toBe(401)
  })

  it('pairs measure-locally: the same offset in the second measure swings the same amount', () => {
    expect(swungTick(ticks(MEASURE_TICKS + 240), 67, 'eighth', MEASURE_TICKS)).toBe(MEASURE_TICKS + 322)
    expect(swungTick(ticks(MEASURE_TICKS + 480), 67, 'eighth', MEASURE_TICKS)).toBe(MEASURE_TICKS + 480)
  })

  it('identity at 50%, for arbitrary ticks and units', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 * MEASURE_TICKS }),
        fc.constantFrom('eighth', 'sixteenth'),
        (tick, unit) => {
          expect(swungTick(ticks(tick), 50, unit, MEASURE_TICKS)).toBe(tick)
        },
      ),
    )
  })

  it('property: consecutive cells of a grid come out strictly increasing (order is preserved)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('eighth', 'sixteenth'),
        fc.integer({ min: 50, max: 75 }),
        fc.integer({ min: 2, max: 32 }),
        (unit, swingPercent, count) => {
          const cell = unit === 'eighth' ? 240 : 120
          const cellsPerMeasureCount = MEASURE_TICKS / cell
          const swung: number[] = []
          for (let i = 0; i < count; i++) {
            swung.push(swungTick(ticks(i * cell), swingPercent, unit, MEASURE_TICKS) as number)
          }
          for (let i = 1; i < swung.length; i++) {
            expect(swung[i]).toBeGreaterThan(swung[i - 1] ?? -1)
          }
          // Sanity: cellsPerMeasureCount is only used to size `count` sensibly above.
          expect(cellsPerMeasureCount).toBeGreaterThan(0)
        },
      ),
    )
  })

  it('property: the result is always within [tick, tick + cell)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 * MEASURE_TICKS }),
        fc.constantFrom('eighth', 'sixteenth'),
        fc.integer({ min: 50, max: 75 }),
        (tick, unit, swingPercent) => {
          const cell = unit === 'eighth' ? 240 : 120
          const result = swungTick(ticks(tick), swingPercent, unit, MEASURE_TICKS) as number
          expect(result).toBeGreaterThanOrEqual(tick)
          expect(result).toBeLessThan(tick + cell)
        },
      ),
    )
  })

  /**
   * The authoritative cross-check: `swungTick` must agree with `grid.ts`'s
   * own `subdivisionCellTick` for every cell of a grid, at every percent in
   * the trainer's 50..75 range. `subdivisionCellTick(cellIndex, ..., 50, ...)`
   * gives the nominal (straight) tick of that cell, which is exactly the
   * nominal tick `swungTick` expects as input.
   */
  it('agrees with subdivisionCellTick for every cell of a grid, any percent 50..75', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('eighth' as const, 'sixteenth' as const),
        fc.integer({ min: 50, max: 75 }),
        fc.integer({ min: 0, max: 40 }),
        (subdivision, swingPercent, cellIndex) => {
          const cellsPerMeasureCount = subdivision === 'eighth' ? 8 : 16
          const cellTicksStraight = subdivision === 'eighth' ? 240 : 120
          const measureTicks = cellsPerMeasureCount * cellTicksStraight
          const nominalTick = subdivisionCellTick(cellIndex, subdivision, 50, cellsPerMeasureCount) as number
          const expected = subdivisionCellTick(cellIndex, subdivision, swingPercent, cellsPerMeasureCount)
          expect(swungTick(ticks(nominalTick), swingPercent, subdivision, measureTicks)).toBe(expected)
        },
      ),
    )
  })
})
