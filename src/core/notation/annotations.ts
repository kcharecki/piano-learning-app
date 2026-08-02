/**
 * Annotations: fingering edits, highlights and per-measure text notes, kept
 * per score (REQ-3.2.6, roadmap 4.8).
 *
 * `Annotation` is a discriminated union rather than three parallel maps so a
 * caller can hold "one list of edits" and dispatch on `kind` — the shape the
 * app's persistence layer stores wholesale, one `ScoreAnnotations` per score
 * id (see `@core/ports/store.ts`'s `COLLECTIONS.annotations`).
 *
 * Invariants `setAnnotation`/`removeAnnotation` maintain:
 *  - at most one `fingering` and one `highlight` annotation per `noteId` —
 *    `setAnnotation` replaces the existing one, keyed by `noteId` alone (the
 *    finger/colour value itself is not part of the identity);
 *  - `note` annotations accumulate per `measureIndex` — several measure notes
 *    can coexist, so `setAnnotation` always appends one rather than replacing.
 *
 * `applyAnnotations` is the point of the whole module for REQ-3.2.6: an edited
 * fingering must be what the engraver actually draws, so it has to become
 * part of the `Score` the viewer renders, not live only in a side table.
 */
import { assertNever } from '@core/shared/invariant.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import type { Score } from './score.ts'

export type AnnotationKind = 'fingering' | 'highlight' | 'note'

export type Annotation =
  | { readonly kind: 'fingering'; readonly noteId: string; readonly finger: number }
  | { readonly kind: 'highlight'; readonly noteId: string; readonly colour: string }
  | { readonly kind: 'note'; readonly measureIndex: number; readonly text: string }

/** All annotations for one score, keyed by score id at the storage layer. */
export type ScoreAnnotations = { readonly scoreId: string; readonly items: readonly Annotation[] }

/** A conventional piano fingering: thumb (1) through little finger (5). */
export const MIN_FINGER = 1
export const MAX_FINGER = 5

export function emptyAnnotations(scoreId: string): ScoreAnnotations {
  return { scoreId, items: [] }
}

/** True for the two kinds identified by `noteId` (as opposed to `note`, identified by `measureIndex`). */
function isNoteKeyed(
  item: Annotation,
): item is Extract<Annotation, { readonly noteId: string }> {
  return item.kind === 'fingering' || item.kind === 'highlight'
}

/**
 * Add or replace. `fingering`/`highlight` replace whichever existing item
 * shares their `kind` and `noteId` — see the module comment. `note` always
 * appends: several notes on the same measure are the point.
 */
export function setAnnotation(a: ScoreAnnotations, item: Annotation): ScoreAnnotations {
  if (item.kind === 'note') return { ...a, items: [...a.items, item] }
  const kept = a.items.filter(
    (existing) => !(isNoteKeyed(existing) && existing.kind === item.kind && existing.noteId === item.noteId),
  )
  return { ...a, items: [...kept, item] }
}

/**
 * Identity used by `removeAnnotation`: `fingering`/`highlight` match on
 * `kind` + `noteId` alone (there is only ever one, so the finger/colour value
 * carried on `item` is not needed to find it); `note` matches the exact
 * `measureIndex` + `text` pair, since several can coexist on one measure.
 */
function sameAnnotation(existing: Annotation, item: Annotation): boolean {
  if (existing.kind !== item.kind) return false
  switch (item.kind) {
    case 'fingering':
      return existing.kind === 'fingering' && existing.noteId === item.noteId
    case 'highlight':
      return existing.kind === 'highlight' && existing.noteId === item.noteId
    case 'note':
      return (
        existing.kind === 'note' &&
        existing.measureIndex === item.measureIndex &&
        existing.text === item.text
      )
    default:
      return assertNever(item)
  }
}

/**
 * Removes the matching item. `fingering`/`highlight` have at most one match
 * (identified by noteId alone), so removing it removes the annotation
 * entirely. `note` annotations can have several with the same
 * measureIndex+text (the module allows duplicates to accumulate), so this
 * removes only the FIRST match — one `removeMeasureNote` call for one
 * `addMeasureNote` call, not all of them at once.
 */
