/**
 * The internal score model — the contract shared by the parsers (MusicXML, SMF),
 * the transport, the note matcher and the renderer.
 *
 * Shape rules that everything downstream relies on:
 *  - `notes` is ALWAYS sorted by `startTick`, then by `midi`. Range queries are
 *    binary searches over that ordering, which is what keeps the playback loop
 *    inside its latency budget (REQ-4.1).
 *  - `measures` are contiguous from tick 0, so the measure containing a tick is
 *    also a binary search.
 *  - a note never extends past the end of its own measure; a sustain that
 *    crosses a barline is two notes joined by `tiedTo`/`tiedFrom`. Parsers must
 *    split at the barline — that is how notation represents it anyway.
 *
 * `makeScore` throws (programmer error) — it is fed already-parsed data.
 * `validateScore` returns a `Result` and is the check a parser runs on the
 * structure it built before handing it on.
 */
import { at, invariant } from '@core/shared/invariant.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import {
  bpm as asBpm,
  isValidMidi,
  midi as asMidi,
  ticks as asTicks,
  TICKS_PER_QUARTER,
  type Bpm,
  type Midi,
  type Ticks,
} from '@core/shared/units.ts'

export type Hand = 'left' | 'right'
export const HANDS = ['left', 'right'] as const

export type Clef = 'treble' | 'bass' | 'alto' | 'tenor'

/**
 * 6/8 is `{ beats: 6, beatType: 8 }`.
 *
 * `beatType` is a note value, so it is always a power of two (1, 2, 4, 8, 16,
 * …) — `makeScore` and `validateScore` reject anything else. Nothing in
 * notation writes 4/3, and letting one through only gives downstream writers
 * (SMF, which encodes the denominator as an exponent) a metre they must
 * silently rewrite.
 */
export type TimeSignature = { readonly beats: number; readonly beatType: number }

export type StaffInfo = { readonly staff: number; readonly clef: Clef; readonly hand: Hand }

export type ScoreNote = {
  /** Stable, derived from position: `m3.r.480.60` (measure.hand.startTick.midi). */
  readonly id: string
  readonly midi: Midi
  readonly startTick: Ticks
  readonly durationTicks: Ticks
  readonly hand: Hand
  readonly voice: number
  readonly staff: number
  /** 0-based index into `Score.measures`. */
  readonly measureIndex: number
  readonly velocity: number
  /** Continues a tie started earlier — the matcher must not expect a key press. */
  readonly tiedFrom: boolean
  /** Is tied into the following note — no key release is expected at its end. */
  readonly tiedTo: boolean
  readonly fingering?: number
}

export type Measure = {
  readonly index: number
  readonly startTick: Ticks
  readonly durationTicks: Ticks
  readonly timeSignature: TimeSignature
  readonly keyFifths: number
  /** As printed; may repeat (repeats, split measures) or be `0` for a pickup. */
  readonly number: string
}

export type TempoMark = { readonly tick: Ticks; readonly bpm: Bpm }
export type ScoreMeta = {
  readonly title: string
  readonly composer: string
  readonly source?: string
}

export type Score = {
  readonly id: string
  readonly meta: ScoreMeta
  readonly measures: readonly Measure[]
  readonly notes: readonly ScoreNote[]
  readonly tempos: readonly TempoMark[]
  readonly staves: readonly StaffInfo[]
  /**
   * The longest `durationTicks` in `notes` — how far back `soundingAtTick` has
   * to look for a note that is still being held. Derived, never independent
   * state: every function here that changes `notes` recomputes it, and
   * `validateScore` rejects a value too small for the notes it is attached to.
   */
  readonly maxNoteDurationTicks: Ticks
}

const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }
const DEFAULT_BPM = 120
const DEFAULT_VELOCITY = 64
const NO_NOTES: readonly ScoreNote[] = []

/** Exact for every safe integer: `2 ** round(log2(n))` reproduces `n` only for powers of two. */
function isPowerOfTwo(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0 && 2 ** Math.round(Math.log2(n)) === n
}

