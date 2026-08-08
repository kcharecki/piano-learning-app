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
 * re-renders on its own initiative (`autoResize: true` re-engraves on every
 * window resize), and a re-engrave draws whatever the model currently holds;
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
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { stepsToOnsetAtOrBefore } from './cursorSteps.ts'
import type { ScoreEngraver } from './engraver.ts'

/**
 * The slice of OSMD's `Note` this file actually touches. `NoteheadColor`
 * recolours the notehead itself; `ParentVoiceEntry.StemColor` (a getter/
 * setter OSMD exposes on the parent `VoiceEntry`, not on `Note` — see
 * `VoiceEntry.d.ts`) recolours its stem, so hiding a note occludes both,
 * not just the head. Beams and ledger lines are a known residual gap: OSMD
 * has no equally cheap way to recolour those, only a heavier `PrintObject`/
 * `updateGraphic()` path, which is out of scope here.
 */
type EngravedNote = { NoteheadColor: string; readonly ParentVoiceEntry: { StemColor: string } }

/** The slice of OSMD's `ColoringOptions` this file uses — see GraphicalNote.d.ts. */
type OsmdColoringOptions = { readonly applyToNoteheads: boolean; readonly applyToStem: boolean }
/**
 * `getSVGGElement` (see `VexFlowGraphicalNote.d.ts`) is the same access path
 * `setColor` already uses — the rendered `<g>` wrapping this note's notehead,
 * stem and beams. Used only to stamp `data-note-id` for click-to-select
 * (roadmap 4.8a); never for colouring, which stays exclusively on `setColor`.
 *
 * For a CHORD, `getSVGGElement()` is NOT per-note: OSMD backs every note of a
 * chord with the same single VexFlow `StaveNote` (`vfnote[0]`), so it returns
 * the SAME `<g>` for every note in the chord — stamping that alone would let
 * the chord's last-processed note silently overwrite every other member's id
 * on the shared group. `vfnoteIndex` (this note's index within that shared
 * `StaveNote`) and `getNoteheadSVGs()` (the notehead elements inside the
 * group, one per chord member, in chord order) are the same pair OSMD's own
 * `setColor` indexes by internally; stamping
 * `getNoteheadSVGs()[vfnoteIndex]` targets this note's own notehead element
 * instead of the shared group, so each chord member keeps its own id.
 */
type OsmdGraphicalNote = {
  setColor(color: string, options: OsmdColoringOptions): void
  getSVGGElement(): SVGGElement
  readonly vfnoteIndex: number
  getNoteheadSVGs(): readonly Element[]
}
type OsmdEngravingRules = { GNote(note: EngravedNote): OsmdGraphicalNote | undefined }

type EngravedRawNote = EngravedNote & { readonly halfTone: number; isRest(): boolean }
type EngravedVoiceEntry = { readonly Notes: readonly EngravedRawNote[] }
type EngravedStaffEntry = { readonly VoiceEntries: readonly EngravedVoiceEntry[] }
// OSMD leaves a slot `undefined` when a staff has no entry at that container's
// vertical timestamp (e.g. one staff rests while another sounds a note) — this
// is a sparse array, not a dense one, however implausible the SDK's own types
// make it look.
type EngravedContainer = { readonly StaffEntries: readonly (EngravedStaffEntry | undefined)[] }
type EngravedSourceMeasure = {
  readonly VerticalSourceStaffEntryContainers: readonly EngravedContainer[]
}

/**
 * The slice of a VexFlow `Stave` (`@types/vexflow`) this file reads to place a
 * measure label (roadmap 3.18a). `getX()`/`getWidth()` give the horizontal
 * span already laid out for this measure; `getBottomY()` the y of its lowest
 * staff line — all in the SAME real SVG pixel space the rendered notation
 * uses, because VexFlow (OSMD's SVG-backend renderer) bakes zoom/layout into
 * these numbers when it computes them, unlike OSMD's own internal "unit"
 * coordinate system (10 units = 1 staff space) which would need a manual
 * conversion factor this file has no clean access to.
 */
