/**
 * The app half of annotations (roadmap 4.8, REQ-3.2.6): reads the currently
 * loaded score from `useScoreStore`, reads/writes that score's
 * `ScoreAnnotations` in `useAnnotationStore`, and hands back `annotatedScore`
 * — the score with fingering edits applied — which is what the viewer must
 * render instead of the raw loaded score for an edited fingering to actually
 * show up (REQ-3.2.6's own point; see `applyAnnotations`'s module comment).
 *
 * All editing decisions (replace-per-note fingering/highlight, accumulate-per-
 * measure notes) live in `@core/notation/annotations.ts`; this hook only
 * reads the current score id, calls the core function, and writes the result
 * back through `useAnnotationStore.setAnnotations`. No annotation exists
 * without a loaded score — every setter below is a no-op when nothing is
 * loaded, since there is no score id to file the edit under.
 */
import {
  applyAnnotations,
  emptyAnnotations,
  fingeringFor,
  highlightFor,
  MAX_FINGER,
  MIN_FINGER,
  notesForMeasure,
  removeAnnotation,
  setAnnotation,
  type ScoreAnnotations,
} from '@core/notation/annotations.ts'
import type { Score } from '@core/notation/score.ts'
import { useMemo } from 'react'
import { useAnnotationStore } from '@app/state/annotationStore.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'

export type UseAnnotationsResult = {
  readonly scoreId: string | undefined
  readonly annotations: ScoreAnnotations
  /** The loaded score with fingering edits applied — what the viewer should render. */
  readonly annotatedScore: Score | undefined
  fingeringFor(noteId: string): number | undefined
  highlightFor(noteId: string): string | undefined
  notesForMeasure(measureIndex: number): readonly string[]
  setFingering(noteId: string, finger: number): void
  removeFingering(noteId: string): void
  setHighlight(noteId: string, colour: string): void
  removeHighlight(noteId: string): void
  addMeasureNote(measureIndex: number, text: string): void
  removeMeasureNote(measureIndex: number, text: string): void
}

export function useAnnotations(): UseAnnotationsResult {
  const score = useScoreStore((s) => s.loaded?.score)
  const byScoreId = useAnnotationStore((s) => s.byScoreId)
  const setAnnotations = useAnnotationStore((s) => s.setAnnotations)

  const scoreId = score?.id
  const annotations = useMemo(
    () => (scoreId === undefined ? emptyAnnotations('') : (byScoreId[scoreId] ?? emptyAnnotations(scoreId))),
    [scoreId, byScoreId],
  )
  const annotatedScore = useMemo(
    () => (score === undefined ? undefined : applyAnnotations(score, annotations)),
    [score, annotations],
  )

  // Reads the CURRENT store state rather than closing over the `annotations`
  // captured at render time: two setters called inside one batched React
  // event handler must each see the other's write, not both derive from the
  // same pre-edit snapshot (which would silently drop the first one).
  const update = (mutate: (current: ScoreAnnotations) => ScoreAnnotations): void => {
    if (scoreId === undefined) return
    const current = useAnnotationStore.getState().byScoreId[scoreId] ?? emptyAnnotations(scoreId)
    setAnnotations(scoreId, mutate(current))
  }

  return {
    scoreId,
    annotations,
    annotatedScore,

    fingeringFor: (noteId) => fingeringFor(annotations, noteId),
    highlightFor: (noteId) => highlightFor(annotations, noteId),
    notesForMeasure: (measureIndex) => notesForMeasure(annotations, measureIndex),

    setFingering: (noteId, finger) => {
      if (!Number.isInteger(finger) || finger < MIN_FINGER || finger > MAX_FINGER) return
      update((current) => setAnnotation(current, { kind: 'fingering', noteId, finger }))
    },
    removeFingering: (noteId) =>
      update((current) => removeAnnotation(current, { kind: 'fingering', noteId, finger: 0 })),
    setHighlight: (noteId, colour) =>
      update((current) => setAnnotation(current, { kind: 'highlight', noteId, colour })),
    removeHighlight: (noteId) =>
      update((current) => removeAnnotation(current, { kind: 'highlight', noteId, colour: '' })),
    addMeasureNote: (measureIndex, text) =>
      update((current) => setAnnotation(current, { kind: 'note', measureIndex, text })),
    removeMeasureNote: (measureIndex, text) =>
      update((current) => removeAnnotation(current, { kind: 'note', measureIndex, text })),
  }
}
