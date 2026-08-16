/**
 * MusicXML -> `GrooveScore` (DR-04) — the inverse of `./write.ts`, and this
 * module's whole reason for existing: DR-04's gate is a bundled reference
 * groove parsing to an exact `GrooveScore` and back, byte-stable.
 *
 * Reuses `parseXml` from `core/notation/musicxml.ts` for the generic XML tree
 * (that dir's public surface, per this task's contract — not modified). Its
 * own `parseMusicXml` is NOT reused for the music-level walk: it explicitly
 * rejects `<unpitched>` notes ("`<unpitched>` is not supported"), which is
 * exactly what every drum note is. `childOf`/`childrenOf`/`numberOf`/
 * `findDeep` below are small local re-implementations of that file's private
 * tree helpers — duplicated, not imported, because they are not exported and
 * this task does not modify `core/notation`.
 *
 * Pad identity comes from `<instrument>` -> the matching `<score-instrument>`
 * -> `<instrument-name>`, NOT from display position (`./instrument.ts`'s
 * contract) and NOT primarily from `<midi-unpitched>` (research §5: "playback
 * instrument... never from display position" — the same discipline applied
 * one level deeper, since two pads can share a GM note).
 *
 * Deliberately not handled, mirroring `core/notation/musicxml.ts`'s own
 * documented gaps: grace notes (so a foreign file's grace-note flam is
 * dropped, not reconstructed — this bridge's own flam/drag never uses grace
 * notes, see `./shared.ts`), the `<type>`+dot duration fallback (every note
 * this bridge writes carries an explicit `<duration>`), and meter changes
 * (first `<time>` wins, later ones are ignored — `GrooveScore` has exactly
 * one time signature).
 */
import { err, ok, type Result } from '@core/shared/result.ts'
import { parseXml, type XmlNode } from '@core/notation/musicxml.ts'
import { measureDurationTicks, type TimeSignature } from '@core/notation/score.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import { isArticulation, isSticking, type Articulation, type Sticking } from '../articulation.ts'
import {
  makeGrooveScore,
  type DynamicsClass,
  type GrooveScore,
  type GrooveScoreInput,
  type SwingUnit,
} from '../groove.ts'
import type { MappedDrumPad } from '../pad.ts'
import { padByGmNote, padByInstrumentName } from './instrument.ts'
import { CHOKE_ARTICULATION, swingUnitOfXml } from './shared.ts'

// ------------------------------------------------------------------ tree helpers

const childOf = (node: XmlNode, tag: string): XmlNode | undefined =>
  node.children.find((c) => c.tag === tag)

const childrenOf = (node: XmlNode, tag: string): readonly XmlNode[] =>
  node.children.filter((c) => c.tag === tag)

const has = (node: XmlNode, tag: string): boolean => node.children.some((c) => c.tag === tag)

function findDeep(node: XmlNode, tag: string): XmlNode | undefined {
  for (const c of node.children) {
    if (c.tag === tag) return c
    const found = findDeep(c, tag)
    if (found !== undefined) return found
  }
  return undefined
}

function numberOf(node: XmlNode, tag: string): number | undefined {
  const c = childOf(node, tag)
  if (c === undefined || c.text.length === 0) return undefined
  const value = Number(c.text)
  return Number.isFinite(value) ? value : undefined
}

function slug(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return cleaned.length > 0 ? cleaned : 'drum-groove'
}

// -------------------------------------------------------------- instrument map

/** `<instrument id>` -> pad, built from `<score-part>`'s declared instruments. */
function instrumentMap(scorePart: XmlNode): ReadonlyMap<string, MappedDrumPad> {
  const map = new Map<string, MappedDrumPad>()
  const midiById = new Map<string, XmlNode>()
  for (const m of childrenOf(scorePart, 'midi-instrument')) {
    const id = m.attrs['id']
    if (id !== undefined) midiById.set(id, m)
  }
  for (const el of childrenOf(scorePart, 'score-instrument')) {
    const id = el.attrs['id']
    if (id === undefined) continue
    const name = childOf(el, 'instrument-name')?.text
    const byName = name === undefined ? undefined : padByInstrumentName(name)
    if (byName !== undefined) {
      map.set(id, byName)
      continue
    }
    // Foreign file, no name match: fall back to <midi-unpitched> (1-based — see `./shared.ts`).
    const midi = midiById.get(id)
    const unpitched = midi === undefined ? undefined : numberOf(midi, 'midi-unpitched')
    const byGm = unpitched === undefined ? undefined : padByGmNote(unpitched - 1)
    if (byGm !== undefined) map.set(id, byGm)
  }
  return map
}