type OsmdVexStave = { getX(): number; getWidth(): number; getBottomY(): number }
/**
 * The slice of OSMD's `GraphicalMeasure` this file reads. `getVFStave()` is
 * declared only on the SVG-backend's concrete `VexFlowMeasure` (see
 * `VexFlowMeasure.d.ts`), not on the abstract `GraphicalMeasure` the public
 * `MeasureList` type says it holds — but this app's engraver never selects a
 * `backend` option (`DEFAULT_OSMD_OPTIONS` above), and OSMD defaults to the
 * SVG/VexFlow backend, so every measure in `MeasureList` is actually one of
 * these at runtime. `OsmdLike` is already a hand-picked structural slice
 * (see its own doc comment), not the SDK's literal exported types, so naming
 * the narrower, accurate shape here is consistent with the rest of the file.
 */
type OsmdGraphicalMeasureForLabel = { getVFStave(): OsmdVexStave | undefined }
/**
 * `MeasureList[measureIndex][staffIndex]` — the SAME positional
 * `measureIndex` this file already uses elsewhere (`Sheet.SourceMeasures`,
 * `score.notes[].measureIndex`): a 0-based array index in engraving order,
 * not the printed `Measure.number` string, which can repeat or read "0" for
 * a pickup (see `Measure.number` in `@core/notation/score.ts`).
 */
type OsmdGraphicalMusicSheet = {
  readonly MeasureList: readonly (readonly OsmdGraphicalMeasureForLabel[])[]
}

/** The slice of OSMD's cursor this file actually touches. */
type OsmdCursorIterator = {
  readonly EndReached: boolean
  readonly CurrentSourceTimestamp: { readonly RealValue: number }
}
type OsmdCursor = {
  readonly iterator: OsmdCursorIterator
  reset(): void
  next(): void
  nextMeasure(): void
  update(): void
  show(): void
}

/**
 * The narrow structural slice of OpenSheetMusicDisplay this file depends on —
 * `createOsmd` (an option to `createOsmdEngraver`) can hand back a fake
 * implementing exactly this, so `osmdEngraver.test.ts` can drive the id
 * mapping, colouring and batching logic without a browser. The real
 * `OpenSheetMusicDisplay` satisfies this structurally; the default factory
 * below is the only place that touches the real library.
 */
export type OsmdLike = {
  readonly Sheet: { readonly SourceMeasures: readonly EngravedSourceMeasure[] }
  /** Public accessor on the real `OpenSheetMusicDisplay` (see `OpenSheetMusicDisplay.d.ts`:
   *  `get GraphicSheet(): GraphicalMusicSheet`) — the laid-out graphical measures,
   *  read only by `applyMeasureLabels` (roadmap 3.18a) to place text under a measure. */
  readonly GraphicSheet: OsmdGraphicalMusicSheet
  readonly cursor: OsmdCursor
  readonly rules: OsmdEngravingRules
  load(musicXml: string): Promise<void>
  render(): void
  clear(): void
}

/**
 * OSMD engraves in black by default. The design system's notation frame is a
 * light "paper" surface (`--paper`) sitting inside the app's dark shell —
 * everything drawn is forced to the paper ink colour so it reads at full
 * contrast on that surface. Keep this in step with `--paper-fg` in
 * src/design-system/tokens/colors.css; OSMD wants a concrete hex, so a CSS
 * variable cannot be handed to it directly.
 */
const SCORE_INK = '#191712'
/**
 * Exported for `osmdEngraver.test.ts` — the colour `clearNoteColors`
 * restores — and for `PracticeScreen.tsx`, which restores a deselected
 * notehead to it directly (roadmap 4.8a).
 */
export const DEFAULT_NOTE_COLOR = SCORE_INK
/**
 * The read-ahead drill (roadmap 2.26, REQ-3.4.5) "hides" a note by painting it
 * the same colour as the page background rather than toggling engraving
 * visibility — far cheaper than re-laying-out the measure, and reversible by
 * the same `NoteheadColor` write `setNoteColor` already uses. Keep this in
 * step with `--paper` in src/design-system/tokens/colors.css.
 */
