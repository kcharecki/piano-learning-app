/**
 * Dashboard data (roadmap 4.7, REQ-3.10.1/REQ-3.10.2) — reads what the app has
 * already persisted and reduces it for display, using the core functions
 * rather than recomputing any of the underlying music-theory/streak/
 * retention logic itself.
 *
 * Three of REQ-3.10.1's six sections have no real data source anywhere in the
 * app yet, and this hook is honest about that rather than fabricating a
 * number:
 *
 *  - **Technique tempo trends**: no store persists a `TechniqueAttempt` list
 *    anywhere (there is no writer — no screen calls `evennessOf`/`isClean`
 *    and saves the result). `techniqueAttempts` is always `[]`.
 *  - **Repertoire status**: no store persists a `RepertoirePiece` list either
 *    (roadmap 4.9's content and its screen are not built). `repertoirePieces`
 *    is always `[]`, so `repertoireDue` (via `maintenanceDue`) is always `[]`.
 *  - **Current level per track + exit criteria (REQ-3.10.2)**: there is no
 *    persisted `LevelState` anywhere (no store, no manual-override UI) and no
 *    shipped curriculum content (roadmap 4.9) to supply a `CurriculumLevel`'s
 *    `exitCriteria` — `trackProgress`/`canAdvance` both require one and
 *    cannot be called meaningfully without it. Only sight-reading has a real
 *    persisted level (`useSightReadingStore`); the other two tracks report
 *    `undefined` (never a fabricated 1) and an empty criteria list;
 *    `curriculumAvailable` is `false` so the screen can render an explicit
 *    "nothing to check yet" instead of a blank checklist.
 *
 * The other three sections (practice streak & weekly time, sight-reading
 * accuracy trend, theory retention) read real, already-persisted state:
 * `useProgressStore`'s `practiceEntries`, `useSightReadingStore`'s
 * `level`/`history`, and `useFlashcardStore`'s `cardsById` filtered to the
 * theory-drill kinds (`key-signature-*`, `interval-on-staff-*` ids) — the
 * store also holds reading-drill cards (`note-name`, `staff-to-key`), which
 * are excluded so "Theory retention" does not overstate itself.
 */
