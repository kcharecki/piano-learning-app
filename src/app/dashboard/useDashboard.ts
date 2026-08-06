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
 * **Exit criteria (roadmap 2.36's second half, REQ-2.2, REQ-3.10.2)**:
 * `@content/curriculum/curriculum.ts` now ships levels 1-3 with real
 * `exitCriteria`, so `levels[].criteria` is populated by calling
 * `trackProgress` for whichever `CurriculumLevel` matches a track's current
 * `levelState` number (via `levelAt`) — never for any other level, because
 * `trackProgress`'s own `invariant` requires `level.number === state.levels[track]`.
 * A track whose current level is not authored (e.g. a manual override past
 * level 3) gets `criteria: []` for that track, and `curriculumAvailable`
 * (now "true when the authored curriculum covers every track's current
 * level") goes `false` — the screen still renders honestly instead of
 * crashing on the invariant or fabricating criteria.
 *
 * The `ProgressEvidence` passed to `trackProgress` is assembled entirely
 * from values this hook already computes elsewhere in the same memo —
 * `assessments`/`techniqueBpm` reuse `assessmentBestByScore`/
 * `techniqueBestBpmByDrill` verbatim, `theoryRetention` and
 * `sightReadingAccuracy` are one honest reduction each over `retention`/
 * `sightReadingTrend` (documented at their call sites below), and
 * `sightReadingLevel` is the same adaptive-trainer number already exposed as
 * `DashboardData.sightReadingLevel` — the exit-check semantics ("has the
 * learner reached sight-reading level N at that accuracy") are about the
 * adaptive trainer's own progression, not the curriculum track level, so
 * reusing it here is correct, not a collision with the module comment above.
 * `earTrainingLevel` (roadmap 3.22): `useEarTrainingStore`'s
 * `EarSessionState.levels` is keyed per `EarItemKind` (roadmap 3.10) and,
 * since roadmap 3.11a, persisted across reloads — so it is a real, durable
 * number now, not the "died with the tab" state it used to be when this
 * field had no honest source. Reducing six kind-levels to one is still a
 * judgement call: `earTrainingLevel` is their MINIMUM, not their mean or
 * max, because a learner has reached ear-training level N only once EVERY
 * kind is at N — a mean or max would advance an `ear-training` exit check on
 * evidence that was never collected for whichever kind the learner happened
 * to avoid (e.g. never once practising rhythmic dictation). The minimum is
 * the conservative reading and cannot be gamed that way. A session with NO
 * attempts at all reports `0`, not `EAR_MIN_LEVEL` (1): every kind starts at
 * `EAR_MIN_LEVEL` even before the learner has ever answered a single
 * question, so taking the minimum of an untouched session would read as "has
 * demonstrated level 1" on zero evidence, letting an `{ kind: 'ear-training',
 * minLevel: 1 }` exit criterion pass with nothing practised. `0` is reserved
 * for exactly that no-evidence case; `1` means level 1 was actually
 * demonstrated. No shipped curriculum entry uses `kind: 'ear-training'`
 * today, so this is currently a latent value rather than a visible gate —
 * fixed anyway, since `evidence` is a public field of this hook's contract.
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
import { trackProgress, type CriterionStatus, type ProgressEvidence } from '@core/progress/levels.ts'
import { levelAt } from '@core/curriculum/model.ts'
import { tempoHistory, bestCleanBpm, type TechniqueAttempt, type TempoPoint } from '@core/technique/evenness.ts'
import { maintenanceDue, type RepertoirePiece } from '@core/repertoire/repertoire.ts'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import { useProgressStore, type StoredAssessment } from '@app/state/progressStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'
import { useLevelStore } from '@app/state/levelStore.ts'
import { useEarTrainingStore } from '@app/state/earTrainingStore.ts'

const WEEK_DAYS = 7
/** Matches `adaptLevel`'s own default window (`@core/sightreading/adaptive.ts`) — see its use below. */
const SIGHT_READING_ACCURACY_WINDOW = 3

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

export type AssessmentTrendPoint = {
  readonly at: number
  readonly accuracy: number
  readonly scoreId: string
  readonly scoreTitle: string
}

export type DashboardTrackLevel = {
  readonly track: Track
  /** The curriculum track level from `useLevelStore` — always a real number now. */
  readonly level: number
  /** REQ-2.3: true once this track has been placed by hand. */
  readonly overridden: boolean
  /**
   * `trackProgress` over this track's exit criteria at its current level, or
   * `[]` when the authored curriculum has no `CurriculumLevel` for `level`
   * (e.g. an override past the highest shipped level) — see the module
   * comment.
   */
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
  /**
   * Every recorded repertoire assessment (`useProgressStore.assessments`,
   * REQ-3.3.4) as a trend point, oldest first — a separate source from
   * `sightReadingTrend` above (generated sight-reading exercise runs) and
   * never conflated with it. `[]` until one is recorded.
   */
  readonly assessmentTrend: readonly AssessmentTrendPoint[]
  /**
   * Best accuracy (0..1) among the RETAINED assessments per `scoreId`, from
   * `assessmentTrend` — capped at `MAX_STORED_ASSESSMENTS` (see
   * `progressStore.ts`); an older, better run that has since been evicted is
   * not counted. `{}` until one is recorded.
   */
  readonly assessmentBestByScore: Readonly<Record<string, number>>
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
  /** True when the authored curriculum covers every track's current level (see the module comment). */
  readonly curriculumAvailable: boolean
  /**
   * The same `ProgressEvidence` used to compute `levels[].criteria`, exposed
   * so `DashboardScreen` can call the real `canAdvance`/pass to
   * `advanceTrack` for its "Advance" control instead of re-deriving
   * "every criterion met" from `criteria` by hand (not part of the original
   * frozen contract — a new field, no existing field's name or type changes).
   */
  readonly evidence: ProgressEvidence
}

const defaultDate: DateSource = { epochMillis: () => Date.now() }

export function useDashboard(options: UseDashboardOptions = {}): DashboardData {
  const date = options.date ?? defaultDate
  const utcOffsetMinutes = options.utcOffsetMinutes ?? -new Date().getTimezoneOffset()

  const practiceEntries = useProgressStore((s) => s.practiceEntries)
  const assessments = useProgressStore((s) => s.assessments)
  const sightReadingLevel = useSightReadingStore((s) => s.level)
  const sightReadingHistory = useSightReadingStore((s) => s.history)
  const cardsById = useFlashcardStore((s) => s.cardsById)
  const techniqueAttempts = useTechniqueStore((s) => s.attempts)
  const repertoirePieces = useRepertoireStore((s) => s.pieces)
  const levelState = useLevelStore((s) => s.levelState)
  const earTrainingLevels = useEarTrainingStore((s) => s.session.levels)
  /** Only used to detect "no attempts recorded anywhere yet" — see the module comment. */
  const earTrainingAttemptCount = useEarTrainingStore((s) => s.session.attempts.length)

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

    // `assessments` (from `useProgressStore`, roadmap 2.24) is stored NEWEST
    // first, capped — reverse to oldest-first to match `sightReadingTrend`
    // and `techniqueTrend` above and how `TrendChart`/the screen read a
    // series left-to-right.
    const assessmentTrend: readonly AssessmentTrendPoint[] = [...assessments]
      .sort((a, b) => a.at - b.at)
      .map((a: StoredAssessment) => ({
        at: a.at,
        accuracy: a.result.accuracy,
        scoreId: a.scoreId,
        scoreTitle: a.scoreTitle,
      }))
    const assessmentBestByScore: Readonly<Record<string, number>> = assessmentTrend.reduce<
      Record<string, number>
    >((best, p) => {
      const prior = best[p.scoreId]
      if (prior === undefined || p.accuracy > prior) best[p.scoreId] = p.accuracy
      return best
    }, {})

    // Grouped by drill so `tempoHistory`/`bestCleanBpm` (both drill-scoped)
    // apply correctly, then flattened for the single trend chart the screen
    // renders. Computed here (ahead of `assessmentTrend`'s siblings below) so
    // `techniqueBestBpmByDrill` exists before the evidence block that reuses
    // it needs it.
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
    const retention = retentionStats(theoryCards, now)

    // Best accuracy across ALL pieces, from `assessmentBestByScore` above —
    // no second accuracy computation, just its max (0 when no assessment has
    // ever been recorded, which correctly leaves an `assessment` check unmet).
    const bestAssessmentAccuracy = Object.values(assessmentBestByScore).reduce(
      (best, accuracy) => Math.max(best, accuracy),
      0,
    )

    // Mean accuracy of the most recent `SIGHT_READING_ACCURACY_WINDOW` reads
    // from `sightReadingTrend` (already oldest-first, computed above) — the
    // same window size `adaptLevel`'s own default uses
    // (`@core/sightreading/adaptive.ts`), so "recent" means the same thing
    // here as it does when the trainer itself decides whether to move the
    // level. `0` when nothing has been read yet.
    const recentSightReadingReads = sightReadingTrend.slice(-SIGHT_READING_ACCURACY_WINDOW)
    const sightReadingAccuracy =
      recentSightReadingReads.length === 0
        ? 0
        : recentSightReadingReads.reduce((sum, r) => sum + r.accuracy, 0) /
          recentSightReadingReads.length

    // `retention` (above) has no direct 0..1 "retention rate" field — the
    // most honest reduction is the fraction of theory cards that have
    // graduated to a MATURE_THRESHOLD_DAYS-or-longer interval (durable
    // retention), out of every theory card tracked. A card still `due` often
    // or on a short `young` interval has not yet demonstrated retention, so
    // it does not count toward this ratio. `0` when there are no theory
    // cards yet, which correctly leaves a `theory-quiz` check unmet.
    const theoryRetention = retention.total === 0 ? 0 : retention.mature / retention.total

    // `earTrainingLevel` is the MINIMUM of the six per-kind levels, not their
    // mean — see the module comment for why the conservative reduction is
    // the correct one. A session with zero recorded attempts reports `0`
    // instead: every kind starts at `EAR_MIN_LEVEL`, so the minimum of an
    // untouched session would otherwise be indistinguishable from "level 1
    // actually demonstrated".
    const earTrainingLevel =
      earTrainingAttemptCount === 0 ? 0 : Math.min(...Object.values(earTrainingLevels))
    const evidence: ProgressEvidence = {
      assessments: assessmentBestByScore,
      bestAssessmentAccuracy,
      sightReadingLevel,
      sightReadingAccuracy,
      theoryRetention,
      earTrainingLevel,
      techniqueBpm: techniqueBestBpmByDrill,
    }

    // `levelState` (from `useLevelStore`, roadmap 4.3) is the curriculum
    // track level for all three tracks — see the module comment for why this
    // is deliberately NOT the same number as `sightReadingLevel` below.
    // `criteria` is populated by calling `trackProgress` for whichever
    // authored `CurriculumLevel` matches a track's current level; a track
    // whose current level has no authored content gets `[]` rather than a
    // call that would throw `trackProgress`'s own invariant.
    let curriculumAvailable = true
    const levels: readonly DashboardTrackLevel[] = TRACKS.map((track) => {
      const levelNumber = levelState.levels[track]
      const level = levelAt(CURRICULUM, levelNumber)
      if (level === undefined) curriculumAvailable = false
      const criteria =
        level === undefined ? [] : trackProgress(levelState, level, track, evidence)
      return {
        track,
        level: levelNumber,
        overridden: levelState.overridden[track],
        criteria,
      }
    })

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
      assessmentTrend,
      assessmentBestByScore,
      retention,
      techniqueAttempts,
      techniqueTrend,
      techniqueBestBpmByDrill,
      repertoirePieces,
      repertoireDue: maintenanceDue(repertoirePieces, now),
      levels,
      curriculumAvailable,
      evidence,
    }
  }, [
    date,
    utcOffsetMinutes,
    practiceEntries,
    assessments,
    sightReadingLevel,
    sightReadingHistory,
    cardsById,
    techniqueAttempts,
    repertoirePieces,
    levelState,
    earTrainingLevels,
    earTrainingAttemptCount,
  ])
}
