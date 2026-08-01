import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildTestScore } from '@test/fixtures.ts'
import type { Score, ScoreNote } from '@core/notation/score.ts'
import { at } from '@core/shared/invariant.ts'
import { QUARTER, millis as asMillis } from '@core/shared/units.ts'
import { MAX_TEMPO_SCALE, MIN_TEMPO_SCALE } from '@core/timing/tempo.ts'
import { FakeClock } from '@test/fakes.ts'
import { assess, type AssessmentResult, type MeasureScore } from './assessment.ts'
import type { MatchResult } from './matcher.ts'
import {
  problemMeasures,
  suggestedLoops,
  suggestedTempoScale,
  type ProblemMeasure,
} from './review.ts'

// -------------------------------------------------------------------- helpers

const dateAt = (epochMs: number): FakeClock => new FakeClock(epochMs)

const mkCorrect = (note: ScoreNote, atMs: number, deviationMs: number): MatchResult => ({
  verdict: 'correct',
  expected: note,
  playedMidi: note.midi,
  timing: Math.abs(deviationMs) <= 50 ? 'onTime' : deviationMs < 0 ? 'early' : 'late',
  deviationMs,
  atMs: asMillis(atMs),
})

/** One 4/4 measure at 120bpm, four quarter notes — used by the timing-only case. */
const ONE_MEASURE_SCORE: Score = buildTestScore(
  [
    { midi: 60, startTick: 0 },
    { midi: 62, startTick: QUARTER },
    { midi: 64, startTick: 2 * QUARTER },
    { midi: 65, startTick: 3 * QUARTER },
  ],
  { id: 'review-one-measure', bpm: 120 },
)

/** Ten empty 4/4 measures — indices 0..9 — for exercising loop merging and clamping. */
const TEN_MEASURE_SCORE: Score = buildTestScore([], {
  id: 'review-ten-measures',
  measureCount: 10,
})

function measureScore(overrides: Partial<MeasureScore> & { measureIndex: number }): MeasureScore {
  return {
    expected: 0,
    correct: 0,
    wrongPitch: 0,
    missed: 0,
    extra: 0,
    accuracy: 1,
    meanAbsDeviationMs: 0,
    ...overrides,
  }
}

function resultWith(
  measures: readonly MeasureScore[],
  overrides: Partial<AssessmentResult> = {},
): AssessmentResult {
  return {
    scoreId: 'review-test',
    accuracy: 1,
    timingConsistency: 1,
    meanAbsDeviationMs: 0,
    tempoBpm: 120,
    measures,
    counts: { correct: 0, wrongPitch: 0, missed: 0, extra: 0 },
    completedAt: 0,
    ...overrides,
  }
}

function pm(
  measureIndex: number,
  overrides: Partial<Omit<ProblemMeasure, 'measureIndex'>> = {},
): ProblemMeasure {
  return { measureIndex, severity: 0.5, reasons: ['accuracy'], ...overrides }
}

// -------------------------------------------------------------- problemMeasures

describe('problemMeasures — a flawless run', () => {
  it('yields no problems', () => {
    const results = [
      mkCorrect(at(ONE_MEASURE_SCORE.notes, 0), 0, 0),
      mkCorrect(at(ONE_MEASURE_SCORE.notes, 1), 500, 0),
      mkCorrect(at(ONE_MEASURE_SCORE.notes, 2), 1000, 0),
      mkCorrect(at(ONE_MEASURE_SCORE.notes, 3), 1500, 0),
    ]
    const result = assess(ONE_MEASURE_SCORE, results, {
      tempoBpm: 120,
      date: dateAt(0),
      scoreId: 'flawless',
    })
    expect(problemMeasures(result)).toEqual([])
  })
})