import { useMemo } from 'react'
import type { DateSource } from '@core/ports/index.ts'
import {
  currentStreakDays,
  dailyTotals,
  longestStreakDays,
  minutesByKind,
  totalMinutes,
  type ActivityKind,
} from '@core/progress/log.ts'
import { DAY_MS, retentionStats, type RetentionStats } from '@core/srs/scheduler.ts'
import { TRACKS, type Track } from '@core/curriculum/types.ts'
import type { CriterionStatus } from '@core/progress/levels.ts'
import { tempoHistory, bestCleanBpm, type TechniqueAttempt, type TempoPoint } from '@core/technique/evenness.ts'
import type { RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'

const WEEK_DAYS = 7

export type UseDashboardOptions = {
  /** Wall-clock reading for "now". Defaults to the real browser clock. */
  readonly date?: DateSource
  /**
   * Minutes to ADD to a UTC epoch-ms timestamp to get local wall-clock time —
   * the same convention `@core/progress/log.ts` uses. Defaults to the
   * browser's own offset (`-new Date().getTimezoneOffset()`); tests pass a
   * fixed value so streak/daily-total assertions never depend on the host
   * machine's timezone.
   */
  readonly utcOffsetMinutes?: number
}

export type SightReadingTrendPoint = {
  readonly at: number
  readonly accuracy: number
}

export type DashboardTrackLevel = {
  readonly track: Track
  /**
   * `undefined` when no persisted level source exists yet for this track —
   * the screen renders "not tracked yet", never a fabricated 1. Only
   * sight-reading has a persisted level today (`useSightReadingStore`).
   */
  readonly level: number | undefined
  /** Always `[]` until a `LevelState` store and shipped curriculum content exist — see the module comment. */
  readonly criteria: readonly CriterionStatus[]
}

export type TechniqueTrendPoint = TempoPoint & { readonly drillId: string }

export type DashboardData = {
  readonly now: number
  readonly streak: { readonly currentDays: number; readonly longestDays: number }
  /** Total practice minutes in the trailing 7 days ending at `now`. */
  readonly weeklyMinutes: number
  readonly minutesByKind: Record<ActivityKind, number>
  /**
   * One point per local calendar day touched by the trailing 7*24h window,
   * oldest first, zero-filled. That is 7 or 8 buckets depending on what time
   * of day "now" is — `dailyTotals`'s own well-defined behaviour, not
   * rounded off here.
   */
  readonly dailyMinutes: readonly { readonly date: string; readonly minutes: number }[]
  readonly sightReadingLevel: number
  /** Oldest first. `[]` until at least one sight-reading run has been graded. */
  readonly sightReadingTrend: readonly SightReadingTrendPoint[]
  readonly retention: RetentionStats
  /** Always `[]` — see the module comment. */
  readonly techniqueAttempts: readonly TechniqueAttempt[]
  /**
   * Clean-tempo history across every drill in `techniqueAttempts`, oldest
   * first — always `[]` today since `techniqueAttempts` is always `[]`, but
   * computed from the real core functions so the section goes live the
   * moment a writer exists, with no further change needed here.
   */
  readonly techniqueTrend: readonly TechniqueTrendPoint[]
  /** Best clean bpm reached per drill id — always `{}` today, see `techniqueTrend`. */
  readonly techniqueBestBpmByDrill: Readonly<Record<string, number>>
  /** Always `[]` — see the module comment. */
  readonly repertoirePieces: readonly RepertoirePiece[]
  /** Always `[]` — `repertoirePieces` has no writer yet, so there is nothing to compute maintenance-due status over. */
  readonly repertoireDue: readonly RepertoirePiece[]
  readonly levels: readonly DashboardTrackLevel[]
  /** `false` until a `LevelState` store and shipped curriculum content exist — see the module comment. */
  readonly curriculumAvailable: boolean
}

const defaultDate: DateSource = { epochMillis: () => Date.now() }

export function useDashboard(options: UseDashboardOptions = {}): DashboardData {
  const date = options.date ?? defaultDate
  const utcOffsetMinutes = options.utcOffsetMinutes ?? -new Date().getTimezoneOffset()

  const practiceEntries = useProgressStore((s) => s.practiceEntries)
  const sightReadingLevel = useSightReadingStore((s) => s.level)
  const sightReadingHistory = useSightReadingStore((s) => s.history)
  const cardsById = useFlashcardStore((s) => s.cardsById)

  return useMemo(() => {
    // `now` is a snapshot taken when this memo last recomputed (on mount, or
    // when a dependency below changes) — it does not tick on its own while
    // the screen stays open. The streak will not roll over at local midnight,
    // and an SRS card that comes due while the dashboard is open will not be
    // reflected in `retention.due` until an unrelated store write happens to
    // invalidate this memo. Treat every field derived from `now` as "as of
    // last render", not live.
    const now = date.epochMillis()
    const from = now - WEEK_DAYS * DAY_MS
    const cards = Object.values(cardsById)

    const sightReadingTrend = [...sightReadingHistory]
      .sort((a, b) => a.readAt - b.readAt)
      .map((r) => ({ at: r.readAt, accuracy: r.accuracy }))

    // No LevelState store and no shipped curriculum content exist yet — see
    // the module comment. `trackProgress`/`canAdvance` both require a real
    // `CurriculumLevel` and cannot be called meaningfully without one. Only
    // sight-reading has a persisted level source today; the other two tracks
    // report `undefined` rather than a fabricated 1.
    const levels: readonly DashboardTrackLevel[] = TRACKS.map((track) => ({
      track,
      level: track === 'sight-reading' ? sightReadingLevel : undefined,
      criteria: [],
    }))

    // No writer exists for either collection yet — see the module comment.
    const techniqueAttempts: readonly TechniqueAttempt[] = []
    const repertoirePieces: readonly RepertoirePiece[] = []

    // Grouped by drill so `tempoHistory`/`bestCleanBpm` (both drill-scoped)
    // apply correctly, then flattened for the single trend chart the screen
    // renders. Always `[]`/all-zero today since `techniqueAttempts` is
    // always `[]` — see the module comment — but this is the real reduction,
    // so the section goes live the moment a writer exists.
    const techniqueDrillIds = Array.from(new Set(techniqueAttempts.map((a) => a.drillId)))
    const techniqueTrend: readonly TechniqueTrendPoint[] = techniqueDrillIds
      .flatMap((drillId) =>
        tempoHistory(techniqueAttempts, drillId).map((p) => ({ ...p, drillId })),
      )
      .sort((a, b) => a.at - b.at)
    const techniqueBestBpmByDrill: Readonly<Record<string, number>> = Object.fromEntries(
      techniqueDrillIds.map((drillId) => [drillId, bestCleanBpm(techniqueAttempts, drillId)]),
    )

    const theoryCardIdPrefixes = ['key-signature-', 'interval-on-staff-']
    const theoryCards = cards.filter((c) => theoryCardIdPrefixes.some((p) => c.id.startsWith(p)))

    return {
      now,
      streak: {
        currentDays: currentStreakDays(practiceEntries, now, utcOffsetMinutes),
        longestDays: longestStreakDays(practiceEntries, utcOffsetMinutes),
      },
      weeklyMinutes: totalMinutes(practiceEntries, from, now),
      minutesByKind: minutesByKind(practiceEntries, from, now),
      dailyMinutes: dailyTotals(practiceEntries, from, now, utcOffsetMinutes),
      sightReadingLevel,
      sightReadingTrend,
      retention: retentionStats(theoryCards, now),
      techniqueAttempts,
      techniqueTrend,
      techniqueBestBpmByDrill,
      repertoirePieces,
      // `repertoirePieces` has no writer yet, so there is nothing to run
      // `maintenanceDue` over — see the module comment.
      repertoireDue: [],
      levels,
      curriculumAvailable: false,
    }
  }, [date, utcOffsetMinutes, practiceEntries, sightReadingLevel, sightReadingHistory, cardsById])
}