export const HIDDEN_NOTE_COLOR = '#f8f5ec'
/**
 * Marks the `<g>` this file owns inside OSMD's SVG so a later call can find
 * and clear it rather than accumulate a new group on every `setMeasureLabels`
 * call or every OSMD-initiated re-render (roadmap 3.18a).
 */
const MEASURE_LABEL_GROUP_ATTR = 'data-measure-labels'
/** Vertical gap (px) between a measure's lowest staff line and its label's baseline. */
const MEASURE_LABEL_Y_OFFSET = 16
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

const DEFAULT_OSMD_OPTIONS = {
  autoResize: true,
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

/** The only place the real OSMD library is constructed. */
function defaultCreateOsmd(container: HTMLElement, presentation: ScorePresentation): OsmdLike {
  const options = presentation === 'reference' ? REFERENCE_OSMD_OPTIONS : DEFAULT_OSMD_OPTIONS
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
 * Stamps each mapped note's rendered SVG element with `data-note-id` (roadmap
 * 4.8a) so `noteIdAt` can resolve a click without a per-notehead listener — a
 * click handler on the CONTAINER walks up from `event.target` to the nearest
 * `[data-note-id]` ancestor instead. Uses the exact same `osmd.rules.GNote`
 * access path `paint` already uses for colouring — see the `OsmdGraphicalNote`
 * doc comment above.
 *
 * Must be re-run after every full `render()`, not just the first one:
 * `osmd.render()` discards and rebuilds the entire SVG tree, so a stamp from a
 * previous render does not survive it — the SVG analogue of why `paint` also
 * writes `NoteheadColor`/`StemColor` onto the model, not only the SVG. Unlike
 * colour, that includes re-renders OSMD triggers on its OWN initiative
 * (`autoResize` fires one shortly after mount, once the container's real
 * layout size settles, and again on every window resize) — a real
 * bundled-score load hit this in the running app: the load-time stamp was
 * visibly wiped seconds later with no error, because `paint`'s durability
 * trick (writing the colour onto the OSMD model so it survives OSMD's own
 * re-render) has no analogue here — there is no model-level property to
 * stamp an id onto. `load()` (below) closes this by wrapping the OSMD
 * instance's OWN `render` method to re-stamp after every call, not only the
 * ones this file makes itself.
 *
 * Best-effort and per-note, like `buildNoteIdMap`: a note whose graphical
 * counterpart cannot be resolved, or whose SVG element access throws, is
 * simply left unstamped (and therefore unselectable) rather than aborting the
 * whole pass. Never throws.
 */
function stampNoteIds(osmd: OsmdLike, noteById: ReadonlyMap<string, EngravedNote>): void {
  for (const [id, engraved] of noteById) {
    try {
      const graphicalNote = osmd.rules.GNote(engraved)
      // Prefer this note's OWN notehead element (`getNoteheadSVGs()[vfnoteIndex]`)
      // over the shared chord group `getSVGGElement()` returns — see the
      // `OsmdGraphicalNote` doc comment above for why the group is not
      // per-note. Falls back to the group when the notehead list is
      // unavailable/short (e.g. a single-note voice entry, or a fake in
      // tests that only implements `getSVGGElement`), so single notes keep
      // working exactly as before.
      const el = graphicalNote?.getNoteheadSVGs()[graphicalNote.vfnoteIndex] ?? graphicalNote?.getSVGGElement()
      el?.setAttribute('data-note-id', id)
    } catch {
      // Best-effort — see doc comment above.
    }
  }
}

/**
 * Places `labels` text under their measure directly in the rendered SVG —
 * roadmap 3.18a, REQ-3.5.5's "numeral under its own measure on the engraving"
 * half, matching how the side `AnalysisPanel` already reads.
 *
 * ## Why direct SVG injection, not an OSMD-native measure-label mechanism
 *
 * OSMD does carry a per-measure text concept — `SourceMeasure.rehearsalExpression`
 * (`RehearsalExpression`, see its `.d.ts`) — but it is a MODEL-level field only
 * `MusicSheetCalculator` (the LAYOUT pass) turns into a graphical mark; setting
 * it does nothing to the already-rendered SVG until the next `osmd.render()`
 * re-engraves the whole score. Using it here would mean paying that cost every
 * time an analysis changes — exactly the ~550ms/102-measure regression the
 * module comment at the top of this file exists to prevent. So this function
 * takes the same path `paint`/`stampNoteIds` already do: mutate the rendered
 * SVG directly, no `render()` involved.
 *
 * It is NOT undocumented-internals archaeology, though: `VexFlowMeasure.getVFStave()`
 * (public, see `VexFlowMeasure.d.ts`) hands back the real VexFlow `Stave` OSMD
 * itself already computed and drew from — `getX()`/`getWidth()`/`getBottomY()`
 * are real SVG pixel coordinates (see `OsmdVexStave`'s doc comment), so this
 * function does no layout math of its own, only reads what OSMD already laid
 * out and appends one `<text>` per labelled measure under the BOTTOM staff
 * (last entry in that measure's row of `MeasureList`) — i.e. under the whole
 * grand staff, not wedged between a piano piece's two staves.
 *
 * ## Resize durability (roadmap 2.32's hazard, restated for this feature)
 *
 * `autoResize: true` (`DEFAULT_OSMD_OPTIONS`) makes OSMD re-engrave on its own
 * initiative on every window resize, which discards and rebuilds the entire
 * SVG tree — this function's injected `<g>` included. Unlike note colour,
 * there is no OSMD MODEL property this function could durability-write onto
 * (measure labels are not an OSMD concept OSMD's own render would redraw from
 * — see above), so the only fix is re-running this function after every
 * render, real or OSMD-initiated: `load()` below wraps the OSMD instance's
 * OWN `render` method to call this again after every call, the same trick
 * `stampNoteIds` already relies on for the identical reason.
 *
 * Idempotent and replace-all: clears its own `<g>` and rebuilds every label
 * from `labels` fresh on every call, so a measure removed from `labels` since
 * the last call does not linger, and calling this twice in a row with the
 * same map leaves the SVG unchanged but never duplicated. Best-effort and
 * never throws — a label pass that fails (unmounted container, an
 * unrecognised OSMD shape) leaves the notation itself unaffected, same
 * contract as `stampNoteIds`/`buildNoteIdMap`.
 */
function applyMeasureLabels(
  osmd: OsmdLike,
  container: HTMLElement,
  labels: ReadonlyMap<number, string>,
): void {
  try {
    // Single-page assumption: `container.querySelector('svg')` takes the
    // FIRST svg in the container. OSMD's `SvgVexFlowBackend` renders one svg
    // per `GraphicalMusicPage`, and this app never sets a `pageFormat` option
    // (endless single-page default), so there is exactly one svg today and
    // every measure's label belongs on it. If pagination is ever turned on,
    // this must resolve the svg per page (e.g. via each
    // `MeasureList[i][s].ParentMusicPage`) instead of always using the first.
    const svg = container.querySelector('svg')
    if (svg === null) return
    let group = svg.querySelector<SVGGElement>(`g[${MEASURE_LABEL_GROUP_ATTR}]`)
    if (group === null) {
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      group.setAttribute(MEASURE_LABEL_GROUP_ATTR, '')
      svg.appendChild(group)
    } else {
      while (group.firstChild !== null) group.removeChild(group.firstChild)
    }
    if (labels.size === 0) return

    osmd.GraphicSheet.MeasureList.forEach((staves, measureIndex) => {
      const label = labels.get(measureIndex + 1) // 1-based, per the ScoreViewer contract
      if (label === undefined || label.length === 0) return
      // `staves` can have sparse/undefined slots (e.g. a hidden or multi-rest
      // bottom staff) — OSMD documents exactly that hazard for `MeasureList`
      // rows (see this function's own doc comment above). Walk from the
      // bottom up and anchor to the first staff that actually yields a
      // stave, instead of only ever looking at the last slot, so one empty
      // staff does not silently drop the whole measure's numeral.
      let stave: OsmdVexStave | undefined
      for (let s = staves.length - 1; s >= 0 && stave === undefined; s--) {
        stave = staves[s]?.getVFStave()
      }
      if (stave === undefined) return

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('x', String(stave.getX() + stave.getWidth() / 2))
      text.setAttribute('y', String(stave.getBottomY() + MEASURE_LABEL_Y_OFFSET))
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('font-style', 'italic')
      text.setAttribute('font-size', '13')
      text.setAttribute('fill', SCORE_INK)
      text.textContent = label
      group.appendChild(text)
    })
  } catch {
    // Best-effort — see the doc comment above.
  }
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

export function createOsmdEngraver(opts?: OsmdEngraverOptions): ScoreEngraverWithMeasureLabels {
  const scheduleRender = opts?.scheduleRender ?? defaultScheduleRender
  const presentation = opts?.presentation ?? 'practice'
  const createOsmd = opts?.createOsmd ?? ((container) => defaultCreateOsmd(container, presentation))

  let osmd: OsmdLike | undefined
  /** The element `load()` rendered into — bounds the walk `noteIdAt` does. */
  let containerEl: HTMLElement | undefined
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
   * they are what makes the colour survive an OSMD-initiated re-render (e.g.
   * `autoResize` on a window resize), which redraws strictly from the model.
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
    const changed = note.NoteheadColor !== color || note.ParentVoiceEntry.StemColor !== color
    note.NoteheadColor = color
    note.ParentVoiceEntry.StemColor = color
    if (!changed) return 'unchanged'
    try {
      const graphicalNote = osmd?.rules.GNote(note)
      if (graphicalNote !== undefined) {
        graphicalNote.setColor(color, { applyToNoteheads: true, applyToStem: true })
        return 'painted'
      }
    } catch {
      // GNote/setColor threw — the model write above still stands, and the
      // caller falls back to a full render to make it visible.
    }
    return 'needs-render'
  }

  return {
    async load(container, musicXml, score) {
      const instance = createOsmd(container)
      // OSMD calls `render()` on its OWN initiative too — `autoResize` fires
      // one shortly after mount, once the container's layout size settles,
      // and again on every window resize (see `stampNoteIds`'s doc comment,
      // and the module comment on why the analogous colour case needs no
      // equivalent: `paint` durability-writes onto the OSMD model itself,
      // which `render()` always redraws from, but there is no model-level
      // property to stamp an id onto). Re-binding BEFORE that first
      // `render()` call below, and re-reading the closure's `noteById`
      // rather than a value captured here, is what makes every later call —
      // OSMD's own included — re-stamp using whatever the map currently is.
      const originalRender = instance.render.bind(instance)
      instance.render = () => {
        originalRender()
        stampNoteIds(instance, noteById)
        // Re-applies measure labels after every render, including one OSMD
        // schedules on its OWN initiative (autoResize) — see
        // `applyMeasureLabels`'s doc comment for why there is no model-level
        // write that would make this survive on its own, the way note colour
        // does.
        applyMeasureLabels(instance, container, measureLabels)
      }
      await instance.load(musicXml)
      instance.render()
      onsetTicks = collectOnsetTicks(instance.cursor)
      cursorIndex = 0
      // Walked above either way — `moveCursorTo` stays callable in both modes
      // — but only SHOWN when something can play. See `ScorePresentation`.
      if (presentation !== 'reference') instance.cursor.show()
      osmd = instance
      containerEl = container
      noteById = buildNoteIdMap(instance, score)
      stampNoteIds(instance, noteById)

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
      osmd?.clear()
      osmd = undefined
      containerEl = undefined
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
