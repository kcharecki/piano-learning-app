/**
 * Milestones (roadmap B.4, REQ-3.10.3): "Light gamification MAY be included
 * (streaks, milestones like 'all major scales at quarter-note=100'), but no
 * social features, leaderboards, or engagement-bait — this is a personal
 * tool." That is the design brief, not a footnote: every milestone here is a
 * real, checkable musical achievement DERIVED from data the app already
 * stores. There is no points system, no badge for merely showing up, no
 * nagging and no streak-loss guilt — see the streak milestone below for why
 * it is built on `longestStreakDays`, not `currentStreakDays`.
 *
 * `computeMilestones` reads exactly five things, and says here what each one
 * feeds:
 *
 *  - **`practiceEntries`** (`@core/progress/log.ts`'s `PracticeEntry[]`) —
 *    reused, never re-derived, through the log module's own
 *    `longestStreakDays` for the streak milestone. This module does not
 *    reimplement day-bucketing or streak counting; see `findStreakAchieved`.
 *  - **`techniqueAttempts`** (`@core/technique/evenness.ts`'s
 *    `TechniqueAttempt[]`) — read through the technique module's own
 *    `tempoHistory` (never re-graded) for the twelve-scales milestone, and
 *    cross-referenced against `@core/technique/library.ts`'s
 *    `techniqueDrillById` (for each attempt's `hands`) for the
 *    first-hands-together milestone.
 *  - **`repertoirePieces`** (`@core/repertoire/repertoire.ts`'s
 *    `RepertoirePiece[]`) — each piece's `sessions` (never `bestAccuracy`
 *    alone, which carries no timestamp) for the repertoire-accuracy
 *    milestone.
 *  - **`earTraining`** (`@core/eartraining/session.ts`'s `EarSessionState`)
 *    — `levels` (the live, authoritative per-kind level) for the achieved
 *    flag, `attempts` for the date it was first reached.
 *  - **`utcOffsetMinutes`** — the same local-day convention `log.ts` uses,
 *    passed straight through to `longestStreakDays`.
 *
 * Per-track curriculum levels and theory/SRS retention are both real,
 * already-derived numbers elsewhere on the dashboard (`useDashboard.ts`),
 * but neither is a "real, checkable musical achievement" distinct from what
 * the exit-criteria checklist (`@core/progress/levels.ts`) already shows on
 * the same screen — a milestone duplicating that would be the "inert
 * feature" this app has shipped a dozen of before, not a new one. Left out
 * on purpose, not overlooked.
 *
 * ## Why a `DateSource`, not a `Clock`
 *
 * `Clock.now()` is monotonic and explicitly never wall-clock (see
 * `@core/ports/clock.ts`'s own doc comment) — no use here needs elapsed
 * time. What this module needs is "now" as a wall-clock instant, which is
 * exactly `DateSource`'s job, and `useDashboard.ts` already threads one
 * through for the same reason. Its `now` has exactly one job here: every
 * timestamp read from the inputs (`PracticeEntry.startedAt`,
 * `TechniqueAttempt.at`, `RepertoireSession.at`, `EarAttempt.at`) is dropped
 * if it is later than `now` — a defensive clamp against a clock-skewed or
 * hand-edited record claiming an achievement before it could honestly have
 * happened. `computeMilestones` filters every input against `now` itself,
 * once, so no individual milestone builder has to.
 *
 * ## Achieved is permanent
 *
 * Every milestone here, once achieved, stays achieved even if the
 * underlying activity stops (a streak lapses, a piece is dropped from
 * practice) — REQ-3.10.3's "no streak-loss guilt" reads as ruling out any
 * milestone that can un-achieve itself out from under the learner. The
 * streak milestone is the one place this needed a deliberate choice: it is
 * built on `longestStreakDays` (the best run ever), not `currentStreakDays`
 * (today's live run, which the dashboard's streak panel already shows) —
 * see `streakMilestone`'s own comment.
 */
import type { DateSource } from '@core/ports/index.ts'
import { longestStreakDays, type PracticeEntry } from '@core/progress/log.ts'
import { tempoHistory, type TechniqueAttempt } from '@core/technique/evenness.ts'
import { techniqueDrillById, techniqueLibrary, type TechniqueDrill } from '@core/technique/library.ts'
import { MAX_LEVEL, MIN_LEVEL } from '@core/curriculum/types.ts'
import type { RepertoirePiece } from '@core/repertoire/repertoire.ts'
import type { EarSessionState } from '@core/eartraining/session.ts'
import type { EarItemKind } from '@core/eartraining/item.ts'
import { at } from '@core/shared/invariant.ts'

