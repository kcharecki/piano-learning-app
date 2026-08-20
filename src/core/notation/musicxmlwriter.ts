/**
 * `Score` -> MusicXML text (REQ-3.2.5, REQ-3.4.2) — the inverse of `musicxml.ts`.
 *
 * The two must agree on one convention: a part with more than one staff sends
 * staff 1 to the right hand and staff 2 to the left (see `musicxml.ts:432-546`).
 * Everything here is written to satisfy that reader, not any other consumer, so
 * that `parseMusicXml(writeMusicXml(score))` reproduces `score` exactly on the
 * fields that matter to playback: midi, startTick, durationTicks, hand,
 * measureIndex.
 *
 * `<divisions>` is fixed at `TICKS_PER_QUARTER` (480), so one division is one
 * tick — every `<duration>`, `<backup>` and `<forward>` value below is a tick
 * count with no unit conversion and therefore no rounding.
 *
 * A single staff's `hand` is a per-note fact in the Score model (the parser
 * derives it from whatever clef was active when a note was read), while a
 * staff's clef is declared once in `score.staves`. To round-trip a single-staff
 * score whose hand switches mid-piece (a clef change in the original file), this
 * writer re-declares the clef in whatever later measure the hand changes,
 * choosing bass for 'left' and the staff's own declared clef (or treble, if that
 * declared clef is itself bass) for 'right'. A multi-staff score never needs
 * this: hand is pinned to the staff number there, so its clef never changes.
 */
import { alterFor } from '@core/theory/keys.ts'
import { fromMidi } from '@core/theory/pitch.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import {
  measureDurationTicks,
  notesInMeasure,
  type Clef,
  type Measure,
  type Score,
  type ScoreNote,
  type StaffInfo,
  type Tuplet,
} from './score.ts'

// -------------------------------------------------------------------- escaping

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ----------------------------------------------------------------- note values

/** `<type>` values in quarter notes, largest first — the vocabulary this writer emits. */
const TYPE_QUARTERS: readonly (readonly [string, number])[] = [
  ['whole', 4],
  ['half', 2],
  ['quarter', 1],
  ['eighth', 0.5],
  ['16th', 0.25],
  ['32nd', 0.125],
]

/** One dot adds a half, two dots three quarters — the same rule `musicxml.ts` reads by. */
const dotFactor = (dots: number): number => 2 - 2 ** -dots

/**
 * The largest `<type>` whose (possibly dotted, up to two dots) value does not
 * exceed the note's duration, engraving-only: the parser trusts `<duration>`
 * for everything, so no duration — however odd, e.g. from a tie fragment —
 * fails to produce a plausible type here.
 *
 * A tuplet note's raw `durationTicks` is not what it is written as — a triplet
 * eighth is 160 ticks (0.333 quarters), which by raw duration would engrave as
 * a 16th. `tuplet` recovers the WRITTEN duration via its ratio
 * (`durationTicks * actual / normal`; 160 * 3 / 2 = 240, an eighth) before the
 * lookup runs.
 */
function typeAndDots(
  durationTicks: number,
  tuplet?: Tuplet,
): { readonly type: string; readonly dots: number } {
  const writtenTicks = tuplet === undefined ? durationTicks : (durationTicks * tuplet.actual) / tuplet.normal
  const quarters = writtenTicks / TICKS_PER_QUARTER
  for (const [type, base] of TYPE_QUARTERS) {
    if (base > quarters && type !== '32nd') continue
    let dots = 0
    while (dots < 2 && base * dotFactor(dots + 1) <= quarters) dots++
    return { type, dots }
  }
  return { type: '32nd', dots: 0 } // unreachable: the loop always matches on '32nd'
}

// --------------------------------------------------------------------- pitch

const CLEF_SIGN: Readonly<Record<Clef, readonly [string, number]>> = {
  treble: ['G', 2],
  bass: ['F', 4],
  alto: ['C', 3],
  tenor: ['C', 4],
}

function clefXml(staff: number, clef: Clef): string {
  const [sign, line] = CLEF_SIGN[clef]
  return `<clef number="${staff}"><sign>${sign}</sign><line>${line}</line></clef>`
}

