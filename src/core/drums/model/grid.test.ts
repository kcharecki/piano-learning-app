import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ARTICULATIONS, type Articulation } from './articulation.ts'
import {
  cellsPerMeasure,
  gridToScore,
  scoreToGrid,
  subdivisionCellTicks,
  type GrooveGrid,
  type GrooveGridRow,
  type Subdivision,
} from './grid.ts'
import { MAPPED_PADS } from './pad.ts'
import type { DynamicsClass } from './groove.ts'

describe('cellsPerMeasure', () => {
  it('divides a 4/4 bar evenly for eighth/sixteenth/triplet', () => {
    const ts = { beats: 4, beatType: 4 }
    expect(cellsPerMeasure(ts, 'eighth')).toBe(8)
    expect(cellsPerMeasure(ts, 'sixteenth')).toBe(16)
    expect(cellsPerMeasure(ts, 'triplet')).toBe(12)
  })

  it('returns undefined when the meter does not divide evenly', () => {
    // TICKS_PER_QUARTER=480, one triplet cell = 160 ticks; 3/8 = 720 ticks -> not a multiple of 160.
    expect(cellsPerMeasure({ beats: 3, beatType: 8 }, 'triplet')).toBeUndefined()
  })
})

describe('subdivisionCellTick / straight grids', () => {
  it('a straight (swingPercent=50) eighth grid lands on 240-tick multiples', () => {
    const ticks = subdivisionCellTicks(8, 'eighth', 50)
    expect(ticks).toEqual([0, 240, 480, 720, 960, 1200, 1440, 1680])
  })

  it('a triplet grid ignores swingPercent entirely', () => {
    const straight = subdivisionCellTicks(6, 'triplet', 50)
    const swung = subdivisionCellTicks(6, 'triplet', 75)
    expect(swung).toEqual(straight)
  })

  it('swing delays only the odd (off-beat) cell of each pair', () => {
    // eighth cells at 75% swing: pair (0,240) -> cell 1 sits at round(480*0.75)=360.
    const ticks = subdivisionCellTicks(4, 'eighth', 75)
    expect(ticks).toEqual([0, 360, 480, 840])
  })
})

describe('property: swing application is reversible (strictly increasing tick positions)', () => {
  const subdivisionArb: fc.Arbitrary<Subdivision> = fc.constantFrom('eighth', 'sixteenth', 'triplet')
  const swingPercentArb = fc.integer({ min: 50, max: 75 })

  it('every generated tick sequence is strictly increasing, so the tick->cell lookup is a true inverse', () => {
    fc.assert(
      fc.property(subdivisionArb, swingPercentArb, fc.integer({ min: 1, max: 64 }), (subdivision, swingPercent, count) => {
        const seq = subdivisionCellTicks(count, subdivision, swingPercent)
        for (let i = 1; i < seq.length; i++) {
          const prev = seq[i - 1]
          const cur = seq[i]
          expect(prev !== undefined && cur !== undefined && prev < cur).toBe(true)
        }
      }),
    )
  })
})

describe('property: grid round-trip (grid -> score -> grid) is lossless', () => {
  const subdivisionArb: fc.Arbitrary<Subdivision> = fc.constantFrom('eighth', 'sixteenth', 'triplet')

  const cellArb = fc.record({
    dynamics: fc.constantFrom<DynamicsClass>('accent', 'normal', 'ghost'),
    articulations: fc.subarray(ARTICULATIONS as unknown as Articulation[]),
  })

  /** A grid over one 4/4 measure, at a random subdivision, with a random sparse note layout. */
  const gridArb: fc.Arbitrary<GrooveGrid> = subdivisionArb.chain((subdivision) => {
    const perMeasure = cellsPerMeasure({ beats: 4, beatType: 4 }, subdivision)
    if (perMeasure === undefined) throw new Error('unreachable: 4/4 divides evenly at every subdivision')
    const swingPercentArb = subdivision === 'triplet' ? fc.constant(50) : fc.integer({ min: 50, max: 75 })
    const cellsArb = fc.array(fc.option(cellArb, { nil: undefined }), { minLength: perMeasure, maxLength: perMeasure })
    const rowsArb = fc.array(cellsArb, { minLength: MAPPED_PADS.length, maxLength: MAPPED_PADS.length })
    return fc.tuple(swingPercentArb, rowsArb).map(([swingPercent, cellsPerRow]) => ({
      subdivision,
      timeSignature: { beats: 4, beatType: 4 },
      swingPercent,
      measureCount: 1,
      cellsPerMeasure: perMeasure,
      rows: MAPPED_PADS.map((pad, i): GrooveGridRow => ({ pad, cells: cellsPerRow[i] ?? [] })),
    }))
  })

  it('scoreToGrid(gridToScore(grid)) equals the original grid', () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const score = gridToScore(grid, { id: 'g' })
        const result = scoreToGrid(score, grid.subdivision)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value.rows).toEqual(grid.rows)
        expect(result.value.swingPercent).toBe(grid.swingPercent)
      }),
    )
  })
})
