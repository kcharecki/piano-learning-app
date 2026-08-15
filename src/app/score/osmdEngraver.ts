/**
 * The real `ScoreEngraver`, wrapping OpenSheetMusicDisplay. See `engraver.ts`
 * for the contract and why this file is the only OSMD import in the app.
 *
 * Note colouring needs a way from our `ScoreNote.id` to the `Note` object OSMD
 * built while parsing the same MusicXML. OSMD exposes no such lookup, so
 * `buildNoteIdMap` derives one: for each measure, our `score.notes` (already
 * sorted by `startTick` then `midi` — see notation/score.ts) and OSMD's own
 * per-measure notes (walked in document order: vertical position, then staff,
 * then voice, chords sorted by `halfTone`) are two lists that describe the
 * same notes in the same order. Zipping them index-for-index is far more
 * robust than trying to reproduce OSMD's pitch encoding. If a measure's counts
 * ever disagree — a future OSMD version, an edge case in the matching — that
 * measure's notes are simply left uncoloured rather than mismatched or thrown.
 *
 * ## Rendering (roadmap 2.21, and the 2.3x performance round)
 *
 * `osmd.render()` re-engraves the ENTIRE score synchronously. Roadmap 2.21
 * batched that cost down to one `render()` per animation frame regardless of
 * how many notes changed within it — but measured against a real 102-measure,
 * 1603-note import (Pachelbel's Canon in D), one full re-engrave per frame was
 * still ruinous: p95 animation-frame gap 551ms, worst 564ms, 13 long tasks in
 * 6 seconds, only 28 frames rendered in 6 seconds, and Stop took 5.3 seconds
 * to respond. The fix is to stop rendering at all for a recolour: `paint` now
 * pushes the colour straight into the already-rendered SVG via
 * `osmd.rules.GNote(note)?.setColor(...)` (OSMD's documented no-re-render
 * path — see `GraphicalNote.d.ts`), so `setNoteColor`/`clearNoteColors`/
 * `setNoteHidden`/`clearHiddenNotes` need no re-engrave at all in the common
 * case. The `NoteheadColor`/`ParentVoiceEntry.StemColor` model-property writes
 * are kept regardless — deliberately, not redundantly — because OSMD itself
 * re-renders on its own initiative (the width watcher re-engraves when the
 * container really changes width), and a re-engrave draws whatever the model
 * currently holds;
 * without the model write, an SVG-only recolour would vanish on the next
 * resize. `requestRender`/`scheduleRender`/the `renderPending` coalescing
 * survive as the FALLBACK path, used only when `paint` reports `'needs-render'`
 * (osmd/rules/GNote unavailable, `GNote` returns nothing, or the SVG mutation
 * throws) — still coalescing any number of such calls within one task into
 * exactly one `render()`, scheduled via the injectable `scheduleRender` (real
 * `requestAnimationFrame` by default). Because `render()` always draws
 * whatever the note objects currently hold, coalescing never drops a
 * mutation — the frame that eventually fires always sees the LAST colour
 * written, even if a dozen calls raced ahead of it.
 */
import type { Score, ScoreNote } from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { OpenSheetMusicDisplay, type IOSMDOptions } from 'opensheetmusicdisplay'
import { stepsToOnsetAtOrBefore } from './cursorSteps.ts'
import type { ScoreChrome, ScoreEngraver } from './engraver.ts'
import {
  DEFAULT_NOTE_COLOR,
  HIDDEN_NOTE_COLOR,
  SCORE_INK,
  FEEDBACK_CLASS_BY_COLOR,
  applyFeedbackClass,
  applyMeasureLabels,
  reapplyFeedbackClasses,
  stampNoteIds,
  type EngravedContainer,
  type EngravedNote,
  type OsmdCursor,
  type OsmdLike,
} from './osmdSvg.ts'
import {
  MIN_CACHEABLE_NOTES,
  engravingCacheKey,
  putCachedEngraving,
  takeCachedEngraving,
  type EngravingCacheEntry,
} from './engravingCache.ts'

/**
 * Backstop against a runaway walk (e.g. a cursor whose `EndReached` never
 * flips), not a plausible real-score limit — Pachelbel's Canon in D, 102
 * measures/1603 notes, produces well under 1_000 onsets. If a real score
 * ever did exceed this, `collectOnsetTicks` truncates rather than hangs, and
 * warns once (see below) so the truncation is visible instead of silently
 * capping the cursor's reach partway through the piece.
 */
