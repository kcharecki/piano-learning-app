/**
 * MusicXML → `Score` (REQ-3.2.1, REQ-3.2.5).
 *
 * Two layers, both pure and dependency-free:
 *
 *  1. `parseXml` — a small recursive-descent XML reader. `src/core` has no DOM,
 *     so `DOMParser` is not available; this handles the subset a well-formed
 *     MusicXML file uses (elements, attributes, text, comments, CDATA,
 *     self-closing tags, the XML declaration, DOCTYPE, the five entities).
 *  2. `parseMusicXml` — walks that tree into the internal score model, turning
 *     `<divisions>`-relative durations into the app's 480-ticks-per-quarter grid.
 *
 * Neither throws on bad input: everything the user can get wrong comes back as a
 * descriptive `Err`, because "import an arbitrary file off the internet" is the
 * normal case, not the exceptional one.
 *
 * Not handled yet, deliberately: repeats, voltas, D.C./D.S. and codas are read
 * and ignored, so a file that uses them parses to its written-out form. Unrolling
 * the repeat structure into playback order is future work.
 */
import { err, ok, type Result } from '@core/shared/result.ts'
import { isValidMidi, TICKS_PER_QUARTER } from '@core/shared/units.ts'
import {
  makeScore,
  type Clef,
  type Hand,
  type MeasureInput,
  type Score,
  type ScoreNoteInput,
  type StaffInfo,
  type TimeSignature,
  type Tuplet,
} from './score.ts'

// ------------------------------------------------------------------- XML reader

export type XmlNode = {
  readonly tag: string
  readonly attrs: Readonly<Record<string, string>>
  readonly children: readonly XmlNode[]
  /** Concatenated direct text content, entity-decoded and trimmed. */
  readonly text: string
}

type OpenNode = { tag: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  apos: "'",
  quot: '"',
}

const ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g

function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw
  return raw.replace(ENTITY_RE, (whole, body: string) => {
    if (!body.startsWith('#')) return ENTITIES[body] ?? whole
    const hex = body[1] === 'x' || body[1] === 'X'
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : whole
  })
}

const isSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\n' || c === '\t' || c === '\r'

const isNameEnd = (c: string | undefined): boolean =>
  c === undefined || isSpace(c) || c === '/' || c === '>' || c === '='

