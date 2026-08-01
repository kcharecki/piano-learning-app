import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildTestScore, SINGLE_NOTE } from '@core/notation/fixtures.ts'
import type { Score, ScoreNote } from '@core/notation/score.ts'
import { InvariantError, at } from '@core/shared/invariant.ts'
import { QUARTER, WHOLE, midi as asMidi, millis as asMillis } from '@core/shared/units.ts'
import { FakeClock } from '@test/fakes.ts'
import {
  ASSESSMENT_DEFAULT_THRESHOLD,
  assess,
  passesThreshold,
  type AssessmentResult,
} from './assessment.ts'
import type { MatchResult } from './matcher.ts'

// -------------------------------------------------------------------- helpers

const TEMPO_BPM = 120

/**
 * Two 4/4 measures at 120bpm: measure 0 spans [0, 2000)ms, measure 1
 * [2000, 4000)ms — a quarter is 500ms and a bar is four quarters.
 *   measure 0: C4 (tick 0 -> 0ms), D4 (tick 480 -> 500ms)
 *   measure 1: E4 (tick 1920 -> 2000ms), F4 (tick 2400 -> 2500ms)
 */
const TWO_MEASURE_SCORE: Score = buildTestScore(
  [
    { midi: 60, startTick: 0 },
    { midi: 62, startTick: QUARTER },
    { midi: 64, startTick: WHOLE },
    { midi: 65, startTick: WHOLE + QUARTER },
  ],
  { id: 'assessment-two-measures', bpm: TEMPO_BPM },
)

const M0_N0 = at(TWO_MEASURE_SCORE.notes, 0)
const M0_N1 = at(TWO_MEASURE_SCORE.notes, 1)
const M1_N0 = at(TWO_MEASURE_SCORE.notes, 2)
const M1_N1 = at(TWO_MEASURE_SCORE.notes, 3)

const dateAt = (epochMs: number): FakeClock => new FakeClock(epochMs)

const mkCorrect = (note: ScoreNote, atMs: number, deviationMs: number): MatchResult => ({
  verdict: 'correct',
  expected: note,
  playedMidi: note.midi,
  timing: Math.abs(deviationMs) <= 50 ? 'onTime' : deviationMs < 0 ? 'early' : 'late',
  deviationMs,
  atMs: asMillis(atMs),
})

const mkWrongPitch = (
  note: ScoreNote,
  atMs: number,
  deviationMs: number,
  playedMidi: number,
): MatchResult => ({
  verdict: 'wrongPitch',
  expected: note,
  playedMidi: asMidi(playedMidi),
  timing: 'onTime',
  deviationMs,
  atMs: asMillis(atMs),
})

const mkMissed = (note: ScoreNote, atMs: number): MatchResult => ({
  verdict: 'missed',
  expected: note,
  atMs: asMillis(atMs),
})

const mkExtra = (atMs: number, playedMidi = 60): MatchResult => ({
  verdict: 'extra',
  playedMidi: asMidi(playedMidi),
  atMs: asMillis(atMs),
})

const measureOf = (result: AssessmentResult, index: number) => at(result.measures, index)

// ------------------------------------------------------------------- timing

