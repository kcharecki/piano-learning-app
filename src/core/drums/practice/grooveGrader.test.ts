import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { at, invariant, InvariantError } from '@core/shared/invariant.ts'
import { millis } from '@core/shared/units.ts'
import { makeGrooveScore } from '@core/drums/model/groove.ts'
import { moneyBeat } from '@core/drums/model/referenceGrooves.ts'
import { PADS, type DrumPad, type MappedDrumPad } from '@core/drums/model/pad.ts'
import type { RawDrumHit } from '@core/drums/model/hit.ts'
import {
  DEFAULT_GROOVE_TOLERANCE_MS,
  gradeGroovePerformance,
  grooveOnsetsMs,
  type PadResult,
} from './grooveGrader.ts'

// -------------------------------------------------------------------- helpers

/** A raw hit at a plain millisecond time — bypasses `makeDrumHit`'s own
 * validation deliberately, since a couple of property tests below need to
 * push hit times outside the range that constructor would accept. */
const hit = (pad: DrumPad, atMs: number, velocity = 100): RawDrumHit => ({
  pad,
  velocity,
  time: millis(atMs),
  articulations: [],
})

function rowFor(perPad: readonly PadResult[], pad: DrumPad): PadResult {
  return at(
    perPad.filter((r) => r.pad === pad),
    0,
  )
}

const swapKickAndSnare = (pad: MappedDrumPad): DrumPad => {
  if (pad === 'kick') return 'snare'
  if (pad === 'snare') return 'kick'
  return pad
}

/**
 * `moneyBeat()` at 80 bpm, 2 repeats: a 4/4 bar is 3000 ms at 80 bpm, so an
 * eighth note is 375 ms. 24 expected onsets total: 16 hi-hat, 4 kick, 4 snare.
 */
const BPM = 80
const REPEATS = 2

// ------------------------------------------------------------------- examples

