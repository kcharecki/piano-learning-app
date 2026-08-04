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
 *  - `lesson`: the currently loaded score, if any — practicing what is
 *    already open, not inventing a lesson.
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
 */
import { MAX_LEVEL, MIN_LEVEL, type Exercise } from '@core/curriculum/types.ts'
import type { SessionSegmentKind } from '@core/curriculum/session.ts'
import type { LoadedScore } from '@app/state/scoreStore.ts'
import { techniqueLibrary } from '@core/technique/library.ts'

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

function sightReadingCandidates(sightReadingLevel: number): readonly Exercise[] {
  const level = clampLevel(sightReadingLevel)
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

function lessonCandidates(loadedScore: LoadedScore | undefined): readonly Exercise[] {
  if (loadedScore === undefined) return []
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

export type SessionCandidatesInput = {
  readonly sightReadingLevel: number
  readonly loadedScore: LoadedScore | undefined
  /** The playing-track level the technique drills are drawn from. Defaults to level 1. */
  readonly techniqueLevel?: number
}

/** Builds `planSession`'s `candidates` option from what the app can offer today. */
export function sessionCandidates(
  input: SessionCandidatesInput,
): Record<SessionSegmentKind, readonly Exercise[]> {
  return {
    technique: techniqueCandidates(input.techniqueLevel ?? MIN_LEVEL),
    'sight-reading': sightReadingCandidates(input.sightReadingLevel),
    lesson: lessonCandidates(input.loadedScore),
    'theory-ear': theoryEarCandidates(),
  }
}