/**
 * Ticks in one bar of the given metre: 4/4 → 1920, 6/8 → 1440.
 * A low-level helper: it only asks that the metre be tick-exact, so it will
 * measure a 4/3 bar. `makeScore`/`validateScore` are what refuse such a metre.
 */
export function measureDurationTicks(ts: TimeSignature): Ticks {
  invariant(Number.isInteger(ts.beats) && ts.beats > 0, `bad time signature beats: ${ts.beats}`)
  invariant(
    Number.isInteger(ts.beatType) && ts.beatType > 0,
    `bad time signature beat type: ${ts.beatType}`,
  )
  const total = (ts.beats * TICKS_PER_QUARTER * 4) / ts.beatType
  invariant(Number.isInteger(total), `time signature ${ts.beats}/${ts.beatType} is not tick-exact`)
  return asTicks(total)
}

/** The id `makeScore` derives for a note. Collisions get a `#2`, `#3`, … suffix. */
export function noteId(note: {
  readonly measureIndex: number
  readonly hand: Hand
  readonly startTick: number
  readonly midi: number
}): string {
  return `m${note.measureIndex}.${note.hand === 'right' ? 'r' : 'l'}.${note.startTick}.${note.midi}`
}

// ---------------------------------------------------------------- construction

export type ScoreNoteInput = {
  readonly midi: number
  readonly startTick: number
  readonly durationTicks: number
  readonly hand: Hand
  readonly voice?: number
  readonly staff?: number
  readonly velocity?: number
  readonly tiedFrom?: boolean
  readonly tiedTo?: boolean
  readonly fingering?: number
}

export type MeasureInput = {
  /** Inherited from the previous measure when omitted; 4/4 for the first. */
  readonly timeSignature?: TimeSignature
  /** Inherited from the previous measure when omitted; 0 (C major) for the first. */
  readonly keyFifths?: number
  /** Defaults to the metre's full bar — pass a shorter value for a pickup. */
  readonly durationTicks?: number
  readonly number?: string
}

export type ScoreInput = {
  readonly id: string
  readonly meta?: { readonly title?: string; readonly composer?: string; readonly source?: string }
  readonly measures: readonly MeasureInput[]
  readonly notes: readonly ScoreNoteInput[]
  /** Defaults to a single 120 bpm mark at tick 0. Must contain a tick-0 mark. */
  readonly tempos?: readonly { readonly tick: number; readonly bpm: number }[]
  /** Derived from the hands present in `notes` when omitted. */
  readonly staves?: readonly StaffInfo[]
}

/**
 * Validate, sort and assign ids. Throws `InvariantError` on input that cannot
 * describe a real score; the returned Score always passes `validateScore`.
 */
export function makeScore(input: ScoreInput): Score {
  invariant(input.id.length > 0, 'score id must not be empty')
  invariant(input.measures.length > 0, 'a score needs at least one measure')

  const measures = buildMeasures(input.measures)
  const tempos = buildTempos(input.tempos)
  const notes = buildNotes(input.notes, measures)
  const staves = buildStaves(input.staves, notes)

  const meta: ScoreMeta = {
    title: input.meta?.title ?? '',
    composer: input.meta?.composer ?? '',
    ...(input.meta?.source === undefined ? {} : { source: input.meta.source }),
  }
  const score: Score = {
    id: input.id,
    meta,
    measures,
    notes,
    tempos,
    staves,
    maxNoteDurationTicks: maxNoteDurationTicks(notes),
  }
  const checked = validateScore(score)
  if (!checked.ok) invariant(false, checked.error)
  return score
}

