/**
 * Standard MIDI File (SMF) ⇄ `Score` — REQ-3.2.5.
 *
 * A MIDI file is a performance, not a piece of notation: it has no bars, no
 * hands, no spelling and no ties. Everything the score model needs beyond raw
 * note-on/note-off pairs therefore has to be *derived*, and the rules used here
 * are written down so a reader can disagree with them on purpose:
 *
 *  - **Resolution.** File ticks are rescaled to `TICKS_PER_QUARTER` (480) with
 *    `round`, so 96, 480 and 960 ticks-per-quarter files give the same music.
 *  - **Bars.** Derived from the time-signature meta events, 4/4 until told
 *    otherwise. A signature change part-way through a bar cuts that bar short.
 *  - **Hands.** Track order is *not* a reliable guide (plenty of files put the
 *    left hand first, and format 0 has one track for everything). So: exactly
 *    two note-carrying tracks → the one with the higher average pitch is the
 *    right hand; anything else → split at middle C (MIDI 60), below goes left.
 *  - **Ties.** A note may not cross a barline in the score model, so a held
 *    note is split at each barline into `tiedTo`/`tiedFrom` fragments.
 *  - **Unmatched note-ons.** SMF does not promise that every note-on is closed.
 *    `parseMidiFile` returns a `Score` or an error and has no channel for a
 *    warning, so a dangling note is simply clamped to the end of its track.
 *
 * This module only reads SMF; there is no writer. Nothing in the app exports a
 * `Score` back out as a MIDI file — the one format writer this app ships is
 * `writeMusicXml` (`@core/notation/musicxmlwriter.ts`).
 */
import { at } from '@core/shared/invariant.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { TICKS_PER_QUARTER } from '@core/shared/units.ts'
import {
  makeScore,
  measureDurationTicks,
  type Hand,
  type MeasureInput,
  type Score,
  type ScoreNoteInput,
  type TimeSignature,
} from './score.ts'

const MTHD = 0x4d546864
const MTRK = 0x4d54726b

const MICROS_PER_MINUTE = 60_000_000
const DEFAULT_BPM = 120
const MIDDLE_C = 60
const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }

/** Refuse absurd files rather than allocating a measure list the size of a city. */
const MAX_MUSIC_TICKS = TICKS_PER_QUARTER * 4 * 10_000
/**
 * The same limit expressed in bars, which is the one that actually binds: bar
 * length is a free variable, and a legal 1/128 metre is 15 ticks, so a 45-byte
 * file can ask for 1.2 million measures while staying inside MAX_MUSIC_TICKS.
 */
const MAX_MEASURE_COUNT = 10_000
/**
 * Data-byte counts for the system-common messages. They are illegal inside an
 * SMF, but do turn up in files dumped straight off the wire; knowing their
 * length is what stops one from desyncing the rest of the track.
 */
const SYSTEM_COMMON_DATA_BYTES: Readonly<Record<number, number>> = { 0xf1: 1, 0xf2: 2, 0xf3: 1 }

// --------------------------------------------------------------------- reading

/** A cursor that never reads out of bounds: it records the failure instead. */
class ByteReader {
  private readonly bytes: Uint8Array
  private position = 0
  private failure: string | undefined = undefined

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  get pos(): number {
    return this.position
  }

  get remaining(): number {
    return this.bytes.length - this.position
  }

  get failed(): boolean {
    return this.failure !== undefined
  }

  /** The first failure seen, if any. */
  get error(): string | undefined {
    return this.failure
  }

  fail(reason: string): void {
    if (this.failure === undefined) this.failure = reason
  }

  seekTo(position: number): void {
    this.position = position
  }

  /** Reserve `n` bytes and return their offset, or -1 when they are not there. */
  private take(n: number): number {
    if (this.position + n > this.bytes.length) {
      this.fail('truncated MIDI file: ran out of bytes')
      this.position = this.bytes.length
      return -1
    }
    const start = this.position
    this.position += n
    return start
  }