export function removeAnnotation(a: ScoreAnnotations, item: Annotation): ScoreAnnotations {
  const index = a.items.findIndex((existing) => sameAnnotation(existing, item))
  if (index === -1) return a
  return { ...a, items: [...a.items.slice(0, index), ...a.items.slice(index + 1)] }
}

export function fingeringFor(a: ScoreAnnotations, noteId: string): number | undefined {
  for (const item of a.items) {
    if (item.kind === 'fingering' && item.noteId === noteId) return item.finger
  }
  return undefined
}

export function highlightFor(a: ScoreAnnotations, noteId: string): string | undefined {
  for (const item of a.items) {
    if (item.kind === 'highlight' && item.noteId === noteId) return item.colour
  }
  return undefined
}

export function notesForMeasure(a: ScoreAnnotations, measureIndex: number): readonly string[] {
  const out: string[] = []
  for (const item of a.items) {
    if (item.kind === 'note' && item.measureIndex === measureIndex) out.push(item.text)
  }
  return out
}

/**
 * Apply the fingering annotations to a Score, returning a new Score whose
 * notes carry the edited `fingering` — REQ-3.2.6's own point: an edited
 * fingering must be what the engraver draws. Every other note, and every
 * other field of an annotated note, is left exactly as it was. Highlights and
 * measure notes are UI-only overlays with nothing on `ScoreNote` to carry
 * them, so they are not touched here.
 */
export function applyAnnotations(score: Score, a: ScoreAnnotations): Score {
  const fingerings = new Map<string, number>()
  for (const item of a.items) {
    if (item.kind === 'fingering') fingerings.set(item.noteId, item.finger)
  }
  if (fingerings.size === 0) return score
  const notes = score.notes.map((n) => {
    const finger = fingerings.get(n.id)
    return finger === undefined ? n : { ...n, fingering: finger }
  })
  return { ...score, notes }
}

// ------------------------------------------------------------------ validation

function isValidFinger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_FINGER && value <= MAX_FINGER
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isValidAnnotationItem(value: unknown): value is Annotation {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.kind === 'fingering') return isNonEmptyString(v.noteId) && isValidFinger(v.finger)
  if (v.kind === 'highlight') return isNonEmptyString(v.noteId) && isNonEmptyString(v.colour)
  if (v.kind === 'note') {
    return (
      typeof v.measureIndex === 'number' &&
      Number.isInteger(v.measureIndex) &&
      v.measureIndex >= 0 &&
      isNonEmptyString(v.text)
    )
  }
  return false
}

/**
 * Structural validation of untrusted stored data — a corrupt or hand-edited
 * IndexedDB entry, not a programmer error, so this returns a `Result` rather
 * than throwing (matching `persistence.ts`'s `isValidXxx` checks).
 *
 * The result is a freshly-built `ScoreAnnotations`, not an alias of the input
 * array: every item is folded through `setAnnotation`, which both copies the
 * data (so callers never hand a store's raw parsed JSON into app state) and
 * collapses any duplicate fingering/highlight per noteId down to one, per the
 * module's own at-most-one-per-noteId invariant.
 */
export function validateAnnotations(value: unknown): Result<ScoreAnnotations, string> {
  if (typeof value !== 'object' || value === null) return err('annotations must be an object')
  const v = value as Record<string, unknown>
  if (!isNonEmptyString(v.scoreId)) return err('annotations scoreId must be a non-empty string')
  const items = v.items
  if (!Array.isArray(items)) return err('annotations items must be an array')
  for (let i = 0; i < items.length; i++) {
    if (!isValidAnnotationItem(items[i])) return err(`annotation item ${i} is invalid`)
  }
  let result = emptyAnnotations(v.scoreId)
  for (const item of items as Annotation[]) {
    result = setAnnotation(result, item)
  }
  return ok(result)
}