const MAX_CURSOR_STEPS = 200_000
/**
 * `moveCursorToIndex` runs on the main thread inside an animation frame, and
 * each step is a real, visible-cursor `cursor.next()` — OSMD's full graphical
 * `Cursor.update()`, not a cheap counter increment. `onsetTicks` (bounded by
 * `MAX_CURSOR_STEPS` above) can be far longer than any single frame can
 * afford to walk, so this caps how many steps ONE `moveCursorToIndex` call
 * may take; a target beyond the budget is approached over several frames
 * instead of stalling the first one.
 */
const MAX_CURSOR_STEPS_PER_MOVE = 4_000

/**
 * How long after the last `resize` event a width-changing re-engrave is
 * allowed to run. Matches the 200ms trailing debounce OSMD's own
 * `handleResize` used before `autoResize: false` replaced it (see
 * `DEFAULT_OSMD_OPTIONS`), so a window drag still costs exactly one
 * re-engrave, at the end.
 */
const RESIZE_DEBOUNCE_MS = 200

const DEFAULT_OSMD_OPTIONS = {
  /**
   * OFF, deliberately — this file does the resizing itself (see
   * `watchContainerWidth` in `load`), because OSMD's own `autoResize` costs a
   * whole redundant engrave on every load.
   *
   * `autoResize: true` makes OSMD call `handleResize(...)` in its constructor,
   * and the last two lines of that method are
   * `window.setTimeout(startCallback, 0)` / `window.setTimeout(endCallback, 1)`
   * — an UNCONDITIONAL, resize-less kick of the end callback, which is
   * `renderAndScrollBack()`, i.e. a full `render()`. Nothing about it is
   * guarded on the container having actually changed size. It lands a
   * millisecond after construction, which on a real score is squarely inside
   * the `await instance.load(musicXml)` below — by the time it runs,
   * `IsReadyToRender()` is true and it re-engraves the entire sheet a second
   * time. Measured on the 102-measure Canon in D import: a plain 548ms full
   * engrave, paid twice, for one load, with no resize involved.
   *
   * What is lost by turning it off is only what this file now does itself:
   * re-engraving when the container's WIDTH really changes. OSMD's version
   * re-engraved on every `window` resize event regardless of whether the score
   * was any narrower for it; the replacement compares the container's actual
   * width against the width the current engraving was laid out at, so a
   * height-only resize is free.
   */
  autoResize: false,
  drawTitle: true,
  followCursor: true,
  // Every score this app engraves is solo piano, so the part name OSMD prints
  // to the left of the first system is always the literal word "Piano" — pure
  // noise that also steals horizontal space from the music (roadmap 5.13's
  // part-name half; its "Untitled Score" half belongs to the generators).
  drawPartNames: false,
  defaultColorMusic: SCORE_INK,
  defaultColorNotehead: SCORE_INK,
  defaultColorStem: SCORE_INK,
  defaultColorRest: SCORE_INK,
  defaultColorLabel: SCORE_INK,
  defaultColorTitle: SCORE_INK,
}

/**
 * How the engraved score is presented.
 *
 * - `'practice'` — the default: a piece being played. Playback cursor shown,
 *   title and tempo mark drawn, page margins as OSMD lays them out.
 * - `'reference'` — a few notes shown to be *read*, not played (the theory
 *   reference's scale staff, roadmap 3.14). A playback cursor highlighting
 *   the first note reads as "you are here" on a score nothing is playing;
 *   the tempo mark is meaningless for a scale; the title duplicates the
 *   heading the surrounding screen already renders; and OSMD's default page
 *   margins leave a one-bar scale sitting in ~360px of empty paper.
 *   `compacttight` is OSMD's own name for the tight-margin mode.
 */
export type ScorePresentation = 'practice' | 'reference'

const REFERENCE_OSMD_OPTIONS = {
  ...DEFAULT_OSMD_OPTIONS,
  drawingParameters: 'compacttight',
  drawTitle: false,
  drawMetronomeMarks: false,
}

