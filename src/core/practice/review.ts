/**
 * Post-run review (roadmap 2.2, REQ-3.3.5) — turns a completed `AssessmentResult`
 * into the things a review screen shows and a "practice this" button acts on:
 * which measures went badly, where to loop, and how much to slow down.
 *
 * ## Severity combines accuracy and timing, not just accuracy
 *
 * `assess()`'s own doc explains why timing has to be judged on evenness, not
 * lateness (see assessment.ts); the same principle applies here one level up.
 * A measure played with 100% accuracy but wildly uneven timing is still a
 * measure worth practising slowly — accuracy alone would score it a perfect
 * zero and hide it from the list entirely. `severityOf` therefore adds a
 * timing component to every measure's score, sourced from `meanAbsDeviationMs`
 * (the only per-measure timing figure `assess()` produces — there is no
 * per-measure spread to draw on, only the aggregate one over the whole run).
 *
 * Each defect type — wrong pitches, missed notes, stray extra notes, uneven
 * timing — is scored as its own component and tagged with its own reason, so
 * `reasons` always explains exactly what `severity` is built from; nothing
 * contributes to the number without also appearing in the list.
 *
 * ## Loops merge adjacent problems instead of stacking one-bar loops
 *
 * `suggestedLoops` pads every problem measure with `contextBars` on each side
 * and merges any two padded ranges that touch or overlap — three consecutive
 * problem measures become one loop spanning all three plus context, not three
 * separate one-bar loops fighting for the same few seconds of playing. Padding
 * is clamped to the score, so a problem on the first or last measure never
 * asks the transport to loop past either end.
 */
import type { Measure, Score } from '@core/notation/score.ts'
import { invariant } from '@core/shared/invariant.ts'
import { clampScale, MIN_TEMPO_SCALE } from '@core/timing/tempo.ts'
import { MATCHER_DEFAULTS } from './matcher.ts'
import type { AssessmentResult, MeasureScore } from './assessment.ts'

export type ProblemReason = 'accuracy' | 'timing' | 'missed' | 'extra'

export type ProblemMeasure = {
  readonly measureIndex: number
  readonly severity: number
  readonly reasons: readonly ProblemReason[]
}

export type SuggestedLoop = {
  readonly startMeasure: number
  readonly endMeasure: number
  readonly reason: string
}

// ---------------------------------------------------------------- severity

/**
 * How much each defect type contributes to a measure's severity, tuned so no
 * single axis alone can reach the top of the scale — a measure needs one bad
 * defect or several lesser ones to rank as the worst kind of problem. Wrong
 * and missed notes are weighted heaviest because they are outright wrong;
 * timing and stray extra notes are real but more forgivable problems.
 */
const ACCURACY_WEIGHT = 0.4
const MISSED_WEIGHT = 0.4
const TIMING_WEIGHT = 0.3
const EXTRA_WEIGHT = 0.2

/**
 * Below this mean absolute deviation, a measure is not flagged for timing at
 * all — pegged to the matcher's own `onTimeMs` band (50ms by default): inside
 * it every note already counted as on-time, so there is nothing to report.
 */
const TIMING_REASON_THRESHOLD_MS = MATCHER_DEFAULTS.onTimeMs

/**
 * Mean absolute deviation at which the timing component alone maxes out.
 * Pegged to the matcher's `toleranceMs` (150ms), the same scale `assess()`
 * uses to normalise `timingConsistency` — a spread that wide already means
 * presses are grazing the matcher's attribution window.
 */
const TIMING_SEVERITY_SCALE_MS = MATCHER_DEFAULTS.toleranceMs

/** Stray extra notes at which the extra component alone maxes out. */
const EXTRA_SEVERITY_SCALE = 3

function severityOf(m: MeasureScore): { severity: number; reasons: readonly ProblemReason[] } {
  const reasons: ProblemReason[] = []
  let severity = 0

  if (m.expected > 0 && m.wrongPitch > 0) {
    reasons.push('accuracy')
    severity += (m.wrongPitch / m.expected) * ACCURACY_WEIGHT
  }
  if (m.expected > 0 && m.missed > 0) {
    reasons.push('missed')
    severity += (m.missed / m.expected) * MISSED_WEIGHT
  }
  if (m.meanAbsDeviationMs > TIMING_REASON_THRESHOLD_MS) {
    reasons.push('timing')
    severity += Math.min(1, m.meanAbsDeviationMs / TIMING_SEVERITY_SCALE_MS) * TIMING_WEIGHT
  }
  if (m.extra > 0) {
    reasons.push('extra')
    severity += Math.min(1, m.extra / EXTRA_SEVERITY_SCALE) * EXTRA_WEIGHT
  }

  return { severity: Math.min(1, severity), reasons }
}

/**
 * Measures worth flagging on the review screen, worst first. A measure with
 * nothing wrong never appears — `minSeverity` (default 0) only raises the bar
 * further, it cannot lower it below "has at least one reason".
 */
