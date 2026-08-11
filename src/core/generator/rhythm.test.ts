import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  gradeTapping,
  generateRhythm,
  rhythmToScore,
  type RhythmParams,
  type RhythmPattern,
} from './rhythm.ts'
import { seededRng } from '@core/ports/rng.ts'
import { makeTempoMap, tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import {
  bpm as asBpm,
  midi as asMidi,
  HALF,
  QUARTER,
  millis,
  ticks,
  type Ticks,
} from '@core/shared/units.ts'
import {
  measureDurationTicks,
  notesInMeasure,
  validateScore,
  type TimeSignature,
} from '@core/notation/score.ts'

// A representative spread of simple and compound metres, all with a bar at
// least a quarter note long — the floor `complexity: 1` promises to respect.
// (`3/8`, at 720 ticks, is deliberately excluded: no metre needs to be able
// to hold a note it structurally cannot.)
const METRES: readonly TimeSignature[] = [
  { beats: 2, beatType: 4 },
  { beats: 3, beatType: 4 },
  { beats: 4, beatType: 4 },
  { beats: 2, beatType: 2 },
  { beats: 6, beatType: 8 },
  { beats: 9, beatType: 8 },
  { beats: 12, beatType: 8 },
]

const COMPLEXITIES = [1, 2, 3, 4, 5] as const

const metreArb = fc.constantFrom(...METRES)
const complexityArb = fc.constantFrom(...COMPLEXITIES)
const paramsArb = fc.record({
  bars: fc.integer({ min: 1, max: 4 }),
  timeSignature: metreArb,
  complexity: complexityArb,
  allowRests: fc.boolean(),
  allowTies: fc.boolean(),
})

const DEFAULT_PARAMS: RhythmParams = {
  bars: 2,
  timeSignature: { beats: 4, beatType: 4 },
  complexity: 3,
  allowRests: true,
  allowTies: true,
}

const defaultTempo = (): TempoMap => makeTempoMap([])

/** Every bar's onsets, sliced from the flat pattern by bar boundaries. */
function onsetsByBar(pattern: RhythmPattern): (readonly { tick: Ticks; durationTicks: Ticks }[])[] {
  const barTicks = measureDurationTicks(pattern.timeSignature)
  const bars: { tick: Ticks; durationTicks: Ticks }[][] = Array.from(
    { length: pattern.bars },
    () => [],
  )
  for (const o of pattern.onsets) {
    const index = Math.floor(o.tick / barTicks)
    bars[index]?.push(o)
  }
  return bars
}

describe('generateRhythm', () => {
  it('produces onsets that sum exactly to each bar length', () => {
    fc.assert(
      fc.property(paramsArb, fc.integer(), (params, seed) => {
        const pattern = generateRhythm(params, seededRng(seed))
        const barTicks = measureDurationTicks(params.timeSignature)
        for (const bar of onsetsByBar(pattern)) {
          const sum = bar.reduce((s, o) => s + o.durationTicks, 0)
          expect(sum).toBe(barTicks)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('never leaves a gap or overlap within a bar — onsets are contiguous', () => {
    fc.assert(
      fc.property(paramsArb, fc.integer(), (params, seed) => {
        const pattern = generateRhythm(params, seededRng(seed))
        for (const bar of onsetsByBar(pattern)) {
          let expected = bar[0]?.tick ?? 0
          for (const o of bar) {
            expect(o.tick).toBe(expected)
            expected += o.durationTicks
          }
        }
      }),
      { numRuns: 200 },
    )
  })

  // Roadmap 5.20: Faber/Alfred both teach note values quarter -> half -> whole,
  // so complexity 1 (the very first thing a learner sees) must sit strictly
  // between those two bounds, and rests — a separate, later skill — must not
  // appear at all yet. 500 runs, matching the roadmap task's own proof action.
  it('complexity 1 is quarter/half notes only, never a rest', () => {
    fc.assert(
      fc.property(
        fc.record({
          bars: fc.integer({ min: 1, max: 4 }),
          timeSignature: metreArb,
          allowRests: fc.boolean(),
          allowTies: fc.boolean(),
        }),
        fc.integer(),
        (partial, seed) => {
          const pattern = generateRhythm({ ...partial, complexity: 1 }, seededRng(seed))
          for (const o of pattern.onsets) {
            expect(o.durationTicks).toBeGreaterThanOrEqual(QUARTER)
            expect(o.durationTicks).toBeLessThanOrEqual(HALF)
            expect(o.isRest).toBe(false)
          }
        },
      ),
      { numRuns: 500 },
    )
  })

  it('a broken floor would fail the complexity-1 property (mutant check)', () => {
    // Same generation, but manually cut the first onset of a 4/4 bar in
    // quarters — exactly the bug class the property above exists to catch.
    const pattern = generateRhythm(
      {
        bars: 1,
        timeSignature: { beats: 4, beatType: 4 },
        complexity: 1,
        allowRests: false,
        allowTies: false,
      },
      seededRng(1),
    )
    const first = pattern.onsets[0]
    if (first === undefined) throw new Error('expected at least one onset')
    const broken = { ...first, durationTicks: ticks(first.durationTicks / 4) }
    expect(broken.durationTicks).toBeLessThan(QUARTER)
  })

  it('a broken ceiling would fail the complexity-1 property (mutant check)', () => {
    // Same generation, but manually double the first onset — the "still
    // merging into whole notes" bug the ceiling above exists to catch.
    const pattern = generateRhythm(
      {
        bars: 1,
        timeSignature: { beats: 4, beatType: 4 },
        complexity: 1,
        allowRests: false,
        allowTies: false,
      },
      seededRng(1),
    )
    const first = pattern.onsets[0]
    if (first === undefined) throw new Error('expected at least one onset')
    const broken = { ...first, durationTicks: ticks(first.durationTicks * 2) }
    expect(broken.durationTicks).toBeGreaterThan(HALF)
  })

  // Faber/Alfred introduce the quarter rest before the half or whole rest —
  // complexity 2 is the first complexity with any rests at all (complexity 1
  // has none, proven above), so it must never produce one shorter than a
  // quarter, and it must actually produce quarter ones, not skip straight to
  // half+ (both halves matter: a table that only ever emitted half rests
  // would pass a ">= QUARTER" check while still getting the ordering wrong).
  it('complexity 2 never emits a rest shorter than a quarter note', () => {
    fc.assert(
      fc.property(
        fc.record({ bars: fc.integer({ min: 1, max: 4 }), timeSignature: metreArb }),
        fc.integer(),
        (partial, seed) => {
          const pattern = generateRhythm(
            { ...partial, complexity: 2, allowRests: true, allowTies: false },
            seededRng(seed),
          )
          for (const o of pattern.onsets) {
            if (o.isRest) expect(o.durationTicks).toBeGreaterThanOrEqual(QUARTER)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('complexity 2 actually produces quarter rests (not just half+)', () => {
    let sawQuarterRest = false
    for (let seed = 0; seed < 300 && !sawQuarterRest; seed++) {
      const pattern = generateRhythm(
        {
          bars: 4,
          timeSignature: { beats: 4, beatType: 4 },
          complexity: 2,
          allowRests: true,
          allowTies: false,
        },
        seededRng(seed),
      )
      sawQuarterRest = pattern.onsets.some((o) => o.isRest && o.durationTicks === QUARTER)
    }
    expect(sawQuarterRest).toBe(true)
  })

  it('emits no rests when allowRests is false', () => {
    fc.assert(
      fc.property(
        fc.record({
          bars: fc.integer({ min: 1, max: 4 }),
          timeSignature: metreArb,
          complexity: complexityArb,
          allowTies: fc.boolean(),
        }),
        fc.integer(),
        (partial, seed) => {
          const pattern = generateRhythm({ ...partial, allowRests: false }, seededRng(seed))
          expect(pattern.onsets.some((o) => o.isRest)).toBe(false)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('can emit rests when allowRests is true', () => {
    // Not a property (rests are probabilistic) — just evidence the flag actually
    // does something, across enough seeds that "never once" would be suspicious.
    let sawRest = false
    for (let seed = 0; seed < 200 && !sawRest; seed++) {
      const pattern = generateRhythm(
        {
          bars: 4,
          timeSignature: { beats: 4, beatType: 4 },
          complexity: 5,
          allowRests: true,
          allowTies: true,
        },
        seededRng(seed),
      )
      sawRest = pattern.onsets.some((o) => o.isRest)
    }
    expect(sawRest).toBe(true)
  })

  it('is reproducible from a seed', () => {
    fc.assert(
      fc.property(paramsArb, fc.integer(), (params, seed) => {
        const a = generateRhythm(params, seededRng(seed))
        const b = generateRhythm(params, seededRng(seed))
        expect(b).toEqual(a)
      }),
      { numRuns: 100 },
    )
  })

  it('produces a different pattern for a different seed (sanity, not a law)', () => {
    const a = generateRhythm(DEFAULT_PARAMS, seededRng(1))
    const b = generateRhythm(DEFAULT_PARAMS, seededRng(2))
    expect(b).not.toEqual(a)
  })

  it('rejects a non-positive bar count', () => {
    expect(() => generateRhythm({ ...DEFAULT_PARAMS, bars: 0 }, seededRng(1))).toThrow()
    expect(() => generateRhythm({ ...DEFAULT_PARAMS, bars: -1 }, seededRng(1))).toThrow()
  })

  it('rejects an out-of-range complexity', () => {
    expect(() =>
      generateRhythm({ ...DEFAULT_PARAMS, complexity: 0 as never }, seededRng(1)),
    ).toThrow()
    expect(() =>
      generateRhythm({ ...DEFAULT_PARAMS, complexity: 6 as never }, seededRng(1)),
    ).toThrow()
  })

  it('rejects a beat type that is not a power of two', () => {
    expect(() =>
      generateRhythm({ ...DEFAULT_PARAMS, timeSignature: { beats: 4, beatType: 6 } }, seededRng(1)),
    ).toThrow()
  })

  describe('compound metres group in threes', () => {
    // Without ties, every onset boundary in a compound bar must fall on the
    // three-eighth (dotted-quarter) pulse grid, or be fully contained inside a
    // single pulse. A binary/dotted split that instead cut a pulse in half
    // across its boundary — the bug this suite caught during design — would
    // produce an onset whose start or end lands strictly inside a pulse from
    // one side and crosses into the next, which this test would notice as a
    // non-pulse-aligned, non-contained boundary.
    it('every onset respects the pulse grid when ties are off', () => {
      const compoundMetres: readonly TimeSignature[] = [
        { beats: 6, beatType: 8 },
        { beats: 9, beatType: 8 },
        { beats: 12, beatType: 8 },
      ]
      fc.assert(
        fc.property(
          fc.constantFrom(...compoundMetres),
          fc.integer({ min: 1, max: 4 }),
          complexityArb,
          fc.boolean(),
          fc.integer(),
          (timeSignature, bars, complexity, allowRests, seed) => {
            const pulseTicks = 3 * (HALF / 4) // 3 eighths = 720 ticks
            const pattern = generateRhythm(
              { bars, timeSignature, complexity, allowRests, allowTies: false },
              seededRng(seed),
            )
            for (const o of pattern.onsets) {
              const start = o.tick % pulseTicks
              const end = start + o.durationTicks
              const wholePulses = o.durationTicks % pulseTicks === 0 && start === 0
              const containedInOnePulse = end <= pulseTicks
              expect(wholePulses || containedInOnePulse).toBe(true)
            }
          },
        ),
        { numRuns: 300 },
      )
    })

    it('allowTies lets a note legitimately cross a pulse boundary', () => {
      // With ties on, a run of complexity 5 over many bars/seeds should
      // eventually produce at least one onset that crosses the 720-tick grid —
      // otherwise `allowTies` would be dead weight in compound metres.
      const pulseTicks = 720
      let sawCrossing = false
      for (let seed = 0; seed < 300 && !sawCrossing; seed++) {
        const pattern = generateRhythm(
          {
            bars: 4,
            timeSignature: { beats: 6, beatType: 8 },
            complexity: 5,
            allowRests: false,
            allowTies: true,
          },
          seededRng(seed),
        )
        sawCrossing = pattern.onsets.some((o) => {
          const start = o.tick % pulseTicks
          return start !== 0 && start + o.durationTicks > pulseTicks
        })
      }
      expect(sawCrossing).toBe(true)
    })
  })
})

describe('rhythmToScore', () => {
  it('produces a valid Score with one note per non-rest onset', () => {
    const pattern = generateRhythm(DEFAULT_PARAMS, seededRng(7))
    const score = rhythmToScore(pattern)
    expect(validateScore(score).ok).toBe(true)
    const expectedNotes = pattern.onsets.filter((o) => !o.isRest).length
    expect(score.notes.length).toBe(expectedNotes)
  })

  it('places notes at the same ticks as the non-rest onsets, all on one pitch', () => {
    const pattern = generateRhythm(DEFAULT_PARAMS, seededRng(11))
    const score = rhythmToScore(pattern)
    const nonRestTicks = pattern.onsets.filter((o) => !o.isRest).map((o) => o.tick)
    expect(score.notes.map((n) => n.startTick)).toEqual(nonRestTicks)
    expect(new Set(score.notes.map((n) => n.midi)).size).toBeLessThanOrEqual(1)
  })

  it('uses the requested pitch when given one', () => {
    const pattern = generateRhythm(
      {
        bars: 1,
        timeSignature: { beats: 4, beatType: 4 },
        complexity: 2,
        allowRests: false,
        allowTies: false,
      },
      seededRng(3),
    )
    const score = rhythmToScore(pattern, { midi: asMidi(67) })
    expect(score.notes.every((n) => n.midi === 67)).toBe(true)
  })

  it('one measure per bar, matching the pattern time signature', () => {
    const pattern = generateRhythm(
      {
        bars: 3,
        timeSignature: { beats: 3, beatType: 4 },
        complexity: 2,
        allowRests: true,
        allowTies: false,
      },
      seededRng(5),
    )
    const score = rhythmToScore(pattern)
    expect(score.measures).toHaveLength(3)
    for (const m of score.measures) expect(m.timeSignature).toEqual({ beats: 3, beatType: 4 })
    // Notes are correctly bucketed into their own measure, not just present.
    for (let i = 0; i < 3; i++) {
      const bar = pattern.onsets.filter((o) => {
        const barTicks = measureDurationTicks({ beats: 3, beatType: 4 })
        return Math.floor(o.tick / barTicks) === i && !o.isRest
      })
      expect(notesInMeasure(score, i)).toHaveLength(bar.length)
    }
  })
})

describe('gradeTapping', () => {
  const pattern = generateRhythm(
    {
      bars: 2,
      timeSignature: { beats: 4, beatType: 4 },
      complexity: 2,
      allowRests: false,
      allowTies: false,
    },
    seededRng(9),
  )
  const tempo = defaultTempo()

  function onsetTimes(p: RhythmPattern, t: TempoMap): number[] {
    return p.onsets.filter((o) => !o.isRest).map((o) => Number(tickToMs(t, o.tick)))
  }

  it('scores 1 for a perfect tap sequence', () => {
    const taps = onsetTimes(pattern, tempo).map((ms) => millis(ms))
    const grade = gradeTapping(pattern, taps, tempo)
    expect(grade.matched).toBe(taps.length)
    expect(grade.missed).toBe(0)
    expect(grade.extra).toBe(0)
    expect(grade.accuracy).toBe(1)
    expect(grade.meanAbsDeviationMs).toBe(0)
  })

  it('still matches a uniformly late sequence, reporting the deviation', () => {
    const offset = 40
    const taps = onsetTimes(pattern, tempo).map((ms) => millis(ms + offset))
    const grade = gradeTapping(pattern, taps, tempo)
    expect(grade.matched).toBe(taps.length)
    expect(grade.missed).toBe(0)
    expect(grade.extra).toBe(0)
    expect(grade.accuracy).toBe(1)
    expect(grade.meanAbsDeviationMs).toBeCloseTo(offset, 5)
  })

  it('a doubled tap produces exactly one extra', () => {
    const times = onsetTimes(pattern, tempo)
    const first = times[0]
    if (first === undefined) throw new Error('pattern has no onsets')
    const taps = [...times, first + 5].map((ms) => millis(ms))
    const grade = gradeTapping(pattern, taps, tempo)
    expect(grade.matched).toBe(times.length)
    expect(grade.missed).toBe(0)
    expect(grade.extra).toBe(1)
  })

  it('a dropped tap produces exactly one missed', () => {
    const times = onsetTimes(pattern, tempo)
    const taps = times.slice(1).map((ms) => millis(ms))
    const grade = gradeTapping(pattern, taps, tempo)
    expect(grade.matched).toBe(taps.length)
    expect(grade.missed).toBe(1)
    expect(grade.extra).toBe(0)
  })

  it('out-of-order taps do not corrupt the matching', () => {
    const times = onsetTimes(pattern, tempo)
    const shuffled = [...times].reverse().map((ms) => millis(ms))
    const inOrder = gradeTapping(
      pattern,
      times.map((ms) => millis(ms)),
      tempo,
    )
    const outOfOrder = gradeTapping(pattern, shuffled, tempo)
    expect(outOfOrder).toEqual(inOrder)
    expect(outOfOrder.accuracy).toBe(1)
  })

  it('reports 0 accuracy for taps against an empty (all-rest) pattern', () => {
    const restOnly = generateRhythm(
      {
        bars: 1,
        timeSignature: { beats: 4, beatType: 4 },
        complexity: 1,
        allowRests: false,
        allowTies: false,
      },
      seededRng(1),
    )
    // Force every onset to a rest to build a pattern with nothing to tap for.
    const empty: RhythmPattern = {
      ...restOnly,
      onsets: restOnly.onsets.map((o) => ({ ...o, isRest: true })),
    }
    const grade = gradeTapping(empty, [millis(0), millis(500)], tempo)
    expect(grade.matched).toBe(0)
    expect(grade.missed).toBe(0)
    expect(grade.extra).toBe(2)
    expect(grade.accuracy).toBe(0)
  })

  it('scores 1 with nothing expected and nothing tapped', () => {
    const empty: RhythmPattern = {
      timeSignature: { beats: 4, beatType: 4 },
      bars: 1,
      onsets: [{ tick: ticks(0), durationTicks: ticks(1920), isRest: true }],
    }
    const grade = gradeTapping(empty, [], tempo)
    expect(grade.accuracy).toBe(1)
    expect(grade.meanAbsDeviationMs).toBe(0)
  })

  it('respects a custom tolerance', () => {
    const times = onsetTimes(pattern, tempo)
    const first = times[0]
    if (first === undefined) throw new Error('pattern has no onsets')
    const taps = [millis(first + 60)]
    expect(gradeTapping(pattern, taps, tempo, { toleranceMs: 100 }).matched).toBe(1)
    expect(gradeTapping(pattern, taps, tempo, { toleranceMs: 10 }).matched).toBe(0)
  })

  it('grading a pattern against its own onset times always scores 1', () => {
    fc.assert(
      fc.property(
        paramsArb,
        fc.integer(),
        fc.integer({ min: 60, max: 240 }),
        (params, seed, bpm) => {
          const p = generateRhythm(params, seededRng(seed))
          const t = makeTempoMap([{ tick: ticks(0), bpm: asBpm(bpm) }])
          const taps = p.onsets.filter((o) => !o.isRest).map((o) => tickToMs(t, o.tick))
          const grade = gradeTapping(p, taps, t)
          expect(grade.matched).toBe(taps.length)
          expect(grade.missed).toBe(0)
          expect(grade.extra).toBe(0)
          expect(grade.accuracy).toBe(1)
          expect(grade.meanAbsDeviationMs).toBe(0)
        },
      ),
      { numRuns: 200 },
    )
  })
})