/**
 * MusicXML's accidental names for every value `Alter` allows. `fromMidi`
 * (the no-spelling fallback) only ever produces -1/0/1, but a note carrying
 * its own `spelling` — e.g. a scale's raised leading tone — can legitimately
 * need a double sharp/flat.
 */
function accidentalName(alter: number): string {
  switch (alter) {
    case 2:
      return 'double-sharp'
    case 1:
      return 'sharp'
    case 0:
      return 'natural'
    case -1:
      return 'flat'
    default:
      return 'flat-flat'
  }
}

/**
 * `<pitch>` plus, when the spelling disagrees with the accidental already in
 * force for this letter+octave in the current measure, the `<accidental>`
 * name — computed once so the caller does not spell the note twice. An
 * accidental printed earlier in the measure persists to the end of the bar
 * (standard engraving practice), so the "already explained" baseline is
 * whatever `accidentalState` last recorded for this letter+octave, falling
 * back to the key signature the first time that letter+octave is seen.
 * Mutates `accidentalState`; reset it once per measure.
 *
 * `note.spelling`, when the builder supplied one, is engraved AS WRITTEN —
 * it is what lets a scale's E#/B#/Cb/Fb leading tone or a harmonic-minor
 * raised 7th disagree with the measure's single sharps-vs-flats bias and
 * still print correctly. Without it, `fromMidi` re-derives a spelling from
 * `midi` alone, which can only ever choose between the twelve single
 * sharp/flat spellings for that measure.
 */
function pitchXml(
  note: ScoreNote,
  keyFifths: number,
  accidentalState: Map<string, number>,
): { readonly xml: string; readonly accidental?: string } {
  const preferFlats = keyFifths < 0
  const spelled = note.spelling ?? fromMidi(note.midi, preferFlats)
  const keyAlter = alterFor({ fifths: keyFifths, mode: 'major' }, spelled.letter)
  const stateKey = `${spelled.letter}${spelled.octave}`
  const priorAlter = accidentalState.get(stateKey) ?? keyAlter
  const alterEl = spelled.alter === 0 ? '' : `<alter>${spelled.alter}</alter>`
  const xml = `<pitch><step>${spelled.letter}</step>${alterEl}<octave>${spelled.octave}</octave></pitch>`
  accidentalState.set(stateKey, spelled.alter)
  return spelled.alter === priorAlter
    ? { xml }
    : { xml, accidental: accidentalName(spelled.alter) }
}

// ---------------------------------------------------------------------- notes

function noteXml(
  note: ScoreNote,
  chord: boolean,
  keyFifths: number,
  staff: number,
  accidentalState: Map<string, number>,
): string {
  const { xml: pitch, accidental } = pitchXml(note, keyFifths, accidentalState)
  const { type, dots } = typeAndDots(note.durationTicks, note.tuplet)
  const parts: string[] = ['<note>']
  if (chord) parts.push('<chord/>')
  parts.push(pitch, `<duration>${note.durationTicks}</duration>`)
  if (note.tiedFrom) parts.push('<tie type="stop"/>')
  if (note.tiedTo) parts.push('<tie type="start"/>')
  parts.push(`<voice>${note.voice}</voice>`, `<type>${type}</type>`)
  for (let i = 0; i < dots; i++) parts.push('<dot/>')
  if (accidental !== undefined) parts.push(`<accidental>${accidental}</accidental>`)
  // Schema order (`chord?, pitch, duration, tie*, voice, type, dot*,
  // accidental?, time-modification?, staff?, beam*, notations*`):
  // time-modification sits after accidental and before staff; beam sits after
  // staff and before notations.
  if (note.tuplet !== undefined) {
    parts.push(
      '<time-modification>' +
        `<actual-notes>${note.tuplet.actual}</actual-notes>` +
        `<normal-notes>${note.tuplet.normal}</normal-notes>` +
        '</time-modification>',
    )
  }
  parts.push(`<staff>${staff}</staff>`)
  if (note.tuplet !== undefined) {
    const beam =
      note.tuplet.position === 'start' ? 'begin' : note.tuplet.position === 'stop' ? 'end' : 'continue'
    parts.push(`<beam number="1">${beam}</beam>`)
  }
  const notations: string[] = []
  if (note.tiedFrom) notations.push('<tied type="stop"/>')
  if (note.tiedTo) notations.push('<tied type="start"/>')
  // The bracket only marks the group's edges — MusicXML readers infer the
  // span from start to the next matching stop, so an inner note (which
  // already carries the <time-modification> above) gets neither tag.
  if (note.tuplet !== undefined && note.tuplet.position !== 'inner') {
    notations.push(`<tuplet type="${note.tuplet.position}" number="1"/>`)
  }
  // REQ-3.7.1 (roadmap 5.22): a fingering rides on the SAME `<notations>` a
  // tie already uses — printed editions place RH numbers above the staff and
  // LH below it, and OSMD's `FingeringPositionFromXML` (default true) honors
  // this attribute directly rather than falling back to its own above/below
  // heuristic, which is what makes "above their own noteheads, per hand" a
  // property of the XML, not a hope about the renderer's guess.
  if (note.fingering !== undefined) {
    const placement = note.hand === 'left' ? 'below' : 'above'
    notations.push(
      `<technical><fingering placement="${placement}">${note.fingering}</fingering></technical>`,
    )
  }
  if (notations.length > 0) parts.push(`<notations>${notations.join('')}</notations>`)
  parts.push('</note>')
  return parts.join('')
}