function buildMeasures(inputs: readonly MeasureInput[]): readonly Measure[] {
  const first = at(inputs, 0)
  const firstTs = first.timeSignature ?? DEFAULT_TIME_SIGNATURE
  const isPickup =
    (first.durationTicks ?? measureDurationTicks(firstTs)) < measureDurationTicks(firstTs)

  const measures: Measure[] = []
  let ts = DEFAULT_TIME_SIGNATURE
  let keyFifths = 0
  let startTick = 0
  for (let i = 0; i < inputs.length; i++) {
    const m = at(inputs, i)
    ts = m.timeSignature ?? ts
    keyFifths = m.keyFifths ?? keyFifths
    const durationTicks = m.durationTicks ?? measureDurationTicks(ts)
    invariant(
      Number.isInteger(durationTicks) && durationTicks > 0,
      `measure ${i} duration must be a positive integer, got ${durationTicks}`,
    )
    invariant(
      Number.isInteger(keyFifths) && Math.abs(keyFifths) <= 7,
      `measure ${i} keyFifths out of range: ${keyFifths}`,
    )
    measures.push({
      index: i,
      startTick: asTicks(startTick),
      durationTicks: asTicks(durationTicks),
      timeSignature: { beats: ts.beats, beatType: ts.beatType },
      keyFifths,
      number: m.number ?? String(isPickup ? i : i + 1),
    })
    startTick += durationTicks
  }
  return measures
}

function buildTempos(
  inputs: readonly { readonly tick: number; readonly bpm: number }[] | undefined,
): readonly TempoMark[] {
  const raw = inputs === undefined || inputs.length === 0 ? [{ tick: 0, bpm: DEFAULT_BPM }] : inputs
  const sorted = [...raw].sort((a, b) => a.tick - b.tick)
  const out: TempoMark[] = []
  for (const t of sorted) {
    invariant(Number.isInteger(t.tick) && t.tick >= 0, `tempo tick must be a whole tick: ${t.tick}`)
    invariant(Number.isFinite(t.bpm) && t.bpm > 0, `tempo bpm must be positive: ${t.bpm}`)
    const previous = out[out.length - 1]
    invariant(
      previous === undefined || previous.tick !== t.tick,
      `two tempo marks at tick ${t.tick}`,
    )
    out.push({ tick: asTicks(t.tick), bpm: asBpm(t.bpm) })
  }
  invariant(at(out, 0).tick === 0, 'a score needs a tempo mark at tick 0')
  return out
}

function buildNotes(
  inputs: readonly ScoreNoteInput[],
  measures: readonly Measure[],
): readonly ScoreNote[] {
  const placed = inputs.map((n) => {
    invariant(isValidMidi(n.midi), `note midi out of range: ${n.midi}`)
    invariant(
      Number.isInteger(n.startTick) && n.startTick >= 0,
      `note startTick must be a whole tick >= 0, got ${n.startTick}`,
    )
    invariant(
      Number.isInteger(n.durationTicks) && n.durationTicks >= 0,
      `note durationTicks must be a whole tick >= 0, got ${n.durationTicks}`,
    )
    const velocity = n.velocity ?? DEFAULT_VELOCITY
    invariant(
      Number.isInteger(velocity) && velocity >= 0 && velocity <= 127,
      `note velocity out of range: ${velocity}`,
    )
    const voice = n.voice ?? 1
    invariant(Number.isInteger(voice) && voice >= 1, `note voice must be >= 1, got ${voice}`)
    const staff = n.staff ?? (n.hand === 'right' ? 1 : 2)
    invariant(Number.isInteger(staff) && staff >= 1, `note staff must be >= 1, got ${staff}`)

    const measureIndex = measureIndexAtTick(measures, n.startTick)
    invariant(measureIndex >= 0, `note at tick ${n.startTick} lies outside every measure`)
    const measure = at(measures, measureIndex)
    invariant(
      n.startTick + n.durationTicks <= measure.startTick + measure.durationTicks,
      `note at tick ${n.startTick} runs past the end of measure ${measureIndex} — split it at the barline and tie`,
    )
    return {
      midi: asMidi(n.midi),
      startTick: asTicks(n.startTick),
      durationTicks: asTicks(n.durationTicks),
      hand: n.hand,
      voice,
      staff,
      measureIndex,
      velocity,
      tiedFrom: n.tiedFrom ?? false,
      tiedTo: n.tiedTo ?? false,
      ...(n.fingering === undefined ? {} : { fingering: n.fingering }),
    }
  })
  // Stable sort: notes that agree on both keys keep the order they came in.
  placed.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi)
  return assignIds(placed)
}