export type MilestoneId =
  | 'twelve-major-scales'
  | 'repertoire-accuracy-90'
  | 'first-hands-together'
  | 'streak-7-days'
  | 'eartraining-level-3-all-kinds'

export type Milestone = {
  readonly id: MilestoneId
  readonly title: string
  /** What it takes to earn it — shown before it is achieved. */
  readonly description: string
  readonly achieved: boolean
  /** Epoch ms the milestone was first reached, derived from stored data. `null` until achieved. */
  readonly achievedAt: number | null
  /** 0..1, honest fraction toward the milestone. Exactly 1 once `achieved`. */
  readonly progress: number
  /** Human-readable progress, e.g. "7 of 12 major scales" — never fabricated, "0 of N" included. */
  readonly progressLabel: string
}

export type MilestoneInputs = {
  readonly practiceEntries: readonly PracticeEntry[]
  /** Minutes to ADD to a UTC epoch-ms timestamp to get local wall-clock time — `log.ts`'s own convention. */
  readonly utcOffsetMinutes: number
  readonly techniqueAttempts: readonly TechniqueAttempt[]
  readonly repertoirePieces: readonly RepertoirePiece[]
  readonly earTraining: EarSessionState
}

const STREAK_TARGET_DAYS = 7
const REPERTOIRE_ACCURACY_TARGET = 0.9
const EAR_TRAINING_TARGET_LEVEL = 3

function pct(ratio: number): number {
  return Math.round(ratio * 100)
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

// ------------------------------------------------------------------ scales

/**
 * Every "major scale, 2 octaves, hands together" drill across all five
 * technique levels — REQ-3.10.3's own example ("all major scales at
 * quarter-note=100") read literally: the twelve major keys reach this exact
 * drill shape across levels 3 (C, G, D, F, Bb) and 4 (Db, Eb, A, E, B, F#,
 * Ab), each with its own curriculum `targetBpm` (`@core/technique/library.ts`
 * — never a single hardcoded tempo here, since the curriculum's own targets
 * already vary by key and level).
 */
function majorScaleHandsTogetherDrills(): readonly TechniqueDrill[] {
  const levels = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => MIN_LEVEL + i)
  return levels
    .flatMap((level) => techniqueLibrary(level))
    .filter((d) => d.kind === 'scale' && d.scaleType === 'major' && d.octaves === 2 && d.hands === 'both')
}

/** The first time a drill was played clean at (or above) its own `targetBpm`, or `null` if never. */
function scaleAchievedAt(attempts: readonly TechniqueAttempt[], drill: TechniqueDrill): number | null {
  const hit = tempoHistory(attempts, drill.id).find((p) => p.bpm >= drill.targetBpm)
  return hit?.at ?? null
}

function scalesMilestone(attempts: readonly TechniqueAttempt[]): Milestone {
  const drills = majorScaleHandsTogetherDrills()
  const perDrillAt = drills.map((drill) => scaleAchievedAt(attempts, drill))
  const achievedDates = perDrillAt.filter(isDefined)
  const achieved = drills.length > 0 && achievedDates.length === drills.length
  return {
    id: 'twelve-major-scales',
    title: 'All 12 major scales at target tempo',
    description:
      "Play every major scale, two octaves, hands together, clean at that scale's own " +
      'curriculum target tempo.',
    achieved,
    achievedAt: achieved && achievedDates.length > 0 ? Math.max(...achievedDates) : null,
    progress: drills.length === 0 ? 0 : achievedDates.length / drills.length,
    progressLabel: `${achievedDates.length} of ${drills.length} major scales`,
  }
}

// -------------------------------------------------------------- repertoire

/**
 * The earliest moment any piece's recorded session accuracy first reached
 * `REPERTOIRE_ACCURACY_TARGET`, and the best accuracy seen so far (for
 * honest progress even before that happens). `bestAccuracy` on
 * `RepertoirePiece` is not used directly — it carries no timestamp, so it
 * cannot answer "when", only "what"; this re-derives both from the same
 * `sessions` history it is itself computed from.
 */