function restXml(durationTicks: number, voice: number, staff: number): string {
  const { type, dots } = typeAndDots(durationTicks)
  const parts = ['<note><rest/>', `<duration>${durationTicks}</duration>`, `<voice>${voice}</voice>`, `<type>${type}</type>`]
  for (let i = 0; i < dots; i++) parts.push('<dot/>')
  parts.push(`<staff>${staff}</staff></note>`)
  return parts.join('')
}

function forwardXml(durationTicks: number): string {
  return `<forward><duration>${durationTicks}</duration></forward>`
}

function backupXml(durationTicks: number): string {
  return `<backup><duration>${durationTicks}</duration></backup>`
}

/**
 * One (staff, voice) stream's content for one measure: its notes in order,
 * `<rest/>` filling a gap the reader's cursor would otherwise skip, `<chord/>`
 * on a note sharing its predecessor's onset AND duration (a shorter or longer
 * "chord" member is not a real chord — MusicXML chord notes share the first
 * note's duration — so it starts a fresh position instead). Ticks are
 * measure-relative. When a note's onset lies BEFORE the cursor the stream's
 * own notes have already reached — two notes in one nominal voice that
 * overlap in time, which is not representable as true polyphony inside a
 * single MusicXML voice — a `<backup>` is emitted so the reader's cursor
 * still lands on this note's actual onset instead of drifting forward and
 * corrupting every later onset (including other staves/voices, which resync
 * off this stream's final cursor position).
 */
function voiceStreamXml(
  notes: readonly ScoreNote[],
  measure: Measure,
  staff: number,
  accidentalState: Map<string, number>,
  clefTrack?: { clef: Clef; readonly staffInfo: StaffInfo },
): string[] {
  const out: string[] = []
  let cursor = 0
  let prev: ScoreNote | undefined
  for (const note of notes) {
    const localStart = note.startTick - measure.startTick
    const chord =
      prev !== undefined &&
      note.startTick === prev.startTick &&
      note.voice === prev.voice &&
      note.durationTicks === prev.durationTicks
    if (!chord) {
      if (localStart > cursor) out.push(restXml(localStart - cursor, note.voice, staff))
      else if (localStart < cursor) out.push(backupXml(cursor - localStart))
      if (clefTrack !== undefined) {
        const target: Clef =
          note.hand === 'left' ? 'bass' : clefTrack.staffInfo.clef === 'bass' ? 'treble' : clefTrack.staffInfo.clef
        if (target !== clefTrack.clef) {
          clefTrack.clef = target
          out.push(`<attributes>${clefXml(staff, target)}</attributes>`)
        }
      }
      cursor = localStart + note.durationTicks
    }
    out.push(noteXml(note, chord, measure.keyFifths, staff, accidentalState))
    prev = note
  }
  if (cursor < measure.durationTicks) {
    out.push(restXml(measure.durationTicks - cursor, prev?.voice ?? 1, staff))
  } else if (cursor > measure.durationTicks) {
    out.push(backupXml(cursor - measure.durationTicks))
  }
  return out
}

