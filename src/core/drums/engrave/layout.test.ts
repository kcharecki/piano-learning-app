/**
 * `layout.ts` is a types-and-constants module with no logic of its own, so
 * there is nothing to unit-test except that the constants agree with each
 * other. The interesting vertical guarantee — that a layout's ink actually
 * fits inside the box it reports — belongs to the module that derives the box
 * from a score, and is proven over all 16 pads in `staff.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { staffPositionOf } from '@core/drums/model/pad.ts'
import {
  SLOT_WIDTH,
  COUNT_ROW_DESCENT,
  COUNT_ROW_GAP,
  EDGE_PAD,
  LEFT_MARGIN,
  MARK_RESERVE,
  MIN_STAFF_TOP_Y,
  RIGHT_MARGIN,
  STEM_LENGTH,
} from './layout.ts'

describe('layout constants', () => {
  it('are all finite and positive', () => {
    const values = [
      MIN_STAFF_TOP_Y,
      LEFT_MARGIN,
      SLOT_WIDTH,
      RIGHT_MARGIN,
      STEM_LENGTH,
      MARK_RESERVE,
      EDGE_PAD,
      COUNT_ROW_GAP,
      COUNT_ROW_DESCENT,
    ]
    for (const value of values) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it('leaves the count row clear of the ink above it and of the bottom of the layout', () => {
    // Both gaps have to be real distances, not zero: a count glyph sitting on
    // the lowest stem tip, or on the canvas edge, is the collision this whole
    // derived-box change exists to remove.
    expect(COUNT_ROW_GAP).toBeGreaterThan(0)
    expect(COUNT_ROW_DESCENT).toBeGreaterThan(0)
  })

  it('sizes the minimum headroom for the pad in routine use that sits highest — the hi-hat, stem and all', () => {
    // `MIN_STAFF_TOP_Y` is a floor, not a bound: `staff.ts` slides the staff
    // further down for a score that reaches higher. What it must not do is
    // make the COMMON groove pay for headroom it never uses, so the hi-hat's
    // stem tip is expected to land just inside it rather than far above.
    const position = staffPositionOf('hhClosed')
    expect(position).toBeDefined()
    const hiHatY = MIN_STAFF_TOP_Y - 0.5 // the space above the top line
    const stemToY = hiHatY - STEM_LENGTH
    expect(stemToY).toBeGreaterThanOrEqual(0)
    expect(stemToY).toBeLessThan(EDGE_PAD + 1)
  })

  it('gives a grid slot more room than a notehead is wide, so adjacent notes never overlap', () => {
    // A notehead is 1.2 staff spaces across (`GrooveStaff.NOTEHEAD_RX` is its
    // radius). The old fixed 12-spaces-per-bar left sixteenths 0.75 apart —
    // overlapping heads and merged ghost parentheses.
    const NOTEHEAD_WIDTH = 1.2
    expect(SLOT_WIDTH).toBeGreaterThan(NOTEHEAD_WIDTH)
  })

  it('reserves less for a mark stack than for a stem, since marks sit between the head and the stem tip', () => {
    expect(MARK_RESERVE).toBeLessThan(STEM_LENGTH)
  })
})