describe('gradeGroovePerformance', () => {
  it('grades clean when every expected onset is played exactly', () => {
    const score = moneyBeat()
    const onsets = grooveOnsetsMs(score, BPM, REPEATS)
    const hits = onsets.map((o) => hit(o.pad, o.atMs))

    const result = gradeGroovePerformance({ score, bpm: BPM, repeats: REPEATS, hits })

    expect(result.clean).toBe(true)
    expect(result.toleranceMs).toBe(DEFAULT_GROOVE_TOLERANCE_MS)
    expect(result.expectedTotal).toBe(24)
    expect(result.matchedTotal).toBe(24)
    expect(rowFor(result.perPad, 'hhClosed')).toMatchObject({
      expected: 16,
      matched: 16,
      missed: 0,
      extra: 0,
      meanOffsetMs: 0,
    })
    expect(rowFor(result.perPad, 'snare')).toMatchObject({
      expected: 4,
      matched: 4,
      missed: 0,
      extra: 0,
      meanOffsetMs: 0,
    })
    expect(rowFor(result.perPad, 'kick')).toMatchObject({
      expected: 4,
      matched: 4,
      missed: 0,
      extra: 0,
      meanOffsetMs: 0,
    })
  })

  it('catches a kick/snare limb swap even though the onset-time multiset is unchanged — this module\'s reason to exist', () => {
    const score = moneyBeat()
    const onsets = grooveOnsetsMs(score, BPM, REPEATS)
    const hits = onsets.map((o) => hit(swapKickAndSnare(o.pad), o.atMs))

    // A grader keying only on onset times (ignoring which pad played them)
    // would see an identical multiset of times and call this clean.
    const expectedTimesSorted = onsets.map((o) => o.atMs).sort((a, b) => a - b)
    const hitTimesSorted = hits.map((h) => h.time).sort((a, b) => a - b)
    expect(hitTimesSorted).toEqual(expectedTimesSorted)

    const result = gradeGroovePerformance({ score, bpm: BPM, repeats: REPEATS, hits })

    expect(result.clean).toBe(false)
    expect(rowFor(result.perPad, 'kick')).toMatchObject({
      expected: 4,
      matched: 0,
      missed: 4,
      extra: 4,
    })
    expect(rowFor(result.perPad, 'snare')).toMatchObject({
      expected: 4,
      matched: 0,
      missed: 4,
      extra: 4,
    })
    expect(rowFor(result.perPad, 'hhClosed')).toMatchObject({
      expected: 16,
      matched: 16,
      missed: 0,
      extra: 0,
    })
  })

  it('matches a hit exactly at the tolerance boundary; one further out does not', () => {
    // bpm 125 makes 1 tick == 1 ms exactly (60000 / (125 * 480) == 1), so a
    // note at tick 0 is expected at exactly 0 ms — easy round numbers.
    const score = makeGrooveScore({
      id: 'tolerance-boundary',
      measureCount: 1,
      notes: [{ pad: 'kick', tick: 0, durationTicks: 240 }],
    })

    const atBoundary = gradeGroovePerformance({
      score,
      bpm: 125,
      repeats: 1,
      hits: [hit('kick', DEFAULT_GROOVE_TOLERANCE_MS)],
    })
    expect(rowFor(atBoundary.perPad, 'kick')).toMatchObject({
      expected: 1,
      matched: 1,
      missed: 0,
      extra: 0,
    })

    const justOver = gradeGroovePerformance({
      score,
      bpm: 125,
      repeats: 1,
      hits: [hit('kick', DEFAULT_GROOVE_TOLERANCE_MS + 1)],
    })
    expect(rowFor(justOver.perPad, 'kick')).toMatchObject({
      expected: 1,
      matched: 0,
      missed: 1,
      extra: 1,
    })
  })

  it('a pad the groove never asks for appears with expected: 0 and extra hits, and breaks clean', () => {
    const score = moneyBeat()
    const onsets = grooveOnsetsMs(score, BPM, REPEATS)
    const hits = [...onsets.map((o) => hit(o.pad, o.atMs)), hit('crash1', 0)]

    const result = gradeGroovePerformance({ score, bpm: BPM, repeats: REPEATS, hits })

    expect(result.clean).toBe(false)
    expect(rowFor(result.perPad, 'crash1')).toMatchObject({
      expected: 0,
      matched: 0,
      missed: 0,
      extra: 1,
    })
  })

  it('two hits inside one note\'s window match once, leaving the other extra', () => {
    const score = makeGrooveScore({
      id: 'double-hit',
      measureCount: 1,
      notes: [{ pad: 'snare', tick: 0, durationTicks: 240 }],
    })
    // Note expected at exactly 0 ms (see the tolerance-boundary test above).
    const hits = [hit('snare', 30), hit('snare', 10)]

    const result = gradeGroovePerformance({ score, bpm: 125, repeats: 1, hits })

    const row = rowFor(result.perPad, 'snare')
    expect(row).toMatchObject({ expected: 1, matched: 1, missed: 0, extra: 1 })
    expect(row.meanOffsetMs).toBeCloseTo(10)
  })

  it('refuses a non-positive toleranceMs', () => {
    const score = moneyBeat()
    expect(() =>
      gradeGroovePerformance({ score, bpm: BPM, repeats: 1, hits: [], toleranceMs: 0 }),
    ).toThrow(InvariantError)
    expect(() =>
      gradeGroovePerformance({ score, bpm: BPM, repeats: 1, hits: [], toleranceMs: -5 }),
    ).toThrow(InvariantError)
  })

  it('an empty groove has no expected onsets and is never clean, even with no hits', () => {
    const empty = makeGrooveScore({ id: 'empty', measureCount: 1, notes: [] })
    const result = gradeGroovePerformance({ score: empty, bpm: 100, repeats: 1, hits: [] })
    expect(result.expectedTotal).toBe(0)
    expect(result.clean).toBe(false)
    expect(result.perPad).toEqual([])
  })
})

describe('grooveOnsetsMs', () => {
  it('refuses a swung score, a non-positive bpm, and a non-positive/non-integer repeats', () => {
    const straight = moneyBeat()
    const swung = makeGrooveScore({
      id: 'swung',
      measureCount: 1,
      swingPercent: 66,
      notes: [{ pad: 'hhClosed', tick: 0, durationTicks: 240 }],
    })

    expect(() => grooveOnsetsMs(swung, 120, 1)).toThrow(InvariantError)
    expect(() => grooveOnsetsMs(straight, 0, 1)).toThrow(InvariantError)
    expect(() => grooveOnsetsMs(straight, -10, 1)).toThrow(InvariantError)
    expect(() => grooveOnsetsMs(straight, 120, 0)).toThrow(InvariantError)
    expect(() => grooveOnsetsMs(straight, 120, 1.5)).toThrow(InvariantError)
  })
})

