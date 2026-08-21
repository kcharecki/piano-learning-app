import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { at, invariant, InvariantError } from '@core/shared/invariant.ts'
import { millis } from '@core/shared/units.ts'
import { makeGrooveScore } from '@core/drums/model/groove.ts'
import { ghostFunkBar, moneyBeat, referenceGrooves } from '@core/drums/model/referenceGrooves.ts'
import { PADS, type DrumPad, type MappedDrumPad } from '@core/drums/model/pad.ts'
import type { RawDrumHit } from '@core/drums/model/hit.ts'
import {
  DEFAULT_GROOVE_TOLERANCE_MS,
  gradeGroovePerformance,
  grooveOnsetsMs,
  grooveToleranceMs,
  STEADY_SPREAD_MS,
  TOLERANCE_GAP_FRACTION,
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
  it('grades complete and steady when every expected onset is played exactly', () => {
    const score = moneyBeat()
    const onsets = grooveOnsetsMs(score, BPM, REPEATS)
    const hits = onsets.map((o) => hit(o.pad, o.atMs))

    const result = gradeGroovePerformance({ score, bpm: BPM, repeats: REPEATS, hits })

    expect(result.complete).toBe(true)
    expect(result.steady).toBe(true)
    expect(result.toleranceMs).toBe(DEFAULT_GROOVE_TOLERANCE_MS)
    expect(result.expectedTotal).toBe(24)
    expect(result.matchedTotal).toBe(24)
    expect(rowFor(result.perPad, 'hhClosed')).toMatchObject({
      expected: 16,
      matched: 16,
      missed: 0,
      extra: 0,
      meanOffsetMs: 0,
      spreadMs: 0,
      steady: true,
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

    expect(result.complete).toBe(false)
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

  it('a pad the groove never asks for appears with expected: 0 and extra hits, and breaks complete', () => {
    const score = moneyBeat()
    const onsets = grooveOnsetsMs(score, BPM, REPEATS)
    const hits = [...onsets.map((o) => hit(o.pad, o.atMs)), hit('crash1', 0)]

    const result = gradeGroovePerformance({ score, bpm: BPM, repeats: REPEATS, hits })

    expect(result.complete).toBe(false)
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

  it('an empty groove has no expected onsets and is never complete, even with no hits', () => {
    const empty = makeGrooveScore({ id: 'empty', measureCount: 1, notes: [] })
    const result = gradeGroovePerformance({ score: empty, bpm: 100, repeats: 1, hits: [] })
    expect(result.expectedTotal).toBe(0)
    expect(result.complete).toBe(false)
    expect(result.perPad).toEqual([])
  })
})

// ----------------------------------------------------------- bias vs. spread

describe('the cancelling-hats case', () => {
  it('alternating 80 ms early / 80 ms late averages to a mean of zero, and is not steady', () => {
    const score = moneyBeat()
    const onsets = grooveOnsetsMs(score, BPM, REPEATS)
    // Only the hi-hat lurches. Kick and snare are played exactly, so whatever
    // the performance verdict says can only be coming from the hat row.
    let hatIndex = 0
    const hits = onsets.map((o) => {
      if (o.pad !== 'hhClosed') return hit(o.pad, o.atMs)
      const lurch = hatIndex % 2 === 0 ? 80 : -80
      hatIndex += 1
      return hit(o.pad, o.atMs + lurch)
    })

    const result = gradeGroovePerformance({ score, bpm: BPM, repeats: REPEATS, hits })

    // 80 ms is inside the window this score admits at 80 bpm, so every hit
    // still matches its own note: the counts see nothing wrong at all.
    expect(result.toleranceMs).toBe(100)
    expect(result.complete).toBe(true)
    expect(result.matchedTotal).toBe(result.expectedTotal)

    const hats = rowFor(result.perPad, 'hhClosed')
    expect(hats.matched).toBe(16)
    expect(hats.meanOffsetMs).toBeCloseTo(0)
    expect(hats.spreadMs).toBeCloseTo(80)
    expect(hats.steady).toBe(false)

    expect(rowFor(result.perPad, 'kick').steady).toBe(true)
    expect(rowFor(result.perPad, 'snare').steady).toBe(true)
    expect(result.steady).toBe(false)
  })

  it('reads steady up to STEADY_SPREAD_MS and stops one millisecond later', () => {
    // Two snare notes 480 ticks apart; bpm 125 makes 1 tick == 1 ms, so they
    // are 480 ms apart and the window stays the flat default. Offsets of 0 and
    // 2 * STEADY_SPREAD_MS put the mean exactly halfway, so the spread is
    // STEADY_SPREAD_MS either side of it.
    const score = makeGrooveScore({
      id: 'spread-boundary',
      measureCount: 1,
      notes: [
        { pad: 'snare', tick: 0, durationTicks: 240 },
        { pad: 'snare', tick: 480, durationTicks: 240 },
      ],
    })
    const grade = (secondOffsetMs: number): PadResult => {
      const result = gradeGroovePerformance({
        score,
        bpm: 125,
        repeats: 1,
        hits: [hit('snare', 0), hit('snare', 480 + secondOffsetMs)],
      })
      return rowFor(result.perPad, 'snare')
    }

    const atBoundary = grade(2 * STEADY_SPREAD_MS)
    expect(atBoundary.matched).toBe(2)
    expect(atBoundary.spreadMs).toBeCloseTo(STEADY_SPREAD_MS)
    expect(atBoundary.steady).toBe(true)

    const justOver = grade(2 * STEADY_SPREAD_MS + 2)
    expect(justOver.matched).toBe(2)
    expect(justOver.spreadMs).toBeCloseTo(STEADY_SPREAD_MS + 1)
    expect(justOver.steady).toBe(false)
  })
})

describe('the wrong-note case', () => {
  /** 120 ticks at 80 bpm — ghostFunkBar's whole grid. */
  const SIXTEENTH_MS = 187.5

  it('caps ghostFunkBar at 80 bpm to 75 ms, narrower than half its own grid', () => {
    expect(grooveToleranceMs(ghostFunkBar(), BPM, 1)).toBe(75)
    expect(grooveToleranceMs(ghostFunkBar(), BPM, REPEATS)).toBe(75)
    // The cap is not something a caller can opt out of by asking for more.
    expect(grooveToleranceMs(ghostFunkBar(), BPM, 1, 150)).toBe(75)
    // The point of the number: two windows do not reach across one gap.
    expect(2 * 75).toBeLessThan(SIXTEENTH_MS)
  })

  it('a hi-hat 100 ms late is honestly missed instead of matched to the next note', () => {
    // 100 ms was the old flat window. At this grid it reaches BOTH the note
    // the learner meant (100 ms away) and the next one (87.5 ms away), and
    // nearest-first matching therefore matched the wrong note and reported the
    // run as slightly EARLY. 100 > 75, so nothing matches now and the row says
    // so.
    const score = ghostFunkBar()
    const onsets = grooveOnsetsMs(score, BPM, 1)
    const hits = onsets.map((o) =>
      o.pad === 'hhClosed' ? hit(o.pad, o.atMs + 100) : hit(o.pad, o.atMs),
    )

    const result = gradeGroovePerformance({ score, bpm: BPM, repeats: 1, hits })

    expect(result.toleranceMs).toBe(75)
    expect(rowFor(result.perPad, 'hhClosed')).toMatchObject({
      expected: 16,
      matched: 0,
      missed: 16,
      extra: 16,
    })
    expect(result.complete).toBe(false)
    expect(result.steady).toBe(false)
  })

  it('a hi-hat displaced by one whole sixteenth never grades 16 of 16', () => {
    // Displaced by exactly one grid step, each hit lands exactly on top of its
    // neighbour, so those 15 aliases are genuinely indistinguishable from the
    // real thing — no window can rescue that. What the grader must not do is
    // hide it: the first note is never played and the last hit falls past the
    // end of the bar, so the row reports a miss and an extra rather than a
    // full house a few milliseconds late.
    const score = ghostFunkBar()
    const onsets = grooveOnsetsMs(score, BPM, 1)
    const hits = onsets.map((o) =>
      o.pad === 'hhClosed' ? hit(o.pad, o.atMs + SIXTEENTH_MS) : hit(o.pad, o.atMs),
    )

    const result = gradeGroovePerformance({ score, bpm: BPM, repeats: 1, hits })

    expect(rowFor(result.perPad, 'hhClosed')).toMatchObject({
      expected: 16,
      matched: 15,
      missed: 1,
      extra: 1,
    })
    expect(result.complete).toBe(false)
    expect(result.steady).toBe(false)
  })
})

describe('a uniformly late run', () => {
  it('is complete AND steady, because the constant could be the machine', () => {
    // Every hit 95 ms behind the click. The fix for the old "Clean run" verdict
    // is not to fail this: audio output latency plus e-kit input latency adds
    // exactly this shape — one constant on every hit — and this module cannot
    // tell that apart from a learner who drags. What it can say for certain is
    // that the pulse was perfectly even, which is what `steady` reports.
    // Disclosing the 95 ms with the latency caveat attached is `attempt.ts`'s
    // job, and `meanOffsetMs` is what it does that with.
    const LATE_MS = 95
    const score = moneyBeat()
    const onsets = grooveOnsetsMs(score, BPM, REPEATS)
    const hits = onsets.map((o) => hit(o.pad, o.atMs + LATE_MS))

    const result = gradeGroovePerformance({ score, bpm: BPM, repeats: REPEATS, hits })

    expect(result.complete).toBe(true)
    expect(result.steady).toBe(true)
    for (const row of result.perPad) {
      expect(row.meanOffsetMs).toBeCloseTo(LATE_MS)
      expect(row.spreadMs).toBeCloseTo(0)
      expect(row.steady).toBe(true)
    }
  })
})

describe('grooveToleranceMs', () => {
  it('returns the requested window when the score is coarse enough to admit it', () => {
    // moneyBeat's tightest same-pad spacing at 80 bpm is a 375 ms eighth, and
    // 0.4 * 375 == 150, so the 100 ms default is already narrow enough.
    expect(grooveToleranceMs(moneyBeat(), BPM, REPEATS)).toBe(DEFAULT_GROOVE_TOLERANCE_MS)
    expect(grooveToleranceMs(moneyBeat(), BPM, REPEATS, 40)).toBe(40)
  })

  it('measures gaps per pad, not globally — kick and hi-hat both land on tick 0', () => {
    const score = moneyBeat()
    const simultaneous = grooveOnsetsMs(score, BPM, 1).filter((o) => o.atMs === 0)
    expect(simultaneous.length).toBeGreaterThan(1)
    // So the smallest GLOBAL gap in this groove is 0, and a global rule would
    // collapse the window to the 1 ms floor. Per pad, it stays usable.
    expect(grooveToleranceMs(score, BPM, 1)).toBe(DEFAULT_GROOVE_TOLERANCE_MS)
  })

  it('a pad with a single onset contributes no gap', () => {
    // bpm 125 makes 1 tick == 1 ms. The hat asks for 120 ms spacing; the kick
    // is played once and can be confused with nothing, so it caps nothing.
    const mixed = makeGrooveScore({
      id: 'one-kick-two-hats',
      measureCount: 1,
      notes: [
        { pad: 'kick', tick: 0, durationTicks: 120 },
        { pad: 'hhClosed', tick: 0, durationTicks: 120 },
        { pad: 'hhClosed', tick: 120, durationTicks: 120 },
      ],
    })
    expect(grooveToleranceMs(mixed, 125, 1)).toBe(48) // floor(0.4 * 120)

    const kickOnly = makeGrooveScore({
      id: 'one-kick',
      measureCount: 1,
      notes: [{ pad: 'kick', tick: 0, durationTicks: 120 }],
    })
    expect(grooveToleranceMs(kickOnly, 125, 1)).toBe(DEFAULT_GROOVE_TOLERANCE_MS)
  })

  it('counts the gap that wraps from the last note of one lap into the next', () => {
    // A one-eighth bar (240 ticks) holding a single kick. At bpm 125 one lap is
    // 240 ms, so the only gap this score has is the one across the loop point
    // — and it exists only once the lap actually repeats.
    const score = makeGrooveScore({
      id: 'one-note-lap',
      timeSignature: { beats: 1, beatType: 8 },
      measureCount: 1,
      notes: [{ pad: 'kick', tick: 0, durationTicks: 240 }],
    })
    expect(grooveToleranceMs(score, 125, 1)).toBe(DEFAULT_GROOVE_TOLERANCE_MS)
    expect(grooveToleranceMs(score, 125, 2)).toBe(96) // floor(0.4 * 240)
  })

  it('never returns less than 1, however absurdly tight the grid gets', () => {
    const score = makeGrooveScore({
      id: 'impossible-grid',
      measureCount: 1,
      notes: [
        { pad: 'hhClosed', tick: 0, durationTicks: 120 },
        { pad: 'hhClosed', tick: 120, durationTicks: 120 },
      ],
    })
    // 120 ticks at 10000 bpm is 1.5 ms, so 0.4 of it floors to 0.
    expect(grooveToleranceMs(score, 10_000, 1)).toBe(1)
  })

  it('refuses a non-positive requested window', () => {
    expect(() => grooveToleranceMs(moneyBeat(), BPM, 1, 0)).toThrow(InvariantError)
    expect(() => grooveToleranceMs(moneyBeat(), BPM, 1, -5)).toThrow(InvariantError)
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
  it('always grades complete, with matchedTotal === expectedTotal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 40, max: 200 }),
        fc.integer({ min: 1, max: 4 }),
        (bpm, repeats) => {
          const score = moneyBeat()
          const onsets = grooveOnsetsMs(score, bpm, repeats)
          const hits = onsets.map((o) => hit(o.pad, o.atMs))

          const result = gradeGroovePerformance({ score, bpm, repeats, hits })

          expect(result.complete).toBe(true)
          expect(result.matchedTotal).toBe(result.expectedTotal)
        },
      ),
    )
  })
})

describe('property: a constant time shift on every hit', () => {
  it('stays complete, with every pad\'s meanOffsetMs/worstOffsetMs equal to the shift', () => {
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

          expect(result.complete).toBe(true)
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

/**
 * The smallest gap between consecutive onsets ON ONE PAD, recomputed here
 * independently of the implementation so the property below is a check and not
 * a restatement. `undefined` when no pad has two onsets to be confused between.
 */
function smallestPerPadGapMs(onsets: readonly { pad: DrumPad; atMs: number }[]): number | undefined {
  const byPad = new Map<DrumPad, number[]>()
  for (const onset of onsets) {
    const list = byPad.get(onset.pad)
    if (list === undefined) byPad.set(onset.pad, [onset.atMs])
    else list.push(onset.atMs)
  }
  let smallest: number | undefined
  for (const times of byPad.values()) {
    const sorted = [...times].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      const gap = at(sorted, i) - at(sorted, i - 1)
      if (smallest === undefined || gap < smallest) smallest = gap
    }
  }
  return smallest
}

describe('property: grooveToleranceMs never admits a two-note ambiguity', () => {
  it('stays in [1, DEFAULT], and two windows never span one gap on the same pad', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...referenceGrooves()),
        fc.integer({ min: 40, max: 200 }),
        fc.integer({ min: 1, max: 4 }),
        (score, bpm, repeats) => {
          const tolerance = grooveToleranceMs(score, bpm, repeats)
          expect(tolerance).toBeGreaterThanOrEqual(1)
          expect(tolerance).toBeLessThanOrEqual(DEFAULT_GROOVE_TOLERANCE_MS)

          const smallestGap = smallestPerPadGapMs(grooveOnsetsMs(score, bpm, repeats))
          invariant(smallestGap !== undefined, 'every reference groove has a pad with two onsets')
          // The whole point: a hit inside one note's window is outside every
          // other note's window on its own pad, so it cannot match the wrong
          // one. The 1 ms floor could break this on an absurd grid, but the
          // tightest reference gap in this range is 75 ms, so it cannot here.
          expect(2 * tolerance).toBeLessThanOrEqual(smallestGap)
          expect(tolerance).toBeLessThanOrEqual(TOLERANCE_GAP_FRACTION * smallestGap)
        },
      ),
    )
  })
})

describe('property: spread is immune to a constant offset', () => {
  it('shifting every hit by one shared constant leaves every pad\'s spreadMs alone', () => {
    // The bound that keeps the comparison honest: per-hit jitter within +-20 ms
    // and a shared shift within +-20 ms puts every hit at most 40 ms from its
    // own note. moneyBeat at 80 bpm admits a 100 ms window and its tightest
    // same-pad spacing is 375 ms, so no hit can cross to a neighbour and the
    // set of matched pairs is identical before and after the shift. Only then
    // does "the spread did not move" mean anything.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -20, max: 20 }), { minLength: 24, maxLength: 24 }),
        fc.integer({ min: -20, max: 20 }),
        (jitter, shiftMs) => {
          const score = moneyBeat()
          const onsets = grooveOnsetsMs(score, BPM, REPEATS)
          expect(onsets.length).toBe(jitter.length)
          const before = gradeGroovePerformance({
            score,
            bpm: BPM,
            repeats: REPEATS,
            hits: onsets.map((o, i) => hit(o.pad, o.atMs + at(jitter, i))),
          })
          const after = gradeGroovePerformance({
            score,
            bpm: BPM,
            repeats: REPEATS,
            hits: onsets.map((o, i) => hit(o.pad, o.atMs + at(jitter, i) + shiftMs)),
          })

          expect(before.complete).toBe(true)
          expect(after.complete).toBe(true)
          for (const row of after.perPad) {
            const baseline = rowFor(before.perPad, row.pad)
            expect(row.matched).toBe(baseline.matched)

            const spread = row.spreadMs
            const baselineSpread = baseline.spreadMs
            invariant(
              spread !== undefined && baselineSpread !== undefined,
              'every row matched, so spreadMs must be defined',
            )
            expect(spread).toBeCloseTo(baselineSpread)

            const mean = row.meanOffsetMs
            const baselineMean = baseline.meanOffsetMs
            invariant(
              mean !== undefined && baselineMean !== undefined,
              'every row matched, so meanOffsetMs must be defined',
            )
            // The mean is the half that DOES move — that asymmetry is the
            // reason the verdict is judged on the other one.
            expect(mean).toBeCloseTo(baselineMean + shiftMs)
          }
        },
      ),
    )
  })
})
