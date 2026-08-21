/**
 * The words the groove trainer's result panel is made of (roadmap DR-09/T.17).
 *
 * Split out of the screen because these sentences are the feature: "which limb
 * was off" is the whole claim, and a sentence that is only reachable by
 * driving a browser is a sentence nobody tests the edges of. Everything here
 * is pure — a `GrooveRunResult` in, strings out — so the awkward cases (a pad
 * that landed nothing, an offset that rounds to zero, a pad the groove never
 * asked for) are unit-testable without a DOM.
 *
 * ## Two rules the copy has to hold
 *
 * **A pad line always names a number.** `Hi-hat — 16 of 16` with nothing after
 * it tells a learner they were right without telling them how right; the
 * offset (or what went wrong) always follows the count.
 *
 * **The diagnosis is capped at two sentences.** The grader can find four
 * things wrong at once, and a screen that lists all four is a screen that
 * chooses nothing for the learner to fix. Worst first, then stop.
 */
import {
  worstUnisonGap,
  type GroovePadResult,
  type GrooveRunResult,
} from '@core/drums/practice/grade.ts'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { GROOVE_PAD_LABEL } from './padLabels.ts'

/** How many diagnosis sentences the panel will show at once. See the module comment. */
export const MAX_DIAGNOSIS_SENTENCES = 2

/**
 * "Steady", not "clean" or "accurate": everything measured here includes the
 * machine's own latency, which shifts every stroke by the same constant. The
 * verdict is therefore about spread and drift — things a constant cannot fake
 * — and the word has to promise only that.
 */
export function verdictText(result: GrooveRunResult): string {
  return result.steady ? 'Steady run' : 'Not there yet'
}

/** Rounded to the millisecond, because tenths of a millisecond are below what any of this can resolve. */
function offsetPhrase(meanOffsetMs: number): string {
  const rounded = Math.round(Math.abs(meanOffsetMs))
  if (rounded === 0) return 'dead on'
  return `${rounded} ms ${meanOffsetMs > 0 ? 'late' : 'early'}`
}

/**
 * One pad's line: its count, then its own offset, then what it got wrong.
 *
 * A pad with `expected === 0` is one the learner played that this groove never
 * asks for. "0 of 0" would read as a pass, so that row says what it is.
 */
export function padLineText(row: GroovePadResult): string {
  const label = GROOVE_PAD_LABEL[row.pad]
  if (row.expected === 0) return `${label} — not in this groove, ${row.extra} extra`

  // Always non-empty: `matched > 0` gives an offset, and `matched === 0` with
  // something expected gives a miss.
  const parts: string[] = []
  if (row.meanOffsetMs !== undefined) parts.push(offsetPhrase(row.meanOffsetMs))
  if (row.missed > 0) parts.push(`${row.missed} missed`)
  if (row.extra > 0) parts.push(`${row.extra} extra`)
  return `${label} — ${row.matched} of ${row.expected}, ${parts.join(', ')}`
}

/**
 * What one grid step is called at this groove's density, so a phase slip can be
 * reported in musical units rather than as "1 step".
 */
function stepName(plan: GrooveRunPlan): string {
  const perBeat = plan.beatMs / plan.subdivisionMs
  if (perBeat >= 3.5) return 'sixteenth'
  if (perBeat >= 1.5) return 'eighth'
  return 'beat'
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The pad furthest past `limit` on `metric`, or `undefined` when none is past it. */
function worstOver(
  pads: readonly GroovePadResult[],
  metric: (row: GroovePadResult) => number | undefined,
  limit: number,
): GroovePadResult | undefined {
  let worst: GroovePadResult | undefined
  let worstValue = limit
  for (const row of pads) {
    const value = metric(row)
    if (value === undefined || value <= worstValue) continue
    worst = row
    worstValue = value
  }
  return worst
}

/**
 * Why the run was not steady, worst cause first — empty for a steady run,
 * because a learner who got it right does not need a list of things that were
 * nearly wrong.
 */
export function diagnosisSentences(
  result: GrooveRunResult,
  plan: GrooveRunPlan,
): readonly string[] {
  if (result.steady) return []

  // Checked on hits, not on matches (T.17.8): a run where nothing registered
  // and a run where everything landed in the wrong place both have zero
  // matches, and only one of them is a rig problem.
  if (result.totalHits === 0) {
    return [
      'Nothing registered at all. Tap a pad now — if it does not light up and sound, the run could not see it either.',
    ]
  }

  const sentences: string[] = []

  if (result.slipSteps !== undefined) {
    const steps = Math.abs(result.slipSteps)
    const direction = result.slipSteps > 0 ? 'behind' : 'ahead of'
    sentences.push(
      `The whole pattern sat ${plural(steps, stepName(plan))} ${direction} the click. The pattern is right; where you came in is not.`,
    )
  }

  const flam = worstUnisonGap(result)
  if (flam !== undefined) {
    const [first, second] = flam.pads
    sentences.push(
      `${GROOVE_PAD_LABEL[first]} and ${GROOVE_PAD_LABEL[second]} are written on the same stroke here, and you played them ${Math.round(flam.gapMs)} ms apart.`,
    )
  }

  const loose = worstOver(result.pads, (row) => row.spreadMs, result.limits.spreadMs)
  if (loose !== undefined) {
    sentences.push(
      `${GROOVE_PAD_LABEL[loose.pad]} scattered ${Math.round(loose.spreadMs ?? 0)} ms around its own average, against a ${Math.round(result.limits.spreadMs)} ms budget. That is the limb to slow down for.`,
    )
  }

  const drifting = worstOver(result.pads, (row) => Math.abs(row.driftMs ?? 0), result.limits.driftMs)
  if (drifting !== undefined) {
    const drift = drifting.driftMs ?? 0
    sentences.push(
      `${GROOVE_PAD_LABEL[drifting.pad]} moved ${Math.round(Math.abs(drift))} ms ${drift > 0 ? 'later' : 'earlier'} between the first half of the run and the second.`,
    )
  }

  return sentences.slice(0, MAX_DIAGNOSIS_SENTENCES)
}

/** The one-line summary of a stored attempt, shown when the learner comes back to the screen. */
export function lastRunText(title: string, bpm: number, steady: boolean): string {
  return `Last run: ${title} at ${bpm} bpm — ${steady ? 'steady' : 'not there yet'}`
}
