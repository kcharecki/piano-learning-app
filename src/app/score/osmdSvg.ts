/**
 * The OSMD SVG layer: the structural slice of OpenSheetMusicDisplay's own
 * types this app reads or writes, the exact colours it paints with, and the
 * four passes that write DIRECTLY into the already-rendered SVG —
 * `stampNoteIds`, `applyFeedbackClass`, `reapplyFeedbackClasses` and
 * `applyMeasureLabels`.
 *
 * They belong together because they share one property: OSMD's `render()`
 * discards and rebuilds the whole SVG tree, so every mark this file makes has
 * to be re-made after every render. `osmdEngraver.ts` owns the engraver
 * itself and re-runs these; this file owns what they write.
 *
 * Imports nothing from `osmdEngraver.ts` — the dependency runs one way only.
 */
/**
 * The slice of OSMD's `Note` this file actually touches. `NoteheadColor`
 * recolours the notehead itself; `ParentVoiceEntry.StemColor` (a getter/
 * setter OSMD exposes on the parent `VoiceEntry`, not on `Note` — see
 * `VoiceEntry.d.ts`) recolours its stem, so hiding a note occludes both,
 * not just the head. Beams and ledger lines are a known residual gap: OSMD
 * has no equally cheap way to recolour those, only a heavier `PrintObject`/
 * `updateGraphic()` path, which is out of scope here.
 */
export type EngravedNote = { NoteheadColor: string; readonly ParentVoiceEntry: { StemColor: string } }

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
export type OsmdGraphicalNote = {
  setColor(color: string, options: OsmdColoringOptions): void
  getSVGGElement(): SVGGElement
  readonly vfnoteIndex: number
  getNoteheadSVGs(): readonly Element[]
}
export type OsmdEngravingRules = { GNote(note: EngravedNote): OsmdGraphicalNote | undefined }

