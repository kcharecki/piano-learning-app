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
  CLEF_WIDTH,
  COUNT_ROW_DESCENT,
  COUNT_ROW_GAP,
  EDGE_PAD,
  MARK_ANCHOR_GAP,
  MARK_RESERVE,
  MIN_STAFF_TOP_Y,
  REPEAT_LABEL_RESERVE,
  RIGHT_MARGIN,
  SLOT_WIDTH,
  STEM_LENGTH,
  TIME_SIGNATURE_WIDTH,
} from './layout.ts'

describe('layout constants', () => {
  it('are all finite and positive', () => {
    const values = [
      MIN_STAFF_TOP_Y,
      CLEF_WIDTH,
      TIME_SIGNATURE_WIDTH,
      SLOT_WIDTH,
      RIGHT_MARGIN,
      STEM_LENGTH,
      MARK_ANCHOR_GAP,
      MARK_RESERVE,
      REPEAT_LABEL_RESERVE,
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

  it('gives the clef more room than the time signature, and both a real width', () => {
    // A hand-picked ordering fact about the two head glyphs, not a value this
    // test could derive by re-running the same subtraction the code does.
    expect(CLEF_WIDTH).toBeGreaterThan(TIME_SIGNATURE_WIDTH)
  })

  it('sits the mark anchor closer to the stem than the room it has to clear', () => {
    // `markAnchorY` is `MARK_ANCHOR_GAP` off the stem tip; the marks
    // themselves then need `MARK_RESERVE` beyond THAT. If the gap were not
    // smaller than the reserve it protects, the anchor could sit past the
    // room the layout set aside for it.
    expect(MARK_ANCHOR_GAP).toBeLessThan(MARK_RESERVE)
  })
})
