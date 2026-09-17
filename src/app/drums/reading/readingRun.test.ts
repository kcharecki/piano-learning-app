/**
 * `readingRun.ts`'s pure helpers — the arithmetic and the wording, tested
 * without a running trainer. `useReadingTrainer.test.ts` covers these wired
 * into a live run; this file covers the awkward cases and the exact wording.
 */
import { describe, expect, it } from 'vitest'
import type { GroovePadResult, GrooveRunResult } from '@core/drums/practice/grade.ts'
import { accuracyOf, nextSeed, readingResultLines } from './readingRun.ts'

function row(overrides: Partial<GroovePadResult> = {}): GroovePadResult {
  return {
    pad: 'snare',
    expected: 8,
    hits: 8,
    matched: 8,
    missed: 0,
    extra: 0,
    slipped: 0,
    meanOffsetMs: 0,
    spreadMs: 0,
    driftMs: 0,
    ...overrides,
  }
}

function result(overrides: Partial<GrooveRunResult> & { pads?: readonly GroovePadResult[] } = {}): GrooveRunResult {
  return {
    steady: true,
    totalHits: 8,
    pads: [row()],
    unison: [],
    articulation: [],
    slipSteps: undefined,
    limits: { spreadMs: 40, driftMs: 50, flamMs: 50 },
    ...overrides,
  }
}

describe('accuracyOf', () => {
  it('is matched over expected on the snare row', () => {
    expect(accuracyOf(result({ pads: [row({ expected: 8, matched: 6 })] }))).toBeCloseTo(0.75)
  })

  it('is 0 when nothing was expected, never a division by zero', () => {
    expect(accuracyOf(result({ pads: [row({ pad: 'snare', expected: 0, matched: 0 })] }))).toBe(0)
  })

  it('is 0 when the snare row is entirely absent', () => {
    expect(accuracyOf(result({ pads: [] }))).toBe(0)
  })

  it('ignores any non-snare row (pad-agnostic grading only ever produces one, but stay defensive)', () => {
    expect(
      accuracyOf(result({ pads: [row({ pad: 'kick', expected: 4, matched: 4 })] })),
    ).toBe(0)
  })
})

describe('readingResultLines', () => {
  it('says Clean at or above 0.9 accuracy on a steady run', () => {
    const r = result({ steady: true, pads: [row({ expected: 8, matched: 8 })] })
    expect(readingResultLines(r, 1).verdict).toBe('Clean')
  })

  it('says Getting there at or above 0.9 accuracy when the run was not steady', () => {
    const r = result({ steady: false, pads: [row({ expected: 8, matched: 8 })] })
    expect(readingResultLines(r, 1).verdict).toBe('Getting there')
  })

  it('says Getting there between 0.6 and 0.9', () => {
    const r = result({ steady: true, pads: [row({ expected: 8, matched: 6 })] })
    expect(readingResultLines(r, 0.75).verdict).toBe('Getting there')
  })

  it('says Not there yet below 0.6', () => {
    const r = result({ steady: false, pads: [row({ expected: 8, matched: 3 })] })
    expect(readingResultLines(r, 0.375).verdict).toBe('Not there yet')
  })

  it('names the count, what was missed and extra, and the offset with its sign', () => {
    const r = result({
      pads: [row({ expected: 8, matched: 7, missed: 1, extra: 2, meanOffsetMs: -12.4 })],
    })
    expect(readingResultLines(r, 7 / 8).detail).toBe(
      '7 of 8 onsets, 1 missed, 2 extra · early by 12 ms on average',
    )
  })

  it('reads late for a positive offset', () => {
    const r = result({ pads: [row({ expected: 4, matched: 4, meanOffsetMs: 9.6 })] })
    expect(readingResultLines(r, 1).detail).toBe('4 of 4 onsets · late by 10 ms on average')
  })

  it('omits the offset clause entirely when nothing matched to average', () => {
    const r = result({
      steady: false,
      pads: [row({ expected: 4, matched: 0, missed: 4, meanOffsetMs: undefined })],
    })
    expect(readingResultLines(r, 0).detail).toBe('0 of 4 onsets, 4 missed')
  })

  it('omits missed and extra clauses when both are zero', () => {
    const r = result({ pads: [row({ expected: 4, matched: 4, meanOffsetMs: 0 })] })
    expect(readingResultLines(r, 1).detail).toBe('4 of 4 onsets · late by 0 ms on average')
  })
})

describe('nextSeed', () => {
  it('is deterministic: the same seed always advances to the same next seed', () => {
    expect(nextSeed(1)).toBe(nextSeed(1))
  })

  it('advances to a different seed than it started from', () => {
    expect(nextSeed(1)).not.toBe(1)
  })

  it('is a pure function of its input only, independent of call order', () => {
    const a = nextSeed(42)
    const b = nextSeed(7)
    expect(nextSeed(42)).toBe(a)
    expect(nextSeed(7)).toBe(b)
  })
})
