import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BETWEEN_GRID_MIN_STROKES, displayOffsetMs, padLooseOffset } from './betweenGrid.ts'

/** Eight instants 300 ms apart — an eighth-note grid at 100 bpm — with a 100 ms window (money-beat-shaped). */
const CELL_MS = 300
const WINDOW_MS = 100
const expectedMs = (n: number): number[] => [...Array(n).keys()].map((i) => i * CELL_MS)

describe('padLooseOffset', () => {
  it('names a uniformly late band: every hit +130 ms', () => {
    const hits = expectedMs(8).map((ms) => ms + 130)
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toEqual({ meanOffsetMs: 130, strokes: 8 })
  })

  it('names a uniformly early band: every hit -130 ms', () => {
    const hits = expectedMs(8).map((ms) => ms - 130)
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toEqual({ meanOffsetMs: -130, strokes: 8 })
  })

  it('is undefined when every hit is inside the strict window (+50 ms)', () => {
    const hits = expectedMs(8).map((ms) => ms + 50)
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  // Widely-spaced instants (not a contiguous 300 ms grid): with 8 evenly
  // spaced instants a +160 ms hit is actually CLOSER to the *next* instant
  // (distance 140 <= 150) than to its own (distance 160 > 150), so `pair`'s
  // nearest-first search across the whole array reassigns it there instead
  // of leaving it unpaired — a genuine property of `pair`, not a bug, but
  // not what this case means to isolate. Spacing the instants far apart
  // removes that cross-instant interference and tests the cellMs/2 boundary
  // on its own terms.
  it('is undefined when every hit is past half the cell (+160 ms > 150 ms = cellMs/2) — not even loosely paired', () => {
    const wideExpected = [0, 10_000]
    const hits = wideExpected.map((ms) => ms + 160)
    expect(padLooseOffset(wideExpected, hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('is undefined when only 5 of 8 are late (5 < ceil(0.75 * 8) = 6)', () => {
    const hits = expectedMs(8).map((ms, i) => (i < 5 ? ms + 130 : ms))
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('is defined with strokes 6 when 6 of 8 are late', () => {
    const hits = expectedMs(8).map((ms, i) => (i < 6 ? ms + 130 : ms))
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toEqual({ meanOffsetMs: 130, strokes: 6 })
  })

  it('is undefined for any hits when the band is empty (cellMs 187.5, windowMs 93.75 — half the cell equals the window)', () => {
    const cell = 187.5
    const window = 93.75
    const eight = [...Array(8).keys()].map((i) => i * cell)
    for (const delta of [10, -10, 50, -50, 90, -90]) {
      const hits = eight.map((ms) => ms + delta)
      expect(padLooseOffset(eight, hits, window, cell)).toBeUndefined()
    }
  })

  it('is undefined for a single instant (below BETWEEN_GRID_MIN_STROKES)', () => {
    expect(BETWEEN_GRID_MIN_STROKES).toBe(2)
    expect(padLooseOffset([0], [130], WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('is undefined when the larger side (a tie goes to late) still falls short of coverage: 4 late, 4 early', () => {
    const hits = expectedMs(8).map((ms, i) => (i < 4 ? ms + 130 : ms - 130))
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('returns undefined, never NaN, on an empty expected or hits list', () => {
    expect(padLooseOffset([], [130], WINDOW_MS, CELL_MS)).toBeUndefined()
    expect(padLooseOffset(expectedMs(8), [], WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('property: a whole grid, all offsets strictly inside the band and the same sign, is always defined, sign matches, and |mean| stays in the band', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.double({ min: 250, max: 600, noNaN: true }),
        fc.double({ min: 0.02, max: 0.98, noNaN: true }),
        fc.constantFrom(1, -1),
        (n, cell, gapFraction, sign) => {
          const window = 100
          fc.pre(cell / 2 > window) // band must exist
          const grid = [...Array(n).keys()].map((i) => i * cell)
          const magnitude = window + gapFraction * (cell / 2 - window)
          const hits = grid.map((ms) => ms + sign * magnitude)
          const result = padLooseOffset(grid, hits, window, cell)
          expect(result).toBeDefined()
          if (result === undefined) return
          expect(Number.isNaN(result.meanOffsetMs)).toBe(false)
          expect(Math.sign(result.meanOffsetMs)).toBe(sign)
          expect(Math.abs(result.meanOffsetMs)).toBeGreaterThan(window)
          expect(Math.abs(result.meanOffsetMs)).toBeLessThan(cell / 2)
        },
      ),
    )
  })

  it('property: every offset inside the strict window is always undefined', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.double({ min: 150, max: 600, noNaN: true }),
        fc.array(fc.double({ min: -100, max: 100, noNaN: true }), { minLength: 1, maxLength: 8 }),
        (n, cell, offsets) => {
          const window = 100
          const grid = [...Array(n).keys()].map((i) => i * cell)
          const hits = grid.map((ms, i) => ms + (offsets[i % offsets.length] ?? 0))
          expect(padLooseOffset(grid, hits, window, cell)).toBeUndefined()
        },
      ),
    )
  })

  it('property: the result never carries a NaN mean, across random grids and offsets', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.double({ min: 50, max: 600, noNaN: true }),
        fc.array(fc.double({ min: -400, max: 400, noNaN: true }), { minLength: 1, maxLength: 8 }),
        (n, cell, offsets) => {
          const window = 100
          const grid = [...Array(n).keys()].map((i) => i * cell)
          const hits = grid.map((ms, i) => ms + (offsets[i % offsets.length] ?? 0))
          const result = padLooseOffset(grid, hits, window, cell)
          if (result !== undefined) expect(Number.isNaN(result.meanOffsetMs)).toBe(false)
        },
      ),
    )
  })

  // RED-1 (review): a stroke train more than half a cell late does not go
  // unmatched — nearest-first `pair` reassigns every instant to the NEXT
  // instant's hit, at a NEGATIVE offset, which used to read as "ahead of
  // the click" for a train that was actually late. The fix anchors on both
  // ends: a late train this far off always leaves the very FIRST instant
  // unmatched (nothing before it to steal a hit from); an early train this
  // far off leaves the LAST instant unmatched.
  it('a train more than half a cell late is not a band: the first instant is unmatched', () => {
    const hits = expectedMs(8).map((ms) => ms + 170)
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('a train more than half a cell early is not a band: the last instant is unmatched', () => {
    const hits = expectedMs(8).map((ms) => ms - 170)
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  // Fix (review — the ends-only proxy's actual failure case, per the module
  // doc's worked example): the first stroke lands exactly on time, so BOTH
  // ends end up "matched" (the old proxy's only test passed), but every one
  // of the other 15 strokes is +170 — beyond half the cell — so the cascade
  // among THEM still leaves an INTERIOR instant unmatched. Money beat 100
  // bpm: cellMs 300, windowMs 100. Pre-fix this returned
  // `{ meanOffsetMs: -130, strokes: 14 }` — a train that ran 170 ms LATE
  // reported as 130 ms EARLY.
  it('is undefined when the first stroke lands exactly on time but the other 15 are +170 ms (RED-1 worked example, interior gap)', () => {
    const hits = expectedMs(16).map((ms, i) => (i === 0 ? ms : ms + 170))
    expect(padLooseOffset(expectedMs(16), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  // The reading-trainer analogue from the same bug report: level 1's first
  // onset lands on time, the rest of the bar is uniformly late by more than
  // half a cell — same shape, different grid size, still an interior gap.
  it('is undefined for a uniform +170 band (all 16 shifted) plus one stray hit at expected[0] + 5 — the leftover hit overhangs the span', () => {
    const hits = [...expectedMs(16).map((ms) => ms + 170), 5]
    expect(padLooseOffset(expectedMs(16), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('is undefined when the first stroke is on time, the middle strokes are +170, and the last stroke is dropped entirely (still an interior gap)', () => {
    const hits = expectedMs(16)
      .slice(0, 15)
      .map((ms, i) => (i === 0 ? ms : ms + 170))
    expect(padLooseOffset(expectedMs(16), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('a uniform +130 band still works at 16 instants (the fix does not regress an ordinary band)', () => {
    const hits = expectedMs(16).map((ms) => ms + 130)
    expect(padLooseOffset(expectedMs(16), hits, WINDOW_MS, CELL_MS)).toEqual({ meanOffsetMs: 130, strokes: 16 })
  })

  it('a uniform -130 band still works at 16 instants', () => {
    const hits = expectedMs(16).map((ms) => ms - 130)
    expect(padLooseOffset(expectedMs(16), hits, WINDOW_MS, CELL_MS)).toEqual({ meanOffsetMs: -130, strokes: 16 })
  })

  it('is defined (-130, 15 strokes) when the first stroke is on time and the other 15 are a legitimate -130 rush — no gap, no overhang', () => {
    const hits = expectedMs(16).map((ms, i) => (i === 0 ? ms : ms - 130))
    expect(padLooseOffset(expectedMs(16), hits, WINDOW_MS, CELL_MS)).toEqual({ meanOffsetMs: -130, strokes: 15 })
  })

  it('property: a uniform shift is never read as a band with the wrong sign, whether or not the first stroke lands exactly on time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 16 }),
        fc.constantFrom(240, 300, 480, 960),
        fc.double({ min: 0.001, max: 0.999, noNaN: true }),
        fc.constantFrom(1, -1),
        fc.boolean(),
        (n, cell, gapFraction, sign, firstOnTime) => {
          const window = 100
          const magnitude = 100 + gapFraction * (cell - 200) // 100 < |o| < cell - 100
          const grid = [...Array(n).keys()].map((i) => i * cell)
          const hits = grid.map((ms, i) => (firstOnTime && i === 0 ? ms : ms + sign * magnitude))
          const result = padLooseOffset(grid, hits, window, cell)
          if (result === undefined) return
          expect(Number.isNaN(result.meanOffsetMs)).toBe(false)
          expect(Math.sign(result.meanOffsetMs)).toBe(sign)
        },
      ),
    )
  })

  it('is undefined when the first stroke is dropped, even though every other stroke is +130', () => {
    const hits = expectedMs(8)
      .slice(1)
      .map((ms) => ms + 130)
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('is undefined when the last stroke is dropped, even though every other stroke is +130', () => {
    const hits = expectedMs(8)
      .slice(0, 7)
      .map((ms) => ms + 130)
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  // Fix (was: "is defined with strokes 7 when a MIDDLE stroke is dropped
  // (both ends still matched)"): the ends-only check used to let this
  // through since expected[0] and expected[7] both still matched; the
  // complete-pairing fix now requires EVERY expected instant to find a
  // loose partner, so a dropped middle stroke (expected index 3, unmatched)
  // now loses the sentence too — conservative, per the module doc.
  it('is undefined when a MIDDLE stroke is dropped, even though both ends still match', () => {
    const hits = expectedMs(8)
      .filter((_, i) => i !== 3)
      .map((ms) => ms + 130)
    expect(padLooseOffset(expectedMs(8), hits, WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('is undefined when 2 notated instants both land +130 but 6 wild extra hits swamp them (extras rule)', () => {
    const grid = expectedMs(2) // [0, 300]
    const onGrid = grid.map((ms) => ms + 130)
    const extras = [10_000, 10_100, 10_200, 10_300, 10_400, 10_500] // far outside either instant's cellMs/2 window
    expect(padLooseOffset(grid, [...onGrid, ...extras], WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  // Fix: these 2 extra hits (50_000, 50_100) sit far outside
  // [expected[0] - cellMs/2, expected[7] + cellMs/2] = [-150, 2250], so the
  // new overhang check now rejects them regardless of the extras-coverage
  // math (8*2 > 10) that used to let this through — an extra hit has to sit
  // within half a cell of the span to be an honest "double stroke"; one
  // parked 50 seconds away is not that. See the in-span variant below for
  // the extras-coverage rule still holding when the overhang check does not
  // fire.
  it('is undefined when 2 extra hits are mixed in far outside the span, even though the extras-coverage math (8*2 > 10) would otherwise allow it', () => {
    const onGrid = expectedMs(8).map((ms) => ms + 130)
    const extras = [50_000, 50_100]
    expect(padLooseOffset(expectedMs(8), [...onGrid, ...extras], WINDOW_MS, CELL_MS)).toBeUndefined()
  })

  it('is defined when 8 notated instants all land +130 and one extra hit lands INSIDE the span (expected[3] + 140)', () => {
    const onGrid = expectedMs(8).map((ms) => ms + 130)
    const extras = [900 + 140] // expected[3] (900) + 140 = 1040, well inside [-150, 2250]
    expect(padLooseOffset(expectedMs(8), [...onGrid, ...extras], WINDOW_MS, CELL_MS)).toEqual({
      meanOffsetMs: 130,
      strokes: 8,
    })
  })

  it('property: a uniform shift inside the band (window < |s| < cellMs/2) is always defined with the shift\'s own sign', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }),
        fc.double({ min: 250, max: 600, noNaN: true }),
        fc.double({ min: 0.02, max: 0.98, noNaN: true }),
        fc.constantFrom(1, -1),
        (n, cell, gapFraction, sign) => {
          const window = 100
          fc.pre(cell / 2 > window)
          const grid = [...Array(n).keys()].map((i) => i * cell)
          const magnitude = window + gapFraction * (cell / 2 - window)
          const hits = grid.map((ms) => ms + sign * magnitude)
          const result = padLooseOffset(grid, hits, window, cell)
          expect(result).toBeDefined()
          if (result === undefined) return
          expect(Math.sign(result.meanOffsetMs)).toBe(sign)
        },
      ),
    )
  })

  // The RED-1 property: proven wrong pre-fix by the worked example in the
  // module doc (s=170, cellMs=300, windowMs=100, n=8) — pre-fix, that case
  // pairs 7 of 8 instants to the NEXT instant's hit at offset -130 each,
  // clearing every existing threshold (coverage, min-strokes, and even the
  // new extras rule) and returning `{ meanOffsetMs: -130, strokes: 7 }`: a
  // train that ran 170 ms LATE reported as 130 ms EARLY. Post-fix,
  // `expectedIndex 0` is left unmatched by that same `pair()` call (nothing
  // before it to steal a hit from), so the anchor check catches it and this
  // property holds.
  it('property: a uniform shift beyond half the cell (cellMs/2 < |s| < cellMs) is never read as a band of the opposite sign — RED-1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }),
        fc.double({ min: 250, max: 600, noNaN: true }),
        fc.double({ min: 0.02, max: 0.98, noNaN: true }),
        fc.constantFrom(1, -1),
        (n, cell, gapFraction, sign) => {
          const window = 100
          fc.pre(cell / 2 > window)
          const magnitude = cell / 2 + gapFraction * (cell / 2)
          fc.pre(magnitude < cell)
          const grid = [...Array(n).keys()].map((i) => i * cell)
          const hits = grid.map((ms) => ms + sign * magnitude)
          const result = padLooseOffset(grid, hits, window, cell)
          expect(result).toBeUndefined()
        },
      ),
    )
  })
})

describe('displayOffsetMs', () => {
  it('snaps to the nearest ten', () => {
    expect(displayOffsetMs(114.9, 100)).toBe(110)
    expect(displayOffsetMs(101, 100)).toBe(110)
    expect(displayOffsetMs(104, 100)).toBe(110)
  })

  it('AMBER-c: tolerates the float noise nominalSubdivisionMs can carry (114.99999999999997 reads as the 115 it nearly is)', () => {
    expect(displayOffsetMs(115, 100)).toBe(120)
    expect(displayOffsetMs(114.99999999999997, 100)).toBe(120)
  })

  it('carries the magnitude only — the caller supplies the sign', () => {
    expect(displayOffsetMs(-130, 100)).toBe(130)
    expect(displayOffsetMs(130, 75)).toBe(130)
  })

  it('AMBER-b: never prints below the window it is said to be outside of, even for a raw value that rounds under it', () => {
    expect(displayOffsetMs(76, 75)).toBe(85)
  })

  it('property: never below windowMs + 10 (rounded), always a multiple of 10 when windowMs is, and never NaN', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        (ms, windowMs) => {
          const result = displayOffsetMs(ms, windowMs)
          expect(Number.isNaN(result)).toBe(false)
          expect(result).toBeGreaterThanOrEqual(Math.round(windowMs) + 10)
          if (Math.round(windowMs) % 10 === 0) expect(result % 10).toBe(0)
        },
      ),
    )
  })
})