/**
 * Pure: the exact `IOSMDOptions` object `defaultCreateOsmd` hands to
 * `new OpenSheetMusicDisplay(container, options)` for a given
 * presentation/chrome combination (roadmap UI-06, `ScoreChrome` in
 * `engraver.ts`). Exported and unit-tested directly, because the real OSMD
 * cannot run in happy-dom (see this file's module doc comment) — this
 * function is the only way a test can read the actual constructor options
 * rather than merely asserting that a prop was accepted.
 *
 * `chrome.title === false` suppresses the title block: OSMD's own
 * `drawTitle: false` already disables the subtitle too (see `IOSMDOptions`'s
 * own doc comment on `drawTitle`), but NOT the composer name — that is
 * `drawComposer`, a separate flag OSMD draws top-right regardless of
 * `drawTitle` — so both are set together to fully remove the block.
 *
 * `chrome` absent, or `chrome.title` `true`/`undefined` (every existing
 * caller, since none passes `chrome` at all), returns the exact SAME options
 * object `presentation` alone already produced before this option existed —
 * not a copy of it — so every current engraving is byte-for-byte unchanged
 * (this task's central constraint). `chrome.compact` is deliberately never
 * read here: it never reaches OSMD at all, only `ScoreViewer`'s own CSS
 * (`.paper--compact` in domain.css) — see `ScoreChrome`'s doc comment.
 */
export function resolveOsmdOptions(
  presentation: ScorePresentation,
  chrome?: ScoreChrome,
): IOSMDOptions {
  const base = presentation === 'reference' ? REFERENCE_OSMD_OPTIONS : DEFAULT_OSMD_OPTIONS
  if (chrome?.title === false) return { ...base, drawTitle: false, drawComposer: false }
  return base
}

/** The only place the real OSMD library is constructed. */
function defaultCreateOsmd(
  container: HTMLElement,
  presentation: ScorePresentation,
  chrome?: ScoreChrome,
): OsmdLike {
  const options = resolveOsmdOptions(presentation, chrome)
  const instance = new OpenSheetMusicDisplay(container, options)
  if (presentation === 'reference') {
    // A scale has no meter. `ScaleStaff` sizes its single measure to the
    // scale's own note count, so the engraved signature would read "8/4" for
    // a seven-note scale plus its octave (or 5/4, 6/4, 12/4 for the
    // pentatonics, whole tone and chromatic) — a meter claim no printed
    // scale book makes and no learner should read as one. The KEY signature
    // is left on: that one is real and is half the point of the reference.
    // `EngravingRules` is the public accessor for the same object the
    // protected `rules` field holds (see `OpenSheetMusicDisplay.d.ts`).
    instance.EngravingRules.RenderTimeSignatures = false
  }
  return instance as unknown as OsmdLike
}

/**
 * `requestAnimationFrame` is not defined outside a DOM (e.g. a plain node
 * vitest environment), so batching still works in tests that inject nothing:
 * falls back to a 0ms timeout, which still coalesces every call made within
 * the current task into one flush on the next tick.
 */
function defaultScheduleRender(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 0)
}

function groupNotesByMeasure(notes: readonly ScoreNote[]): Map<number, ScoreNote[]> {
  const byMeasure = new Map<number, ScoreNote[]>()
  for (const note of notes) {
    const list = byMeasure.get(note.measureIndex)
    if (list === undefined) byMeasure.set(note.measureIndex, [note])
    else list.push(note)
  }
  return byMeasure
}

/** One measure's notes, in the same order `groupNotesByMeasure` preserves for ours. */
function flattenMeasureNotes(containers: readonly EngravedContainer[]): EngravedNote[] {
  const out: EngravedNote[] = []
  for (const container of containers) {
    const atThisTick: { halfTone: number; note: EngravedNote }[] = []
    for (const staffEntry of container.StaffEntries) {
      if (staffEntry === undefined) continue
      for (const voiceEntry of staffEntry.VoiceEntries) {
        for (const note of voiceEntry.Notes) {
          if (!note.isRest()) atThisTick.push({ halfTone: note.halfTone, note })
        }
      }
    }
    atThisTick.sort((a, b) => a.halfTone - b.halfTone)
    for (const entry of atThisTick) out.push(entry.note)
  }
  return out
}

/** Best-effort id → OSMD note lookup. Never throws — a failed mapping just leaves colouring inert. */
function buildNoteIdMap(osmd: OsmdLike, score: Score): Map<string, EngravedNote> {
  const map = new Map<string, EngravedNote>()
  try {
    const ourNotesByMeasure = groupNotesByMeasure(score.notes)
    osmd.Sheet.SourceMeasures.forEach((measure, measureIndex) => {
      const ours = ourNotesByMeasure.get(measureIndex)
      if (ours === undefined || ours.length === 0) return
      const theirs = flattenMeasureNotes(measure.VerticalSourceStaffEntryContainers)
      if (theirs.length !== ours.length) return
      ours.forEach((note, i) => {
        const engraved = theirs[i]
        if (engraved !== undefined) map.set(note.id, engraved)
      })
    })
  } catch {
    // Mapping is a nice-to-have overlay — rendering must succeed regardless.
  }
  return map
}


