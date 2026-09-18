/**
 * Per-groove tightness trend (roadmap DR-23 "tightness trends"): over a
 * groove's most recent runs, the worst-limb timing offset per run, oldest to
 * newest, whether that offset is tightening or loosening, and how many of
 * those runs were steady.
 *
 * Like `limbBias` below in the same package, this trusts `attempts` to
 * already be newest-first (`useDrumsHistoryStore`'s documented and maintained
 * order) rather than re-deriving recency from `at` — see `grooveBests.ts`'s
 * module comment for why that split exists between the two functions here.
 */
import type { GrooveAttemptLike } from './grooveBests.ts'

export type GrooveTrendPoint = {
  readonly at: number
  readonly bpm: number
  readonly steady: boolean
  /** max |meanOffsetMs| over pads with matched > 0 and a defined meanOffsetMs; undefined when no pad qualifies. Rounded to integer ms. */
  readonly worstAbsOffsetMs: number | undefined
}

export type TrendDirection = 'tightening' | 'loosening' | 'flat' | 'unknown'

export type GrooveTrend = {
  readonly grooveId: string
  readonly grooveTitle: string
  /** Oldest first, at most `n` — the `n` MOST RECENT attempts of this groove. */
  readonly points: readonly GrooveTrendPoint[]
  readonly direction: TrendDirection
  readonly steadyCount: number
}

export const DEFAULT_TREND_RUNS = 8
export const TREND_FLAT_MS = 2

function worstAbsOffsetMs(attempt: GrooveAttemptLike): number | undefined {
  if (attempt.pads === undefined) return undefined
  let worst: number | undefined
  for (const pad of attempt.pads) {
    if (pad.matched <= 0 || pad.meanOffsetMs === undefined) continue
    const abs = Math.abs(pad.meanOffsetMs)
    if (worst === undefined || abs > worst) worst = abs
  }
  return worst === undefined ? undefined : Math.round(worst)
}

/**
 * Only points with a defined `worstAbsOffsetMs` are considered; fewer than 4
 * of those is 'unknown'. The rest split into an older half and a newer half
 * (odd count: the middle point joins the newer half), and the two means are
 * compared against `TREND_FLAT_MS`.
 */
function directionOf(points: readonly GrooveTrendPoint[]): TrendDirection {
  const offsets = points
    .map((point) => point.worstAbsOffsetMs)
    .filter((offset): offset is number => offset !== undefined)
  if (offsets.length < 4) return 'unknown'

  const olderCount = Math.floor(offsets.length / 2)
  const older = offsets.slice(0, olderCount)
  const newer = offsets.slice(olderCount)
  const mean = (xs: readonly number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length
  const olderMean = mean(older)
  const newerMean = mean(newer)

  if (newerMean < olderMean - TREND_FLAT_MS) return 'tightening'
  if (newerMean > olderMean + TREND_FLAT_MS) return 'loosening'
  return 'flat'
}

/**
 * `attempts` must be newest-first (the store's order; trust it like
 * `limbBias` does). Per groove: take that groove's first `n` attempts (its
 * most recent), reverse to oldest-first, sorted by the most recent attempt's
 * `at` desc — like `grooveBests`.
 */
export function grooveTrends(
  attempts: readonly GrooveAttemptLike[],
  n = DEFAULT_TREND_RUNS,
): readonly GrooveTrend[] {
  const byGroove = new Map<string, GrooveAttemptLike[]>()
  // The first attempt seen for a groveId, while walking the trusted
  // newest-first order, IS that groove's most recent attempt.
  const mostRecentOf = new Map<string, GrooveAttemptLike>()

  for (const attempt of attempts) {
    const list = byGroove.get(attempt.grooveId)
    if (list === undefined) {
      byGroove.set(attempt.grooveId, [attempt])
      mostRecentOf.set(attempt.grooveId, attempt)
    } else {
      list.push(attempt)
    }
  }

  const results: GrooveTrend[] = []
  for (const [grooveId, list] of byGroove) {
    const recent = list.slice(0, n)
    const oldestFirst = [...recent].reverse()
    const points: GrooveTrendPoint[] = oldestFirst.map((attempt) => ({
      at: attempt.at,
      bpm: attempt.bpm,
      steady: attempt.steady,
      worstAbsOffsetMs: worstAbsOffsetMs(attempt),
    }))

    results.push({
      grooveId,
      grooveTitle: mostRecentOf.get(grooveId)?.grooveTitle ?? grooveId,
      points,
      direction: directionOf(points),
      steadyCount: points.filter((point) => point.steady).length,
    })
  }

  return results.sort((a, b) => (mostRecentOf.get(b.grooveId)?.at ?? 0) - (mostRecentOf.get(a.grooveId)?.at ?? 0))
}
