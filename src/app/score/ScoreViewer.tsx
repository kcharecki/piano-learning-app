/**
 * Score viewer (roadmap 1.17, REQ-3.2.4). Wraps OSMD behind the `ScoreEngraver`
 * seam (`engraver.ts`) so nothing outside this file ever touches the library
 * directly, and so tests can drive it with a fake engraver instead of a real
 * DOM/canvas render.
 */
import type { Score } from '@core/notation/score.ts'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import type { EngraverFactory, ScoreChrome, ScoreEngraver } from './engraver.ts'
import { createOsmdEngraver } from './osmdEngraver.ts'

/**
 * `ScoreEngraver` plus an OPTIONAL `setMeasureLabels` (roadmap 3.18a). The
 * shared `ScoreEngraver` interface (`engraver.ts`) is not extended for this —
 * it is a dependency of `src/app/score/`, not owned by this change — so the
 * capability is added here, locally, as a structurally-optional extra: any
 * value satisfying plain `ScoreEngraver` (e.g. every existing test fake)
 * still satisfies this type unchanged, while the real `createOsmdEngraver`
 * (which DOES implement the method) is called through the optional-chained
 * call below. This is what keeps the new capability additive without
 * touching a file outside this module's own remit.
 */
type EngraverWithMeasureLabels = ScoreEngraver & {
  setMeasureLabels?(labels: ReadonlyMap<number, string>): void
}

export type CursorPosition = { readonly measureIndex: number; readonly tick: number }

export type ScoreViewerHandle = {
  moveCursorTo(measureIndex: number, tick: number): void
  setNoteColor(noteId: string, color: string): void
  clearNoteColors(): void
  setNoteHidden(noteId: string, hidden: boolean): void
  clearHiddenNotes(): void
}

export type ScoreViewerProps = {
  readonly musicXml: string
  readonly score: Score
  /** Follows the transport position, if given — moves the cursor as it changes. */
  readonly cursorPosition?: CursorPosition
  /** Injection seam for tests. Defaults to the real OSMD-backed engraver. */
  readonly createEngraver?: EngraverFactory
  /** Called with the clicked note's id, or `undefined` when the click hit no notehead. */
  readonly onSelectNote?: (noteId: string | undefined) => void
  /** Text to place under each measure, keyed by 1-based measure number
   *  (roadmap 3.18a). Absent means today's behaviour exactly. */
  readonly measureLabels?: ReadonlyMap<number, string>
  /** How to chrome the frame around this engraving — title block and paper
   *  padding (roadmap UI-06). Absent means today's behaviour exactly: title
   *  drawn, default paper padding. See `ScoreChrome` in `engraver.ts`.
   *  Ignored when `createEngraver` is also given — an injected factory owns
   *  its own construction, the same way it already owns everything else
   *  about how the engraver is built. */
  readonly chrome?: ScoreChrome
}