/**
 * One staff's content for one measure: every voice present, in ascending
 * voice-number order, each starting back at the measure's tick 0 via
 * `<backup>` (a staff with no notes at all is one full-measure rest in voice
 * 1). `clefTrack`, when given, is mutated in onset order across every voice
 * so a mid-measure hand change re-declares the clef inline — only meaningful
 * for the single-staff case, where a staff's `hand` is a per-note fact.
 */
function staffContentXml(
  notes: readonly ScoreNote[],
  measure: Measure,
  staff: number,
  accidentalState: Map<string, number>,
  clefTrack?: { clef: Clef; readonly staffInfo: StaffInfo },
): string[] {
  if (notes.length === 0) return [restXml(measure.durationTicks, 1, staff)]
  const byVoice = new Map<number, ScoreNote[]>()
  for (const note of notes) {
    const existing = byVoice.get(note.voice)
    if (existing === undefined) byVoice.set(note.voice, [note])
    else existing.push(note)
  }
  const voiceNumbers = [...byVoice.keys()].sort((a, b) => a - b)
  const out: string[] = []
  voiceNumbers.forEach((voice, i) => {
    if (i > 0) out.push(backupXml(measure.durationTicks))
    const voiceNotes = byVoice.get(voice) ?? []
    out.push(...voiceStreamXml(voiceNotes, measure, staff, accidentalState, clefTrack))
  })
  return out
}

// ----------------------------------------------------------------- attributes

function tempoXml(bpm: number): string {
  return (
    '<direction placement="above"><direction-type><metronome>' +
    `<beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute>` +
    `</metronome></direction-type><sound tempo="${bpm}"/></direction>`
  )
}

/**
 * The clef a single-staff score must declare in `measure` for its notes' `hand`
 * to survive the round trip, or `[]` when nothing needs to change (including
 * every multi-staff score, where hand is pinned to the staff number instead).
 * Mutates `current` when it returns a change, so the next measure compares
 * against what this one just declared.
 */
function clefChangesFor(
  score: Score,
  measure: Measure,
  current: Map<number, Clef>,
): readonly { readonly staff: number; readonly clef: Clef }[] {
  const staffInfo = score.staves.length === 1 ? score.staves[0] : undefined
  if (staffInfo === undefined) return []
  const first = notesInMeasure(score, measure.index)[0]
  if (first === undefined) return []
  const target: Clef =
    first.hand === 'left' ? 'bass' : staffInfo.clef === 'bass' ? 'treble' : staffInfo.clef
  if (current.get(staffInfo.staff) === target) return []
  current.set(staffInfo.staff, target)
  return [{ staff: staffInfo.staff, clef: target }]
}

function sameTimeSignature(
  a: Measure['timeSignature'],
  b: Measure['timeSignature'] | undefined,
): boolean {
  return b !== undefined && a.beats === b.beats && a.beatType === b.beatType
}

function attributesXml(
  measure: Measure,
  prevMeasure: Measure | undefined,
  staves: readonly { readonly staff: number; readonly clef: Clef }[],
  clefChanges: readonly { readonly staff: number; readonly clef: Clef }[],
): string | undefined {
  const isFirst = prevMeasure === undefined
  const keyChanged = isFirst || measure.keyFifths !== prevMeasure.keyFifths
  const timeChanged = isFirst || !sameTimeSignature(measure.timeSignature, prevMeasure.timeSignature)
  if (!isFirst && !keyChanged && !timeChanged && clefChanges.length === 0) return undefined

  const parts: string[] = ['<attributes>']
  if (isFirst) parts.push(`<divisions>${TICKS_PER_QUARTER}</divisions>`)
  if (keyChanged) parts.push(`<key><fifths>${measure.keyFifths}</fifths></key>`)
  if (timeChanged) {
    parts.push(
      `<time><beats>${measure.timeSignature.beats}</beats>` +
        `<beat-type>${measure.timeSignature.beatType}</beat-type></time>`,
    )
  }
  if (isFirst && staves.length > 1) parts.push(`<staves>${staves.length}</staves>`)
  // On the first measure, `clefChanges` already reflects whatever the actual
  // first note needs (see `clefChangesFor`, now called for every measure
  // including the first); fall back to the declared staves only when nothing
  // needed to change (e.g. no notes at all).
  const clefs = isFirst && clefChanges.length === 0 ? staves : clefChanges
  for (const c of clefs) parts.push(clefXml(c.staff, c.clef))
  parts.push('</attributes>')
  return parts.join('')
}

