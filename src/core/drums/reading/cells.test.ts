/**
 * Structural checks on the rhythm-cell table: every cell's span is exact
 * (`beats * 480`), every onset lies inside that span with no overlap, and
 * ids are unique and self-consistent with their table key. These are the
 * invariants `generate.ts` leans on without re-checking them itself.
 */
import { describe, expect, it } from 'vitest'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { cellSpanTicks, RHYTHM_CELLS } from './cells.ts'

const cellEntries = Object.entries(RHYTHM_CELLS)

describe('RHYTHM_CELLS', () => {
  it('keys match each cell id', () => {
    for (const [key, cell] of cellEntries) {
      expect(cell.id).toBe(key)
    }
  })

  it('has unique ids', () => {
    const ids = cellEntries.map(([, cell]) => cell.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every cell spans exactly beats * TICKS_PER_QUARTER', () => {
    for (const [, cell] of cellEntries) {
      expect(cellSpanTicks(cell)).toBe(cell.beats * TICKS_PER_QUARTER)
    }
  })

  it('onsets are sorted, non-overlapping, and inside the cell span', () => {
    for (const [, cell] of cellEntries) {
      const span = cellSpanTicks(cell)
      let cursor = 0
      for (const onset of cell.onsets) {
        expect(onset.offsetTicks).toBeGreaterThanOrEqual(cursor)
        expect(onset.durationTicks).toBeGreaterThan(0)
        expect(onset.offsetTicks + onset.durationTicks).toBeLessThanOrEqual(span)
        cursor = onset.offsetTicks + onset.durationTicks
      }
    }
  })

  it('beats is only ever 1 or 2', () => {
    for (const [, cell] of cellEntries) {
      expect([1, 2]).toContain(cell.beats)
    }
  })

  it('q_rest is the only cell with no onsets', () => {
    const silent = cellEntries.filter(([, cell]) => cell.onsets.length === 0).map(([key]) => key)
    expect(silent).toEqual(['q_rest'])
  })
})
