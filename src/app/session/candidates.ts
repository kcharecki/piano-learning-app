/**
 * Turns what the app can actually offer today into `planSession`'s candidate
 * lists (roadmap 4.7a, REQ-3.1.4).
 *
 * Deliberately pure — no store subscription happens here. `useSessionPlan.ts`
 * reads `scoreStore`/`sightReadingStore` and passes plain values in, so this
 * module stays trivially unit-testable and has no React dependency of its
 * own.
 *
 * Each `Exercise.params` is exactly what the shell needs to open the real
 * destination — never an invented drill the app cannot run:
 *  - `warmup`: the one fixed `WARMUP_EXERCISE` from
 *    `@content/curriculum/warmups.ts` (roadmap 5.45). This is the wiring
 *    point that module's own comment describes: `@core/curriculum/session.ts`
 *    cannot import `src/content` (the architecture boundary runs one way
 *    only — core is pure, content depends on core, never the reverse), so
 *    the warm-up content is turned into a candidate HERE, exactly like every
 *    other segment, and `session.ts` only ever sees an already-built
 *    `Exercise` it knows nothing about the origin of.
 *  - `technique`: one `Exercise` per drill at the playing-track level, each
 *    carrying `params.drillId`. `Shell.tsx` resolves that id through
 *    `techniqueDrillById` and hands the drill's id AND its level to
 *    `TechniqueScreen` (roadmap 2.34) — the level matters because
 *    `useTechniqueDrill` builds its picker from `techniqueLibrary(level)` and
 *    silently drops an id absent from that list.
 *  - `sight-reading`: a single "keep sight-reading" `Exercise` — the trainer
 *    itself generates the actual exercise and reads its level from the
 *    store, so there is nothing further to parametrise.
 *  - `theory-ear`: both flashcard decks `FlashcardScreen` can drive, each
 *    carrying `params.drillKind` — see ambiguity (2) below.
 *  - `lesson`: three-deep fallback (roadmap 4.10, M4 acceptance Defect 1b —
 *    `docs/m4-acceptance-2026-08-12.md`). Highest priority to lowest:
 *      1. the currently loaded score, if any — practicing what is already
 *         open, not inventing a lesson;
 *      2. otherwise the first piece in the learner's OWN repertoire library
 *         (`repertoireStore.pieces`), if they have added any — still
 *         real, learner-curated content, just not currently open;
 *      3. otherwise the curriculum's very first lesson (level `MIN_LEVEL`,
 *         `lessonsForLevel`'s own order) — the one candidate that exists
 *         unconditionally, even on a brand-new profile with an empty score
 *         store AND an empty repertoire library. Before this fallback
 *         existed, a fresh install's `lesson` segment was empty and
 *         `planSession` silently renormalised its ~40% share onto the other
 *         three segments — Today (the app's default screen) planned "Lesson
 *         / repertoire — 0 min" for every new learner. See ambiguity (4)
 *         below for what this fallback does NOT attempt to fix.
 *
 * ## Ambiguities flagged, not resolved silently
 *
 * 1. (superseded — technique candidates are emitted and routed; see above.)
 * 2. (superseded — roadmap 4.9c. `FlashcardScreen` now takes an `initialKind`
 *    prop that seeds which deck opens, so both decks it can drive
 *    (`'staff-to-key'` and `'interval-on-staff'`) are OPENABLE, and both are
 *    emitted below. They only actually open correctly once `Shell.tsx` routes
 *    `params.drillKind` into that prop — until then a planned interval item
 *    lands on the default deck.)
 * 3. The loaded score's `Exercise` uses kind `'repertoire'` — `scoreStore`
 *    carries no tag distinguishing "lesson demo" from "repertoire piece",
 *    and `'repertoire'` was picked as the more general fit for "whatever the
 *    learner currently has open".
 * 4. Fallbacks (2) and (3) above route through `destinationFor`'s existing
 *    `'repertoire'`/`'play'` cases, which both land on the Practice screen —
 *    the SAME screen the loaded-score candidate opens. Neither fallback
 *    actually LOADS the named piece/lesson into `scoreStore` first (that
 *    would mean `Shell.tsx`'s `open()` reading `Exercise.params` to fetch a
 *    score, which it does not do for any kind today — see its own module
 *    doc). Clicking "Open" on either fallback therefore lands on whatever
 *    Practice already shows (nothing, on a true cold profile), same as it
 *    already would if the lesson segment were empty. This is the same class
 *    of honest gap the flashcard/theory-quiz ambiguities above already
 *    document: the candidate is real and its MINUTES are real (which is what
 *    REQ-3.1.4's mix is about), but "Open" is not yet a deep link for it.
 *    `src/app/session/candidates.ts` is this task's only file boundary into
 *    routing-adjacent code; wiring an actual score load through `Shell.tsx`
 *    is future work, not this fix's scope.
 */