export type EngravedRawNote = EngravedNote & { readonly halfTone: number; isRest(): boolean }
export type EngravedVoiceEntry = { readonly Notes: readonly EngravedRawNote[] }
export type EngravedStaffEntry = { readonly VoiceEntries: readonly EngravedVoiceEntry[] }
// OSMD leaves a slot `undefined` when a staff has no entry at that container's
// vertical timestamp (e.g. one staff rests while another sounds a note) — this
// is a sparse array, not a dense one, however implausible the SDK's own types
// make it look.
export type EngravedContainer = { readonly StaffEntries: readonly (EngravedStaffEntry | undefined)[] }
export type EngravedSourceMeasure = {
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
export type OsmdCursor = {
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
const PAPER_INK = '#191712'
export const SCORE_INK = PAPER_INK
/**
 * Exported for `osmdEngraver.test.ts` — the colour `clearNoteColors`
 * restores — and for `PracticeScreen.tsx`, which restores a deselected
 * notehead to it directly (roadmap 4.8a). Same ink as `SCORE_INK`, kept as
 * its own binding because the two names answer different questions ("what
 * colour is the score drawn in" vs "what colour does a reset notehead get").
 */
export const DEFAULT_NOTE_COLOR = PAPER_INK
/**
 * The read-ahead drill (roadmap 2.26, REQ-3.4.5) "hides" a note by painting it
 * the same colour as the page background rather than toggling engraving
 * visibility — far cheaper than re-laying-out the measure, and reversible by
 * the same `NoteheadColor` write `setNoteColor` already uses. Keep this in
 * step with `--paper` in src/design-system/tokens/colors.css.
 */
export const HIDDEN_NOTE_COLOR = '#f8f5ec'

/**
 * Shape/stroke cue that makes a note's feedback state legible without colour
 * (roadmap 5.24 — "Color is NEVER the only signal", `colors.css`'s own header
 * comment). These three names are exactly the selectors `.notation-frame
 * .note-correct` / `.note-wrong` / `.note-missed` implement in
 * `src/design-system/css/domain.css`; nothing upstream of `paint()` needs to
 * know a class is involved at all, only the colour it was already writing.
 */
export const FEEDBACK_CLASSES = ['note-correct', 'note-wrong', 'note-missed'] as const
export type FeedbackClass = (typeof FEEDBACK_CLASSES)[number]

/**
 * The three colours `useNoteFeedback.ts`'s `colorForVerdict` hands
 * `setNoteColor` for a `correct` / `wrongPitch` / `missed` verdict — kept in
 * exact sync with that file's own `CORRECT_COLOR`/`WRONG_PITCH_COLOR`/
 * `MISSED_COLOR` constants, and with `--fb-correct-ink`/`--fb-wrong-ink`/
 * `--fb-missed-ink` in src/design-system/tokens/colors.css, the same
 * hardcode-with-sync-comment contract `SCORE_INK` above already has with
 * `--paper-fg`: OSMD wants a concrete hex, never a CSS variable.
 *
 * This pair (colour in, class out) is deliberately a plain value comparison,
 * not a verdict passed down from `useNoteFeedback.ts` — the call this file
 * actually receives is `setNoteColor(noteId, color)` (see `engraver.ts`),
 * routed there through `ScoreViewerHandle.setNoteColor` in `ScoreViewer.tsx`
 * (owned by a different session this round), which forwards exactly two
 * arguments. A verdict-typed third parameter has nowhere to travel without
 * editing that file, so classifying the COLOUR itself is the only channel
 * available inside this round's file boundary — and it is sufficient, since
 * `colorForVerdict` already gives each verdict its own exact colour.
 */
export const FEEDBACK_CORRECT_COLOR = '#1c7c3c'
export const FEEDBACK_WRONG_COLOR = '#c22f2c'
export const FEEDBACK_MISSED_COLOR = '#666e78'

export const FEEDBACK_CLASS_BY_COLOR: ReadonlyMap<string, FeedbackClass> = new Map([
  [FEEDBACK_CORRECT_COLOR, 'note-correct'],
  [FEEDBACK_WRONG_COLOR, 'note-wrong'],
  [FEEDBACK_MISSED_COLOR, 'note-missed'],
])

/**
 * Marks the `<g>` this file owns inside OSMD's SVG so a later call can find
 * and clear it rather than accumulate a new group on every `setMeasureLabels`
 * call or every OSMD-initiated re-render (roadmap 3.18a).
 */
const MEASURE_LABEL_GROUP_ATTR = 'data-measure-labels'
/** Vertical gap (px) between a measure's lowest staff line and its label's baseline. */
const MEASURE_LABEL_Y_OFFSET = 16
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
export function stampNoteIds(osmd: OsmdLike, noteById: ReadonlyMap<string, EngravedNote>): void {
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
 * This note's own notehead SVG element when resolvable — `getNoteheadSVGs()`
 * indexed by `vfnoteIndex`, required for a CHORD, where every member shares
 * one `getSVGGElement()` group (see the `OsmdGraphicalNote` doc comment) —
 * falling back to that shared group otherwise. The exact access path
 * `stampNoteIds` above already uses to place `data-note-id`; factored out
 * here so `applyFeedbackClass` targets the identical element a click would
 * resolve back to the same note.
 */
function resolveNoteheadElement(graphicalNote: OsmdGraphicalNote): Element | undefined {
  return graphicalNote.getNoteheadSVGs()[graphicalNote.vfnoteIndex] ?? graphicalNote.getSVGGElement()
}

/**
 * Replaces whichever of `FEEDBACK_CLASSES` the notehead element currently
 * carries with `className` (or none, for `undefined`) — always a full
 * remove-then-add rather than a toggle, so a note that changes verdict
 * (e.g. correct, then cleared, then missed on a later pass) never ends up
 * wearing two classes at once. Can throw (DOM access via `resolveNoteheadElement`
 * or `classList`) — deliberately left to the caller's own `try`, exactly like
 * `graphicalNote.setColor` itself, so a failure here falls back to
 * `'needs-render'` the same way a `setColor` failure already does.
 */
export function applyFeedbackClass(graphicalNote: OsmdGraphicalNote, className: FeedbackClass | undefined): void {
  const el = resolveNoteheadElement(graphicalNote)
  if (el === undefined) return
  for (const cls of FEEDBACK_CLASSES) el.classList.remove(cls)
  if (className !== undefined) el.classList.add(className)
}

/**
 * Re-stamps every currently-fed-back note's class after a full re-engrave —
 * the same durability requirement as `stampNoteIds`/`applyMeasureLabels`
 * above, and for the identical reason: the class lives only on the SVG
 * element, which `render()` discards and rebuilds from scratch, and unlike
 * colour there is no OSMD model property a class could be written onto that
 * `render()` would redraw from on its own (see the module comment's
 * "Rendering" section for why colour alone needs no equivalent here).
 *
 * Iterates `coloredIds` only — the notes that currently have ANY requested
 * colour, typically a small fraction of the score — not every mapped note,
 * so a resize on a long piece costs O(notes currently showing feedback), not
 * O(score size). Best-effort and never throws, same contract as its siblings.
 */
export function reapplyFeedbackClasses(
  osmdInstance: OsmdLike,
  noteById: ReadonlyMap<string, EngravedNote>,
  coloredIds: ReadonlySet<string>,
  hiddenIds: ReadonlySet<string>,
  desiredColor: ReadonlyMap<string, string>,
): void {
  for (const id of coloredIds) {
    const note = noteById.get(id)
    if (note === undefined) continue
    const color = hiddenIds.has(id) ? HIDDEN_NOTE_COLOR : (desiredColor.get(id) ?? DEFAULT_NOTE_COLOR)
    const feedbackClass = FEEDBACK_CLASS_BY_COLOR.get(color)
    if (feedbackClass === undefined) continue
    try {
      const graphicalNote = osmdInstance.rules.GNote(note)
      if (graphicalNote !== undefined) applyFeedbackClass(graphicalNote, feedbackClass)
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
export function applyMeasureLabels(
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