  u8(): number {
    const i = this.take(1)
    return i < 0 ? 0 : (this.bytes[i] ?? 0)
  }

  u16(): number {
    const hi = this.u8()
    return hi * 0x100 + this.u8()
  }

  u32(): number {
    const hi = this.u16()
    return hi * 0x10000 + this.u16()
  }

  /** The next byte without consuming it; -1 at the end of the file. */
  peek(): number {
    return this.position < this.bytes.length ? (this.bytes[this.position] ?? 0) : -1
  }

  skip(n: number): void {
    this.take(n)
  }

  slice(n: number): Uint8Array {
    const i = this.take(n)
    return i < 0 ? new Uint8Array(0) : this.bytes.subarray(i, i + n)
  }

  /** Variable-length quantity: 7 bits per byte, high bit means "more follows". */
  vlq(): number {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const b = this.u8()
      if (this.failed) return 0
      value = value * 0x80 + (b & 0x7f)
      if ((b & 0x80) === 0) return value
    }
    this.fail('malformed MIDI file: variable-length quantity longer than four bytes')
    return 0
  }
}

type OpenNote = { readonly midi: number; readonly startTick: number; readonly velocity: number }
type RawNote = {
  readonly midi: number
  readonly startTick: number
  readonly endTick: number
  readonly velocity: number
}
type TempoEvent = { readonly tick: number; readonly microsPerQuarter: number }
type TimeSigEvent = { readonly tick: number; readonly ts: TimeSignature }
type KeySigEvent = { readonly tick: number; readonly fifths: number }

type TrackData = {
  readonly index: number
  name: string | undefined
  endTick: number
  readonly notes: RawNote[]
  readonly tempos: TempoEvent[]
  readonly timeSigs: TimeSigEvent[]
  readonly keySigs: KeySigEvent[]
}

/** SMF text meta events are 8-bit, so Latin-1 is the faithful reading. */
function decodeText(data: Uint8Array): string {
  let out = ''
  for (let i = 0; i < data.length; i++) out += String.fromCharCode(data[i] ?? 0)
  return out
}

function applyMeta(track: TrackData, type: number, data: Uint8Array, tick: number): void {
  if (type === 0x03) {
    if (track.name === undefined) track.name = decodeText(data)
  } else if (type === 0x51 && data.length === 3) {
    const micros = (data[0] ?? 0) * 0x10000 + (data[1] ?? 0) * 0x100 + (data[2] ?? 0)
    if (micros > 0) track.tempos.push({ tick, microsPerQuarter: micros })
  } else if (type === 0x58 && data.length >= 4) {
    const beats = data[0] ?? 0
    const power = data[1] ?? 0
    // 2^7 = 128 is the smallest beat unit that still divides 480 ticks exactly;
    // anything beyond that (or a bar of zero beats) is not notatable, so drop it.
    if (beats > 0 && power <= 7) track.timeSigs.push({ tick, ts: { beats, beatType: 2 ** power } })
  } else if (type === 0x59 && data.length >= 2) {
    const raw = data[0] ?? 0
    const fifths = raw > 127 ? raw - 256 : raw
    if (Math.abs(fifths) <= 7) track.keySigs.push({ tick, fifths })
  }
  // Everything else — copyright, marker, lyric, instrument, sequencer-specific —
  // is skipped. Meta events carry a length, so an unknown one never desyncs.
}

function closeNote(pending: Map<number, OpenNote[]>, notes: RawNote[], key: number, tick: number) {
  const open = pending.get(key)?.shift()
  // A note-off with no matching note-on is meaningless; drop it rather than
  // inventing a zero-length note at an arbitrary place.
  if (open === undefined) return
  notes.push({
    midi: open.midi,
    startTick: open.startTick,
    endTick: Math.max(tick, open.startTick),
    velocity: open.velocity,
  })
}