function repertoireMilestone(pieces: readonly RepertoirePiece[]): Milestone {
  const base = {
    id: 'repertoire-accuracy-90' as const,
    title: `A repertoire piece at ${pct(REPERTOIRE_ACCURACY_TARGET)}% accuracy`,
    description: `Bring any repertoire piece's assessed accuracy to ${pct(REPERTOIRE_ACCURACY_TARGET)}% or higher.`,
  }
  let bestAccuracy = 0
  let earliest: { readonly at: number; readonly title: string } | null = null
  for (const piece of pieces) {
    for (const session of piece.sessions) {
      if (session.accuracy === undefined) continue
      if (session.accuracy > bestAccuracy) bestAccuracy = session.accuracy
      if (session.accuracy < REPERTOIRE_ACCURACY_TARGET) continue
      if (earliest === null || session.at < earliest.at) earliest = { at: session.at, title: piece.title }
    }
  }
  if (earliest === null) {
    return {
      ...base,
      achieved: false,
      achievedAt: null,
      progress: Math.min(1, bestAccuracy / REPERTOIRE_ACCURACY_TARGET),
      progressLabel:
        pieces.length === 0
          ? 'No repertoire pieces yet.'
          : `Best so far: ${pct(bestAccuracy)}% (target ${pct(REPERTOIRE_ACCURACY_TARGET)}%).`,
    }
  }
  return {
    ...base,
    achieved: true,
    achievedAt: earliest.at,
    progress: 1,
    progressLabel: `${earliest.title} reached ${pct(REPERTOIRE_ACCURACY_TARGET)}% accuracy.`,
  }
}

// ---------------------------------------------------------- hands together

/**
 * The first clean attempt at any drill whose `hands` is `'both'` — every
 * scale, chord and arpeggio in the technique library marked
 * "hands-together" (`@core/technique/library.ts`'s `handsSlug`) is eligible,
 * not one specific drill, so this is genuinely the learner's first two-handed
 * coordination win rather than an arbitrary single piece.
 */
function handsTogetherMilestone(attempts: readonly TechniqueAttempt[]): Milestone {
  const base = {
    id: 'first-hands-together' as const,
    title: 'First piece played hands together',
    description: 'Play any scale, chord or arpeggio clean with both hands at once.',
  }
  const cleanTogether = attempts
    .filter((a) => a.clean && techniqueDrillById(a.drillId)?.hands === 'both')
    .slice()
    .sort((a, b) => a.at - b.at)
  const first = cleanTogether[0]
  if (first === undefined) {
    return {
      ...base,
      achieved: false,
      achievedAt: null,
      progress: 0,
      progressLabel: 'Not yet — play any two-handed drill clean to unlock this.',
    }
  }
  const drillTitle = techniqueDrillById(first.drillId)?.title
  return {
    ...base,
    achieved: true,
    achievedAt: first.at,
    progress: 1,
    progressLabel: drillTitle ?? 'Achieved',
  }
}

// --------------------------------------------------------------- streak

/**
 * Built on `longestStreakDays` (the best run ever recorded), not
 * `currentStreakDays` (today's live run — already shown by the dashboard's
 * own streak panel). A milestone built on the live streak would un-achieve
 * itself the moment a streak lapses, which is exactly the "streak-loss
 * guilt" REQ-3.10.3 rules out; built on the longest run, it is a permanent
 * badge for a real 7-day run that once happened, never a status that flips
 * back off.
 *
 * `longestStreakDays` has no notion of "when" — it is not reimplemented here
 * to find one. Instead, `findStreakAchievedAt` calls the exact same exported
 * function against successively longer PREFIXES of the (time-sorted) entry
 * list and returns the timestamp of the entry at which the target was first
 * reached. This reuses `log.ts`'s own day-bucketing/streak logic verbatim —
 * it is never re-derived — at the cost of one extra pass over a practice log
 * capped at `MAX_STORED_PRACTICE_ENTRIES` (500), which is cheap.
 */
function findStreakAchievedAt(
  entries: readonly PracticeEntry[],
  utcOffsetMinutes: number,
  targetDays: number,
): number | null {
  if (longestStreakDays(entries, utcOffsetMinutes) < targetDays) return null
  const sorted = [...entries].sort((a, b) => a.startedAt - b.startedAt)
  for (let i = 0; i < sorted.length; i++) {
    const prefix = sorted.slice(0, i + 1)
    if (longestStreakDays(prefix, utcOffsetMinutes) >= targetDays) return at(prefix, prefix.length - 1).startedAt
  }
  // Unreachable: the guard above already proved a qualifying prefix exists
  // in the full (sorted-equivalent) set, so the loop always returns first.
  return null
}