/** Parse well-formed XML into a generic tree. Returns `Err` rather than throwing. */
export function parseXml(source: string): Result<XmlNode, string> {
  const n = source.length
  const stack: OpenNode[] = []
  let root: XmlNode | undefined
  let i = 0
  const fail = (message: string): Result<XmlNode, string> => err(`${message} (offset ${i})`)

  /** Attach a finished element to its parent, or adopt it as the root. */
  const close = (node: OpenNode): string | undefined => {
    const finished: XmlNode = {
      tag: node.tag,
      attrs: node.attrs,
      children: node.children,
      text: node.text.trim(),
    }
    const parent = stack[stack.length - 1]
    if (parent !== undefined) {
      parent.children.push(finished)
      return undefined
    }
    if (root !== undefined) return `unexpected second root element <${node.tag}>`
    root = finished
    return undefined
  }

  while (i < n) {
    const lt = source.indexOf('<', i)
    if (lt < 0) break // trailing text after the root element — ignored
    if (lt > i) {
      const top = stack[stack.length - 1]
      if (top !== undefined) top.text += decodeEntities(source.slice(i, lt))
    }
    i = lt

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      if (end < 0) return fail('unterminated comment')
      i = end + 3
    } else if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i + 9)
      if (end < 0) return fail('unterminated CDATA section')
      const top = stack[stack.length - 1]
      if (top !== undefined) top.text += source.slice(i + 9, end)
      i = end + 3
    } else if (source.startsWith('<?', i)) {
      const end = source.indexOf('?>', i + 2)
      if (end < 0) return fail('unterminated processing instruction')
      i = end + 2
    } else if (source.startsWith('<!', i)) {
      // DOCTYPE (or any other declaration): skipped, internal subset and all.
      let depth = 0
      let j = i + 2
      for (; j < n; j++) {
        const c = source[j]
        if (c === '[') depth++
        else if (c === ']') depth--
        else if (c === '>' && depth <= 0) break
      }
      if (j >= n) return fail('unterminated <! declaration')
      i = j + 1
    } else if (source.startsWith('</', i)) {
      const end = source.indexOf('>', i)
      if (end < 0) return fail('unterminated closing tag')
      const name = source.slice(i + 2, end).trim()
      const top = stack.pop()
      if (top === undefined) return fail(`unexpected closing tag </${name}>`)
      if (top.tag !== name) return fail(`closing tag </${name}> does not match <${top.tag}>`)
      i = end + 1
      const problem = close(top)
      if (problem !== undefined) return fail(problem)
    } else {
      i++
      const nameStart = i
      while (i < n && !isNameEnd(source[i])) i++
      const tag = source.slice(nameStart, i)
      if (tag.length === 0) return fail('element has an empty tag name')
      const attrs: Record<string, string> = {}
      let selfClosing = false
      for (;;) {
        while (isSpace(source[i])) i++
        const c = source[i]
        if (c === undefined) return fail(`unterminated <${tag}> tag`)
        if (c === '>') {
          i++
          break
        }
        if (c === '/') {
          if (source[i + 1] !== '>') return fail(`malformed self-closing <${tag}> tag`)
          i += 2
          selfClosing = true
          break
        }
        const attrStart = i
        while (i < n && !isNameEnd(source[i])) i++
        const attrName = source.slice(attrStart, i)
        if (attrName.length === 0) return fail(`malformed attribute in <${tag}>`)
        while (isSpace(source[i])) i++
        if (source[i] !== '=') return fail(`attribute ${attrName} of <${tag}> has no value`)
        i++
        while (isSpace(source[i])) i++
        const quote = source[i]
        if (quote !== '"' && quote !== "'") {
          return fail(`attribute ${attrName} of <${tag}> must have a quoted value`)
        }
        const end = source.indexOf(quote, i + 1)
        if (end < 0) return fail(`unterminated value for attribute ${attrName} of <${tag}>`)
        attrs[attrName] = decodeEntities(source.slice(i + 1, end))
        i = end + 1
      }
      const node: OpenNode = { tag, attrs, children: [], text: '' }
      if (selfClosing) {
        const problem = close(node)
        if (problem !== undefined) return fail(problem)
      } else {
        stack.push(node)
      }
    }
  }

  const unclosed = stack[stack.length - 1]
  if (unclosed !== undefined) return err(`unclosed element <${unclosed.tag}>`)
  if (root === undefined) return err('no root element')
  return ok(root)
}

// ------------------------------------------------------------------ tree helpers

const childOf = (node: XmlNode, tag: string): XmlNode | undefined =>
  node.children.find((c) => c.tag === tag)

const childrenOf = (node: XmlNode, tag: string): readonly XmlNode[] =>
  node.children.filter((c) => c.tag === tag)

const has = (node: XmlNode, tag: string): boolean => node.children.some((c) => c.tag === tag)

function nodeAt(node: XmlNode, path: readonly string[]): XmlNode | undefined {
  let cur: XmlNode | undefined = node
  for (const tag of path) {
    if (cur === undefined) return undefined
    cur = childOf(cur, tag)
  }
  return cur
}

/** First descendant with this tag, depth-first. Used for `<sound>`/`<metronome>`. */
function findDeep(node: XmlNode, tag: string): XmlNode | undefined {
  for (const c of node.children) {
    if (c.tag === tag) return c
    const found = findDeep(c, tag)
    if (found !== undefined) return found
  }
  return undefined
}

