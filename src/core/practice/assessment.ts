/**
 * Assessment mode (roadmap 2.1, REQ-3.3.4) — a fixed-tempo run-through reduced
 * to the scalar and per-measure numbers a review screen and the progress log
 * need: accuracy, timing consistency, and a per-measure breakdown.
 *
 * This module does no matching of its own. `NoteMatcher` (matcher.ts) already
 * produces a `MatchResult[]` with per-note verdicts and signed timing
 * deviations while the learner plays; `assess()` just reduces that stream
 * once, at the end of the run, into an `AssessmentResult`.
 *
 * ## Timing consistency measures evenness, not lateness
 *
 * A player who is uniformly 40ms behind the beat on every note has a steady
 * internal pulse — the metronome could be resynced to them — and should score
 * high. A player alternating +60ms / -60ms is unpredictable from one note to
 * the next and should score low, even though a naive "average distance from
 * the beat" metric would rate the second player as being off by less than the
 * first is off by on every single note.
 *
 * `timingConsistency` is therefore built from the SPREAD (population standard
 * deviation) of the *signed* deviations around their own mean, not the mean
 * of their absolute values: a constant offset contributes nothing to spread,
 * an alternating one contributes a lot. `meanAbsDeviationMs` is reported
 * separately for exactly the players this metric would otherwise hide —
 * "how far from the beat" and "how consistent" are different axes and a
 * result can be extreme on one while being fine on the other.
 *
 * ## Attributing extra notes to a measure
 *
 * A `wrongPitch`, `correct` or `missed` verdict carries the `ScoreNote` it was
 * decided against, so its measure is just `expected.measureIndex`. An `extra`
 * verdict has no expected note — the press matched nothing — so it is
 * attributed by wall-clock time: the measure whose written time window
 * `[startMs, endMs)` contains `atMs`, using a *flat* tempo map built from
 * `opts.tempoBpm` (assessment mode plays at one fixed tempo, so this is
 * exact for a real assessment run). A press before the first measure or after
 * the last is clamped to the nearest end, so a stray note struck before count
 * -in finishes or after the final barline still lands somewhere countable.
 */
import type { Measure, Score } from '@core/notation/score.ts'
import { at, invariant } from '@core/shared/invariant.ts'
import { bpm as asBpm, ticks as asTicks } from '@core/shared/units.ts'
import { makeTempoMap, tickToMs } from '@core/timing/tempo.ts'
import type { DateSource } from '@core/ports/index.ts'
import { MATCHER_DEFAULTS, type MatchResult } from './matcher.ts'

export type MeasureScore = {
  readonly measureIndex: number
  /** `correct + wrongPitch + missed` — how many notes this measure asked for. */
  readonly expected: number
  readonly correct: number
  readonly wrongPitch: number
  readonly missed: number
  readonly extra: number
  /** `correct / expected`; 1 when the measure expected nothing. */
  readonly accuracy: number
  /** Mean |deviationMs| over this measure's attributed presses; 0 when there were none. */
  readonly meanAbsDeviationMs: number
}

export type AssessmentResult = {
  readonly scoreId: string
  /** 0..1 over all expected notes: `correct / (correct + wrongPitch + missed)`. */
  readonly accuracy: number
  /** 0..1 evenness of timing — see the module doc. 1 when nothing was timed. */
  readonly timingConsistency: number
  readonly meanAbsDeviationMs: number
  readonly tempoBpm: number
  readonly measures: readonly MeasureScore[]
  readonly counts: {
    readonly correct: number
    readonly wrongPitch: number
    readonly missed: number
    readonly extra: number
  }
  /** Epoch ms the assessment finished, from the injected `DateSource`. */
  readonly completedAt: number
}

export type AssessmentThreshold = {
  readonly accuracy?: number
  readonly timingConsistency?: number
}

/**
 * REQ-3.3.4's "used for level checks" needs a pass/fail line somewhere; these
 * are the defaults until curriculum (roadmap 4.x) states per-level numbers.
 * 90% accuracy is the common "essentially clean" bar teachers use for a
 * run-through; 0.7 timing consistency allows the uneven-but-not-alternating
 * spread a nervous first assessment run typically produces.
 */
export const ASSESSMENT_DEFAULT_THRESHOLD: Required<AssessmentThreshold> = {
  accuracy: 0.9,
  timingConsistency: 0.7,
}

/**
 * Normalises the population standard deviation of signed timing deviations to
 * a 0..1 evenness score. Pegged to the matcher's own `toleranceMs` (150ms by
 * default): a spread that wide already means a meaningful share of presses
 * are grazing or missing the matcher's attribution window, so it is defined
 * as maximally inconsistent (0). A spread of 0 — every press the same
 * distance from the beat, whatever that constant distance is — is maximally
 * consistent (1). Linear in between, clamped at both ends.
 */
const TIMING_CONSISTENCY_SCALE_MS = MATCHER_DEFAULTS.toleranceMs

type MeasureWindow = { readonly startMs: number; readonly endMs: number }

