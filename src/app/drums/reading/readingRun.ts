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
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { displayOffsetMs } from '@core/drums/practice/betweenGrid.ts'
import { plural } from '@app/drums/groove/resultLines.ts'

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
  readonly slip?: string
}

/** Rounded to the millisecond — see `resultLines.ts`'s own `offsetPhrase` for why. */
function offsetClause(meanOffsetMs: number): string {
  const rounded = Math.round(Math.abs(meanOffsetMs))
  return `${meanOffsetMs < 0 ? 'early' : 'late'} by ${rounded} ms on average`
}

/**
 * The ratio (`beatMs / nominalSubdivisionMs`, i.e. grid steps per beat) each
 * named sub-beat grid this codebase generates today has. Levels 1–7's cell
 * vocab is built from these exact ticks (see `subdivisionTicks`'s own doc),
 * so every ratio a real plan produces should land on one of these within
 * `RATIO_TOLERANCE` — but nothing *enforces* that (round-3 review, R1 of
 * this round: `resultLines.ts`'s `stepName` only had three buckets and
 * silently misnamed the two ratios not in its list — 3 as "eighth" and 4/3
 * as "beat" — rather than refusing to guess). `readingSlipQuantity` below
 * never delegates to `stepName` any more; a ratio that matches nothing here
 * falls through to the beat branch's two-decimal fallback instead of a
 * wrong word.
 */
const SUB_BEAT_GRID_NAMES: ReadonlyArray<{ readonly ratio: number; readonly name: string }> = [
  { ratio: 2, name: 'eighth' },
  { ratio: 4, name: 'sixteenth' },
  { ratio: 3, name: 'triplet eighth' },
  { ratio: 4 / 3, name: 'dotted eighth' },
  { ratio: 8, name: 'thirty-second' },
  { ratio: 6, name: 'triplet sixteenth' },
]

const RATIO_TOLERANCE = 1e-6

/**
 * `count` as an exact integer when it rounds to one (floating-point noise —
 * e.g. a ratio that "should" be 2 landing on 1.9999999999998 — read as the
 * whole number it is), else rounded to `decimals` places, worded onto
 * `'beat'` via `plural`.
 */
function formatBeatCount(rawCount: number, decimals: number): string {
  const nearWhole = Math.round(rawCount * 1e6) / 1e6
  const factor = 10 ** decimals
  const count = Number.isInteger(nearWhole) ? nearWhole : Math.round(rawCount * factor) / factor
  return plural(count, 'beat')
}

/**
 * Round-2 review R1: `resultLines.ts`'s `stepName` names anything from a beat
 * up to a whole loop's gap "beat" — it was built for the groove trainer,
 * where a whole-pattern slip is capped at `MAX_SLIP_STEPS` NOMINAL grid
 * steps of a score that is always at least eighth-note dense. A reading
 * exercise at low levels is not: level 1 is quarters and quarter rests only,
 * so two onsets a half note apart (`nominalSubdivisionMs` a whole beat or
 * more) are common, and "1 beat" for a two-beat slip underreports it by
 * half. This computes the actual quantity instead of borrowing the groove
 * trainer's coarsest-bucket name — and (round 3) that includes the sub-beat
 * side too: `stepName` only ever said "eighth" or "sixteenth" below a beat,
 * which is wrong for the triplet and dotted grids levels 5–7 introduce (see
 * `SUB_BEAT_GRID_NAMES`'s doc). `readingSlipQuantity` no longer calls
 * `stepName` at all; every word it produces comes from a ratio this module
 * names itself, or (last resort, an unrecognised ratio) a plain beat
 * fraction.
 *
 * The beat branch (`nominalSubdivisionMs >= beatMs`, i.e. a whole beat or
 * coarser) only ever sees ratios that are multiples of 0.5 today — the
 * finest grid below level 4 is an eighth, and every gap above a beat is
 * built from whole/half-beat cells — which is why one decimal place never
 * loses precision there. The sub-beat branch names the grid by its beat
 * ratio from `SUB_BEAT_GRID_NAMES` instead of assuming a step count.
 * Nothing in the type system enforces either assumption, so an
 * unrecognised ratio (sub-beat or not) falls back to the beat branch with
 * two decimal places — coarser wording than a named grid, but never a
 * wrong one.
 */
export function readingSlipQuantity(steps: number, beatMs: number, nominalSubdivisionMs: number): string {
  const stepsPerBeat = beatMs / nominalSubdivisionMs // > 1 for a sub-beat grid, <= 1 for a beat or coarser

  if (stepsPerBeat > 1) {
    const named = SUB_BEAT_GRID_NAMES.find((entry) => Math.abs(entry.ratio - stepsPerBeat) < RATIO_TOLERANCE)
    if (named !== undefined) return plural(steps, named.name)
  }

  // count = steps * (nominalSubdivisionMs / beatMs) = steps / stepsPerBeat,
  // for both the ordinary beat branch and an unrecognised sub-beat ratio.
  const rawCount = steps / stepsPerBeat
  return formatBeatCount(rawCount, stepsPerBeat > 1 ? 2 : 1)
}