/** Numeric text of a child element; `undefined` when absent, empty or not a number. */
function numberOf(node: XmlNode, tag: string): number | undefined {
  const c = childOf(node, tag)
  if (c === undefined || c.text.length === 0) return undefined
  const value = Number(c.text)
  return Number.isFinite(value) ? value : undefined
}

// ------------------------------------------------------------------ music tables

const STEP_SEMITONE: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

/** `<type>` / `<beat-unit>` expressed in quarter notes. */
const TYPE_QUARTERS: Readonly<Record<string, number>> = {
  maxima: 32,
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
  '128th': 0.03125,
}

/** One dot adds a half, two dots three quarters, … */
const dotFactor = (dots: number): number => 2 - Math.pow(2, -dots)

// ---------------------------------------------------------------- part scanning

type PendingNote = {
  readonly measureIndex: number
  readonly offset: number
  readonly durationTicks: number
  readonly midi: number
  readonly hand: Hand
  readonly voice: number
  readonly staff: number
  readonly tiedFrom: boolean
  readonly tiedTo: boolean
  readonly fingering?: number
  readonly tuplet?: Tuplet
}

type PendingTempo = { readonly measureIndex: number; readonly offset: number; readonly bpm: number }

type Scan = {
  readonly notes: PendingNote[]
  readonly tempos: PendingTempo[]
  readonly staves: StaffInfo[]
  readonly timeSigs: (TimeSignature | undefined)[]
  readonly keys: (number | undefined)[]
  readonly numbers: (string | undefined)[]
  readonly implicit: boolean[]
  /** Longest content, in ticks, any part writes into each measure. */
  readonly content: number[]
  measureCount: number
  staffOffset: number
}

/** `<staves>`, or the largest `<staff>` a note names — a part has at least one. */
function staffCountOf(part: XmlNode): number {
  let count = 1
  const walk = (node: XmlNode): void => {
    if (node.tag === 'staves' || node.tag === 'staff') {
      const value = Number(node.text)
      if (Number.isInteger(value) && value > count) count = value
    }
    for (const c of node.children) walk(c)
  }
  walk(part)
  return count
}

function clefOf(node: XmlNode): Clef {
  const sign = (childOf(node, 'sign')?.text ?? 'G').toUpperCase()
  if (sign === 'F') return 'bass'
  if (sign === 'C') return numberOf(node, 'line') === 4 ? 'tenor' : 'alto'
  return 'treble'
}

/** Quarter-note BPM from a `<sound tempo>` or a `<metronome>`, if either is present. */
function tempoOf(node: XmlNode): number | undefined {
  const sound = node.tag === 'sound' ? node : findDeep(node, 'sound')
  const attr = sound?.attrs['tempo']
  if (attr !== undefined) {
    const value = Number(attr)
    if (Number.isFinite(value) && value > 0) return value
  }
  const metronome = findDeep(node, 'metronome')
  if (metronome === undefined) return undefined
  const unit = TYPE_QUARTERS[childOf(metronome, 'beat-unit')?.text ?? '']
  const perMinute = numberOf(metronome, 'per-minute')
  if (unit === undefined || perMinute === undefined || perMinute <= 0) return undefined
  const dots = childrenOf(metronome, 'beat-unit-dot').length
  return perMinute * unit * dotFactor(dots)
}

/**
 * Total beats in a `<time>`, allowing the composite form MusicXML uses for
 * additive metres: `<beats>3+2</beats><beat-type>8</beat-type>` is 3+2/8, five
 * eighth-note beats to the bar. `undefined` when any term is not a whole
 * positive number.
 */
function beatsOf(time: XmlNode): number | undefined {
  const el = childOf(time, 'beats')
  if (el === undefined || el.text.length === 0) return undefined
  let total = 0
  for (const term of el.text.split('+')) {
    const value = Number(term.trim())
    if (!Number.isInteger(value) || value <= 0) return undefined
    total += value
  }
  return total
}