/** Parse one MTrk body, `reader` positioned at its first delta time. */
function parseTrack(
  reader: ByteReader,
  chunkEnd: number,
  index: number,
): Result<TrackData, string> {
  const track: TrackData = {
    index,
    name: undefined,
    endTick: 0,
    notes: [],
    tempos: [],
    timeSigs: [],
    keySigs: [],
  }
  const pending = new Map<number, OpenNote[]>()
  let running = -1
  let tick = 0
  let ended = false

  while (reader.pos < chunkEnd && !ended && !reader.failed) {
    tick += reader.vlq()
    if (reader.failed) break
    let status = reader.peek()
    if (status >= 0x80) {
      reader.skip(1)
      // System messages (0xF0–0xFF) cancel running status; channel ones set it.
      running = status < 0xf0 ? status : -1
    } else if (running >= 0) {
      status = running
    } else {
      return err('malformed MIDI file: running status used before any status byte')
    }

    const kind = status & 0xf0
    const channelBase = (status & 0x0f) * 128
    if (kind === 0x80 || kind === 0x90) {
      const note = reader.u8() & 0x7f
      const velocity = reader.u8() & 0x7f
      // A note-on with velocity 0 is the idiomatic note-off — running status
      // then lets a whole phrase share one 0x9n status byte.
      if (kind === 0x90 && velocity > 0) {
        const queue = pending.get(channelBase + note) ?? []
        queue.push({ midi: note, startTick: tick, velocity })
        pending.set(channelBase + note, queue)
      } else {
        closeNote(pending, track.notes, channelBase + note, tick)
      }
    } else if (kind === 0xa0 || kind === 0xb0 || kind === 0xe0) {
      reader.skip(2)
    } else if (kind === 0xc0 || kind === 0xd0) {
      reader.skip(1)
    } else if (status === 0xff) {
      const type = reader.u8()
      const data = reader.slice(reader.vlq())
      if (reader.failed) break
      applyMeta(track, type, data, tick)
      if (type === 0x2f) {
        track.endTick = tick
        ended = true
      }
    } else if (status === 0xf0 || status === 0xf7) {
      reader.skip(reader.vlq())
    } else {
      reader.skip(SYSTEM_COMMON_DATA_BYTES[status] ?? 0)
    }
  }

  const failure = reader.error
  if (failure !== undefined) return err(failure)
  if (!ended) track.endTick = tick
  // Note-ons the file never closed: clamp them to the end of the track.
  for (const queue of pending.values()) {
    for (const open of queue) {
      track.notes.push({
        midi: open.midi,
        startTick: open.startTick,
        endTick: Math.max(track.endTick, open.startTick),
        velocity: open.velocity,
      })
    }
  }
  // Anything after end-of-track belongs to the chunk but not to the music.
  reader.seekTo(chunkEnd)
  return ok(track)
}

type HeaderInfo = { readonly division: number; readonly tracks: readonly TrackData[] }

function readChunks(bytes: Uint8Array): Result<HeaderInfo, string> {
  const reader = new ByteReader(bytes)
  if (bytes.length < 14) return err('not a MIDI file: fewer than 14 bytes')
  if (reader.u32() !== MTHD) return err('not a MIDI file: it does not start with an MThd chunk')
  const headerLength = reader.u32()
  if (headerLength < 6) return err(`malformed MIDI file: MThd chunk is only ${headerLength} bytes`)
  const format = reader.u16()
  // The declared track count is deliberately ignored: files with a stale count
  // are common and the chunks themselves are the authority.
  reader.u16()
  const division = reader.u16()
  reader.skip(headerLength - 6)
  if (reader.failed) return err('truncated MIDI file: the MThd chunk is incomplete')

  if (format === 2) {
    return err('unsupported MIDI file: format 2 tracks are independent patterns, not one timeline')
  }
  if (format > 2) return err(`unsupported MIDI file: unknown format ${format}`)
  if ((division & 0x8000) !== 0) {
    return err('unsupported MIDI file: SMPTE time division — ticks per quarter note are required')
  }
  if (division === 0) return err('malformed MIDI file: a division of 0 ticks per quarter note')

  const tracks: TrackData[] = []
  while (reader.remaining >= 8) {
    const type = reader.u32()
    const length = reader.u32()
    const chunkEnd = reader.pos + length
    if (chunkEnd > bytes.length) {
      return err('truncated MIDI file: a chunk claims more bytes than the file holds')
    }
    if (type === MTRK) {
      const parsed = parseTrack(reader, chunkEnd, tracks.length)
      if (!parsed.ok) return parsed
      tracks.push(parsed.value)
    } else {
      // The spec requires readers to skip chunk types they do not know.
      reader.seekTo(chunkEnd)
    }
  }
  if (reader.remaining > 0) return err('truncated MIDI file: a partial chunk header at the end')
  if (tracks.length === 0) return err('malformed MIDI file: it contains no MTrk chunks')
  return ok({ division, tracks })
}

