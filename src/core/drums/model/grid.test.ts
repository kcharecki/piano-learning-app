import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { TimeSignature } from '@core/notation/score.ts'
import { ARTICULATIONS, type Articulation } from './articulation.ts'
import {
  cellsPerMeasure,
  gridToScore,
  scoreToGrid,
  subdivisionCellTick,
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
    const ticks = subdivisionCellTicks(8, 'eighth', 50, 8)
    expect(ticks).toEqual([0, 240, 480, 720, 960, 1200, 1440, 1680])
  })

  it('a triplet grid ignores swingPercent entirely', () => {
    const straight = subdivisionCellTicks(6, 'triplet', 50, 12)
    const swung = subdivisionCellTicks(6, 'triplet', 75, 12)
    expect(swung).toEqual(straight)
  })

  it('swing delays only the odd (off-beat) cell of each pair', () => {
    // eighth cells at 75% swing: pair (0,240) -> cell 1 sits at round(480*0.75)=360.
    const ticks = subdivisionCellTicks(4, 'eighth', 75, 8)
    expect(ticks).toEqual([0, 360, 480, 840])
  })
})

describe('property: swing application is reversible (strictly increasing tick positions)', () => {
  const subdivisionArb: fc.Arbitrary<Subdivision> = fc.constantFrom('eighth', 'sixteenth', 'triplet')
  const swingPercentArb = fc.integer({ min: 50, max: 75 })

  it('every generated tick sequence is strictly increasing, so the tick->cell lookup is a true inverse', () => {
    fc.assert(
      fc.property(
        subdivisionArb,
        swingPercentArb,
        fc.integer({ min: 1, max: 16 }),
        fc.integer({ min: 1, max: 64 }),
        (subdivision, swingPercent, cellsPerMeasureCount, count) => {
          const seq = subdivisionCellTicks(count, subdivision, swingPercent, cellsPerMeasureCount)
          for (let i = 1; i < seq.length; i++) {
            const prev = seq[i - 1]
            const cur = seq[i]
            expect(prev !== undefined && cur !== undefined && prev < cur).toBe(true)
          }
        },
      ),
    )
  })
})

describe('property: swing pairing restarts at every measure boundary (G1)', () => {
  const oddEighthMeters: readonly TimeSignature[] = [
    { beats: 3, beatType: 8 },
    { beats: 5, beatType: 8 },
    { beats: 7, beatType: 8 },
    { beats: 9, beatType: 8 },
  ]
  const swingPercentArb = fc.integer({ min: 50, max: 75 })
  const measureCountArb = fc.integer({ min: 2, max: 4 })

  it('every measure\'s first cell sits exactly on that measure\'s straight start tick, never delayed', () => {
    fc.assert(
      fc.property(fc.constantFrom(...oddEighthMeters), swingPercentArb, measureCountArb, (timeSignature, swingPercent, measureCount) => {
        const perMeasure = cellsPerMeasure(timeSignature, 'eighth')
        expect(perMeasure).toBeDefined()
        if (perMeasure === undefined) return
        const cellTicksStraight = 240 // TICKS_PER_QUARTER / 2 for eighth
        for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
          const globalIndex = measureIndex * perMeasure
          const tick = subdivisionCellTick(globalIndex, 'eighth', swingPercent, perMeasure)
          expect(tick).toBe(measureIndex * perMeasure * cellTicksStraight)
        }
      }),
    )
  })

  it('the swing pairing pattern (offset from measure start, by local cell index) is identical in every measure', () => {
    fc.assert(
      fc.property(fc.constantFrom(...oddEighthMeters), swingPercentArb, measureCountArb, (timeSignature, swingPercent, measureCount) => {
        const perMeasure = cellsPerMeasure(timeSignature, 'eighth')
        expect(perMeasure).toBeDefined()
        if (perMeasure === undefined) return
        const cellTicksStraight = 240
        for (let localIndex = 0; localIndex < perMeasure; localIndex++) {
          const firstMeasureOffset = subdivisionCellTick(localIndex, 'eighth', swingPercent, perMeasure)
          for (let measureIndex = 1; measureIndex < measureCount; measureIndex++) {
            const globalIndex = measureIndex * perMeasure + localIndex
            const tick = subdivisionCellTick(globalIndex, 'eighth', swingPercent, perMeasure)
            const measureStart = measureIndex * perMeasure * cellTicksStraight
            expect(tick - measureStart).toBe(firstMeasureOffset)
          }
        }
      }),
    )
  })

  it('a 5/16 sixteenth-subdivision meter: same measure-local pairing, and the odd trailing cell is always straight', () => {
    const timeSignature: TimeSignature = { beats: 5, beatType: 16 }
    const perMeasure = cellsPerMeasure(timeSignature, 'sixteenth')
    expect(perMeasure).toBe(5)
    if (perMeasure === undefined) return
    fc.assert(
      fc.property(swingPercentArb, measureCountArb, (swingPercent, measureCount) => {
        const cellTicksStraight = 120 // TICKS_PER_QUARTER / 4 for sixteenth
        for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
          const measureStart = measureIndex * perMeasure * cellTicksStraight
          const firstCellTick = subdivisionCellTick(measureIndex * perMeasure, 'sixteenth', swingPercent, perMeasure)
          expect(firstCellTick).toBe(measureStart)

          // Cell 4 (local index 4, the 5th and last cell) has no pair partner
          // in a 5-cell measure — it must always land straight.
          const lastLocal = perMeasure - 1
          const lastCellTick = subdivisionCellTick(measureIndex * perMeasure + lastLocal, 'sixteenth', swingPercent, perMeasure)
          expect(lastCellTick - measureStart).toBe(lastLocal * cellTicksStraight)
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
        const scoreResult = gridToScore(grid, { id: 'g' })
        expect(scoreResult.ok).toBe(true)
        if (!scoreResult.ok) return
        const result = scoreToGrid(scoreResult.value, grid.subdivision)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.value.rows).toEqual(grid.rows)
        expect(result.value.swingPercent).toBe(grid.swingPercent)
      }),
    )
  })
})