import { MAX_LEVEL, MIN_LEVEL, type Exercise } from '@core/curriculum/types.ts'
import type { SessionSegmentKind } from '@core/curriculum/session.ts'
import type { LoadedScore } from '@app/state/scoreStore.ts'
import { techniqueLibrary } from '@core/technique/library.ts'
import { MAX_LEVEL as SIGHT_READING_MAX_LEVEL } from '@core/sightreading/adaptive.ts'
import { WARMUP_EXERCISE } from '@content/curriculum/warmups.ts'
import { lessonsForLevel } from '@core/curriculum/model.ts'
import { CURRICULUM } from '@content/curriculum/curriculum.ts'
import type { RepertoirePiece } from '@core/repertoire/repertoire.ts'

/** Moderate estimate for one flashcard-deck sitting — large enough that a
 * short segment reasonably shows just one pass, small enough that a longer
 * segment cycles through it a few times. */
const FLASHCARD_DECK_MINUTES = 10
/** A technique drill is a short, repeatable block — several fit in one warm-up. */
const TECHNIQUE_DRILL_MINUTES = 5

/**
 * Sight-reading and the loaded score are each a single, open-ended
 * candidate — the actual content varies every time the learner opens the
 * screen (a freshly generated exercise; whatever measure they're up to), so
 * there is nothing to gain from `fillSegment` repeating the same entry
 * several times. Deliberately larger than any session budget so one item
 * always absorbs the whole segment.
 */
const OPEN_ENDED_MINUTES = 1_000_000

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_LEVEL
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(level)))
}

/**
 * The level's technique drills, in the library's own order (REQ-3.7.1). The
 * Technique screen (roadmap 4.4a) is what opens them; before it existed this
 * returned nothing on purpose, because a planned item nothing can open is
 * worse than a redistributed segment.
 */
function techniqueCandidates(level: number): readonly Exercise[] {
  return techniqueLibrary(clampLevel(level)).map((drill) => ({
    id: `technique-${drill.id}`,
    kind: 'technique',
    title: drill.title,
    estimatedMinutes: TECHNIQUE_DRILL_MINUTES,
    params: { drillId: drill.id, targetBpm: drill.targetBpm },
  }))
}

/**
 * Sight reading's own ladder (roadmap 5.11) runs 1..`SIGHT_READING_MAX_LEVEL`
 * independently of the curriculum's 1..`MAX_LEVEL` playing/theory tracks —
 * clamping this label with the curriculum's bound silently displayed "level
 * 5" for a learner the store had genuinely advanced to level 6.
 */
function clampSightReadingLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_LEVEL
  return Math.min(SIGHT_READING_MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(level)))
}

function sightReadingCandidates(sightReadingLevel: number): readonly Exercise[] {
  const level = clampSightReadingLevel(sightReadingLevel)
  return [
    {
      id: 'sight-reading-continue',
      kind: 'sight-read',
      title: `Sight-reading practice, level ${level}`,
      estimatedMinutes: OPEN_ENDED_MINUTES,
      params: { level },
    },
  ]
}

function theoryEarCandidates(): readonly Exercise[] {
  // Both decks FlashcardScreen can actually open (see ambiguity (2) above):
  // 'staff-to-key' opens the on-screen keyboard, 'interval-on-staff' opens
  // the interval answer pad. The interval candidate only becomes reachable
  // in the UI once the theory-ear segment exceeds ~10 minutes (fillSegment
  // allocates min(remaining, FLASHCARD_DECK_MINUTES) per item), i.e. above
  // the default 30-minute total budget — pick the 60-min preset when
  // exercising it end-to-end.
  return [
    {
      id: 'flashcards-staff-to-key',
      kind: 'theory-quiz',
      title: 'Note-reading flashcards',
      estimatedMinutes: FLASHCARD_DECK_MINUTES,
      params: { drillKind: 'staff-to-key' },
    },
    {
      id: 'flashcards-interval-on-staff',
      kind: 'theory-quiz',
      title: 'Interval flashcards',
      estimatedMinutes: FLASHCARD_DECK_MINUTES,
      params: { drillKind: 'interval-on-staff' },
    },
  ]
}