// ------------------------------------------------------------------- assembly

/** Keep the first event at each tick; the score model needs unique tick keys. */
function firstPerTick<T extends { readonly tick: number }>(events: readonly T[]): T[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick)
  const out: T[] = []
  for (const e of sorted) {
    if (out.length === 0 || at(out, out.length - 1).tick !== e.tick) out.push(e)
  }
  return out
}

function averagePitch(track: TrackData): number {
  let sum = 0
  for (const n of track.notes) sum += n.midi
  return sum / track.notes.length
}

/** The track that is the right hand, or `undefined` when the rule does not apply. */
function rightHandTrackIndex(tracks: readonly TrackData[]): number | undefined {
  const carriers = tracks.filter((t) => t.notes.length > 0)
  if (carriers.length !== 2) return undefined
  const a = at(carriers, 0)
  const b = at(carriers, 1)
  // Ties go to the earlier track, which is the usual engraving order.
  return averagePitch(a) >= averagePitch(b) ? a.index : b.index
}

type MeasureSpan = {
  readonly startTick: number
  readonly durationTicks: number
  readonly ts: TimeSignature
  readonly fifths: number
}

/**
 * The bar grid, one span per measure. Fails rather than returning an unbounded
 * list: `MAX_MUSIC_TICKS` bounds the ticks but says nothing about how short a
 * bar may be, and the caller allocates a measure and a tied note fragment per
 * span.
 */
function buildMeasureSpans(
  timeSigs: readonly TimeSigEvent[],
  keySigs: readonly KeySigEvent[],
  endTick: number,
): Result<MeasureSpan[], string> {
  const spans: MeasureSpan[] = []
  let ts = DEFAULT_TIME_SIGNATURE
  let tsIndex = 0
  let fifths = 0
  let keyIndex = 0
  let tick = 0
  while (tsIndex < timeSigs.length && at(timeSigs, tsIndex).tick <= 0) {
    ts = at(timeSigs, tsIndex).ts
    tsIndex += 1
  }
  while (tick < endTick) {
    if (spans.length >= MAX_MEASURE_COUNT) {
      return err(
        `MIDI file needs more than ${MAX_MEASURE_COUNT} measures: its bars are ${measureDurationTicks(ts)} ticks long`,
      )
    }
    while (keyIndex < keySigs.length && at(keySigs, keyIndex).tick <= tick) {
      fifths = at(keySigs, keyIndex).fifths
      keyIndex += 1
    }
    const barEnd = tick + measureDurationTicks(ts)
    const next = timeSigs[tsIndex]
    // A signature that lands mid-bar cuts the bar short rather than shifting
    // every later barline off the grid.
    const end = next !== undefined && next.tick < barEnd ? next.tick : barEnd
    spans.push({ startTick: tick, durationTicks: end - tick, ts, fifths })
    tick = end
    while (tsIndex < timeSigs.length && at(timeSigs, tsIndex).tick <= tick) {
      ts = at(timeSigs, tsIndex).ts
      tsIndex += 1
    }
  }
  return ok(spans)
}