export function problemMeasures(
  result: AssessmentResult,
  opts: { readonly max?: number; readonly minSeverity?: number } = {},
): readonly ProblemMeasure[] {
  const minSeverity = opts.minSeverity ?? 0
  const max = opts.max ?? Number.POSITIVE_INFINITY
  invariant(
    Number.isFinite(minSeverity),
    `problemMeasures: minSeverity must be finite, got ${minSeverity}`,
  )
  invariant(max > 0, `problemMeasures: max must be > 0, got ${max}`)

  const scored: ProblemMeasure[] = []
  for (const m of result.measures) {
    const { severity, reasons } = severityOf(m)
    if (reasons.length === 0 || severity < minSeverity) continue
    scored.push({ measureIndex: m.measureIndex, severity, reasons })
  }
  scored.sort((a, b) => b.severity - a.severity || a.measureIndex - b.measureIndex)
  return scored.slice(0, max)
}

// ------------------------------------------------------------------- loops

const DEFAULT_CONTEXT_BARS = 1

const REASON_ORDER: readonly ProblemReason[] = ['accuracy', 'timing', 'missed', 'extra']

/** `"measure 3: accuracy"` for one, `"measures 2-5: accuracy, timing"` for a merged run. */
function describeLoop(members: readonly ProblemMeasure[]): string {
  const present = new Set<ProblemReason>()
  for (const m of members) for (const r of m.reasons) present.add(r)
  const reasons = REASON_ORDER.filter((r) => present.has(r)).join(', ')

  const indices = members.map((m) => m.measureIndex)
  const lo = Math.min(...indices)
  const hi = Math.max(...indices)
  const where = lo === hi ? `measure ${lo}` : `measures ${lo}-${hi}`
  return `${where}: ${reasons}`
}

type Group = { start: number; end: number; members: ProblemMeasure[] }

/**
 * Pad each problem to `[measureIndex - contextBars, measureIndex + contextBars]`,
 * clamped to the score, then merge ranges that touch or overlap. Problems are
 * processed in measure order, so each new range only ever needs to check
 * against the group it could possibly continue.
 */
function groupProblems(
  problems: readonly ProblemMeasure[],
  measures: readonly Measure[],
  contextBars: number,
): readonly Group[] {
  const lastIndex = measures.length - 1
  const sorted = [...problems].sort((a, b) => a.measureIndex - b.measureIndex)
  const groups: Group[] = []
  for (const p of sorted) {
    const start = Math.max(0, p.measureIndex - contextBars)
    const end = Math.min(lastIndex, p.measureIndex + contextBars)
    const open = groups[groups.length - 1]
    // `+ 1`: ranges that only touch (no gap between them) still merge, so a
    // run of adjacent problem measures never produces back-to-back loops with
    // a one-bar seam between them.
    if (open !== undefined && start <= open.end + 1) {
      open.end = Math.max(open.end, end)
      open.members.push(p)
    } else {
      groups.push({ start, end, members: [p] })
    }
  }
  return groups
}

/**
 * Practice loops for the review screen: adjacent or overlapping problem
 * measures (once padded with `contextBars` bars of context on each side)
 * merge into one loop rather than several one-bar loops. Sorted by the worst
 * severity a loop contains, worst first, then capped at `maxLoops`.
 */
export function suggestedLoops(
  score: Score,
  problems: readonly ProblemMeasure[],
  opts: { readonly maxLoops?: number; readonly contextBars?: number } = {},
): readonly SuggestedLoop[] {
  const contextBars = opts.contextBars ?? DEFAULT_CONTEXT_BARS
  const maxLoops = opts.maxLoops ?? Number.POSITIVE_INFINITY
  invariant(
    Number.isInteger(contextBars) && contextBars >= 0,
    `suggestedLoops: contextBars must be a whole number >= 0, got ${contextBars}`,
  )
  invariant(maxLoops > 0, `suggestedLoops: maxLoops must be > 0, got ${maxLoops}`)
  if (problems.length === 0 || score.measures.length === 0) return []

  const groups = groupProblems(problems, score.measures, contextBars)
  const ranked = groups
    .map((g) => ({
      startMeasure: g.start,
      endMeasure: g.end,
      reason: describeLoop(g.members),
      worstSeverity: Math.max(...g.members.map((m) => m.severity)),
    }))
    .sort((a, b) => b.worstSeverity - a.worstSeverity)

  return ranked.slice(0, maxLoops).map(({ startMeasure, endMeasure, reason }) => ({
    startMeasure,
    endMeasure,
    reason,
  }))
}

// ------------------------------------------------------------------- tempo

/**
 * REQ-3.3.5: a practice tempo to retry the run at, slower in proportion to how
 * rough it was. Driven by whichever axis is worse — accuracy or timing
 * consistency — the same "neither axis alone tells the story" principle
 * `assess()` itself is built on. A flawless run (both axes at 1) suggests no
 * change (scale 1); the worse the worse axis, the closer the suggestion
 * creeps toward `MIN_TEMPO_SCALE`, linearly. Always run through `clampScale`,
 * so the transport can accept the result outright.
 */
export function suggestedTempoScale(result: AssessmentResult): number {
  const worstAxis = Math.min(result.accuracy, result.timingConsistency)
  const badness = 1 - worstAxis
  return clampScale(1 - badness * (1 - MIN_TEMPO_SCALE))
}