describe('assess — timingConsistency measures evenness, not lateness', () => {
  it('scores a uniformly-late player as perfectly consistent', () => {
    const results = [
      mkCorrect(M0_N0, 40, 40),
      mkCorrect(M0_N1, 540, 40),
      mkCorrect(M1_N0, 2040, 40),
      mkCorrect(M1_N1, 2540, 40),
    ]
    const result = assess(TWO_MEASURE_SCORE, results, {
      tempoBpm: TEMPO_BPM,
      date: dateAt(0),
      scoreId: 'run-1',
    })
    expect(result.timingConsistency).toBe(1)
    // The lateness itself is still visible — just on the other metric.
    expect(result.meanAbsDeviationMs).toBe(40)
  })

  it('scores a player alternating +60/-60 as inconsistent, even though it is not the most extreme case', () => {
    const results = [
      mkCorrect(M0_N0, 60, 60),
      mkCorrect(M0_N1, 440, -60),
      mkCorrect(M1_N0, 2060, 60),
      mkCorrect(M1_N1, 2440, -60),
    ]
    const result = assess(TWO_MEASURE_SCORE, results, {
      tempoBpm: TEMPO_BPM,
      date: dateAt(0),
      scoreId: 'run-2',
    })
    // spread (population stdev) of [60,-60,60,-60] is 60; normalised against
    // the matcher's 150ms tolerance: 1 - 60/150 = 0.6.
    expect(result.timingConsistency).toBeCloseTo(0.6, 10)
    expect(result.meanAbsDeviationMs).toBe(60)
  })

  it('rates the uniformly-late player strictly higher than the alternating one', () => {
    const uniform = assess(
      TWO_MEASURE_SCORE,
      [mkCorrect(M0_N0, 40, 40), mkCorrect(M0_N1, 540, 40)],
      { tempoBpm: TEMPO_BPM, date: dateAt(0), scoreId: 'a' },
    )
    const alternating = assess(
      TWO_MEASURE_SCORE,
      [mkCorrect(M0_N0, 60, 60), mkCorrect(M0_N1, 440, -60)],
      { tempoBpm: TEMPO_BPM, date: dateAt(0), scoreId: 'b' },
    )
    expect(uniform.timingConsistency).toBeGreaterThan(alternating.timingConsistency)
  })

  it('is 1 when nothing was timed, and always stays within 0..1', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 0, maxLength: 20 }),
        (deviations) => {
          const results = deviations.map((d, i) => mkCorrect(at(SINGLE_NOTE.notes, 0), i, d))
          const result = assess(SINGLE_NOTE, results, {
            tempoBpm: TEMPO_BPM,
            date: dateAt(0),
            scoreId: 'prop',
          })
          expect(result.timingConsistency).toBeGreaterThanOrEqual(0)
          expect(result.timingConsistency).toBeLessThanOrEqual(1)
        },
      ),
    )
  })

  it('is exactly 1 whenever every timed deviation is identical', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: 1, max: 10 }),
        (value, count) => {
          const results = Array.from({ length: count }, (_, i) =>
            mkCorrect(at(SINGLE_NOTE.notes, 0), i, value),
          )
          const result = assess(SINGLE_NOTE, results, {
            tempoBpm: TEMPO_BPM,
            date: dateAt(0),
            scoreId: 'prop-equal',
          })
          expect(result.timingConsistency).toBe(1)
        },
      ),
    )
  })
})

// ------------------------------------------------------------------- basics

describe('assess — basic reduction', () => {
  it('does not divide by zero on an empty run', () => {
    const result = assess(TWO_MEASURE_SCORE, [], {
      tempoBpm: TEMPO_BPM,
      date: dateAt(0),
      scoreId: 'empty',
    })
    expect(result.accuracy).toBe(1)
    expect(result.timingConsistency).toBe(1)
    expect(result.meanAbsDeviationMs).toBe(0)
    expect(result.counts).toEqual({ correct: 0, wrongPitch: 0, missed: 0, extra: 0 })
    for (const m of result.measures) {
      expect(m.expected).toBe(0)
      expect(m.accuracy).toBe(1)
      expect(m.meanAbsDeviationMs).toBe(0)
      expect(Number.isNaN(m.accuracy)).toBe(false)
      expect(Number.isNaN(m.meanAbsDeviationMs)).toBe(false)
    }
  })

  it('scores a perfect run 1/1', () => {
    const result = assess(SINGLE_NOTE, [mkCorrect(at(SINGLE_NOTE.notes, 0), 0, 0)], {
      tempoBpm: TEMPO_BPM,
      date: dateAt(0),
      scoreId: 'perfect',
    })
    expect(result.accuracy).toBe(1)
    expect(result.counts).toEqual({ correct: 1, wrongPitch: 0, missed: 0, extra: 0 })
    expect(measureOf(result, 0).accuracy).toBe(1)
  })

  it('carries scoreId, tempoBpm and completedAt through from opts', () => {
    const clock = dateAt(1_700_000_000_000)
    const result = assess(SINGLE_NOTE, [], { tempoBpm: 96, date: clock, scoreId: 'my-run' })
    expect(result.scoreId).toBe('my-run')
    expect(result.tempoBpm).toBe(96)
    expect(result.completedAt).toBe(1_700_000_000_000)
  })

  it('rejects an empty scoreId and a non-positive tempo', () => {
    expect(() =>
      assess(SINGLE_NOTE, [], { tempoBpm: TEMPO_BPM, date: dateAt(0), scoreId: '' }),
    ).toThrow(InvariantError)
    expect(() => assess(SINGLE_NOTE, [], { tempoBpm: 0, date: dateAt(0), scoreId: 'x' })).toThrow(
      InvariantError,
    )
  })
})

// ------------------------------------------------------------------- measures

