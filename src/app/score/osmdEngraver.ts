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
 * ## Batched rendering (roadmap 2.21, REQ-3.3.6)
 *
 * `osmd.render()` re-engraves the ENTIRE score synchronously — expensive
 * enough that calling it once per judged note (four times for a four-note
 * chord, all on the incoming MIDI event's own task) blew the 100ms visual
 * budget. `setNoteColor`/`clearNoteColors` now only mutate `NoteheadColor` on
 * the affected `Note` objects and call `requestRender()`, which coalesces any
 * number of calls within one task into exactly one `render()`, scheduled via
 * the injectable `scheduleRender` (real `requestAnimationFrame` by default).
 * Because `render()` always draws whatever the note objects currently hold,
 * coalescing never drops a mutation — the frame that eventually fires always
 * sees the LAST colour written, even if a dozen calls raced ahead of it.
 */
import type { Score, ScoreNote } from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { stepsToOnsetAtOrBefore } from './cursorSteps.ts'
import type { ScoreEngraver } from './engraver.ts'

/** The slice of OSMD's `Note` this file actually touches. */
type EngravedNote = { NoteheadColor: string }

type EngravedRawNote = EngravedNote & { readonly halfTone: number; isRest(): boolean }
type EngravedVoiceEntry = { readonly Notes: readonly EngravedRawNote[] }
type EngravedStaffEntry = { readonly VoiceEntries: readonly EngravedVoiceEntry[] }
type EngravedContainer = { readonly StaffEntries: readonly EngravedStaffEntry[] }
type EngravedSourceMeasure = {
  readonly VerticalSourceStaffEntryContainers: readonly EngravedContainer[]
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
  readonly cursor: OsmdCursor
  load(musicXml: string): Promise<void>
  render(): void
  clear(): void
}

/**
 * OSMD engraves in black by default, which is invisible on this app's dark
 * background — the notation rendered as black-on-near-black and could not be
 * read at all. Everything drawn is forced to the app's foreground colour
 * instead. Keep this in step with `--fg` in styles.css; OSMD wants a concrete
 * hex, so a CSS variable cannot be handed to it directly.
 */
const SCORE_INK = '#e8e6e3'
/** Exported for `osmdEngraver.test.ts` — the colour `clearNoteColors` restores. */
export const DEFAULT_NOTE_COLOR = SCORE_INK
const MAX_CURSOR_STEPS = 10_000

const DEFAULT_OSMD_OPTIONS = {
  autoResize: true,
  drawTitle: true,
  followCursor: true,
  defaultColorMusic: SCORE_INK,
  defaultColorNotehead: SCORE_INK,
  defaultColorStem: SCORE_INK,
  defaultColorRest: SCORE_INK,
  defaultColorLabel: SCORE_INK,
  defaultColorTitle: SCORE_INK,
}

/** The only place the real OSMD library is constructed. */
function defaultCreateOsmd(container: HTMLElement): OsmdLike {
  return new OpenSheetMusicDisplay(container, DEFAULT_OSMD_OPTIONS) as unknown as OsmdLike
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

/** Wind a freshly-reset cursor forward to the start of `measureIndex`. */
function seekMeasure(cursor: OsmdCursor, measureIndex: number): void {
  cursor.reset()
  for (let i = 0; i < measureIndex && !cursor.iterator.EndReached; i++) cursor.nextMeasure()
}

/**
 * Park the cursor on the onset the playhead is currently SOUNDING — the last
 * onset at or before `tick` — and never on the one it is about to reach.
 *
 * The obvious loop ("step until `currentTick >= tick`, then stop") is wrong by
 * a whole note, and wrong from the very first frame: a frame lands the
 * transport a few ticks past 0, so onset 1 at tick 0 fails `0 >= 13` and the
 * cursor steps to onset 2, where it stays one note ahead of the audio for the
 * rest of the piece. Reported from the running app: a note sounds while the
 * highlight sits on the following rest.
 *
 * OSMD's cursor can only step forward, so finding the last onset at or before
 * `tick` takes two passes: walk once to collect every onset's tick, hand that
 * to `stepsToOnsetAtOrBefore` (the pure decision, unit-tested in
 * `cursorSteps.test.ts`), then reset and replay exactly that many steps.
 * Stepping until we overshoot and trying to back off is not possible with
 * this API, hence the replay.
 */
function moveCursor(osmd: OsmdLike, measureIndex: number, tick: number): void {
  const cursor = osmd.cursor
  const tickOf = (): number =>
    cursor.iterator.CurrentSourceTimestamp.RealValue * 4 * TICKS_PER_QUARTER

  seekMeasure(cursor, measureIndex)
  const onsetTicks: number[] = []
  let steps = 0
  while (!cursor.iterator.EndReached && steps < MAX_CURSOR_STEPS) {
    const onset = tickOf()
    onsetTicks.push(onset)
    // Stop at the FIRST onset past the playhead. One past is all
    // `stepsToOnsetAtOrBefore` needs to know it has gone far enough, and this
    // runs every frame — collecting the whole score each time would make the
    // per-frame cost grow with the length of the piece rather than with how
    // far into it the playhead is.
    if (onset > tick) break
    cursor.next()
    steps += 1
  }
  const stepsToTake = stepsToOnsetAtOrBefore(onsetTicks, tick)

  seekMeasure(cursor, measureIndex)
  for (let i = 0; i < stepsToTake && !cursor.iterator.EndReached; i++) cursor.next()
  cursor.update()
  cursor.show()
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
}

export function createOsmdEngraver(opts?: OsmdEngraverOptions): ScoreEngraver {
  const scheduleRender = opts?.scheduleRender ?? defaultScheduleRender
  const createOsmd = opts?.createOsmd ?? defaultCreateOsmd

  let osmd: OsmdLike | undefined
  let noteById = new Map<string, EngravedNote>()
  const coloredIds = new Set<string>()
  let renderPending = false

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
      osmd?.render()
    })
  }

  return {
    async load(container, musicXml, score) {
      const instance = createOsmd(container)
      await instance.load(musicXml)
      instance.render()
      instance.cursor.show()
      osmd = instance
      noteById = buildNoteIdMap(instance, score)
      coloredIds.clear()
    },

    moveCursorTo(measureIndex, tick) {
      if (osmd === undefined) return
      moveCursor(osmd, measureIndex, tick)
    },

    setNoteColor(noteId, color) {
      const note = noteById.get(noteId)
      if (note === undefined || osmd === undefined) return
      note.NoteheadColor = color
      coloredIds.add(noteId)
      requestRender()
    },

    clearNoteColors() {
      if (osmd === undefined || coloredIds.size === 0) return
      for (const id of coloredIds) {
        const note = noteById.get(id)
        if (note !== undefined) note.NoteheadColor = DEFAULT_NOTE_COLOR
      }
      coloredIds.clear()
      requestRender()
    },

    destroy() {
      osmd?.clear()
      osmd = undefined
      noteById = new Map()
      coloredIds.clear()
      renderPending = false
    },
  }
}
