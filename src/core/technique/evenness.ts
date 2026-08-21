/**
 * Technique drill evaluation — REQ-3.7.2 (evenness + target-tempo tracking) and
 * REQ-3.7.3 (per-drill tempo history).
 *
 * `evennessOf` grades **how consistently spaced** a played run's onsets are,
 * nothing else. It deliberately does not know the drill's target tempo: a run
 * played evenly but at the wrong speed still scores 1, because tempo tracking
 * is a separate axis (see `bestCleanBpm`/`tempoHistory`), not a timing-quality
 * axis. Milliseconds are correct here — this grades human timing, exactly like
 * `gradeTapping` in `@core/generator/rhythm.ts`, which this file mirrors in
 * spirit (onsets in, a timing judgement out) without depending on it, since
 * evenness has no reference pattern to match against.
 */
import { at, invariant } from '@core/shared/invariant.ts'

export type TechniqueAttempt = {
  readonly drillId: string
  /** Epoch ms, supplied by the caller. */
  readonly at: number
  readonly bpm: number
  /** 0..1 — evenness of the played onsets. */
  readonly evenness: number
  /** 0..1 — proportion of the drill's notes played correctly. */
  readonly accuracy: number
  readonly clean: boolean
}

export type EvennessOptions = {
  /** An inter-onset gap this far from the median (as a ratio) is judged uneven. Default 0.5. */
  readonly tolerance?: number
}

const DEFAULT_TOLERANCE = 0.5

/**
 * The gap below which the evenness bar stops tightening (roadmap T.10).
 *
 * 500ms is one quarter note at the app's default ♩=120 — the spacing every
 * other timing constant here is implicitly sized against.
 *
 * Without this floor the whole judgement is proportional to the median gap,
 * so the bar moves with the NOTATION rather than with the playing. Measured
 * on the technique drills, the onset jitter a run may carry and still be
 * called clean was ±25.0ms at 500ms spacing, ±16.7ms at 333ms (the broken
 * triad sequence's triplets at ♩=60) and ±10.4ms at 208ms — so re-notating the
 * same physical performance as triplets tightened the bar by a third, and as
 * sixteenths by well over half, without the learner playing any differently.
 * A simulation of 400 runs put a learner with 15ms onset SD at 66% of runs
 * clean when notated in quarters and 5% when notated as triplets. RCM p.7
 * calls its metronome marks "a guideline for the minimum tempo", so a ±17ms
 * gate is a standard the syllabus does not set and we should not invent.
 *
 * Above this spacing the score is unchanged and stays scale-invariant — that
 * is still the right model when the gaps are long enough for a proportional
 * error to be what the ear actually hears. Below it, evenness is judged on
 * the ABSOLUTE deviation instead, against the bar a 500ms-spaced run gets.
 */
export const EVENNESS_REFERENCE_GAP_MS = 500

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return at(sorted, mid)
  return (at(sorted, mid - 1) + at(sorted, mid)) / 2
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/**
 * Evenness of a played run: how consistent the gaps between consecutive onsets
 * are. 1 = perfectly even; 0 = maximally uneven. Judged on the played onsets
 * alone — a run played evenly at the wrong tempo is still perfectly even, and
 * that is deliberate.
 *
 * The score is driven by the *worst* gap's deviation from the run's median
 * gap, measured against `tolerance × max(medianGap,
 * EVENNESS_REFERENCE_GAP_MS)`.
 *
 * While the median gap is at or above the reference, that denominator is
 * `tolerance × medianGap` and the result is scale-invariant: multiplying
 * every onset by a positive constant (playing the identical rhythm twice as
 * fast) multiplies every gap and the median by that same constant, so the
 * ratio — and therefore the score — is unchanged. A plausible-looking stub
 * built on `1 - stddev(gaps)` fails exactly this: doubling the tempo doubles
 * the standard deviation of a perfectly even run while the run is still
 * perfectly even, which is the mutant the property tests below are built to
 * kill.
 *
 * Below the reference the denominator stops shrinking, so the score depends
 * only on the ABSOLUTE deviation — see `EVENNESS_REFERENCE_GAP_MS` for why
 * that is deliberate. Scale invariance is given up there ON PURPOSE: it is
 * exactly the property that let a re-notation change a verdict the playing
 * did not change.
 *
 * Taking the worst gap rather than the mean is what makes the score
 * length-independent: a single note held twice as long is exactly as uneven
 * whether it happens in a 3-onset run or a 29-onset one, because the mean
 * would dilute that one bad gap over however many other, even, gaps there
 * happen to be, and a scale's clean/unclean verdict must not depend on how
 * many octaves it spans.
 *
 * Fewer than three onsets means fewer than two gaps — there is nothing to
 * compare a single gap *against* — so that case is defined as perfectly even
 * (1) rather than left undefined.
 */
