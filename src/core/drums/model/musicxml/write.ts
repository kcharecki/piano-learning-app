/**
 * `GrooveScore` -> MusicXML text (DR-04) — the inverse of `./parse.ts`. Follows
 * `core/notation/musicxmlwriter.ts`'s shape closely: one `<part>`, notes
 * grouped into per-voice streams (hands = voice 1, stem up; feet = voice 2,
 * stem down), gaps filled with `<rest>` so a real notation reader can typeset
 * the bar correctly, `<backup>` between voice streams.
 *
 * `<sound><swing>` carries `swingPercent` as an EXACT integer ratio
 * (`<first>{swingPercent}</first><second>{100-swingPercent}</second>`,
 * always summing to 100) rather than the traditional small ratio (2:1, 3:2)
 * real jazz notation uses — `swingPercent`'s 50..75 domain (`../groove.ts`)
 * keeps both sides positive, and an exact integer round-trips losslessly,
 * which a reduced/rounded traditional ratio could not for an arbitrary
 * percent. `<first>`/`<second>` are schema-legal `positiveInteger`s with no
 * requirement that they be a "nice" ratio, so this stays valid MusicXML.
 */
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { gmNoteOf, staffPositionOf, type Notehead, type Voice } from '../pad.ts'
import { notesInMeasure, type GrooveMeasure, type GrooveNote, type GrooveScore } from '../groove.ts'
import { instrumentIdFor, padInstrumentName, usedPads, type InstrumentId } from './instrument.ts'
import { escapeXml, MIDI_PERCUSSION_CHANNEL, typeAndDots } from './shared.ts'

const NOTEHEAD_XML: Readonly<Record<Notehead, string>> = {
  normal: 'normal',
  x: 'x',
  circleX: 'circle-x',
  diamond: 'diamond',
}

function restXml(durationTicks: number, voiceNum: number): string {
  const { type, dots } = typeAndDots(durationTicks, TICKS_PER_QUARTER)
  const parts = [
    '<note><rest/>',
    `<duration>${durationTicks}</duration>`,
    `<voice>${voiceNum}</voice>`,
    `<type>${type}</type>`,
  ]
  for (let i = 0; i < dots; i++) parts.push('<dot/>')
  parts.push('</note>')
  return parts.join('')
}

function backupXml(durationTicks: number): string {
  return `<backup><duration>${durationTicks}</duration></backup>`
}

function notationsXml(note: GrooveNote): string {
  const ornaments: string[] = []
  if (note.articulations.includes('flam')) ornaments.push('<other-ornament>flam</other-ornament>')
  if (note.articulations.includes('drag')) ornaments.push('<other-ornament>drag</other-ornament>')
  if (note.articulations.includes('buzz')) ornaments.push('<tremolo type="single">3</tremolo>')

  const technical: string[] = []
  if (note.articulations.includes('open')) technical.push('<open/>')
  if (note.articulations.includes('choke')) technical.push('<damp/>')
  if (note.sticking !== undefined) technical.push(`<other-technical>${note.sticking}</other-technical>`)

  const articulations: string[] = []
  if (note.dynamics === 'accent') articulations.push('<accent/>')

  const parts: string[] = []
  if (ornaments.length > 0) parts.push(`<ornaments>${ornaments.join('')}</ornaments>`)
  if (technical.length > 0) parts.push(`<technical>${technical.join('')}</technical>`)
  if (articulations.length > 0) parts.push(`<articulations>${articulations.join('')}</articulations>`)
  return parts.join('')
}

function noteXml(note: GrooveNote, chord: boolean, instrumentId: InstrumentId): string {
  const position = staffPositionOf(note.pad)
  if (position === undefined) throw new Error(`unreachable: mapped pad ${note.pad} has no staff position`)
  const { type, dots } = typeAndDots(note.durationTicks, TICKS_PER_QUARTER)
  const voiceNum = note.voice === 'hands' ? 1 : 2
  const stem = note.voice === 'hands' ? 'up' : 'down'

  const parts: string[] = ['<note>']
  if (chord) parts.push('<chord/>')
  parts.push(
    `<unpitched><display-step>${position.step}</display-step><display-octave>${position.octave}</display-octave></unpitched>`,
  )
  parts.push(`<duration>${note.durationTicks}</duration>`)
  parts.push(`<instrument id="${instrumentId}"/>`)
  parts.push(`<voice>${voiceNum}</voice>`, `<type>${type}</type>`)
  for (let i = 0; i < dots; i++) parts.push('<dot/>')
  parts.push(`<stem>${stem}</stem>`)
  const parens = note.dynamics === 'ghost' ? ' parentheses="yes"' : ''
  parts.push(`<notehead${parens}>${NOTEHEAD_XML[position.notehead]}</notehead>`)
  const notations = notationsXml(note)
  if (notations.length > 0) parts.push(`<notations>${notations}</notations>`)
  parts.push('</note>')
  return parts.join('')
}

/**
 * One voice's content for one measure: notes in tick order, `<rest/>` filling
 * any gap, `<chord/>` for a same-tick-same-duration note sharing the stream
 * (a differently-timed note at the same tick is not a true MusicXML chord
 * member, so it gets its own `<backup>` instead — same rule
 * `musicxmlwriter.ts`'s `voiceStreamXml` uses). Always fills to the end of
 * the measure so the fixed full-bar `<backup>` between voice streams
 * (`measureXml`) is always correct.
 */