// ------------------------------------------------------------------ the writer

/** Serialise a Score as score-partwise MusicXML 4.0 text. Total: every valid Score is writable. */
export function writeMusicXml(score: Score): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<score-partwise version="4.0">']
  if (score.meta.title.length > 0) {
    lines.push(`<work><work-title>${escapeXml(score.meta.title)}</work-title></work>`)
  }
  if (score.meta.composer.length > 0) {
    lines.push(
      '<identification><creator type="composer">' +
        `${escapeXml(score.meta.composer)}</creator></identification>`,
    )
  }
  lines.push('<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>')
  lines.push('<part id="P1">')

  // A part with more than one staff sends staff 1 to the right hand and staff
  // 2 to the left (the reader's rule — see the module doc). Writing by
  // `note.staff` only holds that bar when `score.staves` itself already
  // agrees with it; writing by `note.hand` instead makes the bar hold
  // unconditionally. A single-staff score keeps writing by its one declared
  // staff number, where `hand` is a per-note fact tracked via `clefTrack`.
  const multiStaff = score.staves.length > 1
  const onlyStaff = score.staves.length === 1 ? score.staves[0] : undefined
  const writeStaves: readonly { readonly staff: number; readonly clef: Clef; readonly hand?: 'left' | 'right' }[] =
    multiStaff ? [{ staff: 1, clef: 'treble', hand: 'right' }, { staff: 2, clef: 'bass', hand: 'left' }] : score.staves

  const currentClef = new Map<number, Clef>()
  if (onlyStaff !== undefined) currentClef.set(onlyStaff.staff, onlyStaff.clef)

  let prevMeasure: Measure | undefined
  for (const measure of score.measures) {
    const clefChanges = clefChangesFor(score, measure, currentClef)
    const attrs = attributesXml(measure, prevMeasure, writeStaves, clefChanges)
    const pickup = measure.durationTicks < measureDurationTicks(measure.timeSignature)
    lines.push(`<measure number="${escapeXml(measure.number)}"${pickup ? ' implicit="yes"' : ''}>`)
    if (attrs !== undefined) lines.push(attrs)

    const measureEnd = measure.startTick + measure.durationTicks
    for (const tempo of score.tempos) {
      if (tempo.tick < measure.startTick || tempo.tick >= measureEnd) continue
      const offset = tempo.tick - measure.startTick
      if (offset > 0) lines.push(forwardXml(offset))
      lines.push(tempoXml(tempo.bpm))
      if (offset > 0) lines.push(backupXml(offset))
    }

    const accidentalState = new Map<string, number>()
    const measureNotes = notesInMeasure(score, measure.index)
    writeStaves.forEach((staff, i) => {
      const staffNotes = multiStaff
        ? measureNotes.filter((n) => (staff.staff === 1 ? n.hand === 'right' : n.hand === 'left'))
        : measureNotes.filter((n) => n.staff === staff.staff)
      const clefTrack =
        onlyStaff !== undefined && onlyStaff.staff === staff.staff
          ? { clef: currentClef.get(staff.staff) ?? staff.clef, staffInfo: onlyStaff }
          : undefined
      lines.push(...staffContentXml(staffNotes, measure, staff.staff, accidentalState, clefTrack))
      if (clefTrack !== undefined) currentClef.set(staff.staff, clefTrack.clef)
      if (i < writeStaves.length - 1) {
        lines.push(`<backup><duration>${measure.durationTicks}</duration></backup>`)
      }
    })
    lines.push('</measure>')
    prevMeasure = measure
  }
  lines.push('</part>', '</score-partwise>')
  return lines.join('\n')
}
