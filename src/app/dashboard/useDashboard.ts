/**
 * Dashboard data (roadmap 4.7, REQ-3.10.1/REQ-3.10.2) — reads what the app has
 * already persisted and reduces it for display, using the core functions
 * rather than recomputing any of the underlying music-theory/streak/
 * retention logic itself.
 *
 * Of REQ-3.10.1's six sections, three used to be documented here as having no
 * real data source. All three claims were stale:
 *
 *  - **Technique tempo trends** (roadmap 2.33): `useTechniqueStore` exists,
 *    `useTechniqueDrill` appends a scored `TechniqueAttempt` to it after every
 *    run, and `persistence.ts` persists it. `techniqueAttempts` reads it.
 *  - **Repertoire status** (roadmap 2.33): `useRepertoireStore` (roadmap 4.5)
 *    exists and holds the library; `repertoirePieces` reads it, and
 *    `repertoireDue` runs the real `maintenanceDue` over it.
 *  - **Current level per track (REQ-3.10.2)** (roadmap 2.36): `useLevelStore`
 *    (roadmap 4.3) now persists a `LevelState` — one curriculum level number
 *    and one `overridden` flag per track. `levels` reads it directly, so all
 *    three tracks report a real number and whether it was placed by hand.
 *
 * A collision worth being explicit about: `useSightReadingStore`'s `level`
 * (exposed on `DashboardData` as `sightReadingLevel`) is the ADAPTIVE
 * trainer's own difficulty, driven by run accuracy inside the sight-reading
 * drill loop — it is NOT the same number as `levelState.levels['sight-reading']`,
 * which is the curriculum track level REQ-2.1/REQ-2.3 and roadmap 4.3's proof
 * are about (three independent track levels, one manually overridable per
 * track). They are deliberately kept as two separate fields rather than
 * collapsed into one: `levels` (this hook, from `useLevelStore`) drives the
 * "Current level per track" list for all three tracks including
 * sight-reading, while `sightReadingLevel` (from `useSightReadingStore`,
 * unchanged) keeps feeding the sight-reading section's own trend display.
 *
 * The one section still genuinely missing a data source is exit criteria:
 * no shipped curriculum content (roadmap 4.9) exists to supply a
 * `CurriculumLevel`'s `exitCriteria`, so `trackProgress`/`canAdvance` cannot
 * be called meaningfully yet. `levels[].criteria` stays `[]` and
 * `curriculumAvailable` stays `false` so the screen renders an explicit
 * "nothing to check yet" instead of a blank checklist.
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
import { maintenanceDue, type RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import { useLevelStore } from '@app/state/levelStore.ts'

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
  /** The curriculum track level from `useLevelStore` — always a real number now. */
  readonly level: number
  /** REQ-2.3: true once this track has been placed by hand. */
  readonly overridden: boolean
  /** Still `[]` — no shipped curriculum content supplies `exitCriteria` yet (roadmap 4.9). */
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
  /** `useTechniqueStore`'s persisted attempts, newest first (the store's own order). `[]` until a drill has been run. */
  readonly techniqueAttempts: readonly TechniqueAttempt[]
  /**
   * Clean-tempo history across every drill in `techniqueAttempts`, oldest
   * first — computed from the real core functions (`tempoHistory`/
   * `bestCleanBpm`), grouped by drill id and flattened for the single trend
   * chart the screen renders. `[]` until `techniqueAttempts` has an entry.
   */
  readonly techniqueTrend: readonly TechniqueTrendPoint[]
  /** Best clean bpm reached per drill id, from `bestCleanBpm`. `{}` until `techniqueAttempts` has an entry. */
  readonly techniqueBestBpmByDrill: Readonly<Record<string, number>>
  /** `useRepertoireStore`'s persisted library, insertion order. `[]` until a piece has been added. */
  readonly repertoirePieces: readonly RepertoirePiece[]
  /** `maintenanceDue(repertoirePieces, now)` — 'maintained' pieces overdue for review, most overdue first. */
  readonly repertoireDue: readonly RepertoirePiece[]
  readonly levels: readonly DashboardTrackLevel[]
  /** `false` until shipped curriculum content exists (roadmap 4.9) — see the module comment. */
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
  const techniqueAttempts = useTechniqueStore((s) => s.attempts)
  const repertoirePieces = useRepertoireStore((s) => s.pieces)
  const levelState = useLevelStore((s) => s.levelState)

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

    // `levelState` (from `useLevelStore`, roadmap 4.3) is the curriculum
    // track level for all three tracks — see the module comment for why this
    // is deliberately NOT the same number as `sightReadingLevel` below.
    // `criteria` stays `[]`: no shipped curriculum content (roadmap 4.9)
    // exists to supply a `CurriculumLevel`'s `exitCriteria`, so
    // `trackProgress`/`canAdvance` cannot be called meaningfully yet.
    const levels: readonly DashboardTrackLevel[] = TRACKS.map((track) => ({
      track,
      level: levelState.levels[track],
      overridden: levelState.overridden[track],
      criteria: [],
    }))

    // Grouped by drill so `tempoHistory`/`bestCleanBpm` (both drill-scoped)
    // apply correctly, then flattened for the single trend chart the screen
    // renders.
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
      repertoireDue: maintenanceDue(repertoirePieces, now),
      levels,
      curriculumAvailable: false,
    }
  }, [
    date,
    utcOffsetMinutes,
    practiceEntries,
    sightReadingLevel,
    sightReadingHistory,
    cardsById,
    techniqueAttempts,
    repertoirePieces,
    levelState,
  ])
}