function voiceStreamXml(
  notes: readonly GrooveNote[],
  measure: GrooveMeasure,
  voiceNum: number,
  instrumentIdOf: (pad: GrooveNote['pad']) => InstrumentId,
): string[] {
  const out: string[] = []
  let cursor = 0
  let prev: GrooveNote | undefined
  for (const note of notes) {
    const localStart = note.tick - measure.startTick
    const chord =
      prev !== undefined && note.tick === prev.tick && note.durationTicks === prev.durationTicks
    if (!chord) {
      if (localStart > cursor) out.push(restXml(localStart - cursor, voiceNum))
      else if (localStart < cursor) out.push(backupXml(cursor - localStart))
      cursor = localStart + note.durationTicks
    }
    out.push(noteXml(note, chord, instrumentIdOf(note.pad)))
    prev = note
  }
  if (cursor < measure.durationTicks) out.push(restXml(measure.durationTicks - cursor, voiceNum))
  return out
}

function measureNotesXml(
  score: GrooveScore,
  measure: GrooveMeasure,
  instrumentIdOf: (pad: GrooveNote['pad']) => InstrumentId,
): string[] {
  const notes = notesInMeasure(score, measure.index)
  const byVoice = new Map<Voice, GrooveNote[]>()
  for (const n of notes) {
    const existing = byVoice.get(n.voice)
    if (existing === undefined) byVoice.set(n.voice, [n])
    else existing.push(n)
  }
  const VOICE_ORDER: readonly Voice[] = ['hands', 'feet']
  const out: string[] = []
  let wroteAny = false
  for (const voice of VOICE_ORDER) {
    const voiceNotes = byVoice.get(voice)
    if (voiceNotes === undefined || voiceNotes.length === 0) continue
    if (wroteAny) out.push(backupXml(measure.durationTicks))
    wroteAny = true
    const voiceNum = voice === 'hands' ? 1 : 2
    out.push(...voiceStreamXml(voiceNotes, measure, voiceNum, instrumentIdOf))
  }
  return out
}

function partListXml(score: GrooveScore): string {
  const pads = usedPads(score)
  const lines: string[] = ['<part-list>', '<score-part id="P1">', '<part-name>Drums</part-name>']
  pads.forEach((pad, i) => {
    lines.push(
      `<score-instrument id="${instrumentIdFor(i)}"><instrument-name>${escapeXml(padInstrumentName(pad))}</instrument-name></score-instrument>`,
    )
  })
  pads.forEach((pad, i) => {
    const gm = gmNoteOf(pad)
    if (gm === undefined) throw new Error(`unreachable: mapped pad ${pad} has no GM note`)
    lines.push(
      `<midi-instrument id="${instrumentIdFor(i)}">` +
        `<midi-channel>${MIDI_PERCUSSION_CHANNEL}</midi-channel>` +
        // MusicXML's midi-128 type is 1-based — see the module doc in `./shared.ts`.
        `<midi-unpitched>${gm + 1}</midi-unpitched>` +
        '</midi-instrument>',
    )
  })
  lines.push('</score-part>', '</part-list>')
  return lines.join('')
}

function swingSoundXml(swingPercent: number): string {
  if (swingPercent === 50) return '<sound><swing><straight/></swing></sound>'
  const second = 100 - swingPercent
  return (
    '<sound><swing>' +
    `<first>${swingPercent}</first><second>${second}</second>` +
    '<swing-type>eighth</swing-type>' +
    '</swing></sound>'
  )
}

/** Serialise a `GrooveScore` as score-partwise MusicXML 4.0 text. */
export function writeDrumMusicXml(score: GrooveScore): string {
  const pads = usedPads(score)
  const instrumentIndex = new Map(pads.map((pad, i) => [pad, instrumentIdFor(i)]))
  const instrumentIdOf = (pad: GrooveNote['pad']): InstrumentId => {
    const id = instrumentIndex.get(pad)
    if (id === undefined) throw new Error(`unreachable: note references undeclared pad ${pad}`)
    return id
  }

  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<score-partwise version="4.0">']
  if (score.title.length > 0) {
    lines.push(`<work><work-title>${escapeXml(score.title)}</work-title></work>`)
  }
  lines.push(partListXml(score))
  lines.push('<part id="P1">')

  score.measures.forEach((measure, i) => {
    lines.push(`<measure number="${i + 1}">`)
    if (i === 0) {
      lines.push(
        '<attributes>' +
          `<divisions>${TICKS_PER_QUARTER}</divisions>` +
          '<clef><sign>percussion</sign></clef>' +
          `<time><beats>${score.timeSignature.beats}</beats><beat-type>${score.timeSignature.beatType}</beat-type></time>` +
          '</attributes>',
      )
      lines.push(swingSoundXml(score.swingPercent))
    }
    lines.push(...measureNotesXml(score, measure, instrumentIdOf))
    lines.push('</measure>')
  })
  lines.push('</part>', '</score-partwise>')
  return lines.join('\n')
}
