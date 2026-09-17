/**
 * The words and math the rhythm reading trainer's result panel is made of
 * (roadmap DR-11). Split out of the hook and the screen for the same reason
 * `resultLines.ts` is split out of the groove trainer: these are pure,
 * `GrooveRunResult` in, values out, so the awkward cases (nothing expected,
 * an offset that rounds to zero, an ungraded run) are unit-testable without a
 * DOM or a running trainer.
 *
 * Every reading exercise is engraved and graded entirely on `'snare'` — see
 * `generateReadingExercise` — so unlike the groove trainer's per-limb result,
 * there is exactly one row to read here.
 */
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'

/** The single pad every reading exercise puts its notes on. */
const READING_PAD = 'snare'

/**
 * 0, not `NaN`, when nothing was expected — kept total rather than partial.
 * `generateReadingExercise` now forces an onset into every bar at every
 * level (roadmap DR-11 review, MAJOR 3), so a real "nothing expected" run
 * should not occur any more; this guard is what stops the division rather
 * than a case this function still expects to see often.
 */
export function accuracyOf(result: GrooveRunResult): number {
  const row = result.pads.find((r) => r.pad === READING_PAD)
  const expected = row?.expected ?? 0
  if (expected === 0) return 0
  return (row?.matched ?? 0) / expected
}

export type ReadingResultLines = {
  readonly verdict: string
  readonly detail: string
}

/** Rounded to the millisecond — see `resultLines.ts`'s own `offsetPhrase` for why. */
function offsetClause(meanOffsetMs: number): string {
  const rounded = Math.round(Math.abs(meanOffsetMs))
  return `${meanOffsetMs < 0 ? 'early' : 'late'} by ${rounded} ms on average`
}

/**
 * The verdict and the one detail line the result panel shows, e.g.
 * "7 of 8 onsets, 1 missed, 2 extra · early by 12 ms on average". The offset
 * clause is omitted entirely when nothing matched — there is no average to
 * report.
 */
export function readingResultLines(result: GrooveRunResult, accuracy: number): ReadingResultLines {
  const verdict =
    accuracy >= 0.9 && result.steady ? 'Clean' : accuracy >= 0.6 ? 'Getting there' : 'Not there yet'

  const row = result.pads.find((r) => r.pad === READING_PAD)
  const expected = row?.expected ?? 0
  const matched = row?.matched ?? 0
  const missed = row?.missed ?? 0
  const extra = row?.extra ?? 0

  const parts = [`${matched} of ${expected} onsets`]
  if (missed > 0) parts.push(`${missed} missed`)
  if (extra > 0) parts.push(`${extra} extra`)
  const detail =
    row?.meanOffsetMs === undefined
      ? parts.join(', ')
      : `${parts.join(', ')} · ${offsetClause(row.meanOffsetMs)}`

  return { verdict, detail }
}

/**
 * One mulberry-friendly LCG step (Numerical Recipes' constants), so `next()`
 * can advance the exercise seed deterministically — a test can predict every
 * exercise `useReadingTrainer` will ever generate from a starting seed
 * without touching `Math.random`.
 */
export function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0
}