/** Longest note in the list, `0` when there are none. Carried on the Score. */
function maxNoteDurationTicks(notes: readonly ScoreNote[]): Ticks {
  let max = 0
  for (const n of notes) if (n.durationTicks > max) max = n.durationTicks
  return asTicks(max)
}

/**
 * Derive every id from its note's position. Two notes can share a position (the
 * same pitch in two voices), so repeats get a `#2`, `#3`, … suffix — ids have to
 * stay unique for the renderer and the matcher to key on them.
 */
function assignIds(notes: readonly Omit<ScoreNote, 'id'>[]): readonly ScoreNote[] {
  const seen = new Map<string, number>()
  return notes.map((n) => {
    const base = noteId(n)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return { ...n, id: count === 1 ? base : `${base}#${count}` }
  })
}

function buildStaves(
  declared: readonly StaffInfo[] | undefined,
  notes: readonly ScoreNote[],
): readonly StaffInfo[] {
  if (declared !== undefined) {
    invariant(declared.length > 0, 'staves must not be empty')
    return [...declared].sort((a, b) => a.staff - b.staff)
  }
  const byStaff = new Map<number, StaffInfo>()
  for (const n of notes) {
    if (byStaff.has(n.staff)) continue
    byStaff.set(n.staff, {
      staff: n.staff,
      clef: n.hand === 'right' ? 'treble' : 'bass',
      hand: n.hand,
    })
  }
  if (byStaff.size === 0) {
    return [
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ]
  }
  return [...byStaff.values()].sort((a, b) => a.staff - b.staff)
}

// ------------------------------------------------------------------ validation

/** The complaint about a metre, phrased to follow `measure N has …`. */
function timeSignatureComplaint(ts: TimeSignature): string | undefined {
  if (!Number.isInteger(ts.beats) || ts.beats <= 0) return 'an invalid time signature'
  if (!Number.isInteger(ts.beatType) || ts.beatType <= 0) return 'an invalid time signature'
  if (!isPowerOfTwo(ts.beatType)) {
    return `beat type ${ts.beatType}, which is not a power of two`
  }
  return undefined
}