/**
 * The sentence naming a whole-pattern slip, e.g. "You sat 2 beats ahead of
 * the click. Most of your onsets were on the grid, 2 beats early." — the
 * reading trainer's own wording for `resultLines.ts`'s `diagnosisSentences`
 * slip clause, because a reading run is always steady-or-not on a single
 * grid position (one pad, never swung — see the module comment), so the
 * groove trainer's per-limb framing does not apply here. `undefined` when
 * `result.slipSteps` is `undefined` or `0` — see `readingResultLines`.
 *
 * Round-2 review:
 * R2 — "Every onset was on the grid" claimed a coverage `runSlipSteps` never
 * promises: `SLIP_COVERAGE` (0.75) accepts a whole-pattern vote from as few
 * as three quarters of the onsets agreeing, so up to a quarter can be
 * missing entirely and this sentence still fires. "Most of your onsets"
 * is the claim the grader actually backs.
 * R3 — the tail used to hard-code "one ${unit}" regardless of `steps`,
 * so a two-step slip read "...one eighth late" under its own "2 eighths"
 * opening. Both halves now share the same `readingSlipQuantity` call.
 */
function slipSentence(slipSteps: number, plan: Pick<GrooveRunPlan, 'beatMs' | 'nominalSubdivisionMs'>): string {
  const quantity = readingSlipQuantity(Math.abs(slipSteps), plan.beatMs, plan.nominalSubdivisionMs)
  const direction = slipSteps > 0 ? 'behind' : 'ahead of'
  const lateOrEarly = slipSteps > 0 ? 'late' : 'early'
  return `You sat ${quantity} ${direction} the click. Most of your onsets were on the grid, ${quantity} ${lateOrEarly}.`
}

/**
 * DR-07 between-grid (DR-08/DR-11): the reading trainer's own wording for
 * `betweenGridSentence` (`@app/drums/groove/resultLines.ts`) — see that
 * function's doc and `GroovePadResult.looseOffsetMs` for why this band gets
 * its own sentence rather than folding into "missed". A reading run is
 * always graded on the single `'snare'` row (see the module comment), so
 * there is no per-pad choice to make here the way the groove trainer's
 * `worstLooseOffsetPad` makes one — this is called with that row's own
 * `looseOffsetMs` whenever it is defined.
 *
 * By construction this and `slipSentence` can never both apply to the same
 * run: `GroovePadResult.looseOffsetMs` is only ever computed (`grade.ts`)
 * when that pad's own `displacementSteps` is `undefined` AND the whole run's
 * `slipSteps` is `undefined` — so `readingResultLines` below only ever
 * reaches this branch after already handling (and returning out of) the
 * `slipSteps !== undefined && slipSteps !== 0` case first.
 */
function looseOffsetSentence(
  looseOffsetMs: number,
  plan: Pick<GrooveRunPlan, 'windowMs' | 'beatMs' | 'nominalSubdivisionMs'>,
): string {
  // AMBER-b/AMBER-c (review): the number is `displayOffsetMs` now, not a
  // local `roundTen` — it never rounds below "the window plus 10", so the
  // sentence's own "outside the N ms window" clause can't contradict the
  // number right next to it, and it tolerates the float noise
  // `nominalSubdivisionMs` can carry at some tempos (see that function's doc).
  const rounded = displayOffsetMs(looseOffsetMs, plan.windowMs)
  const behind = looseOffsetMs > 0
  const quantity = readingSlipQuantity(1, plan.beatMs, plan.nominalSubdivisionMs)
  return (
    `You sat about ${rounded} ms ${behind ? 'behind' : 'ahead of'} the click on most onsets — ` +
    `outside the ${Math.round(plan.windowMs)} ms window, short of ${quantity}.`
  )
}

/**
 * The verdict, the one detail line, and (DR-08) a third sentence naming a
 * whole-pattern slip, e.g. "7 of 8 onsets, 1 missed, 2 extra · early by 12 ms
 * on average". The offset clause is omitted entirely when nothing matched —
 * there is no average to report — and also (round 2) whenever a slip
 * sentence fires: `runSlipSteps` only ever agrees on a whole-pattern shift
 * from MATCHED hits re-tried at that shift, which pulls the raw mean back
 * toward 0 ms in exactly this case, so a "· late by 0 ms on average" clause
 * next to "You sat 2 beats ahead of the click" would read as a
 * contradiction rather than a second data point. The slip sentence is the
 * `slip` key, and it is present only when `result.slipSteps` is defined and
 * non-zero — a run with no whole-grid-step displacement (or one this grader
 * could not pin down) gets no `slip` key at all (never `slip: undefined`,
 * per `exactOptionalPropertyTypes`), so a caller can test for the sentence
 * with `'slip' in lines`.
 */
export function readingResultLines(
  result: GrooveRunResult,
  accuracy: number,
  plan: Pick<GrooveRunPlan, 'windowMs' | 'beatMs' | 'nominalSubdivisionMs'>,
): ReadingResultLines {
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

  const slipSteps = result.slipSteps
  if (slipSteps === undefined || slipSteps === 0) {
    // DR-07 between-grid: named only once the whole-pattern slip vote above
    // has already been ruled out — see `looseOffsetSentence`'s own doc for
    // why the two can never both apply. Same treatment as a whole-step slip:
    // the offset clause is dropped from `detail`, because `looseOffsetMs` is
    // itself the same kind of "beyond window, short of a grid step" figure
    // the slip branch already argued a plain "· late by N ms" clause would
    // contradict right next to.
    if (row?.looseOffsetMs !== undefined) {
      const detail = parts.join(', ')
      return { verdict, detail, slip: looseOffsetSentence(row.looseOffsetMs, plan) }
    }
    const detail =
      row?.meanOffsetMs === undefined
        ? parts.join(', ')
        : `${parts.join(', ')} · ${offsetClause(row.meanOffsetMs)}`
    return { verdict, detail }
  }

  const detail = parts.join(', ')
  return { verdict, detail, slip: slipSentence(slipSteps, plan) }
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