/**
 * `<duration>` in ticks, falling back to `<type>` + `<dot>` when it is missing.
 *
 * The fallback path applies `tuplet`'s ratio, because `<type>` is the WRITTEN
 * value: the three notes of an eighth triplet are each `<type>eighth</type>`,
 * and each sounds for two thirds of one. Without the ratio the fallback would
 * make a triplet group last half again as long as its beat and push every
 * later onset in the bar off the grid.
 */
function durationTicks(el: XmlNode, divisions: number, tuplet?: Tuplet): Result<number, string> {
  const duration = numberOf(el, 'duration')
  if (duration !== undefined) {
    if (duration < 0) return err(`<duration> must not be negative, got ${duration}`)
    if (divisions <= 0) return err('no <divisions> was declared before the first timed element')
    return ok(Math.round((duration * TICKS_PER_QUARTER) / divisions))
  }
  if (has(el, 'duration')) return err('<duration> is empty or not a number')
  const type = TYPE_QUARTERS[childOf(el, 'type')?.text ?? '']
  if (type === undefined) return err(`<${el.tag}> has no <duration>`)
  const dots = childrenOf(el, 'dot').length
  const ratio = tuplet === undefined ? 1 : tuplet.normal / tuplet.actual
  return ok(Math.round(type * dotFactor(dots) * ratio * TICKS_PER_QUARTER))
}

/**
 * Name a pitch the way a musician reads it — `C#10`, `Bb-1`, `C4` — so an error
 * message about it is recognisable. An absurd `<alter>` is reported as a number
 * rather than as a row of sharps.
 */
function spellPitch(step: string, alter: number, octave: number): string {
  const magnitude = Math.abs(alter)
  const accidental = magnitude > 3 ? `(alter ${alter})` : (alter > 0 ? '#' : 'b').repeat(magnitude)
  return `${step}${accidental}${octave}`
}

function midiOf(pitch: XmlNode): Result<number, string> {
  const step = childOf(pitch, 'step')?.text.toUpperCase() ?? ''
  const semitone = STEP_SEMITONE[step]
  if (semitone === undefined) return err(`<pitch> has an unknown <step> "${step}"`)
  const octave = numberOf(pitch, 'octave')
  if (octave === undefined || !Number.isInteger(octave)) {
    return err('<pitch> has a missing or non-integer <octave>')
  }
  const alter = Math.round(numberOf(pitch, 'alter') ?? 0)
  const midi = (octave + 1) * 12 + semitone + alter
  if (!isValidMidi(midi)) {
    return err(`pitch ${spellPitch(step, alter, octave)} is outside the MIDI range`)
  }
  return ok(midi)
}

function tieFlags(note: XmlNode): { tiedFrom: boolean; tiedTo: boolean } {
  const notations = childOf(note, 'notations')
  const marks = [
    ...childrenOf(note, 'tie'),
    ...(notations === undefined ? [] : childrenOf(notations, 'tied')),
  ]
  return {
    tiedFrom: marks.some((m) => m.attrs['type'] === 'stop'),
    tiedTo: marks.some((m) => m.attrs['type'] === 'start'),
  }
}

/**
 * `<time-modification>` -> `Tuplet`, so a triplet survives the round trip as a
 * triplet and not merely as three odd durations. `<duration>` already carries
 * the sounding length, so nothing about PLAYBACK depends on this; what depends
 * on it is the ENGRAVING, because a note's tick count cannot say what it is
 * written as (roadmap T.8: 160 ticks is a triplet eighth, but read as a raw
 * duration it is a 16th).
 *
 * The bracket edge comes from `<notations><tuplet type="...">`. A file that
 * declares the ratio without ever bracketing it is common and legal, so a note
 * with no tuplet element of its own reads as `inner` rather than being
 * rejected; the writer's own output always brackets both edges.
 */