/** The fields `lessonCandidates`' repertoire fallback actually reads — a
 * structural subset of `RepertoirePiece`, not the whole shape, so a caller
 * need not thread every field through just to name a piece. */
export type RepertoirePieceLike = Pick<RepertoirePiece, 'id' | 'title'>

/**
 * The curriculum's very first lesson (level `MIN_LEVEL`, `lessonsForLevel`'s
 * own order) — the `lesson` segment's last-resort fallback (roadmap 4.10).
 * Computed once at module load: `CURRICULUM` is static content, not
 * per-learner state, so there is nothing to recompute per call. `undefined`
 * only if the curriculum somehow shipped with an empty level 1, which
 * `curriculum.test.ts` already guards against elsewhere.
 */
const FIRST_CURRICULUM_LESSON = lessonsForLevel(CURRICULUM, MIN_LEVEL)[0]

/**
 * The `lesson` segment's candidate (roadmap 4.10, M4 acceptance Defect 1b —
 * see the module doc's numbered list for the full three-deep fallback and
 * ambiguity (4) for what "Open" does and does not do for the two fallbacks
 * added here). A loaded score always wins; failing that, the learner's own
 * first repertoire piece; failing that, the curriculum's first lesson, which
 * exists unconditionally so this never returns empty on a real curriculum.
 */
function lessonCandidates(
  loadedScore: LoadedScore | undefined,
  repertoirePieces: readonly RepertoirePieceLike[],
): readonly Exercise[] {
  if (loadedScore !== undefined) {
    return [
      {
        id: `lesson-${loadedScore.sourceName}`,
        kind: 'repertoire',
        title: `Practice: ${loadedScore.sourceName}`,
        estimatedMinutes: OPEN_ENDED_MINUTES,
        params: {},
      },
    ]
  }

  const firstPiece = repertoirePieces[0]
  if (firstPiece !== undefined) {
    return [
      {
        id: `lesson-repertoire-${firstPiece.id}`,
        kind: 'repertoire',
        title: `Practice: ${firstPiece.title}`,
        estimatedMinutes: OPEN_ENDED_MINUTES,
        params: {},
      },
    ]
  }

  if (FIRST_CURRICULUM_LESSON === undefined) return []
  return [
    {
      id: `lesson-curriculum-${FIRST_CURRICULUM_LESSON.id}`,
      kind: 'play',
      title: `Lesson: ${FIRST_CURRICULUM_LESSON.title}`,
      estimatedMinutes: OPEN_ENDED_MINUTES,
      params: {},
    },
  ]
}

export type SessionCandidatesInput = {
  readonly sightReadingLevel: number
  readonly loadedScore: LoadedScore | undefined
  /** The playing-track level the technique drills are drawn from. Defaults to level 1. */
  readonly techniqueLevel?: number
  /**
   * The learner's own repertoire library, in the store's insertion order
   * (roadmap 4.10) — `lessonCandidates`' second-priority fallback. Defaults
   * to empty, which is exactly a cold profile's real state (the library is
   * never auto-seeded from the graded catalogue — see `repertoire-seed.spec.ts`).
   */
  readonly repertoirePieces?: readonly RepertoirePieceLike[]
}

/**
 * The one candidate for the warm-up segment (roadmap 5.45) — always offered,
 * unconditionally: unlike every other segment it needs no app state (no
 * level, no loaded score) to decide what to show, because the routine is
 * fixed. `SessionPlanScreen.tsx` opens it as a real checklist, not by
 * routing through `Shell.tsx`'s `destinationFor` the way the other kinds do
 * — see `warmups.ts`'s comment on why `Exercise.kind` is `'technique'` here
 * but is not what decides how this item opens.
 */
function warmupCandidates(): readonly Exercise[] {
  return [WARMUP_EXERCISE]
}

/** Builds `planSession`'s `candidates` option from what the app can offer today. */
export function sessionCandidates(
  input: SessionCandidatesInput,
): Record<SessionSegmentKind, readonly Exercise[]> {
  return {
    warmup: warmupCandidates(),
    technique: techniqueCandidates(input.techniqueLevel ?? MIN_LEVEL),
    'sight-reading': sightReadingCandidates(input.sightReadingLevel),
    lesson: lessonCandidates(input.loadedScore, input.repertoirePieces ?? []),
    'theory-ear': theoryEarCandidates(),
  }
}