// ------------------------------------------------------------------- swing

/** `<sound><swing>`: `<straight/>` is 50; a `<first>/<second>` ratio is `round(first/(first+second)*100)`. */
function swingPercentOf(node: XmlNode): number | undefined {
  const swing = findDeep(node, 'swing')
  if (swing === undefined) return undefined
  if (has(swing, 'straight')) return 50
  const first = numberOf(swing, 'first')
  const second = numberOf(swing, 'second')
  if (first === undefined || second === undefined || first + second <= 0) return undefined
  return Math.round((first / (first + second)) * 100)
}

/** `<sound><swing><swing-type>`: absent (incl. `<straight/>`) means the writer's default, `'eighth'`. */
function swingUnitOf(node: XmlNode): SwingUnit | undefined {
  const swing = findDeep(node, 'swing')
  if (swing === undefined) return undefined
  const swingType = childOf(swing, 'swing-type')?.text
  return swingType === undefined ? undefined : swingUnitOfXml(swingType)
}

// --------------------------------------------------------------- note content

type NoteMarks = {
  readonly dynamics: DynamicsClass
  readonly articulations: readonly Articulation[]
  readonly sticking?: Sticking
}

function marksOf(note: XmlNode): NoteMarks {
  const notations = childOf(note, 'notations')
  const articulationsEl = notations === undefined ? undefined : childOf(notations, 'articulations')
  const ornaments = notations === undefined ? undefined : childOf(notations, 'ornaments')
  const technical = notations === undefined ? undefined : childOf(notations, 'technical')
  const notehead = childOf(note, 'notehead')

  const accented = articulationsEl !== undefined && has(articulationsEl, 'accent')
  const ghosted = notehead?.attrs['parentheses'] === 'yes'
  const dynamics: DynamicsClass = accented ? 'accent' : ghosted ? 'ghost' : 'normal'

  const articulations: Articulation[] = []
  if (ornaments !== undefined) {
    for (const o of childrenOf(ornaments, 'other-ornament')) {
      if (isArticulation(o.text)) articulations.push(o.text)
    }
    if (has(ornaments, 'tremolo')) articulations.push('buzz')
  }
  let sticking: Sticking | undefined
  if (technical !== undefined) {
    if (has(technical, 'open')) articulations.push('open')
    // `<technical>` can carry two `<other-technical>` children at once (choke
    // + sticking) — disambiguated by TEXT, not position; see `./shared.ts`.
    for (const other of childrenOf(technical, 'other-technical')) {
      if (other.text === CHOKE_ARTICULATION) articulations.push('choke')
      else if (isSticking(other.text)) sticking = other.text
    }
  }

  return { dynamics, articulations, ...(sticking === undefined ? {} : { sticking }) }
}

// -------------------------------------------------------------------- scanning

type PendingNote = {
  readonly measureIndex: number
  readonly offset: number
  readonly durationTicks: number
  readonly pad: MappedDrumPad
} & NoteMarks

type Scan = {
  readonly notes: PendingNote[]
  divisions: number
  timeSignature: TimeSignature | undefined
  swingPercent: number | undefined
  swingUnit: SwingUnit | undefined
}

/** `<duration>` scaled from `divisions` to `TICKS_PER_QUARTER` ticks. `Err` if absent or divisions is unset. */
function durationTicksOf(el: XmlNode, divisions: number, where: string): Result<number, string> {
  const duration = numberOf(el, 'duration')
  if (duration === undefined) return err(`${where}: <${el.tag}> has no <duration>`)
  if (duration < 0) return err(`${where}: <duration> must not be negative, got ${duration}`)
  if (divisions <= 0) return err(`${where}: no <divisions> was declared before the first timed element`)
  return ok(Math.round((duration * TICKS_PER_QUARTER) / divisions))
}