/** Index of the last span starting at or before `tick`. */
function spanIndexAt(spans: readonly MeasureSpan[], tick: number): number {
  let lo = 0
  let hi = spans.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (at(spans, mid).startTick <= tick) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

type ScaledNote = RawNote & { readonly hand: Hand }

/** Cut a held note at every barline it crosses, joining the pieces with ties. */
function splitAtBarlines(note: ScaledNote, spans: readonly MeasureSpan[]): ScoreNoteInput[] {
  const out: ScoreNoteInput[] = []
  let start = note.startTick
  let index = spanIndexAt(spans, start)
  for (;;) {
    const span = at(spans, index)
    const barEnd = span.startTick + span.durationTicks
    const segmentEnd = Math.min(note.endTick, barEnd)
    // The spans always reach past the last note, so a continuation always has a
    // bar to land in.
    const tiedTo = segmentEnd < note.endTick
    out.push({
      midi: note.midi,
      startTick: start,
      durationTicks: segmentEnd - start,
      hand: note.hand,
      velocity: note.velocity,
      tiedFrom: out.length > 0,
      tiedTo,
    })
    if (!tiedTo) return out
    index += 1
    start = barEnd
  }
}

export function parseMidiFile(bytes: Uint8Array, opts?: { id?: string }): Result<Score, string> {
  const chunks = readChunks(bytes)
  if (!chunks.ok) return chunks
  const { division, tracks } = chunks.value
  const scale = (tick: number): number => Math.round((tick * TICKS_PER_QUARTER) / division)

  const rightIndex = rightHandTrackIndex(tracks)
  const notes: ScaledNote[] = []
  let musicEnd = 1
  for (const track of tracks) {
    musicEnd = Math.max(musicEnd, scale(track.endTick))
    for (const n of track.notes) {
      const startTick = scale(n.startTick)
      const hand: Hand =
        rightIndex === undefined
          ? n.midi >= MIDDLE_C
            ? 'right'
            : 'left'
          : track.index === rightIndex
            ? 'right'
            : 'left'
      notes.push({ ...n, startTick, endTick: scale(n.endTick), hand })
      // +1 so that a zero-length note still starts inside a bar.
      musicEnd = Math.max(musicEnd, scale(n.endTick), startTick + 1)
    }
  }
  if (musicEnd > MAX_MUSIC_TICKS) {
    return err(`MIDI file spans ${musicEnd} ticks, more than the ${MAX_MUSIC_TICKS} tick limit`)
  }

  const timeSigs = firstPerTick(
    tracks.flatMap((t) => t.timeSigs.map((e) => ({ ...e, tick: scale(e.tick) }))),
  )
  const keySigs = firstPerTick(
    tracks.flatMap((t) => t.keySigs.map((e) => ({ ...e, tick: scale(e.tick) }))),
  )
  const tempos = firstPerTick(
    tracks.flatMap((t) =>
      t.tempos.map((e) => ({ tick: scale(e.tick), bpm: MICROS_PER_MINUTE / e.microsPerQuarter })),
    ),
  )
  if (tempos[0]?.tick !== 0) tempos.unshift({ tick: 0, bpm: DEFAULT_BPM })

  const built = buildMeasureSpans(timeSigs, keySigs, musicEnd)
  if (!built.ok) return built
  const spans = built.value
  const measures: MeasureInput[] = spans.map((s) => ({
    timeSignature: s.ts,
    keyFifths: s.fifths,
    durationTicks: s.durationTicks,
  }))
  // `makeScore` throws on anything it cannot describe. Nothing above is known to
  // reach it, but this function promises a Score or an error, so a broken
  // invariant becomes an error rather than an exception escaping the parser.
  try {
    return ok(
      makeScore({
        id: opts?.id ?? 'midi-import',
        meta: {
          title: tracks.find((t) => t.name !== undefined)?.name ?? '',
          composer: '',
          source: 'midi',
        },
        measures,
        notes: notes.flatMap((n) => splitAtBarlines(n, spans)),
        tempos,
      }),
    )
  } catch (cause) {
    return err(`could not build a score: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
