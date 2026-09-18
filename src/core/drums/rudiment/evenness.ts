/**
 * Evenness scoring for the rudiment trainer (roadmap DR-10) — how consistently
 * spaced the learner's strokes were, as a second axis alongside the groove
 * engine's own steady/missed/extra verdict (`isCleanPass` in `rudimentRun.ts`).
 *
 * This is deliberately a thin wrapper, not a second scorer: the piano side's
 * technique drills already solved "how even was this run of onsets" in
 * `@core/technique/evenness.ts`'s `evennessOf` (worst inter-onset gap against
 * the run's own median, scale-invariant above a 500ms median gap and judged
 * on the absolute deviation below it, with fewer than three onsets defined as
 * perfectly even). A rudiment's strokes are exactly that shape of input — an
 * ordered list of onset instants — so this module only names the drum-side
 * threshold and passes the onsets straight through with that function's own
 * defaults.
 */
import { evennessOf } from '@core/technique/evenness.ts'

/**
 * A pass this even or better counts as clean on the evenness axis. Mirrors
 * the piano side's `CLEAN_EVENNESS_THRESHOLD` (`@core/technique/evenness.ts`),
 * which is 0.8 there too — the same bar, not a coincidence: it is the same
 * judgement ("even enough to read as controlled") applied to a different
 * instrument.
 */
export const RUDIMENT_CLEAN_EVENNESS = 0.8

/**
 * Fewer strokes than this carry no evenness evidence: `evennessOf` defines a
 * run of under three onsets as perfectly even (there is no gap to compare),
 * and a readout of "100% even" over an empty or one-stroke run would be a
 * lie. The trainer hides the line below this count.
 */
export const MIN_EVENNESS_STROKES = 3

/**
 * 0..1 evenness of the strokes as played, in onset order. Delegates to
 * `@core/technique/evenness`'s `evennessOf` with its defaults — see that
 * module's own comment for the full model (worst-gap-vs-median, the 500ms
 * reference floor, fewer-than-three-onsets special case).
 */
export function rudimentEvenness(onsetMs: readonly number[]): number {
  return evennessOf(onsetMs)
}

/** Whether `evenness` clears the clean bar for this axis. */
export function isEvenEnough(evenness: number): boolean {
  return evenness >= RUDIMENT_CLEAN_EVENNESS
}