describe('problemMeasures — severity combines accuracy and timing', () => {
  it('flags a 100%-accurate but wildly uneven measure on timing alone', () => {
    // Alternating +/-80ms: every note is struck correctly, but the measure's
    // mean absolute deviation (80ms) is well past the matcher's 50ms on-time
    // band. A severity that only looked at accuracy would score this measure
    // a flat 0 and hide it entirely.
    const results = [
      mkCorrect(at(ONE_MEASURE_SCORE.notes, 0), 80, 80),
      mkCorrect(at(ONE_MEASURE_SCORE.notes, 1), 420, -80),
      mkCorrect(at(ONE_MEASURE_SCORE.notes, 2), 1080, 80),
      mkCorrect(at(ONE_MEASURE_SCORE.notes, 3), 1420, -80),
    ]
    const result = assess(ONE_MEASURE_SCORE, results, {
      tempoBpm: 120,
      date: dateAt(0),
      scoreId: 'timing-only',
    })
    expect(at(result.measures, 0).accuracy).toBe(1)

    const problems = problemMeasures(result)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ measureIndex: 0, reasons: ['timing'] })
    // min(1, 80/150) * 0.3 (the timing weight)
    expect(at(problems, 0).severity).toBeCloseTo(0.16, 5)
  })

  it('tags wrong pitches, missed notes and extra presses as separate reasons', () => {
    const wrongOnly = measureScore({ measureIndex: 0, expected: 2, correct: 1, wrongPitch: 1 })
    const missedOnly = measureScore({ measureIndex: 1, expected: 2, correct: 0, missed: 2 })
    const extraOnly = measureScore({ measureIndex: 2, extra: 3 })
    const result = resultWith([wrongOnly, missedOnly, extraOnly])

    const byIndex = new Map(problemMeasures(result).map((p) => [p.measureIndex, p]))
    expect(byIndex.get(0)?.reasons).toEqual(['accuracy'])
    expect(byIndex.get(1)?.reasons).toEqual(['missed'])
    expect(byIndex.get(2)?.reasons).toEqual(['extra'])
  })
})

describe('problemMeasures — ranking and options', () => {
  // A: wrongPitch 1/2 -> severity 0.5*0.4 = 0.2, index 2
  // B: missed 2/2     -> severity 1.0*0.4 = 0.4, index 0
  // C: extra 3        -> severity 1.0*0.2 = 0.2, index 1
  const A = measureScore({ measureIndex: 2, expected: 2, correct: 1, wrongPitch: 1 })
  const B = measureScore({ measureIndex: 0, expected: 2, correct: 0, missed: 2 })
  const C = measureScore({ measureIndex: 1, extra: 3 })
  const result = resultWith([A, B, C])

  it('ranks the worst measure first, ties broken by measure order', () => {
    const problems = problemMeasures(result)
    expect(problems.map((p) => p.measureIndex)).toEqual([0, 1, 2])
    expect(at(problems, 0).severity).toBeCloseTo(0.4, 5)
    expect(at(problems, 1).severity).toBeCloseTo(0.2, 5)
    expect(at(problems, 2).severity).toBeCloseTo(0.2, 5)
  })

  it('respects max', () => {
    const problems = problemMeasures(result, { max: 2 })
    expect(problems.map((p) => p.measureIndex)).toEqual([0, 1])
  })

  it('respects minSeverity', () => {
    const problems = problemMeasures(result, { minSeverity: 0.3 })
    expect(problems.map((p) => p.measureIndex)).toEqual([0])
  })

  it('rejects a non-positive max', () => {
    expect(() => problemMeasures(result, { max: 0 })).toThrow()
  })
})

// --------------------------------------------------------------- suggestedLoops

describe('suggestedLoops — merging', () => {
  it('merges adjacent problem measures into one loop instead of three', () => {
    const problems = [pm(4, { severity: 0.3 }), pm(5, { severity: 0.5 }), pm(6, { severity: 0.4 })]
    const loops = suggestedLoops(TEN_MEASURE_SCORE, problems, { contextBars: 0 })
    expect(loops).toHaveLength(1)
    expect(loops[0]).toMatchObject({ startMeasure: 4, endMeasure: 6 })
  })

  it('pads an isolated problem with context on both sides by default', () => {
    const loops = suggestedLoops(TEN_MEASURE_SCORE, [pm(5, { reasons: ['timing'] })])
    expect(loops).toHaveLength(1)
    expect(loops[0]).toMatchObject({
      startMeasure: 4,
      endMeasure: 6,
      reason: 'measure 6: timing',
    })
  })

  it('describes a merged loop with the union of its reasons, in a fixed order', () => {
    const problems = [pm(4, { reasons: ['timing'] }), pm(5, { reasons: ['accuracy', 'missed'] })]
    const loops = suggestedLoops(TEN_MEASURE_SCORE, problems, { contextBars: 0 })
    expect(at(loops, 0).reason).toBe('measures 5-6: accuracy, timing, missed')
  })

  it('does not merge problem measures separated by a real gap', () => {
    const problems = [pm(2), pm(6)]
    const loops = suggestedLoops(TEN_MEASURE_SCORE, problems, { contextBars: 0 })
    expect(loops).toHaveLength(2)
  })
})