function tupletOf(note: XmlNode): Tuplet | undefined {
  const tm = childOf(note, 'time-modification')
  if (tm === undefined) return undefined
  const actual = numberOf(tm, 'actual-notes')
  const normal = numberOf(tm, 'normal-notes')
  if (actual === undefined || normal === undefined) return undefined
  if (!Number.isInteger(actual) || !Number.isInteger(normal) || actual < 1 || normal < 1) {
    return undefined
  }
  const bracket = nodeAt(note, ['notations', 'tuplet'])?.attrs['type']
  const position: Tuplet['position'] =
    bracket === 'start' ? 'start' : bracket === 'stop' ? 'stop' : 'inner'
  return { actual, normal, position }
}

/** Piano fingering is 1..5; there is no finger 0 and no sixth finger. */
const MIN_FINGER = 1
const MAX_FINGER = 5

function fingeringOf(note: XmlNode): number | undefined {
  const el = nodeAt(note, ['notations', 'technical', 'fingering'])
  if (el === undefined) return undefined
  const value = Number(el.text)
  // The 1..5 range check is what keeps an empty <fingering/> from becoming
  // finger 0 — Number('') is 0, and a "0" printed over the note is worse than no
  // fingering at all. It also drops substitutions ("1-2") and alternatives
  // ("1 or 2"), which are NaN here and are left to the renderer.
  return Number.isInteger(value) && value >= MIN_FINGER && value <= MAX_FINGER ? value : undefined
}

/**
 * Walk one `<part>`, filling `scan`. Returns an error message, or `undefined` on
 * success. Everything here is measure-relative; absolute ticks need every part's
 * measure lengths, which only the caller knows.
 */