export const ScoreViewer = forwardRef<ScoreViewerHandle, ScoreViewerProps>(function ScoreViewer(
  {
    musicXml,
    score,
    cursorPosition,
    createEngraver,
    onSelectNote,
    measureLabels,
    chrome,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const engraverRef = useRef<EngraverWithMeasureLabels | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const chromeTitle = chrome?.title

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return undefined
    // No `createEngraver` override: build the real OSMD-backed engraver
    // ourselves so `chrome.title` (a construction-time OSMD option, see
    // `ScoreChrome` in engraver.ts) can reach it. An override supplied by the
    // caller is called exactly as before — bare, no arguments — because it
    // owns its own construction already (roadmap 3.18a's `createEngraver`
    // contract predates this prop). `chromeTitle === undefined` (every
    // existing caller, since none passes `chrome` at all) calls
    // `createOsmdEngraver()` with literally zero arguments — the exact call
    // today's callers already make — rather than
    // `createOsmdEngraver({ chrome: { title: undefined } })`, which
    // `exactOptionalPropertyTypes` treats as a different (invalid) shape from
    // omitting the key entirely.
    const engraver = (
      createEngraver ??
      (() =>
        chromeTitle === undefined
          ? createOsmdEngraver()
          : createOsmdEngraver({ chrome: { title: chromeTitle } }))
    )()
    engraverRef.current = engraver
    setError(undefined)
    let cancelled = false
    engraver.load(container, musicXml, score).catch((reason: unknown) => {
      if (cancelled) return
      setError(reason instanceof Error ? reason.message : 'could not render the score')
    })
    return () => {
      cancelled = true
      engraverRef.current = undefined
      engraver.destroy()
      // `destroy()` calls OSMD's own `clear()`, which does not empty the
      // container synchronously. React reuses this DOM node when the score
      // changes in place (switching between two lessons that both carry a
      // staff diagram, for instance), so without this the next `load()`
      // appends its engraving ALONGSIDE the previous one and the learner sees
      // both scores stacked for a frame before OSMD catches up. Measured at
      // under 60ms, but visible, and it made a lesson-diagram e2e flaky by
      // resolving one container to two `<svg>` elements.
      container.replaceChildren()
    }
    // Depends on `chromeTitle` (the primitive `chrome?.title`), not `chrome`
    // itself — `chrome.compact` never reaches the engraver (it only ever
    // changes the frame's className below, no reload needed), so a caller
    // that passes a fresh `chrome` object literal every render (only
    // `compact` differing, or no difference at all) must not pay for a
    // spurious engraver reload it didn't ask for.
  }, [musicXml, score, createEngraver, chromeTitle])

  useEffect(() => {
    if (cursorPosition === undefined) return
    engraverRef.current?.moveCursorTo(cursorPosition.measureIndex, cursorPosition.tick)
  }, [cursorPosition])

  // Absent prop -> never called at all, so a caller that never passes
  // `measureLabels` gets exactly today's behaviour (roadmap 3.18a contract).
  // Optional-chained on `setMeasureLabels` itself too: a fake engraver from a
  // test that only implements plain `ScoreEngraver` is a safe no-op here,
  // same as it already is for a click before `load()` created a real one.
  useEffect(() => {
    if (measureLabels === undefined) return
    engraverRef.current?.setMeasureLabels?.(measureLabels)
    // Also depends on the load effect's own identities (musicXml/score/
    // createEngraver): that effect recreates `engraverRef.current` whenever
    // any of them change, and `destroy()` on the old engraver wipes its
    // cached labels — a NEW engraver is never told about them unless this
    // effect re-runs too. React runs effects in declaration order, so the
    // load effect above has already installed the new engraver by the time
    // this one fires, and the load-tail catch-up in osmdEngraver covers the
    // async race for the very first load (roadmap-review finding 1).
  }, [measureLabels, musicXml, score, createEngraver])

  useImperativeHandle(
    ref,
    () => ({
      moveCursorTo: (measureIndex, tick) => engraverRef.current?.moveCursorTo(measureIndex, tick),
      setNoteColor: (noteId, color) => engraverRef.current?.setNoteColor(noteId, color),
      clearNoteColors: () => engraverRef.current?.clearNoteColors(),
      setNoteHidden: (noteId, hidden) => engraverRef.current?.setNoteHidden(noteId, hidden),
      clearHiddenNotes: () => engraverRef.current?.clearHiddenNotes(),
    }),
    [],
  )

  // One listener on the container, not one per notehead (roadmap 4.8a) — the
  // engraver walks up from `event.target` to the nearest stamped notehead.
  // Fires for every click on the score, including a miss (empty staff),
  // which resolves to `undefined` and so clears the caller's selection.
  //
  // Known gap (roadmap-review finding, low severity): selection is mouse-only
  // — the container below has no `role`/`tabIndex`/key handler, so the
  // fingering/highlight controls this unlocks have no keyboard path. Left
  // unaddressed here rather than added ad hoc; needs a named roadmap task
  // (arrow-key note stepping) rather than a one-line bolt-on.
  function handleContainerClick(event: MouseEvent<HTMLDivElement>): void {
    onSelectNote?.(engraverRef.current?.noteIdAt(event.target))
  }

  // `chrome.compact` never touches the engraver (see the load effect above)
  // — it is read directly here, every render, same as any other className.
  const frameClassName =
    chrome?.compact === true ? 'score-viewer notation-frame paper--compact' : 'score-viewer notation-frame'

  return (
    <div className={frameClassName} style={{ position: 'relative' }}>
      {error !== undefined && (
        <p role="alert" className="score-viewer-error">
          Could not display this score: {error}
        </p>
      )}
      <div ref={containerRef} data-testid="score-container" onClick={handleContainerClick} />
    </div>
  )
})
