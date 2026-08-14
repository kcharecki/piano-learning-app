/**
 * The seam between `ScoreViewer` and OpenSheetMusicDisplay.
 *
 * OSMD is a large DOM/canvas library that cannot run in happy-dom, so every
 * component test drives `ScoreViewer` through a fake implementing this
 * contract (see `ScoreViewer.test.tsx`) instead of the real thing.
 * `osmdEngraver.ts` — the only file that imports `opensheetmusicdisplay` — is
 * the sole real implementation, so nothing else in the app depends on OSMD.
 */
import type { Score } from '@core/notation/score.ts'

export type ScoreEngraver = {
  /** Render `musicXml` into `container`. `score` is the same music, used to key note colouring. */
  load(container: HTMLElement, musicXml: string, score: Score): Promise<void>
  /** Move the position cursor to the given measure, no later than `tick` within it. */
  moveCursorTo(measureIndex: number, tick: number): void
  /** Colour a single note, keyed by `ScoreNote.id` (see `@core/notation/score.ts`). */
  setNoteColor(noteId: string, color: string): void
  /** Restore every note coloured by `setNoteColor` back to its default. */
  clearNoteColors(): void
  /**
   * Occlude (or reveal) a single note for the read-ahead drill (roadmap 2.26,
   * REQ-3.4.5), keyed by `ScoreNote.id`. Independent of `setNoteColor`: a
   * hidden note stays hidden regardless of what colour is requested for it,
   * and reveals showing whatever colour was last requested (or the default).
   */
  setNoteHidden(noteId: string, hidden: boolean): void
  /** Reveal every note hidden via `setNoteHidden`. Colours from `setNoteColor` are unaffected. */
  clearHiddenNotes(): void
  /** Release everything the engraver holds — DOM nodes, listeners, the OSMD instance. */
  destroy(): void
  /**
   * The `ScoreNote.id` of the notehead at this event's target, or `undefined`
   * when the click did not land on a mapped notehead. Never throws.
   */
  noteIdAt(target: EventTarget | null): string | undefined
}

export type EngraverFactory = () => ScoreEngraver

/**
 * How `ScoreViewer` chromes the frame around an engraving (roadmap UI-06).
 * The two fields travel through entirely different paths, not one:
 *
 * - `title` reaches the engraver at CONSTRUCTION time — it becomes an OSMD
 *   drawing option (`drawTitle`/`drawComposer`; see `osmdEngraver.ts`'s
 *   `OsmdEngraverOptions.chrome` and `resolveOsmdOptions`), because OSMD only
 *   reads that option when the score is engraved, not afterwards.
 * - `compact` never reaches the engraver at all. `ScoreViewer` applies it
 *   directly as a CSS modifier (`.paper--compact` in domain.css) on its own
 *   frame element — there is nothing OSMD-specific about tighter padding.
 *
 * Absent (the default) means today's behaviour exactly: title chrome drawn,
 * default (non-compact) paper padding. This type is not part of the
 * `ScoreEngraver` interface itself — like `setMeasureLabels` before it, it is
 * additive, so every existing `ScoreEngraver` implementation (including every
 * test fake) is unaffected by its existence.
 */
export type ScoreChrome = {
  /** `false` suppresses the title/subtitle/composer block OSMD would otherwise draw. Default true (drawn). */
  readonly title?: boolean
  /** `true` applies the tighter `.paper--compact` padding instead of the default paper margins. Default false. */
  readonly compact?: boolean
}