// -------------------------------------------------------------------- properties

describe('property: exact playback', () => {
  it('always grades clean, with matchedTotal === expectedTotal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 40, max: 200 }),
        fc.integer({ min: 1, max: 4 }),
        (bpm, repeats) => {
          const score = moneyBeat()
          const onsets = grooveOnsetsMs(score, bpm, repeats)
          const hits = onsets.map((o) => hit(o.pad, o.atMs))

          const result = gradeGroovePerformance({ score, bpm, repeats, hits })

          expect(result.clean).toBe(true)
          expect(result.matchedTotal).toBe(result.expectedTotal)
        },
      ),
    )
  })
})

describe('property: a constant time shift on every hit', () => {
  it('stays clean, with every pad\'s meanOffsetMs/worstOffsetMs equal to the shift', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -DEFAULT_GROOVE_TOLERANCE_MS, max: DEFAULT_GROOVE_TOLERANCE_MS }),
        fc.integer({ min: 1, max: 3 }),
        (shiftMs, repeats) => {
          // Fixed at 80 bpm: moneyBeat's tightest same-pad spacing there (a
          // 375 ms eighth note) comfortably exceeds 2 * tolerance, so a
          // uniform shift can never make a hit land closer to a neighbouring
          // note than to its own.
          const score = moneyBeat()
          const onsets = grooveOnsetsMs(score, BPM, repeats)
          const hits = onsets.map((o) => hit(o.pad, o.atMs + shiftMs))

          const result = gradeGroovePerformance({ score, bpm: BPM, repeats, hits })

          expect(result.clean).toBe(true)
          for (const row of result.perPad) {
            const mean = row.meanOffsetMs
            invariant(mean !== undefined, 'every row matched, so meanOffsetMs must be defined')
            expect(mean).toBeCloseTo(shiftMs)
            const worst = row.worstOffsetMs
            invariant(worst !== undefined, 'every row matched, so worstOffsetMs must be defined')
            expect(worst).toBeCloseTo(shiftMs)
          }
        },
      ),
    )
  })
})

const hitArb: fc.Arbitrary<RawDrumHit> = fc
  .record({ pad: fc.constantFrom(...PADS), atMs: fc.integer({ min: 0, max: 8000 }) })
  .map(({ pad, atMs }) => hit(pad, atMs))

describe('property: grading is order-independent', () => {
  it('shuffling the hits array never changes the result', () => {
    const hitsAndShuffleArb = fc
      .array(hitArb, { maxLength: 30 })
      .chain((hits) =>
        fc.tuple(
          fc.constant(hits),
          fc.shuffledSubarray(hits, { minLength: hits.length, maxLength: hits.length }),
        ),
      )

    fc.assert(
      fc.property(hitsAndShuffleArb, ([hits, shuffled]) => {
        const score = moneyBeat()
        const baseline = gradeGroovePerformance({ score, bpm: BPM, repeats: REPEATS, hits })
        const afterShuffle = gradeGroovePerformance({
          score,
          bpm: BPM,
          repeats: REPEATS,
          hits: shuffled,
        })
        expect(afterShuffle).toEqual(baseline)
      }),
    )
  })
})

describe('property: matched/missed/extra bookkeeping', () => {
  it('matched + missed === expected, and matched + extra === that pad\'s hit count, for every row', () => {
    fc.assert(
      fc.property(fc.array(hitArb, { maxLength: 30 }), (hits) => {
        const score = moneyBeat()
        const result = gradeGroovePerformance({ score, bpm: BPM, repeats: REPEATS, hits })

        for (const row of result.perPad) {
          const hitCountForPad = hits.filter((h) => h.pad === row.pad).length
          expect(row.matched + row.missed).toBe(row.expected)
          expect(row.matched + row.extra).toBe(hitCountForPad)
        }
      }),
    )
  })
})
