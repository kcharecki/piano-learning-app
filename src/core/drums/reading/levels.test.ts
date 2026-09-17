/**
 * The level ladder must be strictly cumulative and internally consistent
 * with the cell table — see the module doc on `levels.ts` for why that is a
 * property test rather than a handful of examples: it is the guarantee the
 * whole "vocabulary grows, never shrinks" pedagogy design depends on.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { RHYTHM_CELLS } from './cells.ts'
import {
  cellsForLevel,
  describeReadingLevel,
  isReadingLevel,
  MAX_READING_LEVEL,
  MIN_READING_LEVEL,
  READING_LEVELS,
  type ReadingLevel,
} from './levels.ts'

describe('READING_LEVELS', () => {
  it('runs from MIN_READING_LEVEL to MAX_READING_LEVEL in order', () => {
    expect(READING_LEVELS.map((spec) => spec.level)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(MIN_READING_LEVEL).toBe(1)
    expect(MAX_READING_LEVEL).toBe(7)
  })

  it('every cellIds entry resolves to a real cell', () => {
    for (const spec of READING_LEVELS) {
      for (const id of spec.cellIds) {
        expect(RHYTHM_CELLS[id]).toBeDefined()
      }
    }
  })

  it('every level has a non-empty name and description', () => {
    for (const spec of READING_LEVELS) {
      expect(spec.name.length).toBeGreaterThan(0)
      expect(spec.description.length).toBeGreaterThan(0)
    }
  })

  it('each level is a strict superset of the previous (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_READING_LEVEL + 1, max: MAX_READING_LEVEL }),
        (level) => {
          const prevSpec = READING_LEVELS.find((s) => s.level === level - 1)
          const curSpec = READING_LEVELS.find((s) => s.level === level)
          if (prevSpec === undefined || curSpec === undefined) return
          const prevIds = new Set(prevSpec.cellIds)
          const curIds = new Set(curSpec.cellIds)
          for (const id of prevIds) expect(curIds.has(id)).toBe(true)
          expect(curIds.size).toBeGreaterThan(prevIds.size)
        },
      ),
    )
  })

  it('cellIds within a level are unique', () => {
    for (const spec of READING_LEVELS) {
      expect(new Set(spec.cellIds).size).toBe(spec.cellIds.length)
    }
  })
})

describe('isReadingLevel', () => {
  it('accepts 1..7 and rejects everything else', () => {
    for (let n = 1; n <= 7; n++) expect(isReadingLevel(n)).toBe(true)
    for (const bad of [0, 8, -1, 3.5, NaN]) expect(isReadingLevel(bad)).toBe(false)
  })
})

describe('cellsForLevel / describeReadingLevel', () => {
  it('cellsForLevel returns the resolved cells in cellIds order', () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_READING_LEVEL, max: MAX_READING_LEVEL }), (n) => {
        const level = n as ReadingLevel
        const spec = READING_LEVELS.find((s) => s.level === level)
        if (spec === undefined) return
        const cells = cellsForLevel(level)
        expect(cells.map((c) => c.id)).toEqual(spec.cellIds)
      }),
    )
  })

  it('describeReadingLevel matches the spec description', () => {
    for (const spec of READING_LEVELS) {
      expect(describeReadingLevel(spec.level)).toBe(spec.description)
    }
  })
})