export function evennessOf(onsetMs: readonly number[], opts?: EvennessOptions): number {
  const tolerance = opts?.tolerance ?? DEFAULT_TOLERANCE
  invariant(
    Number.isFinite(tolerance) && tolerance > 0,
    `evennessOf: tolerance must be a finite, positive number, got ${String(tolerance)}`,
  )
  if (onsetMs.length < 3) return 1

  const sorted = [...onsetMs].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(at(sorted, i) - at(sorted, i - 1))
  }
  const medianGap = median(gaps)
  // A non-positive median means at least half the gaps are zero or negative —
  // onsets landed on top of each other or out of order — so there is no
  // meaningful "typical gap" to take a ratio against. Scored as maximally
  // uneven rather than dividing by zero or an epsilon that would understate it.
  if (medianGap <= 0) return 0

  // `max(medianGap, ...)`, not `medianGap`: below the reference spacing the
  // bar stops tightening, so the same absolute unevenness keeps the same
  // verdict however the run is notated. Roadmap T.10.
  const scaleGap = Math.max(medianGap, EVENNESS_REFERENCE_GAP_MS)
  const maxDeviation = Math.max(...gaps.map((g) => Math.abs(g - medianGap)))
  return clamp01(1 - maxDeviation / (tolerance * scaleGap))
}

/**
 * Thresholds for REQ-3.7.2's "clean at bpm": even enough that the timing reads
 * as controlled, and accurate enough that (almost) every note was the right
 * one. Chosen so a single missed note in a short drill, or a touch of rubato,
 * does not count — "clean" is meant to be a specific, repeatable bar to clear,
 * the way the requirement's own example ("currently clean at ♩=88") implies.
 */
const CLEAN_EVENNESS_THRESHOLD = 0.8
const CLEAN_ACCURACY_THRESHOLD = 0.95

/** REQ-3.7.2's "clean at bpm": even enough AND accurate enough at that tempo. */
export function isClean(attempt: { evenness: number; accuracy: number }): boolean {
  return (
    attempt.evenness >= CLEAN_EVENNESS_THRESHOLD && attempt.accuracy >= CLEAN_ACCURACY_THRESHOLD
  )
}

export type TempoPoint = { readonly at: number; readonly bpm: number }

/**
 * REQ-3.7.3: the tempo history of one drill, oldest first, one point per
 * attempt already marked clean. `attempt.clean` is trusted as given — it is
 * the caller's job to have set it (typically via {@link isClean}) when the
 * attempt was recorded — so this is a pure filter-and-sort, not a re-judgement.
 */
export function tempoHistory(
  attempts: readonly TechniqueAttempt[],
  drillId: string,
): readonly TempoPoint[] {
  return attempts
    .filter((a) => a.drillId === drillId && a.clean)
    .map((a) => ({ at: a.at, bpm: a.bpm }))
    .sort((a, b) => a.at - b.at)
}

/** The best clean tempo reached, or 0 if never clean. */
export function bestCleanBpm(attempts: readonly TechniqueAttempt[], drillId: string): number {
  const history = tempoHistory(attempts, drillId)
  return history.reduce((max, p) => Math.max(max, p.bpm), 0)
}

/** One drill's clean-tempo history, ready to be drawn as its own line. */
export type DrillTempoSeries = {
  readonly drillId: string
  /** Oldest first, one point per clean attempt of THIS drill. Never empty. */
  readonly points: readonly TempoPoint[]
  /** The best clean tempo in `points`. */
  readonly bestBpm: number
  /** When this drill was last played clean — what the list is ordered by. */
  readonly lastAt: number
}

/**
 * Every drill's clean-tempo history, one series each, most recently practised
 * first.
 *
 * Roadmap T.14: the dashboard used to concatenate these histories into ONE
 * line sorted by time, which is only meaningful if every drill shares a target
 * tempo — and they do not. A clean solid triad run at its target of 72 followed
 * by a clean broken run at its target of 60 drew 72 → 60, so two successes in a
 * row read as getting slower. Splitting by drill is what makes a downward step
 * on a line mean "this drill got slower" again.
 *
 * Drills with no clean attempt are absent rather than present-and-empty: a
 * chart with no points is a chart that says nothing, and the empty state for
 * "you have not been clean at this yet" is different from a trend.
 */
export function tempoSeriesByDrill(
  attempts: readonly TechniqueAttempt[],
): readonly DrillTempoSeries[] {
  const drillIds = Array.from(new Set(attempts.filter((a) => a.clean).map((a) => a.drillId)))
  return drillIds
    .map((drillId) => {
      const points = tempoHistory(attempts, drillId)
      return {
        drillId,
        points,
        bestBpm: points.reduce((max, p) => Math.max(max, p.bpm), 0),
        lastAt: points.reduce((latest, p) => Math.max(latest, p.at), 0),
      }
    })
    .filter((series) => series.points.length > 0)
    .sort((a, b) => b.lastAt - a.lastAt)
}
