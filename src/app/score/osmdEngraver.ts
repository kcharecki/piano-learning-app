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
 */
import type { Score, ScoreNote } from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { ScoreEngraver } from './engraver.ts'

/** The slice of OSMD's `Note` this file actually touches. */
type EngravedNote = { NoteheadColor: string }

type EngravedRawNote = EngravedNote & { readonly halfTone: number; isRest(): boolean }
type EngravedVoiceEntry = { readonly Notes: readonly EngravedRawNote[] }
type EngravedStaffEntry = { readonly VoiceEntries: readonly EngravedVoiceEntry[] }
type EngravedContainer = { readonly StaffEntries: readonly EngravedStaffEntry[] }

/**
 * OSMD engraves in black by default, which is invisible on this app's dark
 * background — the notation rendered as black-on-near-black and could not be
 * read at all. Everything drawn is forced to the app's foreground colour
 * instead. Keep this in step with `--fg` in styles.css; OSMD wants a concrete
 * hex, so a CSS variable cannot be handed to it directly.
 */
const SCORE_INK = '#e8e6e3'
const DEFAULT_NOTE_COLOR = SCORE_INK
const MAX_CURSOR_STEPS = 10_000

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
function buildNoteIdMap(osmd: OpenSheetMusicDisplay, score: Score): Map<string, EngravedNote> {
  const map = new Map<string, EngravedNote>()
  try {
    const ourNotesByMeasure = groupNotesByMeasure(score.notes)
    const sourceMeasures = osmd.Sheet.SourceMeasures as unknown as {
      VerticalSourceStaffEntryContainers: EngravedContainer[]
    }[]
    sourceMeasures.forEach((measure, measureIndex) => {
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

/** Advance the cursor to `measureIndex`, then as close to `tick` as a note onset allows. */
function moveCursor(osmd: OpenSheetMusicDisplay, measureIndex: number, tick: number): void {
  const cursor = osmd.cursor
  cursor.reset()
  for (let i = 0; i < measureIndex && !cursor.iterator.EndReached; i++) cursor.nextMeasure()
  let steps = 0
  while (!cursor.iterator.EndReached && steps < MAX_CURSOR_STEPS) {
    const currentTick = cursor.iterator.CurrentSourceTimestamp.RealValue * 4 * TICKS_PER_QUARTER
    if (currentTick >= tick) break
    cursor.next()
    steps += 1
  }
  cursor.update()
  cursor.show()
}

export function createOsmdEngraver(): ScoreEngraver {
  let osmd: OpenSheetMusicDisplay | undefined
  let noteById = new Map<string, EngravedNote>()
  const coloredIds = new Set<string>()

  return {
    async load(container, musicXml, score) {
      const instance = new OpenSheetMusicDisplay(container, {
        autoResize: true,
        drawTitle: true,
        followCursor: true,
        defaultColorMusic: SCORE_INK,
        defaultColorNotehead: SCORE_INK,
        defaultColorStem: SCORE_INK,
        defaultColorRest: SCORE_INK,
        defaultColorLabel: SCORE_INK,
        defaultColorTitle: SCORE_INK,
      })
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
      osmd.render()
    },

    clearNoteColors() {
      if (osmd === undefined || coloredIds.size === 0) return
      for (const id of coloredIds) {
        const note = noteById.get(id)
        if (note !== undefined) note.NoteheadColor = DEFAULT_NOTE_COLOR
      }
      coloredIds.clear()
      osmd.render()
    },

    destroy() {
      osmd?.clear()
      osmd = undefined
      noteById = new Map()
      coloredIds.clear()
    },
  }
}