function streakMilestone(entries: readonly PracticeEntry[], utcOffsetMinutes: number): Milestone {
  const longest = longestStreakDays(entries, utcOffsetMinutes)
  const achieved = longest >= STREAK_TARGET_DAYS
  return {
    id: 'streak-7-days',
    title: `${STREAK_TARGET_DAYS}-day practice streak`,
    description: `Practice ${STREAK_TARGET_DAYS} days in a row, any logged activity counts.`,
    achieved,
    achievedAt: achieved ? findStreakAchievedAt(entries, utcOffsetMinutes, STREAK_TARGET_DAYS) : null,
    progress: Math.min(1, longest / STREAK_TARGET_DAYS),
    progressLabel: `${Math.min(longest, STREAK_TARGET_DAYS)} of ${STREAK_TARGET_DAYS} days`,
  }
}

// ----------------------------------------------------------- ear training

/**
 * Every ear-training kind (`Object.keys(earTraining.levels)` — always all
 * six; `emptyEarSession` seeds every `EarItemKind`, so this never hardcodes
 * the list) at level 3 of 5 or higher — the midpoint of the ladder, chosen
 * as a real coordination-across-kinds bar rather than the minimum level
 * every kind starts at. `achieved`/progress read the live, authoritative
 * `levels` map; `achievedAt` is a best-effort re-derivation from
 * `attempts` (the first attempt recorded for that kind at, or above, the
 * target level) — `null` for a kind if promoted but somehow no matching
 * attempt survived (e.g. an imported/edited session), which correctly
 * leaves the overall date honestly `null` too rather than a fabricated one.
 */
function earTrainingMilestone(session: EarSessionState): Milestone {
  const kinds = Object.keys(session.levels) as readonly EarItemKind[]
  const achievedKinds = kinds.filter((k) => session.levels[k] >= EAR_TRAINING_TARGET_LEVEL)
  const achieved = kinds.length > 0 && achievedKinds.length === kinds.length
  const perKindDates = achievedKinds.map((k) => {
    const firstAtLevel = session.attempts
      .filter((a) => a.kind === k && a.level >= EAR_TRAINING_TARGET_LEVEL)
      .reduce<number | null>((earliest, a) => (earliest === null || a.at < earliest ? a.at : earliest), null)
    return firstAtLevel
  })
  const knownDates = perKindDates.filter(isDefined)
  return {
    id: 'eartraining-level-3-all-kinds',
    title: `Ear training: level ${EAR_TRAINING_TARGET_LEVEL} in every kind`,
    description: `Reach level ${EAR_TRAINING_TARGET_LEVEL} in every ear-training kind — intervals, chords, scales and dictation.`,
    achieved,
    achievedAt: achieved && knownDates.length > 0 ? Math.max(...knownDates) : null,
    progress: kinds.length === 0 ? 0 : achievedKinds.length / kinds.length,
    progressLabel: `${achievedKinds.length} of ${kinds.length} kinds at level ${EAR_TRAINING_TARGET_LEVEL}+`,
  }
}

// ------------------------------------------------------------------- entry

/**
 * Every milestone, freshly computed from `inputs` — nothing is cached or
 * stored; a milestone's `achieved`/`achievedAt`/`progress` are always
 * re-derived from the current practice log, technique history, repertoire
 * library and ear-training session, the same "derive, never persist a
 * verdict" approach the rest of `src/core/progress` already uses (see
 * `@core/progress/levels.ts`'s own module comment).
 */
export function computeMilestones(inputs: MilestoneInputs, date: DateSource): readonly Milestone[] {
  const now = date.epochMillis()
  const practiceEntries = inputs.practiceEntries.filter((e) => e.startedAt <= now)
  const techniqueAttempts = inputs.techniqueAttempts.filter((a) => a.at <= now)
  const repertoirePieces = inputs.repertoirePieces.map((p) => ({
    ...p,
    sessions: p.sessions.filter((s) => s.at <= now),
  }))
  const earTraining: EarSessionState = {
    ...inputs.earTraining,
    attempts: inputs.earTraining.attempts.filter((a) => a.at <= now),
  }
  return [
    scalesMilestone(techniqueAttempts),
    repertoireMilestone(repertoirePieces),
    handsTogetherMilestone(techniqueAttempts),
    streakMilestone(practiceEntries, inputs.utcOffsetMinutes),
    earTrainingMilestone(earTraining),
  ]
}