function scanMeasure(
  measure: XmlNode,
  measureIndex: number,
  instruments: ReadonlyMap<string, MappedDrumPad>,
  scan: Scan,
): string | undefined {
  const where = `measure ${measureIndex + 1}`
  let cursor = 0
  let lastStart = 0

  for (const el of measure.children) {
    if (el.tag === 'attributes') {
      const declaredDivisions = numberOf(el, 'divisions')
      if (declaredDivisions !== undefined) {
        if (declaredDivisions <= 0) return `${where}: <divisions> must be positive`
        scan.divisions = declaredDivisions
      }
      const time = childOf(el, 'time')
      if (time !== undefined && scan.timeSignature === undefined) {
        const beats = numberOf(time, 'beats')
        const beatType = numberOf(time, 'beat-type')
        if (beats !== undefined && beatType !== undefined && Number.isInteger(beats) && Number.isInteger(beatType)) {
          scan.timeSignature = { beats, beatType }
        }
      }
    } else if (el.tag === 'sound') {
      if (scan.swingPercent === undefined) scan.swingPercent = swingPercentOf(el)
      if (scan.swingUnit === undefined) scan.swingUnit = swingUnitOf(el)
    } else if (el.tag === 'note') {
      if (has(el, 'grace')) continue // dropped — see the module doc
      const rest = has(el, 'rest')
      const chord = has(el, 'chord')
      const ticksResult = durationTicksOf(el, scan.divisions, where)
      if (!ticksResult.ok) return ticksResult.error
      const offset = chord ? lastStart : cursor
      if (!chord) {
        lastStart = cursor
        cursor += ticksResult.value
      }
      if (rest) continue
      if (!has(el, 'unpitched')) return `${where}: <note> has neither <unpitched> nor <rest>`
      const instrumentId = childOf(el, 'instrument')?.attrs['id']
      const pad = instrumentId === undefined ? undefined : instruments.get(instrumentId)
      if (pad === undefined) {
        return `${where}: note references an unrecognised instrument "${instrumentId ?? ''}"`
      }
      scan.notes.push({
        measureIndex,
        offset,
        durationTicks: ticksResult.value,
        pad,
        ...marksOf(el),
      })
    } else if (el.tag === 'backup' || el.tag === 'forward') {
      const ticksResult = durationTicksOf(el, scan.divisions, where)
      if (!ticksResult.ok) return ticksResult.error
      cursor += el.tag === 'backup' ? -ticksResult.value : ticksResult.value
      if (cursor < 0) return `${where}: <backup> moves before the start of the measure`
      lastStart = cursor
    }
    // <direction> (other than a bare <sound>), <barline>, <print>… ignored.
  }
  return undefined
}

// -------------------------------------------------------------------- the parser

/** Parse a drum-part MusicXML document into a `GrooveScore`. */
export function parseDrumMusicXml(source: string, opts?: { readonly id?: string }): Result<GrooveScore, string> {
  const parsed = parseXml(source)
  if (!parsed.ok) return err(`malformed MusicXML: ${parsed.error}`)
  const root = parsed.value
  if (root.tag !== 'score-partwise') {
    return err(`expected a <score-partwise> root element, found <${root.tag}>`)
  }

  const partList = childOf(root, 'part-list')
  const scorePart = partList === undefined ? undefined : childOf(partList, 'score-part')
  if (scorePart === undefined) return err('score has no <score-part> in <part-list>')
  const instruments = instrumentMap(scorePart)

  const part = childOf(root, 'part')
  if (part === undefined) return err('score has no <part> elements')
  const measures = childrenOf(part, 'measure')
  if (measures.length === 0) return err('part has no <measure> elements')

  const scan: Scan = {
    notes: [],
    divisions: 0,
    timeSignature: undefined,
    swingPercent: undefined,
    swingUnit: undefined,
  }
  for (const [m, measure] of measures.entries()) {
    const problem = scanMeasure(measure, m, instruments, scan)
    if (problem !== undefined) return err(problem)
  }

  const timeSignature = scan.timeSignature ?? { beats: 4, beatType: 4 }
  let barTicks: number
  try {
    barTicks = measureDurationTicks(timeSignature)
  } catch (cause) {
    return err(`bad time signature: ${cause instanceof Error ? cause.message : String(cause)}`)
  }

  const notes: GrooveScoreInput['notes'] = scan.notes.map((p) => ({
    pad: p.pad,
    tick: p.measureIndex * barTicks + p.offset,
    durationTicks: p.durationTicks,
    dynamics: p.dynamics,
    articulations: p.articulations,
    ...(p.sticking === undefined ? {} : { sticking: p.sticking }),
  }))

  const work = childOf(root, 'work')
  const workTitle = work === undefined ? undefined : childOf(work, 'work-title')?.text
  const movementTitle = childOf(root, 'movement-title')?.text
  const resolvedTitle = workTitle ?? movementTitle ?? ''

  try {
    return ok(
      makeGrooveScore({
        id: opts?.id ?? slug(resolvedTitle),
        title: resolvedTitle,
        timeSignature,
        swingPercent: scan.swingPercent ?? 50,
        swingUnit: scan.swingUnit ?? 'eighth',
        measureCount: measures.length,
        notes,
      }),
    )
  } catch (cause) {
    return err(`could not build a groove: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