/** Structural check: sorted notes, notes inside their measure, contiguous measures, tick-0 tempo. */
export function validateScore(score: Score): Result<Score, string> {
  if (score.id.length === 0) return err('score id must not be empty')
  if (score.measures.length === 0) return err('score has no measures')

  let expectedStart = 0
  for (let i = 0; i < score.measures.length; i++) {
    const m = at(score.measures, i)
    if (m.index !== i) return err(`measure at position ${i} carries index ${m.index}`)
    if (!Number.isInteger(m.durationTicks) || m.durationTicks <= 0) {
      return err(`measure ${i} has a non-positive duration: ${m.durationTicks}`)
    }
    if (m.startTick !== expectedStart) {
      return err(
        `measure ${i} starts at tick ${m.startTick}, expected ${expectedStart} — measures must be contiguous from tick 0`,
      )
    }
    const metreComplaint = timeSignatureComplaint(m.timeSignature)
    if (metreComplaint !== undefined) return err(`measure ${i} has ${metreComplaint}`)
    if (!Number.isInteger(m.keyFifths) || Math.abs(m.keyFifths) > 7) {
      return err(`measure ${i} has keyFifths ${m.keyFifths}, outside -7..7`)
    }
    expectedStart += m.durationTicks
  }

  if (score.tempos.length === 0) return err('score has no tempo marks')
  if (at(score.tempos, 0).tick !== 0) return err('score has no tempo mark at tick 0')
  for (let i = 0; i < score.tempos.length; i++) {
    const t = at(score.tempos, i)
    if (!Number.isFinite(t.bpm) || t.bpm <= 0) return err(`tempo mark ${i} has bpm ${t.bpm}`)
    if (i > 0 && t.tick <= at(score.tempos, i - 1).tick) {
      return err('tempo marks must be sorted by ascending tick')
    }
  }

  if (score.staves.length === 0) return err('score has no staves')
  const staffNumbers = new Set(score.staves.map((s) => s.staff))
  if (staffNumbers.size !== score.staves.length) return err('staves must have unique staff numbers')

  if (!Number.isInteger(score.maxNoteDurationTicks) || score.maxNoteDurationTicks < 0) {
    return err(
      `score maxNoteDurationTicks must be a whole tick >= 0, got ${score.maxNoteDurationTicks}`,
    )
  }

  const ids = new Set<string>()
  for (let i = 0; i < score.notes.length; i++) {
    const n = at(score.notes, i)
    if (!isValidMidi(n.midi)) return err(`note ${n.id} has midi ${n.midi}, outside 0..127`)
    if (!Number.isInteger(n.velocity) || n.velocity < 0 || n.velocity > 127) {
      return err(`note ${n.id} has velocity ${n.velocity}, outside 0..127`)
    }
    if (!Number.isInteger(n.durationTicks) || n.durationTicks < 0) {
      return err(`note ${n.id} has a negative duration`)
    }
    if (ids.has(n.id)) return err(`duplicate note id: ${n.id}`)
    ids.add(n.id)
    if (i > 0) {
      const prev = at(score.notes, i - 1)
      if (prev.startTick > n.startTick || (prev.startTick === n.startTick && prev.midi > n.midi)) {
        return err(`notes must be sorted by startTick then midi (index ${i} breaks the order)`)
      }
    }
    const measure = score.measures[n.measureIndex]
    if (measure === undefined)
      return err(`note ${n.id} references missing measure ${n.measureIndex}`)
    const measureEnd = measure.startTick + measure.durationTicks
    if (n.startTick < measure.startTick || n.startTick >= measureEnd) {
      return err(`note ${n.id} starts at ${n.startTick}, outside measure ${n.measureIndex}`)
    }
    if (n.startTick + n.durationTicks > measureEnd) {
      return err(
        `note ${n.id} runs to ${n.startTick + n.durationTicks}, past the end of measure ${n.measureIndex} (${measureEnd})`,
      )
    }
    if (!staffNumbers.has(n.staff)) return err(`note ${n.id} is on undeclared staff ${n.staff}`)
    if (n.durationTicks > score.maxNoteDurationTicks) {
      return err(
        `note ${n.id} lasts ${n.durationTicks} ticks, past the declared maxNoteDurationTicks ${score.maxNoteDurationTicks} — soundingAtTick would miss it`,
      )
    }
  }
  return ok(score)
}

// ---------------------------------------------------------------------- queries

/** First index whose `startTick` is >= `tick`; `notes.length` if there is none. */
function lowerBoundByStart(notes: readonly ScoreNote[], tick: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (at(notes, mid).startTick < tick) lo = mid + 1
    else hi = mid
  }
  return lo
}

function measureIndexAtTick(measures: readonly Measure[], tick: number): number {
  let lo = 0
  let hi = measures.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (at(measures, mid).startTick <= tick) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found < 0) return -1
  const m = at(measures, found)
  return tick < m.startTick + m.durationTicks ? found : -1
}

/**
 * Notes STARTING in the half-open range `[fromTick, toTick)`.
 * O(log n + k) — this runs inside the playback loop, so it must never scan.
 */
export function notesInRange(score: Score, fromTick: Ticks, toTick: Ticks): readonly ScoreNote[] {
  if (toTick <= fromTick) return NO_NOTES
  const notes = score.notes
  const out: ScoreNote[] = []
  for (let i = lowerBoundByStart(notes, fromTick); i < notes.length; i++) {
    const n = at(notes, i)
    if (n.startTick >= toTick) break
    out.push(n)
  }
  return out
}

export function notesInMeasure(score: Score, measureIndex: number): readonly ScoreNote[] {
  const m = score.measures[measureIndex]
  if (m === undefined) return NO_NOTES
  return notesInRange(score, m.startTick, asTicks(m.startTick + m.durationTicks))
}

/** Notes whose onset is exactly `tick`. */
export function notesAtTick(score: Score, tick: Ticks): readonly ScoreNote[] {
  const notes = score.notes
  const out: ScoreNote[] = []
  for (let i = lowerBoundByStart(notes, tick); i < notes.length; i++) {
    const n = at(notes, i)
    if (n.startTick !== tick) break
    out.push(n)
  }
  return out
}

