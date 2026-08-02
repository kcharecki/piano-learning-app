/**
 * The curriculum's shape (REQ-3.1.1, REQ-2.1–2.3): levels → units → lessons →
 * exercises, plus the measurable exit criteria that gate advancement.
 *
 * Written as a contract before the modules that consume it, so the curriculum
 * model, the daily-session builder, the per-track level tracker and the lesson
 * content in `src/content/` all agree on one vocabulary rather than three.
 *
 * Everything here is data, not behaviour: a `Curriculum` value is authored as
 * content and validated by `@core/curriculum/model.ts`. Exit criteria are
 * *declarations* of what will be checked — `@core/progress/levels.ts` is what
 * evaluates them against real progress, which is why an `ExitCheck` carries
 * thresholds and never a function.
 */

/**
 * The three tracks that advance independently (REQ-2.1) — a learner reading
 * two grades below what they can play is the normal case, not a defect.
 */
export type Track = 'playing' | 'sight-reading' | 'theory'
export const TRACKS: readonly Track[] = ['playing', 'sight-reading', 'theory']

/** Levels 1–5, the ladder defined in requirements.md §2. */
export const MIN_LEVEL = 1
export const MAX_LEVEL = 5

/** What a learner actually does in an exercise; each maps to an existing drill or screen. */
export type ExerciseKind =
  | 'play'
  | 'sight-read'
  | 'theory-quiz'
  | 'ear-training'
  | 'technique'
  | 'repertoire'

/**
 * One hands-on task. `params` is the drill's own configuration — deliberately a
 * flat bag of primitives so a lesson stays authorable as data and serialisable
 * without a custom codec.
 */
export type Exercise = {
  readonly id: string
  readonly kind: ExerciseKind
  readonly title: string
  readonly estimatedMinutes: number
  readonly params?: Readonly<Record<string, string | number | boolean>>
}

/**
 * A lesson: a short explanation, a demonstration, and hands-on tasks
 * (REQ-3.1.1). REQ-3.1.2 is why `exercises` is non-empty — a theory concept is
 * never introduced without a playing task that uses it.
 */
export type Lesson = {
  readonly id: string
  readonly unitId: string
  readonly track: Track
  readonly title: string
  /** Markdown. Diagrams are referenced from it by id (REQ-3.1.3). */
  readonly explanation: string
  /** A bundled score id the app can play as the demonstration (REQ-3.1.3). */
  readonly demoScoreId?: string
  readonly exercises: readonly Exercise[]
}

export type Unit = {
  readonly id: string
  readonly levelNumber: number
  readonly title: string
  readonly lessonIds: readonly string[]
}

/**
 * A measurable advancement check (REQ-2.2) — never "time spent". Each variant
 * names the evidence it needs and the threshold that evidence must clear.
 */
export type ExitCheck =
  | { readonly kind: 'assessment'; readonly minAccuracy: number; readonly pieceId?: string }
  | { readonly kind: 'sight-reading'; readonly minLevel: number; readonly minAccuracy: number }
  | { readonly kind: 'theory-quiz'; readonly minRetention: number }
  | { readonly kind: 'ear-training'; readonly minLevel: number }
  | { readonly kind: 'technique'; readonly drillId: string; readonly minBpm: number }

export type ExitCriterion = {
  readonly id: string
  readonly track: Track
  /** Shown to the learner on the dashboard (REQ-3.10.2), so write it as a goal. */
  readonly description: string
  readonly check: ExitCheck
}

export type CurriculumLevel = {
  readonly number: number
  readonly title: string
  readonly units: readonly Unit[]
  readonly exitCriteria: readonly ExitCriterion[]
}

export type Curriculum = {
  readonly levels: readonly CurriculumLevel[]
  readonly lessons: readonly Lesson[]
}