/**
 * Every onset the cursor will visit, in visiting order, as absolute ticks —
 * walked ONCE at load and cached.
 *
 * It used to be walked on every frame, and rewound to the start of the measure
 * twice per frame to do it. On a two-line sample that was invisible; on a real
 * 87-measure import it was the cause of two bugs reported from the running
 * app. `cursor.reset()` puts the cursor at bar 1, and OSMD's `followCursor`
 * scrolls the page to wherever the cursor is — so every single frame yanked
 * the view to the top of the piece and then back down, which reads as the page
 * juddering up and down for as long as playback runs. The same walk is O(how
 * far into the piece you are), so it also blocked the main thread for
 * increasingly long stretches — measured at 231ms — and a main thread stuck
 * inside OSMD is a main thread not scheduling audio, which is heard as the
 * playback lagging.
 */
function collectOnsetTicks(cursor: OsmdCursor): readonly number[] {
  const onsetTicks: number[] = []
  cursor.reset()
  while (!cursor.iterator.EndReached && onsetTicks.length < MAX_CURSOR_STEPS) {
    onsetTicks.push(Math.round(cursor.iterator.CurrentSourceTimestamp.RealValue * 4 * TICKS_PER_QUARTER))
    cursor.next()
  }
  // The loop above exits two ways: EndReached (the whole score was walked —
  // the ordinary case) or the cap (onsetTicks.length hit MAX_CURSOR_STEPS
  // first). Only the latter truncates real cursor tracking, and it did so
  // silently before this fix — the cursor could then never advance past the
  // last collected onset, which presented in the running app as playback
  // freezing partway through with nothing in the console.
  if (!cursor.iterator.EndReached) {
    console.warn(
      `osmdEngraver: cursor onset walk hit the ${MAX_CURSOR_STEPS}-step cap ` +
        'before reaching the end of the score; cursor tracking will be ' +
        'truncated beyond that onset.',
    )
  }
  cursor.reset()
  return onsetTicks
}

/**
 * Move the cursor to the onset index `stepsToOnsetAtOrBefore` chose, from
 * wherever it already is. Returns the index the cursor actually ended up on
 * — NOT necessarily `to`: the walk stops early either because the real
 * cursor's `EndReached` flipped, or because it hit `MAX_CURSOR_STEPS_PER_MOVE`
 * for this call. Returning the real index (rather than the requested one)
 * is required for correctness, not just the per-frame budget: the caller
 * stores the return value as `cursorIndex` and uses it as `from` on the next
 * call, so reporting a index the cursor never reached would make that next
 * call under-step and leave the cursor permanently behind.
 *
 * Forward is one `next()` per onset crossed — the ordinary case, and usually
 * zero of them. Backward (a seek, a loop wrap, Stop) is the only case that
 * pays for a `reset()` and a replay, because the OSMD cursor cannot step back.
 */
function moveCursorToIndex(cursor: OsmdCursor, from: number, to: number): number {
  if (to === from) return from
  let i: number
  if (to < from) {
    cursor.reset()
    const budget = Math.min(to, MAX_CURSOR_STEPS_PER_MOVE)
    for (i = 0; i < budget && !cursor.iterator.EndReached; i++) cursor.next()
  } else {
    const budget = Math.min(to, from + MAX_CURSOR_STEPS_PER_MOVE)
    for (i = from; i < budget && !cursor.iterator.EndReached; i++) cursor.next()
  }
  cursor.update()
  cursor.show()
  return i
}

export type OsmdEngraverOptions = {
  /**
   * Runs `run` once, later — real `requestAnimationFrame` by default (falling
   * back to a 0ms timeout outside a DOM). Injected so tests can control
   * exactly when a batched render flushes instead of racing a real frame.
   */
  readonly scheduleRender?: (run: () => void) => void
  /** Injection seam for tests — defaults to the real `OpenSheetMusicDisplay`. */
  readonly createOsmd?: (container: HTMLElement) => OsmdLike
  /** Defaults to `'practice'`, i.e. exactly the behaviour every existing caller
   *  already gets. See `ScorePresentation`. */
  readonly presentation?: ScorePresentation
  /** Absent by default, i.e. exactly the behaviour every existing caller
   *  already gets. See `ScoreChrome` in `engraver.ts` and `resolveOsmdOptions`. */
  readonly chrome?: ScoreChrome
}


