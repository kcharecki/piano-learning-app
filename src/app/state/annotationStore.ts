/**
 * Annotation state (roadmap 4.8, REQ-3.2.6) — every score's `ScoreAnnotations`,
 * keyed by score id, so switching between pieces never loses another piece's
 * edits held in memory during the session.
 *
 * STATE ONLY, matching `flashcardStore.ts`/`progressStore.ts`'s rule: the
 * actual edit logic (replace-per-note, accumulate-per-measure) lives in
 * `@core/notation/annotations.ts` and is invoked from `useAnnotations.ts`,
 * which reads `byScoreId` and writes the result back through `setAnnotations`.
 *
 * `hydrate` (matching `flashcardStore`'s own) replaces `byScoreId` wholesale —
 * it exists for the main thread's `persistence.ts` slice (see this module's
 * consumer, `useAnnotations.ts`, and the annotation panel's report) to apply
 * previously-saved annotations; every other caller keeps using `setAnnotations`.
 */
import type { ScoreAnnotations } from '@core/notation/annotations.ts'
import { create } from 'zustand'

export type AnnotationStoreState = {
  readonly byScoreId: Readonly<Record<string, ScoreAnnotations>>
}

export type AnnotationStoreActions = {
  /** Replaces the `ScoreAnnotations` for one score id, leaving the others untouched. */
  setAnnotations(scoreId: string, annotations: ScoreAnnotations): void
  /** Replaces `byScoreId` wholesale — used by `persistence.ts`'s restore step. */
  hydrate(byScoreId: Readonly<Record<string, ScoreAnnotations>>): void
}

export type AnnotationStore = AnnotationStoreState & AnnotationStoreActions

export const useAnnotationStore = create<AnnotationStore>((set) => ({
  byScoreId: {},

  setAnnotations: (scoreId, annotations) =>
    set((state) => ({ byScoreId: { ...state.byScoreId, [scoreId]: annotations } })),
  hydrate: (byScoreId) => set({ byScoreId }),
}))
