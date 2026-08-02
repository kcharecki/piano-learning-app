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
 * The score is driven by the *worst* gap's ratio to the run's median gap, not
 * the mean ratio across all gaps. That ratio is what makes the result
 * scale-invariant: multiplying every onset by a positive constant (playing
 * the identical rhythm twice as fast) multiplies every gap and the median by
 * that same constant, so every ratio — and therefore the score — is
 * unchanged. A plausible-looking stub built on `1 - stddev(gaps)` fails
 * exactly this: doubling the tempo doubles the standard deviation of a
 * perfectly even run while the run is still perfectly even, which is the
 * mutant the property tests below are built to kill.
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

  const maxRelDeviation = Math.max(...gaps.map((g) => Math.abs(g - medianGap) / medianGap))
  return clamp01(1 - maxRelDeviation / tolerance)
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