/** Notes being held at `tick`: `startTick <= tick < startTick + durationTicks`. */
export function soundingAtTick(score: Score, tick: Ticks): readonly ScoreNote[] {
  const notes = score.notes
  const out: ScoreNote[] = []
  const earliest = tick - score.maxNoteDurationTicks
  for (let i = lowerBoundByStart(notes, earliest); i < notes.length; i++) {
    const n = at(notes, i)
    if (n.startTick > tick) break
    if (tick < n.startTick + n.durationTicks) out.push(n)
  }
  return out
}

export function measureAtTick(score: Score, tick: Ticks): Measure | undefined {
  const index = measureIndexAtTick(score.measures, tick)
  return index < 0 ? undefined : at(score.measures, index)
}

/** End of the written music. O(n) — call it once, not per frame. */
export function scoreDurationTicks(score: Score): Ticks {
  let end = 0
  for (const m of score.measures) end = Math.max(end, m.startTick + m.durationTicks)
  for (const n of score.notes) end = Math.max(end, n.startTick + n.durationTicks)
  return asTicks(end)
}

// -------------------------------------------------------------- transformations

/**
 * Hand-mute practice (REQ-3.2.3). Measures, tempos and id are unchanged.
 *
 * A staff is not owned by a hand. A single-staff part that turns bass clef
 * mid-piece emits left-hand notes on a staff whose `hand` is still 'right', so
 * filtering staves by hand alone would leave a surviving note standing on an
 * undeclared staff — an invalid Score. Keep every staff a surviving note is
 * still written on, and when nothing survives keep the staves as they were: a
 * score with no notes is still a score, and it must have at least one staff.
 */
export function filterHands(score: Score, hands: readonly Hand[]): Score {
  const keep = new Set(hands)
  const notes = score.notes.filter((n) => keep.has(n.hand))
  const used = new Set(notes.map((n) => n.staff))
  const staves = score.staves.filter((s) => keep.has(s.hand) || used.has(s.staff))
  return {
    ...score,
    notes,
    staves: staves.length > 0 ? staves : score.staves,
    maxNoteDurationTicks: maxNoteDurationTicks(notes),
  }
}

/**
 * Tick span of an inclusive measure range, for looping (REQ-3.2.3).
 * Indices are clamped to the score and swapped if given backwards.
 */
export function measureRange(
  score: Score,
  from: number,
  to: number,
): { startTick: Ticks; endTick: Ticks } {
  invariant(score.measures.length > 0, 'measureRange: score has no measures')
  const last = score.measures.length - 1
  const clamp = (i: number): number => Math.min(last, Math.max(0, Math.trunc(i)))
  const lo = clamp(Math.min(from, to))
  const hi = clamp(Math.max(from, to))
  const a = at(score.measures, lo)
  const b = at(score.measures, hi)
  return { startTick: a.startTick, endTick: asTicks(b.startTick + b.durationTicks) }
}

/**
 * Notes grouped by simultaneous onset — what the matcher waits for.
 * Notes with `tiedFrom` are excluded: they continue an earlier key press, so no
 * new press is expected. `toleranceTicks` measures from the group's first onset,
 * so a long stream of near-simultaneous notes cannot drift into one group.
 *
 * @public — `core/practice/matcher.ts`'s `buildExpected` re-derives this exact
 * grouping rule (notes sharing a `startTick`) internally instead of calling this,
 * and its own comment cross-references `chordGroups` by name as "the same rule".
 * That is a genuine dedup opportunity, but `matcher.ts` is out of this module's
 * scope to edit — kept live and documented here rather than deleted.
 */
export function chordGroups(score: Score, toleranceTicks = 0): readonly (readonly ScoreNote[])[] {
  invariant(toleranceTicks >= 0, `chordGroups: negative tolerance ${toleranceTicks}`)
  const groups: ScoreNote[][] = []
  let current: ScoreNote[] | undefined
  let anchor = 0
  for (const n of score.notes) {
    if (n.tiedFrom) continue
    if (current === undefined || n.startTick - anchor > toleranceTicks) {
      current = []
      groups.push(current)
      anchor = n.startTick
    }
    current.push(n)
  }
  return groups
}
