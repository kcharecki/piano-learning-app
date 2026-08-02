/**
 * Per-track levels (REQ-2.1), advancement gated on measurable exit criteria
 * (REQ-2.2), and a manual override that bypasses gatekeeping entirely
 * (REQ-2.3).
 *
 * This module only judges evidence assembled by the caller — it never reads a
 * clock, a streak, or a practice total, because REQ-2.2 is explicit that
 * advancement is measurable-checks-only, not time spent.
 */
import type { CurriculumLevel, ExitCheck, ExitCriterion, Track } from '@core/curriculum/types.ts'
import { MAX_LEVEL, MIN_LEVEL } from '@core/curriculum/types.ts'
import { assertNever, invariant } from '@core/shared/invariant.ts'

/** The evidence an exit check is judged against. The caller assembles it; this module judges. */
export type ProgressEvidence = {
  /** Best assessment accuracy (0..1) per piece id, and the best overall. */
  readonly assessments: Readonly<Record<string, number>>
  readonly bestAssessmentAccuracy: number
  readonly sightReadingLevel: number
  /** Mean accuracy (0..1) of recent sight-reading runs. */
  readonly sightReadingAccuracy: number
  /** SRS retention (0..1) over theory cards. */
  readonly theoryRetention: number
  readonly earTrainingLevel: number
  /** Best clean tempo in bpm per technique drill id. */
  readonly techniqueBpm: Readonly<Record<string, number>>
}

export type TrackLevels = Readonly<Record<Track, number>>

export type LevelState = {
  readonly levels: TrackLevels
  /** Manually placed tracks (REQ-2.3): advancement never moves these on its own. */
  readonly overridden: Readonly<Record<Track, boolean>>
}

export function initialLevelState(): LevelState {
  const levels: TrackLevels = { playing: MIN_LEVEL, 'sight-reading': MIN_LEVEL, theory: MIN_LEVEL }
  const overridden: Readonly<Record<Track, boolean>> = {
    playing: false,
    'sight-reading': false,
    theory: false,
  }
  return { levels, overridden }
}

export type CriterionStatus = {
  readonly criterion: ExitCriterion
  readonly met: boolean
  /** 0..1 — how far the evidence has come toward the threshold, for the dashboard (REQ-3.10.2). */
  readonly progress: number
}

/** Clamp a ratio of evidence to threshold into [0, 1]. Threshold <= 0 is vacuously met. */
function ratioProgress(value: number, threshold: number): number {
  if (!Number.isFinite(value)) return 0
  if (threshold <= 0) return 1
  if (value <= 0) return 0
  const ratio = value / threshold
  if (ratio >= 1) return 1
  return ratio
}

function evaluateCheck(check: ExitCheck, evidence: ProgressEvidence): { met: boolean; progress: number } {
  switch (check.kind) {
    case 'assessment': {
      const accuracy =
        check.pieceId === undefined
          ? evidence.bestAssessmentAccuracy
          : (evidence.assessments[check.pieceId] ?? 0)
      const progress = ratioProgress(accuracy, check.minAccuracy)
      return { met: accuracy >= check.minAccuracy, progress }
    }
    case 'sight-reading': {
      const levelProgress = ratioProgress(evidence.sightReadingLevel, check.minLevel)
      const accuracyProgress = ratioProgress(evidence.sightReadingAccuracy, check.minAccuracy)
      const met =
        evidence.sightReadingLevel >= check.minLevel &&
        evidence.sightReadingAccuracy >= check.minAccuracy
      // Both sub-conditions must clear for `met`; progress reflects the harder one.
      return { met, progress: Math.min(levelProgress, accuracyProgress) }
    }
    case 'theory-quiz': {
      const progress = ratioProgress(evidence.theoryRetention, check.minRetention)
      return { met: evidence.theoryRetention >= check.minRetention, progress }
    }
    case 'ear-training': {
      const progress = ratioProgress(evidence.earTrainingLevel, check.minLevel)
      return { met: evidence.earTrainingLevel >= check.minLevel, progress }
    }
    case 'technique': {
      const bpm = evidence.techniqueBpm[check.drillId] ?? 0
      const progress = ratioProgress(bpm, check.minBpm)
      return { met: bpm >= check.minBpm, progress }
    }
    default:
      return assertNever(check)
  }
}

export function evaluateCriterion(criterion: ExitCriterion, evidence: ProgressEvidence): CriterionStatus {
  const { met, progress } = evaluateCheck(criterion.check, evidence)
  // `met` is the source of truth; force progress to exactly 1 when met so the
  // two can never disagree (a contradiction the tests forbid).
  return { criterion, met, progress: met ? 1 : progress }
}

/** Every criterion of `track` at the learner's current level in that track. */
export function trackProgress(
  state: LevelState,
  level: CurriculumLevel,
  track: Track,
  evidence: ProgressEvidence,
): readonly CriterionStatus[] {
  invariant(
    level.number === state.levels[track],
    "exit criteria must be for the track's current level",
  )
  return level.exitCriteria
    .filter((criterion) => criterion.track === track)
    .map((criterion) => evaluateCriterion(criterion, evidence))
}

/** True when every criterion for that track at that level is met. */
export function canAdvance(
  state: LevelState,
  level: CurriculumLevel,
  track: Track,
  evidence: ProgressEvidence,
): boolean {
  const statuses = trackProgress(state, level, track, evidence)
  return statuses.length > 0 && statuses.every((status) => status.met)
}

/** Advance one track by one level if it may (REQ-2.2). Pure; returns the next state. */
export function advance(
  state: LevelState,
  level: CurriculumLevel,
  track: Track,
  evidence: ProgressEvidence,
): LevelState {
  if (state.overridden[track]) return state
  if (!canAdvance(state, level, track, evidence)) return state
  const current = state.levels[track]
  if (current >= MAX_LEVEL) return state
  const next = Math.min(MAX_LEVEL, current + 1)
  if (next === current) return state
  return { ...state, levels: { ...state.levels, [track]: next } }
}

/** REQ-2.3: place a track manually, up or down, with no gatekeeping. Marks it overridden. */
export function setLevel(state: LevelState, track: Track, levelNumber: number): LevelState {
  const clamped = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, levelNumber))
  return {
    levels: { ...state.levels, [track]: clamped },
    overridden: { ...state.overridden, [track]: true },
  }
}