function scanPart(part: XmlNode, partIndex: number, scan: Scan): string | undefined {
  const partId = part.attrs['id'] ?? `#${partIndex + 1}`
  const measures = childrenOf(part, 'measure')
  if (measures.length === 0) return `part ${partId} has no <measure> elements`
  const staffCount = staffCountOf(part)
  const clefs = new Map<number, Clef>()
  const firstClefs = new Map<number, Clef>()
  let divisions = 0

  const handFor = (staff: number): Hand => {
    if (staffCount > 1) return staff === 1 ? 'right' : 'left'
    return clefs.get(staff) === 'bass' ? 'left' : 'right'
  }

  for (const [m, measure] of measures.entries()) {
    const where = `part ${partId} measure ${measure.attrs['number'] ?? m + 1}`
    if (scan.numbers[m] === undefined) scan.numbers[m] = measure.attrs['number']
    if (measure.attrs['implicit'] === 'yes') scan.implicit[m] = true
    let cursor = 0
    let lastStart = 0
    let content = scan.content[m] ?? 0

    for (const el of measure.children) {
      if (el.tag === 'attributes') {
        const declaredDivisions = numberOf(el, 'divisions')
        if (declaredDivisions !== undefined) {
          if (declaredDivisions <= 0) {
            return `${where}: <divisions> must be positive, got ${declaredDivisions}`
          }
          divisions = declaredDivisions
        }
        const fifths = nodeAt(el, ['key', 'fifths'])
        if (fifths !== undefined) {
          const value = Number(fifths.text)
          if (!Number.isInteger(value) || Math.abs(value) > 7) {
            return `${where}: <fifths> "${fifths.text}" is outside -7..7`
          }
          if (scan.keys[m] === undefined) scan.keys[m] = value
        }
        const time = childOf(el, 'time')
        if (time !== undefined && has(time, 'beats')) {
          const beats = beatsOf(time)
          const beatType = numberOf(time, 'beat-type')
          if (
            beats === undefined ||
            beatType === undefined ||
            !Number.isInteger(beatType) ||
            beatType <= 0
          ) {
            return `${where}: <time> must have whole positive <beats> and <beat-type>`
          }
          if (scan.timeSigs[m] === undefined) scan.timeSigs[m] = { beats, beatType }
        }
        for (const clefEl of childrenOf(el, 'clef')) {
          const staff = Number(clefEl.attrs['number'] ?? '1')
          const staffNumber = Number.isInteger(staff) && staff > 0 ? staff : 1
          const clef = clefOf(clefEl)
          clefs.set(staffNumber, clef)
          if (!firstClefs.has(staffNumber)) firstClefs.set(staffNumber, clef)
        }
      } else if (el.tag === 'note') {
        // Grace notes are skipped, and crucially do not advance the cursor.
        if (has(el, 'grace')) continue
        const rest = has(el, 'rest')
        const pitch = childOf(el, 'pitch')
        if (pitch === undefined && !rest) {
          return `${where}: <note> has neither <pitch> nor <rest> (<unpitched> is not supported)`
        }
        const tuplet = tupletOf(el)
        const ticks = durationTicks(el, divisions, tuplet)
        if (!ticks.ok) return `${where}: ${ticks.error}`
        // A <chord/> note sounds with the previous note: same onset, no advance.
        const chord = has(el, 'chord')
        const offset = chord ? lastStart : cursor
        if (!chord) {
          lastStart = cursor
          cursor += ticks.value
        }
        content = Math.max(content, cursor, offset + ticks.value)
        if (pitch === undefined) continue
        const midi = midiOf(pitch)
        if (!midi.ok) return `${where}: ${midi.error}`
        const voice = numberOf(el, 'voice')
        const staff = numberOf(el, 'staff')
        const localStaff = staff !== undefined && Number.isInteger(staff) && staff > 0 ? staff : 1
        const fingering = fingeringOf(el)
        scan.notes.push({
          measureIndex: m,
          offset,
          durationTicks: ticks.value,
          midi: midi.value,
          hand: handFor(localStaff),
          voice: voice !== undefined && Number.isInteger(voice) && voice > 0 ? voice : 1,
          staff: scan.staffOffset + localStaff,
          ...tieFlags(el),
          ...(fingering === undefined ? {} : { fingering }),
          ...(tuplet === undefined ? {} : { tuplet }),
        })
      } else if (el.tag === 'backup' || el.tag === 'forward') {
        const ticks = durationTicks(el, divisions)
        if (!ticks.ok) return `${where}: ${ticks.error}`
        cursor += el.tag === 'backup' ? -ticks.value : ticks.value
        if (cursor < 0) return `${where}: <backup> moves before the start of the measure`
        lastStart = cursor
        content = Math.max(content, cursor)
      } else if (el.tag === 'direction' || el.tag === 'sound') {
        const bpm = tempoOf(el)
        if (bpm !== undefined) scan.tempos.push({ measureIndex: m, offset: cursor, bpm })
      }
      // <barline> (repeats, voltas), <harmony>, <print> … are ignored on purpose.
    }
    scan.content[m] = content
  }

  for (let staff = 1; staff <= staffCount; staff++) {
    const clef = firstClefs.get(staff) ?? (staff === 1 ? 'treble' : 'bass')
    const hand: Hand =
      staffCount > 1 ? (staff === 1 ? 'right' : 'left') : clef === 'bass' ? 'left' : 'right'
    scan.staves.push({ staff: scan.staffOffset + staff, clef, hand })
  }
  scan.staffOffset += staffCount
  scan.measureCount = Math.max(scan.measureCount, measures.length)
  return undefined
}

// -------------------------------------------------------------------- the parser

function slug(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return cleaned.length > 0 ? cleaned : 'musicxml-score'
}

