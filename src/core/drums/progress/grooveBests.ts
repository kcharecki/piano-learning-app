/**
 * Groove-run aggregates (roadmap DR-23 "drums progress MVP"): the best
 * steady tempo per groove, and which limb tends early/late over the most
 * recent runs.
 *
 * `GrooveAttemptLike` is a structural echo of `DrumsGrooveAttempt`
 * (`@core/drums/practice/attempt.ts`) rather than an import of it, and
 * `MappedDrumPad` is the only piece actually imported: the real type lives
 * fine inside `@core`, but `attempt.ts`'s own fields aside from `pad` are not
 * needed here, and keeping this module's input structural means it never has
 * to change shape just because `attempt.ts` grows another optional field.
 */
import type { MappedDrumPad } from '@core/drums/model/pad.ts'

export type GrooveAttemptPadLike = {
  readonly pad: MappedDrumPad
  readonly expected: number
  readonly matched: number
  /** Positive is late. Absent when nothing on this pad matched. */
  readonly meanOffsetMs?: number
}

export type GrooveAttemptLike = {
  readonly grooveId: string
  readonly grooveTitle: string
  readonly bpm: number
  /** epoch ms */
  readonly at: number
  readonly steady: boolean
  readonly pads?: readonly GrooveAttemptPadLike[]
}

export type GrooveBest = {
  readonly grooveId: string
  readonly grooveTitle: string
  /** Max `bpm` over steady attempts; `undefined` if none of this groove's attempts were steady. */
  readonly bestSteadyBpm: number | undefined
  readonly attempts: number
  /** Max `at` over this groove's attempts. */
  readonly lastAt: number
}

/**
 * One row per distinct `grooveId`, ordered by `lastAt` desc. `grooveTitle`
 * is read off the most recent attempt (max `at`), since a groove can be
 * renamed and an older attempt's stored title would then be stale.
 *
 * Takes `attempts` in whatever order the caller has them — unlike
 * `limbBias` below, nothing here depends on "most recent N", so every
 * attempt is looked at and `at` alone decides recency.
 */
export function grooveBests(attempts: readonly GrooveAttemptLike[]): readonly GrooveBest[] {
  const byGroove = new Map<string, GrooveAttemptLike[]>()
  for (const attempt of attempts) {
    const list = byGroove.get(attempt.grooveId)
    if (list === undefined) byGroove.set(attempt.grooveId, [attempt])
    else list.push(attempt)
  }

  const results: GrooveBest[] = []
  for (const [grooveId, list] of byGroove) {
    const mostRecent = list.reduce((latest, attempt) => (attempt.at > latest.at ? attempt : latest))
    let bestSteadyBpm: number | undefined
    for (const attempt of list) {
      if (!attempt.steady) continue
      if (bestSteadyBpm === undefined || attempt.bpm > bestSteadyBpm) bestSteadyBpm = attempt.bpm
    }
    results.push({
      grooveId,
      grooveTitle: mostRecent.grooveTitle,
      bestSteadyBpm,
      attempts: list.length,
      lastAt: mostRecent.at,
    })
  }

  return results.sort((a, b) => b.lastAt - a.lastAt)
}

export type LimbBias = {
  readonly pad: MappedDrumPad
  readonly meanMs: number
  readonly samples: number
}

/**
 * `attempts` must already be newest-first — the same order
 * `useDrumsHistoryStore`'s `attempts` are documented and maintained in
 * (`addAttempt` prepends). This function trusts that order rather than
 * re-deriving it from `at`, so it takes literally `attempts.slice(0, n)`.
 *
 * Over those `n` most recent attempts, every pad hit with a defined
 * `meanOffsetMs` and `matched > 0` is folded in, weighted by `matched`:
 * `meanMs = sum(meanOffsetMs * matched) / sum(matched)`, `samples = sum(matched)`.
 * Rows are sorted by `|meanMs|` desc; a pad that never qualifies (`samples`
 * would be 0) is omitted rather than emitted at 0.
 */
export function limbBias(attempts: readonly GrooveAttemptLike[], n = 10): readonly LimbBias[] {
  const recent = attempts.slice(0, n)
  const sums = new Map<MappedDrumPad, { weighted: number; matched: number }>()

  for (const attempt of recent) {
    if (attempt.pads === undefined) continue
    for (const padAttempt of attempt.pads) {
      if (padAttempt.meanOffsetMs === undefined || padAttempt.matched <= 0) continue
      const entry = sums.get(padAttempt.pad) ?? { weighted: 0, matched: 0 }
      entry.weighted += padAttempt.meanOffsetMs * padAttempt.matched
      entry.matched += padAttempt.matched
      sums.set(padAttempt.pad, entry)
    }
  }

  const rows: LimbBias[] = []
  for (const [pad, { weighted, matched }] of sums) {
    if (matched === 0) continue
    rows.push({ pad, meanMs: weighted / matched, samples: matched })
  }

  return rows.sort((a, b) => Math.abs(b.meanMs) - Math.abs(a.meanMs))
}