/**
 * `ScoreEngraver` plus `setMeasureLabels` (roadmap 3.18a). Kept as a local
 * extension rather than a change to the shared `ScoreEngraver` interface in
 * `engraver.ts` — that file is a dependency of this module, not one of it.
 * `ScoreViewer.tsx` consumes this structurally (an intersection type with the
 * new member OPTIONAL), so a test fake implementing plain `ScoreEngraver`
 * still satisfies it and the capability stays additive end to end.
 */
export type ScoreEngraverWithMeasureLabels = ScoreEngraver & {
  /** Place text under each measure, keyed by 1-based measure number. Replaces any
   *  labels previously set. Must not schedule a full re-render (roadmap 2.32). */
  setMeasureLabels(labels: ReadonlyMap<number, string>): void
}

/**
 * The post-render work (re-stamp ids, re-place measure labels, re-apply
 * feedback classes) belonging to the engraver that CURRENTLY owns each OSMD
 * instance. Keyed by instance rather than captured in the `render` wrapper,
 * because a cached engraving outlives the engraver that built it: when a
 * second `ScoreViewer` mount adopts it, a later render must stamp against the
 * live engraver's `noteById`/`measureLabels`/feedback state, not the
 * torn-down one's. See `installRenderHook`.
 */
const renderHooks = new WeakMap<OsmdLike, () => void>()