describe('suggestedLoops — a loop never extends past the score', () => {
  it('clamps context that would run off the start', () => {
    const loops = suggestedLoops(TEN_MEASURE_SCORE, [pm(0)], { contextBars: 2 })
    expect(loops).toEqual([expect.objectContaining({ startMeasure: 0, endMeasure: 2 })])
  })

  it('clamps context that would run off the end', () => {
    const loops = suggestedLoops(TEN_MEASURE_SCORE, [pm(9)], { contextBars: 2 })
    expect(loops).toEqual([expect.objectContaining({ startMeasure: 7, endMeasure: 9 })])
  })

  it('never produces an out-of-range loop, for any single problem measure and context width', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 5 }),
        (measureIndex, contextBars) => {
          const loops = suggestedLoops(TEN_MEASURE_SCORE, [pm(measureIndex)], { contextBars })
          const loop = at(loops, 0)
          expect(loop.startMeasure).toBeGreaterThanOrEqual(0)
          expect(loop.endMeasure).toBeLessThanOrEqual(9)
          expect(loop.startMeasure).toBeLessThanOrEqual(loop.endMeasure)
        },
      ),
    )
  })
})

describe('suggestedLoops — maxLoops', () => {
  it('keeps the worst loops when there are more groups than maxLoops', () => {
    const problems = [pm(0, { severity: 0.9 }), pm(4, { severity: 0.3 }), pm(8, { severity: 0.6 })]
    const loops = suggestedLoops(TEN_MEASURE_SCORE, problems, { contextBars: 0, maxLoops: 2 })
    expect(loops).toHaveLength(2)
    expect(loops.map((l) => l.startMeasure)).toEqual([0, 8])
  })

  it('rejects a non-positive maxLoops', () => {
    expect(() => suggestedLoops(TEN_MEASURE_SCORE, [pm(0)], { maxLoops: 0 })).toThrow()
  })

  it('rejects a negative contextBars', () => {
    expect(() => suggestedLoops(TEN_MEASURE_SCORE, [pm(0)], { contextBars: -1 })).toThrow()
  })
})

describe('suggestedLoops — no problems', () => {
  it('returns nothing', () => {
    expect(suggestedLoops(TEN_MEASURE_SCORE, [])).toEqual([])
  })
})

// ---------------------------------------------------------------- tempo scale

describe('suggestedTempoScale', () => {
  it('is 1 for a flawless run', () => {
    const result = resultWith([], { accuracy: 1, timingConsistency: 1 })
    expect(suggestedTempoScale(result)).toBe(1)
  })

  it('is driven by whichever axis is worse, not accuracy alone', () => {
    const badAccuracy = resultWith([], { accuracy: 0, timingConsistency: 1 })
    const badTiming = resultWith([], { accuracy: 1, timingConsistency: 0 })
    expect(suggestedTempoScale(badAccuracy)).toBe(MIN_TEMPO_SCALE)
    expect(suggestedTempoScale(badTiming)).toBe(MIN_TEMPO_SCALE)
  })

  it('is always within the range the transport accepts', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (accuracy, timingConsistency) => {
          const scale = suggestedTempoScale(resultWith([], { accuracy, timingConsistency }))
          expect(scale).toBeGreaterThanOrEqual(MIN_TEMPO_SCALE)
          expect(scale).toBeLessThanOrEqual(MAX_TEMPO_SCALE)
        },
      ),
    )
  })

  it('never suggests a faster tempo for a worse run', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a1, t1, a2, t2) => {
          const worse = resultWith([], { accuracy: a1, timingConsistency: t1 })
          const better = resultWith([], { accuracy: a2, timingConsistency: t2 })
          if (Math.min(a1, t1) > Math.min(a2, t2)) return
          expect(suggestedTempoScale(worse)).toBeLessThanOrEqual(suggestedTempoScale(better))
        },
      ),
    )
  })
})