describe('assess — per-measure breakdown', () => {
  it('sums per-measure counts to the overall totals', () => {
    const results: MatchResult[] = [
      mkCorrect(M0_N0, 10, 10),
      mkWrongPitch(M0_N1, 480, -20, 61),
      mkMissed(M1_N0, 2150),
      mkCorrect(M1_N1, 2505, 5),
      mkExtra(100), // falls in measure 0's window [0, 2000)
      mkExtra(2500), // falls in measure 1's window [2000, 4000)
    ]
    const result = assess(TWO_MEASURE_SCORE, results, {
      tempoBpm: TEMPO_BPM,
      date: dateAt(0),
      scoreId: 'sums',
    })

    expect(result.counts).toEqual({ correct: 2, wrongPitch: 1, missed: 1, extra: 2 })
    // accuracy is over EXPECTED notes only (correct+wrongPitch+missed = 4): the two
    // extra presses must not dilute the denominator.
    expect(result.accuracy).toBe(0.5)

    const totals = result.measures.reduce(
      (acc, m) => ({
        correct: acc.correct + m.correct,
        wrongPitch: acc.wrongPitch + m.wrongPitch,
        missed: acc.missed + m.missed,
        extra: acc.extra + m.extra,
      }),
      { correct: 0, wrongPitch: 0, missed: 0, extra: 0 },
    )
    expect(totals).toEqual(result.counts)

    expect(measureOf(result, 0)).toMatchObject({
      correct: 1,
      wrongPitch: 1,
      missed: 0,
      extra: 1,
      expected: 2,
      accuracy: 0.5,
    })
    expect(measureOf(result, 1)).toMatchObject({
      correct: 1,
      wrongPitch: 0,
      missed: 1,
      extra: 1,
      expected: 2,
      accuracy: 0.5,
    })
  })

  it('attributes an extra note to the measure whose time window it fell in, clamping at the edges', () => {
    const results: MatchResult[] = [
      mkExtra(-50), // before measure 0 even starts -> clamps to measure 0
      mkExtra(100), // inside measure 0's window
      mkExtra(2500), // inside measure 1's window
      mkExtra(5000), // past the end of the score -> clamps to the last measure
    ]
    const result = assess(TWO_MEASURE_SCORE, results, {
      tempoBpm: TEMPO_BPM,
      date: dateAt(0),
      scoreId: 'extras',
    })
    expect(measureOf(result, 0).extra).toBe(2)
    expect(measureOf(result, 1).extra).toBe(2)
    expect(result.counts.extra).toBe(4)
  })

  it('yields no NaN for a measure with no expected notes', () => {
    const threeMeasures = buildTestScore(
      [
        { midi: 60, startTick: 0 },
        { midi: 62, startTick: 2 * WHOLE },
      ],
      { id: 'skip-middle-measure', measureCount: 3, bpm: TEMPO_BPM },
    )
    // Notes land in measures 0 and 2 (tick 3840 is measure 2's first tick); measure 1
    // — the middle bar — expects nothing and must not divide by zero computing its stats.
    const note0 = at(threeMeasures.notes, 0)
    const note1 = at(threeMeasures.notes, 1)
    const result = assess(threeMeasures, [mkCorrect(note0, 0, 0), mkCorrect(note1, 4000, 0)], {
      tempoBpm: TEMPO_BPM,
      date: dateAt(0),
      scoreId: 'no-nan',
    })
    expect(result.measures).toHaveLength(3)
    const middle = measureOf(result, 1)
    expect(middle.expected).toBe(0)
    expect(middle.correct).toBe(0)
    expect(middle.accuracy).toBe(1)
    expect(middle.meanAbsDeviationMs).toBe(0)
    expect(Number.isNaN(middle.accuracy)).toBe(false)
    expect(Number.isNaN(middle.meanAbsDeviationMs)).toBe(false)
  })
})

// ---------------------------------------------------------------- threshold

describe('passesThreshold', () => {
  const resultWith = (accuracy: number, timingConsistency: number): AssessmentResult => ({
    scoreId: 's',
    accuracy,
    timingConsistency,
    meanAbsDeviationMs: 0,
    tempoBpm: TEMPO_BPM,
    measures: [],
    counts: { correct: 0, wrongPitch: 0, missed: 0, extra: 0 },
    completedAt: 0,
  })

  it('passes at exactly the default thresholds', () => {
    const result = resultWith(
      ASSESSMENT_DEFAULT_THRESHOLD.accuracy,
      ASSESSMENT_DEFAULT_THRESHOLD.timingConsistency,
    )
    expect(passesThreshold(result)).toBe(true)
  })

  it('fails when either axis is below the default threshold', () => {
    expect(passesThreshold(resultWith(0.85, 1))).toBe(false)
    expect(passesThreshold(resultWith(1, 0.5))).toBe(false)
  })

  it('honours a custom threshold for the axis it overrides and the default for the other', () => {
    const result = resultWith(0.6, 0.75)
    expect(passesThreshold(result)).toBe(false) // 0.6 < default 0.9
    expect(passesThreshold(result, { accuracy: 0.5 })).toBe(true) // 0.6 >= 0.5, 0.75 >= default 0.7
    expect(passesThreshold(result, { accuracy: 0.5, timingConsistency: 0.8 })).toBe(false)
  })
})