/** Parse a MusicXML document (score-partwise) into the internal score model. */
export function parseMusicXml(source: string, opts?: { id?: string }): Result<Score, string> {
  const parsed = parseXml(source)
  if (!parsed.ok) return err(`malformed MusicXML: ${parsed.error}`)
  const root = parsed.value
  if (root.tag === 'score-timewise') {
    return err('score-timewise is not supported — convert the file to score-partwise')
  }
  if (root.tag !== 'score-partwise') {
    return err(`expected a <score-partwise> root element, found <${root.tag}>`)
  }

  const parts = childrenOf(root, 'part')
  if (parts.length === 0) return err('score has no <part> elements')

  const scan: Scan = {
    notes: [],
    tempos: [],
    staves: [],
    timeSigs: [],
    keys: [],
    numbers: [],
    implicit: [],
    content: [],
    measureCount: 0,
    staffOffset: 0,
  }
  for (const [p, part] of parts.entries()) {
    const problem = scanPart(part, p, scan)
    if (problem !== undefined) return err(problem)
  }

  // Measure lengths: the metre, except for a pickup (a short opening or
  // `implicit` measure) or an over-full measure, where the content decides.
  const measures: MeasureInput[] = []
  const starts: number[] = []
  const durations: number[] = []
  let ts: TimeSignature = { beats: 4, beatType: 4 }
  let tick = 0
  for (let m = 0; m < scan.measureCount; m++) {
    const declared = scan.timeSigs[m]
    if (declared !== undefined) ts = declared
    const metre = (ts.beats * TICKS_PER_QUARTER * 4) / ts.beatType
    if (!Number.isInteger(metre)) {
      return err(`measure ${m + 1}: time signature ${ts.beats}/${ts.beatType} is not tick-exact`)
    }
    const content = scan.content[m] ?? 0
    const pickup = (m === 0 || scan.implicit[m] === true) && content > 0 && content < metre
    const duration = content > metre || pickup ? content : metre
    const key = scan.keys[m]
    const number = scan.numbers[m]
    measures.push({
      ...(declared === undefined ? {} : { timeSignature: declared }),
      ...(key === undefined ? {} : { keyFifths: key }),
      durationTicks: duration,
      ...(number === undefined ? {} : { number }),
    })
    starts.push(tick)
    durations.push(duration)
    tick += duration
  }

  const notes: ScoreNoteInput[] = []
  for (const p of scan.notes) {
    const start = starts[p.measureIndex] ?? 0
    const barTicks = durations[p.measureIndex] ?? 0
    if (p.offset >= barTicks) continue // beyond the barline: unwritable, dropped
    notes.push({
      midi: p.midi,
      startTick: start + p.offset,
      // Rounding a tuplet can overshoot by a tick; a note may not cross a barline.
      durationTicks: Math.min(p.durationTicks, barTicks - p.offset),
      hand: p.hand,
      voice: p.voice,
      staff: p.staff,
      tiedFrom: p.tiedFrom,
      tiedTo: p.tiedTo,
      ...(p.fingering === undefined ? {} : { fingering: p.fingering }),
      ...(p.tuplet === undefined ? {} : { tuplet: p.tuplet }),
    })
  }

  const seen = new Set<number>()
  const tempos: { tick: number; bpm: number }[] = []
  const marks = scan.tempos
    .map((t) => ({ tick: (starts[t.measureIndex] ?? 0) + t.offset, bpm: t.bpm }))
    .sort((a, b) => a.tick - b.tick)
  for (const mark of marks) {
    if (seen.has(mark.tick)) continue
    seen.add(mark.tick)
    tempos.push(mark)
  }
  // A file that says nothing about tempo plays at 120 (REQ-3.9.1 default).
  if (tempos[0]?.tick !== 0) tempos.unshift({ tick: 0, bpm: 120 })

  const title = nodeAt(root, ['work', 'work-title'])?.text ?? childOf(root, 'movement-title')?.text
  const identification = childOf(root, 'identification')
  const creators = identification === undefined ? [] : childrenOf(identification, 'creator')
  const composer = creators.find((c) => c.attrs['type'] === 'composer') ?? creators[0]

  try {
    return ok(
      makeScore({
        id: opts?.id ?? slug(title ?? ''),
        meta: { title: title ?? '', composer: composer?.text ?? '' },
        measures,
        notes,
        tempos,
        staves: scan.staves,
      }),
    )
  } catch (cause) {
    return err(`could not build a score: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