type Bucket = {
  correct: number
  wrongPitch: number
  missed: number
  extra: number
  absDeviationSum: number
  deviationCount: number
}

function emptyBucket(): Bucket {
  return { correct: 0, wrongPitch: 0, missed: 0, extra: 0, absDeviationSum: 0, deviationCount: 0 }
}

/** Flat single-tempo ms window for every measure — exact for a fixed-tempo assessment run. */
function measureWindows(measures: readonly Measure[], tempoBpm: number): readonly MeasureWindow[] {
  invariant(
    Number.isFinite(tempoBpm) && tempoBpm > 0,
    `assess: tempoBpm must be a finite number > 0, got ${tempoBpm}`,
  )
  const tempo = makeTempoMap([{ tick: asTicks(0), bpm: asBpm(tempoBpm) }])
  return measures.map((m) => ({
    startMs: tickToMs(tempo, m.startTick),
    endMs: tickToMs(tempo, asTicks(m.startTick + m.durationTicks)),
  }))
}

/** Last measure whose window has started by `atMs`; clamped to 0 for anything earlier. */
function measureIndexForMs(windows: readonly MeasureWindow[], atMs: number): number {
  if (atMs < at(windows, 0).startMs) return 0
  for (let i = windows.length - 1; i >= 0; i--) {
    if (atMs >= at(windows, i).startMs) return i
  }
  return 0
}

function populationStdDev(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function timingConsistencyOf(deviations: readonly number[]): number {
  if (deviations.length === 0) return 1
  const spread = populationStdDev(deviations)
  return Math.min(1, Math.max(0, 1 - spread / TIMING_CONSISTENCY_SCALE_MS))
}

/**
 * Reduce a completed matcher run into a scored, per-measure breakdown.
 * `results` is normally `matcher.results` after the run has finished (every
 * window closed, e.g. via a final `advanceTo`); `assess` itself is pure
 * reduction and does not care whether more verdicts could still arrive.
 */
export function assess(
  score: Score,
  results: readonly MatchResult[],
  opts: { readonly tempoBpm: number; readonly date: DateSource; readonly scoreId: string },
): AssessmentResult {
  invariant(opts.scoreId.length > 0, 'assess: scoreId must not be empty')
  const windows = measureWindows(score.measures, opts.tempoBpm)
  const buckets = score.measures.map(() => emptyBucket())

  let correct = 0
  let wrongPitch = 0
  let missed = 0
  let extra = 0
  const deviations: number[] = []
  let absDeviationSum = 0
  let deviationCount = 0

  for (const r of results) {
    const measureIndex =
      r.expected === undefined ? measureIndexForMs(windows, r.atMs) : r.expected.measureIndex
    const bucket = at(buckets, measureIndex)

    if (r.verdict === 'correct') {
      correct += 1
      bucket.correct += 1
    } else if (r.verdict === 'wrongPitch') {
      wrongPitch += 1
      bucket.wrongPitch += 1
    } else if (r.verdict === 'missed') {
      missed += 1
      bucket.missed += 1
    } else {
      extra += 1
      bucket.extra += 1
    }

    if (r.deviationMs !== undefined) {
      deviations.push(r.deviationMs)
      const abs = Math.abs(r.deviationMs)
      absDeviationSum += abs
      deviationCount += 1
      bucket.absDeviationSum += abs
      bucket.deviationCount += 1
    }
  }

  const measures: MeasureScore[] = score.measures.map((m, i) => {
    const b = at(buckets, i)
    const expected = b.correct + b.wrongPitch + b.missed
    return {
      measureIndex: m.index,
      expected,
      correct: b.correct,
      wrongPitch: b.wrongPitch,
      missed: b.missed,
      extra: b.extra,
      accuracy: expected === 0 ? 1 : b.correct / expected,
      meanAbsDeviationMs: b.deviationCount === 0 ? 0 : b.absDeviationSum / b.deviationCount,
    }
  })

  const expectedTotal = correct + wrongPitch + missed
  return {
    scoreId: opts.scoreId,
    accuracy: expectedTotal === 0 ? 1 : correct / expectedTotal,
    timingConsistency: timingConsistencyOf(deviations),
    meanAbsDeviationMs: deviationCount === 0 ? 0 : absDeviationSum / deviationCount,
    tempoBpm: opts.tempoBpm,
    measures,
    counts: { correct, wrongPitch, missed, extra },
    completedAt: opts.date.epochMillis(),
  }
}

/** REQ-3.3.4's level-check gate: both axes must clear their threshold. */
export function passesThreshold(
  result: AssessmentResult,
  threshold: AssessmentThreshold = {},
): boolean {
  const accuracyBar = threshold.accuracy ?? ASSESSMENT_DEFAULT_THRESHOLD.accuracy
  const timingBar = threshold.timingConsistency ?? ASSESSMENT_DEFAULT_THRESHOLD.timingConsistency
  return result.accuracy >= accuracyBar && result.timingConsistency >= timingBar
}