export function createOsmdEngraver(opts?: OsmdEngraverOptions): ScoreEngraverWithMeasureLabels {
  const scheduleRender = opts?.scheduleRender ?? defaultScheduleRender
  const presentation = opts?.presentation ?? 'practice'
  const chrome = opts?.chrome
  const createOsmd =
    opts?.createOsmd ?? ((container) => defaultCreateOsmd(container, presentation, chrome))

  /** The cache detaches a real DOM host; outside a DOM there is nothing to keep. */
  const cacheable = typeof document !== 'undefined'

  let osmd: OsmdLike | undefined
  /** The element `load()` rendered into — bounds the walk `noteIdAt` does. */
  let containerEl: HTMLElement | undefined
  /** The `<div>` inside `containerEl` that OSMD itself draws into — this file
   *  owns it, so a whole engraving can be detached and cached. */
  let hostEl: HTMLElement | undefined
  /** This engraver's entry in the engraving cache, once it has one. */
  let cacheEntry: EngravingCacheEntry | undefined
  let noteById = new Map<string, EngravedNote>()
  const coloredIds = new Set<string>()
  /** Last colour requested via `setNoteColor`, independent of current visibility. */
  const desiredColor = new Map<string, string>()
  /** Ids currently occluded for the read-ahead drill — see `setNoteHidden`. */
  const hiddenIds = new Set<string>()
  /** Last labels requested via `setMeasureLabels` — see `applyMeasureLabels`. */
  let measureLabels: ReadonlyMap<number, string> = new Map()
  let renderPending = false
  /** Every onset the cursor visits, walked once at load — see `collectOnsetTicks`. */
  let onsetTicks: readonly number[] = []
  /** Which of those the cursor is parked on, so a frame that changes nothing costs nothing. */
  let cursorIndex = 0
  /**
   * Set by `destroy()`, and never cleared — an engraver is built per
   * `ScoreViewer` mount and never reused after being torn down. `load()` is
   * asynchronous and can therefore still be mid-`await` when its own viewer
   * unmounts (React StrictMode's double-invoked effect does exactly this on
   * every mount, in development), so this is what stops an abandoned load
   * from going on to engrave, walk the cursor and stamp ids into a container
   * nothing is looking at. Before this flag existed that orphan cost a full
   * extra engrave per mount — 548ms on the Canon in D import — and then
   * LEAKED: `destroy()` ran while `osmd` was still `undefined` (it is only
   * assigned at the tail of `load`), so its `osmd?.clear()` was a no-op on
   * nothing, and the finished instance stayed alive with its resize listener
   * attached, re-engraving on every later resize for the rest of the session.
   */
  let destroyed = false
  /** Detaches the width watcher installed by `watchContainerWidth`, if any. */
  let unwatchWidth: (() => void) | undefined

  /**
   * Re-engraves when the container's WIDTH changes, replacing OSMD's own
   * `autoResize` (see `DEFAULT_OSMD_OPTIONS` for why that option is off).
   *
   * Width, not any resize: OSMD lays a score out to the width it is given, so
   * a taller window changes nothing about the engraving, and re-engraving for
   * it would cost half a second to redraw the identical picture. `lastWidth`
   * starts at the width the just-completed engrave was laid out at, so a
   * resize that ends where it started is free too.
   */
  function watchContainerWidth(container: HTMLElement): () => void {
    if (typeof window === 'undefined') return () => {}
    let lastWidth = container.clientWidth
    let timer: ReturnType<typeof setTimeout> | undefined
    function onResize(): void {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        const width = container.clientWidth
        if (width === lastWidth || width === 0) return
        lastWidth = width
        requestRender()
      }, RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }

  /**
   * Coalesces any number of calls made before the next flush into exactly one
   * `render()`. `osmd?.render()` (rather than capturing `osmd` up front) is
   * what makes `destroy()` neutralise a pending flush: once `destroy` sets
   * `osmd` back to `undefined`, a flush that fires afterwards is a no-op
   * instead of rendering into a cleared instance.
   */
  function requestRender(): void {
    if (renderPending) return
    renderPending = true
    scheduleRender(() => {
      renderPending = false
      // `osmd.render()` (wrapped in `load()` below to also re-stamp
      // `data-note-id` — see that wrapper's doc comment) — a plain
      // `osmd?.render()` here still re-stamps, it just goes through the
      // wrapper transparently.
      osmd?.render()
    })
  }

  /**
   * - `'unchanged'` — nothing on screen would differ; do no further work.
   * - `'painted'`   — the SVG was mutated directly; NO re-engrave is needed.
   * - `'needs-render'` — the colour was recorded on the model but could not be
   *   pushed to the SVG directly; only a full `render()` will show it.
   */
  type PaintResult = 'unchanged' | 'painted' | 'needs-render'

  /**
   * The single place `NoteheadColor`/`StemColor` are written: hidden always
   * wins over whatever colour was last requested, so `setNoteColor` and
   * `setNoteHidden` can never race each other into an inconsistent paint.
   *
   * The model-property writes always happen when something changed, even
   * though the fast path below usually makes them redundant for THIS frame —
   * they are what makes the colour survive a full re-render (e.g. the width
   * watcher, after the window is dragged narrower), which redraws strictly
   * from the model.
   * Only after that does `paint` try the cheap path: pushing the colour
   * straight into the already-rendered SVG via `osmd.rules.GNote(note)`
   * (OSMD's documented no-re-render `setColor`). That call is wrapped in a
   * narrow `try` — an unmapped/unrendered note, a missing `rules`/`GNote`, or
   * any thrown error all fall back to `'needs-render'`, which is the only
   * result that may schedule a `requestRender()` fallback.
   */
  function paint(noteId: string): PaintResult {
    const note = noteById.get(noteId)
    if (note === undefined) return 'unchanged'
    const color = hiddenIds.has(noteId)
      ? HIDDEN_NOTE_COLOR
      : (desiredColor.get(noteId) ?? DEFAULT_NOTE_COLOR)
    const feedbackClass = FEEDBACK_CLASS_BY_COLOR.get(color)
    const changed = note.NoteheadColor !== color || note.ParentVoiceEntry.StemColor !== color
    note.NoteheadColor = color
    note.ParentVoiceEntry.StemColor = color
    if (!changed) return 'unchanged'
    try {
      const graphicalNote = osmd?.rules.GNote(note)
      if (graphicalNote !== undefined) {
        graphicalNote.setColor(color, { applyToNoteheads: true, applyToStem: true })
        // Shape, not hue, carries the signal (roadmap 5.24) — same no-re-render
        // SVG mutation `setColor` above already is, targeting the same element.
        applyFeedbackClass(graphicalNote, feedbackClass)
        return 'painted'
      }
    } catch {
      // GNote/setColor/the class write threw — the model write above still
      // stands, and the caller falls back to a full render to make it
      // visible (which re-applies the class too — see reapplyFeedbackClasses).
    }
    return 'needs-render'
  }

  /**
   * Points the OSMD instance's own `render` at THIS engraver's post-render
   * work. Re-installed on every reuse of a cached engraving, because the
   * previous owner's closure is dead: a render must re-stamp against the live
   * `noteById`/`measureLabels`/feedback state, not against a torn-down
   * viewer's. See `stampNoteIds`'s doc comment for why each of the three has
   * to be redone after a render at all.
   */
  function installRenderHook(instance: OsmdLike, container: HTMLElement): void {
    renderHooks.set(instance, () => {
      stampNoteIds(instance, noteById)
      applyMeasureLabels(instance, container, measureLabels)
      reapplyFeedbackClasses(instance, noteById, coloredIds, hiddenIds, desiredColor)
    })
  }

  /**
   * Re-attaches a cached engraving and takes ownership of it. No parse, no
   * layout, no cursor walk — everything below is O(notes the previous owner
   * had painted), never O(score).
   */
  function adoptCachedEngraving(entry: EngravingCacheEntry, container: HTMLElement): void {
    container.appendChild(entry.host)
    installRenderHook(entry.instance, container)
    osmd = entry.instance
    containerEl = container
    hostEl = entry.host
    cacheEntry = entry
    noteById = entry.noteById
    onsetTicks = entry.onsetTicks
    cursorIndex = 0
    // The previous owner's colours, read-ahead occlusions, feedback classes
    // and measure labels are still painted on this SVG. A freshly-mounted
    // viewer expects none of them, and this engraver's own `desiredColor`/
    // `hiddenIds` are empty, so painting exactly the previously-painted ids
    // resets each one to `DEFAULT_NOTE_COLOR` and drops its feedback class.
    for (const id of entry.paintedIds) paint(id)
    entry.paintedIds = new Set()
    applyMeasureLabels(entry.instance, container, measureLabels)
    entry.instance.cursor.reset()
    if (presentation !== 'reference') entry.instance.cursor.show()
    unwatchWidth = watchContainerWidth(container)
    // Engraved at a width the viewer no longer has — the window was resized
    // while this score was off screen. One re-engrave, batched like any other.
    const width = container.clientWidth
    if (width > 0 && width !== entry.width) {
      entry.width = width
      requestRender()
    }
  }

  return {
    async load(container, musicXml, score) {
      const key = engravingCacheKey(musicXml, presentation, chrome)
      const cached = cacheable ? takeCachedEngraving(key, score) : undefined
      if (cached !== undefined) {
        adoptCachedEngraving(cached, container)
        return
      }

      // OSMD renders into a host this file owns, never into the React-owned
      // `container` — that is what lets `destroy()` detach a whole engraving
      // and keep it (see the engraving-cache doc comment above).
      const host = document.createElement('div')
      container.appendChild(host)
      const instance = createOsmd(host)
      // `render()` is called on more than this file's own initiative — the
      // width watcher above re-engraves when the container really changes
      // width (see `stampNoteIds`'s doc comment, and the module comment on
      // why the analogous colour case needs no equivalent: `paint`
      // durability-writes onto the OSMD model itself, which `render()` always
      // redraws from, but there is no model-level property to stamp an id
      // onto). Re-binding BEFORE that first `render()` call below, and going
      // through the cache entry's `afterRender` (rather than a hook captured
      // here) is what makes a render triggered years later, under a different
      // owner, still stamp against the LIVE engraver's state.
      const originalRender = instance.render.bind(instance)
      installRenderHook(instance, container)
      instance.render = () => {
        originalRender()
        renderHooks.get(instance)?.()
      }
      await instance.load(musicXml)
      // The viewer that asked for this engraving is already gone (see
      // `destroyed`). Everything below — the engrave itself, the cursor walk,
      // the id map — is work for a container nothing will look at, so stop
      // here, and clear the instance that `destroy()` could not reach because
      // `osmd` was still unassigned when it ran.
      if (destroyed) {
        instance.clear()
        host.remove()
        return
      }
      instance.render()
      onsetTicks = collectOnsetTicks(instance.cursor)
      cursorIndex = 0
      // Walked above either way — `moveCursorTo` stays callable in both modes
      // — but only SHOWN when something can play. See `ScorePresentation`.
      if (presentation !== 'reference') instance.cursor.show()
      osmd = instance
      containerEl = container
      hostEl = host
      unwatchWidth = watchContainerWidth(container)
      noteById = buildNoteIdMap(instance, score)
      stampNoteIds(instance, noteById)

      // Worth keeping across unmounts? See the engraving-cache doc comment
      // for why the score's note count is the test.
      if (cacheable && score.notes.length >= MIN_CACHEABLE_NOTES) {
        cacheEntry = {
          key,
          score,
          host,
          instance,
          noteById,
          onsetTicks,
          width: container.clientWidth,
          paintedIds: new Set(),
          inUse: true,
        }
        putCachedEngraving(cacheEntry)
      }

      // Catches up any `setNoteColor`/`setNoteHidden` call that arrived
      // between the engraver being constructed and this `await` resolving
      // (see the module comment on `ScoreViewer` recreating its engraver
      // synchronously while `load()` is still in flight — roadmap finding 4).
      // `hiddenIds`/`desiredColor`/`coloredIds` are NOT cleared here: for this
      // app's real usage a freshly-constructed engraver already has empty
      // Sets/Maps, so clearing would be redundant for a normal load and
      // actively wrong for the race — it would wipe out exactly the
      // legitimately-early calls this repaint pass exists to catch up. A
      // stale id left over from a hypothetical previous `load()` on the same
      // instance is still safe: `paint`'s own `noteById.get(id) === undefined`
      // guard (until this line ran) makes it a no-op rather than a mispaint.
      const idsToRepaint = new Set<string>([...hiddenIds, ...coloredIds])
      let needsRender = false
      for (const id of idsToRepaint) {
        if (paint(id) === 'needs-render') needsRender = true
      }
      if (needsRender) requestRender()
    },

    // `measureIndex` is no longer needed to find the onset — `onsetTicks` is
    // absolute across the score — but it stays in the `ScoreEngraver`
    // contract, which other implementations (and the tests' fakes) are written
    // against.
    moveCursorTo(_measureIndex, tick) {
      if (osmd === undefined) return
      const target = stepsToOnsetAtOrBefore(onsetTicks, tick)
      cursorIndex = moveCursorToIndex(osmd.cursor, cursorIndex, target)
    },

    setNoteColor(noteId, color) {
      // Unconditionally recorded even before `osmd`/`noteById` are populated
      // — `paint` is a safe no-op for an id it doesn't know yet, and the
      // load-tail repaint above catches this up once it does (roadmap
      // finding 4).
      desiredColor.set(noteId, color)
      coloredIds.add(noteId)
      if (paint(noteId) === 'needs-render') requestRender()
    },

    clearNoteColors() {
      if (coloredIds.size === 0) return
      let needsRender = false
      for (const id of coloredIds) {
        desiredColor.delete(id)
        if (paint(id) === 'needs-render') needsRender = true
      }
      coloredIds.clear()
      if (needsRender) requestRender()
    },

    setNoteHidden(noteId, hidden) {
      if (hidden) {
        if (hiddenIds.has(noteId)) return
        hiddenIds.add(noteId)
      } else {
        if (!hiddenIds.has(noteId)) return
        hiddenIds.delete(noteId)
      }
      if (paint(noteId) === 'needs-render') requestRender()
    },

    clearHiddenNotes() {
      if (hiddenIds.size === 0) return
      let needsRender = false
      for (const id of [...hiddenIds]) {
        hiddenIds.delete(id)
        if (paint(id) === 'needs-render') needsRender = true
      }
      if (needsRender) requestRender()
    },

    setMeasureLabels(labels) {
      measureLabels = labels
      // Recorded unconditionally even before `osmd`/`containerEl` exist — the
      // load-tail catch-up above applies it once they do (same race-safety
      // shape as `setNoteColor`, roadmap finding 4). Direct SVG mutation only,
      // same as `paint`'s fast path — never `requestRender()` (roadmap 2.32:
      // this must not cost a full re-engrave).
      if (osmd !== undefined && containerEl !== undefined) {
        applyMeasureLabels(osmd, containerEl, measureLabels)
      }
    },

    destroy() {
      destroyed = true
      unwatchWidth?.()
      unwatchWidth = undefined
      if (cacheEntry !== undefined) {
        // Detach, don't discard — the whole point of the cache (see its doc
        // comment). What the next owner needs to know is which notes are
        // currently painted, so it can reset exactly those.
        cacheEntry.paintedIds = new Set([...coloredIds, ...hiddenIds])
        cacheEntry.inUse = false
        cacheEntry.host.remove()
        cacheEntry = undefined
      } else {
        osmd?.clear()
        hostEl?.remove()
      }
      osmd = undefined
      containerEl = undefined
      hostEl = undefined
      noteById = new Map()
      coloredIds.clear()
      desiredColor.clear()
      hiddenIds.clear()
      measureLabels = new Map()
      renderPending = false
    },

    noteIdAt(target) {
      try {
        if (containerEl === undefined || !(target instanceof Element)) return undefined
        let el: Element | null = target
        while (el !== null) {
          const id = el.getAttribute('data-note-id')
          if (id !== null) return id
          if (el === containerEl) return undefined
          el = el.parentElement
        }
        return undefined
      } catch {
        // Never throws — a click that cannot be resolved is just a miss.
        return undefined
      }
    },
  }
}
