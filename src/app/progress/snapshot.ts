/**
 * The impure edge of progress export/import (roadmap 4.6a, REQ-3.10.4/4.3):
 * gathers a `ProgressSnapshot` (`@core/progress/export.ts`) out of the app's
 * zustand stores, and applies a restored one back into them. `ExportPanel`
 * calls these two functions and never reads or writes a store directly, so
 * the store read/write — the actual impure part — lives here, not in the
 * component.
 *
 * ## What is, and is not, in the snapshot today
 *
 * `ProgressSnapshot`'s shape is a fixed contract owned by `@core/progress/export.ts`
 * (not this file) and only covers stores that exist:
 *  - `practiceEntries` — `useProgressStore().practiceEntries`, exactly (the
 *    core `PracticeEntry` type is what that store already holds).
 *  - `srsCards` — `useFlashcardStore().cardsById`, flattened to an array.
 *  - `sightReadingHistory` — `useSightReadingStore().history`, exactly.
 *  - `levels` — only `'sight-reading'` has a real persisted level anywhere in
 *    the app (`useSightReadingStore().level`); `playing` and `theory` have no
 *    `LevelState` store yet (see `useDashboard.ts`'s module comment for the
 *    same gap), so this snapshot cannot honestly report them and does not
 *    invent a value for either.
 *  - `repertoire` — always `[]`: no store persists a `RepertoirePieceLike` list
 *    anywhere in the app yet, matching `useDashboard.ts`'s `repertoirePieces`.
 *    `applyProgressSnapshot` has nothing to write a restored one into either,
 *    so a snapshot's `repertoire` field is round-tripped through the JSON
 *    envelope (for a future consumer) but otherwise ignored here.
 *  - `assessments` — `useProgressStore().assessments`, projected through
 *    `StoredAssessmentLike`. This projection is LOSSY: `StoredAssessmentLike`
 *    keeps only `id`/`at`/`accuracy`/`kind`/`itemId` (the export module's own
 *    structural minimum), so a restored `StoredAssessment`'s `result` is a
 *    reconstruction carrying just the recovered `accuracy` — timing
 *    consistency, per-measure breakdown and tempo are NOT preserved by this
 *    export format. `scoreTitle`/`scoreId` round-trip via `kind`/`itemId`.
 *  - `techniqueAttempts` — `useTechniqueStore().attempts` (roadmap 4.4b,
 *    REQ-3.7.2/3.7.3), exactly. This IS a first-class, required field of
 *    `@core/progress/export.ts`'s own `ProgressSnapshot` type, so it round-trips
 *    through a real exported JSON file exactly like every other collection:
 *    `exportJson` writes it and `importProgress` restores it, including for a
 *    file exported before this field existed (`importProgress` defaults a
 *    missing `techniqueAttempts` to `[]` — see that module's doc comment).
 *    Nothing here needs to widen `ProgressSnapshot` locally any more.
 */
import {
  useProgressStore,
  MAX_STORED_ASSESSMENTS,
  MAX_STORED_PRACTICE_ENTRIES,
  type StoredAssessment,
} from '@app/state/progressStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useTechniqueStore, MAX_STORED_TECHNIQUE_ATTEMPTS } from '@app/state/techniqueStore.ts'
import {
  MIN_LEVEL as SIGHT_READING_MIN_LEVEL,
  MAX_LEVEL as SIGHT_READING_MAX_LEVEL,
} from '@core/sightreading/adaptive.ts'
import type { DateSource } from '@core/ports/index.ts'
import type { ProgressSnapshot, StoredAssessmentLike } from '@core/progress/export.ts'

/**
 * The only track key `levels` carries today — see the module comment. Named
 * distinctly from the `Track` key `'sight-reading'` in `@core/curriculum/types.ts`
 * so a future `LevelState` restore can never mistake this generator-difficulty
 * number for a curriculum track level.
 */
export const SIGHT_READING_LEVEL_KEY = 'sight-reading-exercise'

function toStoredAssessmentLike(assessment: StoredAssessment): StoredAssessmentLike {
  return {
    id: assessment.id,
    at: assessment.at,
    accuracy: assessment.result.accuracy,
    kind: assessment.scoreTitle,
    itemId: assessment.scoreId,
  }
}

/**
 * Reconstructs a `StoredAssessment` from the structural minimum a snapshot
 * carries. `result` is fabricated around the one number that survived
 * (`accuracy`) — see the module comment on why the rest cannot be recovered.
 */
function toStoredAssessment(like: StoredAssessmentLike): StoredAssessment {
  const scoreId = like.itemId ?? like.id
  return {
    id: like.id,
    scoreId,
    scoreTitle: like.kind ?? scoreId,
    at: like.at,
    result: {
      scoreId,
      accuracy: like.accuracy,
      timingConsistency: 0,
      meanAbsDeviationMs: 0,
      tempoBpm: 0,
      measures: [],
      counts: { correct: 0, wrongPitch: 0, missed: 0, extra: 0 },
      completedAt: like.at,
    },
  }
}

/** Gathers everything the app currently persists into one `ProgressSnapshot`. */
export function gatherProgressSnapshot(date: DateSource): ProgressSnapshot {
  const progress = useProgressStore.getState()
  const flashcards = useFlashcardStore.getState()
  const sightReading = useSightReadingStore.getState()
  const technique = useTechniqueStore.getState()

  return {
    version: 1,
    exportedAt: date.epochMillis(),
    practiceEntries: progress.practiceEntries,
    srsCards: Object.values(flashcards.cardsById),
    sightReadingHistory: sightReading.history,
    levels: { [SIGHT_READING_LEVEL_KEY]: sightReading.level },
    repertoire: [],
    assessments: progress.assessments.map(toStoredAssessmentLike),
    techniqueAttempts: technique.attempts,
  }
}

/**
 * Applies a restored `ProgressSnapshot` back into every store that has one —
 * REPLACING their current contents, not merging. The caller (`ExportPanel`)
 * is responsible for confirming this with the learner first.
 */
export function applyProgressSnapshot(snapshot: ProgressSnapshot): void {
  useProgressStore.getState().hydrate({
    practiceEntries: snapshot.practiceEntries.slice(0, MAX_STORED_PRACTICE_ENTRIES),
    assessments: snapshot.assessments.map(toStoredAssessment).slice(0, MAX_STORED_ASSESSMENTS),
  })

  useFlashcardStore
    .getState()
    .hydrate(Object.fromEntries(snapshot.srsCards.map((card) => [card.id, card])))

  const rawLevel = snapshot.levels[SIGHT_READING_LEVEL_KEY] ?? SIGHT_READING_MIN_LEVEL
  const restoredLevel = Math.min(
    SIGHT_READING_MAX_LEVEL,
    Math.max(SIGHT_READING_MIN_LEVEL, Math.round(rawLevel)),
  )
  useSightReadingStore.getState().hydrate(restoredLevel, snapshot.sightReadingHistory)

  useTechniqueStore.getState().hydrate({
    attempts: snapshot.techniqueAttempts.slice(0, MAX_STORED_TECHNIQUE_ATTEMPTS),
  })
}
