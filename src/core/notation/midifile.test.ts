/**
 * Every byte array in this suite is built by the helpers at the top rather than
 * loaded from a fixture file, so a reader can see exactly which bytes produce
 * which musical claim and nothing binary is committed.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseMidiFile, writeMidiFile } from './midifile.ts'
import {
  makeScore,
  measureDurationTicks,
  type MeasureInput,
  type Score,
  type ScoreNoteInput,
  type TimeSignature,
} from './score.ts'
import {
  C_MAJOR_SCALE_RH,
  PICKUP_MEASURE,
  SINGLE_NOTE,
  SIX_EIGHT,
  TEMPO_CHANGE,
  TIED_NOTES,
  TWO_HAND_CHORDS,
} from '@test/fixtures.ts'
import { at } from '@core/shared/invariant.ts'
import { unwrap } from '@core/shared/result.ts'

// ------------------------------------------------------------------- builders

const MTHD = [0x4d, 0x54, 0x68, 0x64]
const MTRK = [0x4d, 0x54, 0x72, 0x6b]

/** Independent VLQ encoder — deliberately not the one in the implementation. */
function vlq(value: number): number[] {
  if (value < 0x80) return [value]
  const groups: number[] = []
  let rest = value
  while (rest > 0) {
    groups.unshift(rest % 128)
    rest = Math.floor(rest / 128)
  }
  return groups.map((g, i) => (i === groups.length - 1 ? g : g | 0x80))
}

function chunk(type: readonly number[], body: readonly number[]): number[] {
  const n = body.length
  return [...type, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...body]
}

/** One event: `[deltaTicks, statusByte, ...data]` — or `[delta, ...data]` for running status. */
type Event = readonly number[]

function trackChunk(events: readonly Event[], opts: { endDelta?: number; eot?: boolean } = {}) {
  const body: number[] = []
  for (const e of events) body.push(...vlq(e[0] ?? 0), ...e.slice(1))
  if (opts.eot !== false) body.push(...vlq(opts.endDelta ?? 0), 0xff, 0x2f, 0x00)
  return chunk(MTRK, body)
}

function rawTrackChunk(body: readonly number[]): number[] {
  return chunk(MTRK, body)
}

function headerChunk(format: number, trackCount: number, division: number): number[] {
  return chunk(MTHD, [
    0,
    format,
    (trackCount >> 8) & 0xff,
    trackCount & 0xff,
    (division >> 8) & 0xff,
    division & 0xff,
  ])
}

function midiFile(
  opts: { format?: number; division?: number },
  ...tracks: readonly (readonly number[])[]
): Uint8Array {
  const header = headerChunk(opts.format ?? 1, tracks.length, opts.division ?? 480)
  return Uint8Array.from([...header, ...tracks.flat()])
}

const noteOn = (delta: number, note: number, velocity = 64, channel = 0): Event => [
  delta,
  0x90 | channel,
  note,
  velocity,
]
const noteOff = (delta: number, note: number, channel = 0): Event => [
  delta,
  0x80 | channel,
  note,
  0x40,
]
const meta = (delta: number, type: number, data: readonly number[]): Event => [
  delta,
  0xff,
  type,
  ...vlq(data.length),
  ...data,
]
const tempoMeta = (delta: number, micros: number): Event =>
  meta(delta, 0x51, [(micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff])
const timeSigMeta = (delta: number, beats: number, power: number): Event =>
  meta(delta, 0x58, [beats, power, 24, 8])
const keySigMeta = (delta: number, fifths: number): Event =>
  meta(delta, 0x59, [fifths < 0 ? fifths + 256 : fifths, 0])
const nameMeta = (delta: number, name: string): Event =>
  meta(
    delta,
    0x03,
    [...name].map((c) => c.charCodeAt(0)),
  )

/** A melody of equal-length notes, one after another. */
function melodyTrack(pitches: readonly number[], step: number, channel = 0): number[] {
  const events: Event[] = []
  for (const p of pitches) {
    events.push(noteOn(0, p, 64, channel), noteOff(step, p, channel))
  }
  return trackChunk(events)
}

/** `[midi, startTick, durationTicks]` per note — the shape most assertions want. */
function tuples(score: Score): [number, number, number][] {
  return score.notes
    .map((n): [number, number, number] => [n.midi, n.startTick, n.durationTicks])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2])
}

function parseOk(bytes: Uint8Array): Score {
  return unwrap(parseMidiFile(bytes))
}

function parseErr(bytes: Uint8Array): string {
  const r = parseMidiFile(bytes)
  if (r.ok) throw new Error(`expected an Err, got a Score with ${r.value.notes.length} notes`)
  return r.error
}

// ------------------------------------------------------------------- headers

describe('parseMidiFile — header', () => {
  it('accepts format 0 (a single multi-channel track)', () => {
    const file = midiFile({ format: 0 }, melodyTrack([60, 62], 480))
    expect(tuples(parseOk(file))).toEqual([
      [60, 0, 480],
      [62, 480, 480],
    ])
  })

  it('accepts format 1 (parallel tracks sharing a timeline)', () => {
    const file = midiFile(
      { format: 1 },
      trackChunk([tempoMeta(0, 500_000)]),
      melodyTrack([60], 480),
    )
    expect(parseOk(file).notes).toHaveLength(1)
  })

  it('rejects format 2, which has no single timeline', () => {
    const file = midiFile({ format: 2 }, melodyTrack([60], 480))
    expect(parseErr(file)).toMatch(/format 2/)
  })

  it('rejects an unknown format', () => {
    const file = midiFile({ format: 3 }, melodyTrack([60], 480))
    expect(parseErr(file)).toMatch(/unknown format 3/)
  })

  it('rejects SMPTE time division', () => {
    // 0xE728 = -25 fps, 40 subframes per frame: the high bit marks SMPTE.
    const file = midiFile({ division: 0xe728 }, melodyTrack([60], 480))
    expect(parseErr(file)).toMatch(/SMPTE/)
  })

  it('rejects a division of zero', () => {
    const file = midiFile({ division: 0 }, melodyTrack([60], 480))
    expect(parseErr(file)).toMatch(/division of 0/)
  })

  it('rejects a file that does not start with MThd', () => {
    const file = midiFile({}, melodyTrack([60], 480))
    file[0] = 0x52 // 'R', as in a RIFF-wrapped RMID file
    expect(parseErr(file)).toMatch(/does not start with an MThd chunk/)
  })

  it('rejects a file shorter than a bare header', () => {
    expect(parseErr(Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6]))).toMatch(
      /fewer than 14 bytes/,
    )
  })

  it('rejects an MThd chunk that is too short to hold the header fields', () => {
    const file = Uint8Array.from([...chunk(MTHD, [0, 1, 0, 1]), ...melodyTrack([60], 480)])
    expect(parseErr(file)).toMatch(/MThd chunk is only 4 bytes/)
  })

  it('rejects a header whose declared length runs off the end of the file', () => {
    const file = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 100, 0, 1, 0, 1, 1, 0xe0])
    expect(parseErr(file)).toMatch(/MThd chunk is incomplete/)
  })

  it('skips extra bytes in an over-long MThd chunk', () => {
    const header = chunk(MTHD, [0, 1, 0, 1, 1, 0xe0, 0xaa, 0xbb])
    const file = Uint8Array.from([...header, ...melodyTrack([60], 480)])
    expect(parseOk(file).notes).toHaveLength(1)
  })

  it('rejects a file with no MTrk chunks', () => {
    const file = Uint8Array.from([
      ...headerChunk(1, 0, 480),
      ...chunk([0x58, 0x46, 0x49, 0x52], [1]),
    ])
    expect(parseErr(file)).toMatch(/no MTrk chunks/)
  })

  it('skips unknown chunk types instead of desyncing on them', () => {
    const file = Uint8Array.from([
      ...headerChunk(1, 1, 480),
      ...chunk([0x58, 0x46, 0x49, 0x52], [1, 2, 3, 4, 5]),
      ...melodyTrack([60], 480),
    ])
    expect(parseOk(file).notes).toHaveLength(1)
  })

  it('ignores a stale declared track count', () => {
    const header = headerChunk(1, 99, 480)
    const file = Uint8Array.from([...header, ...melodyTrack([60], 480)])
    expect(parseOk(file).notes).toHaveLength(1)
  })
})

describe('parseMidiFile — truncation', () => {
  it('rejects a chunk that claims more bytes than the file holds', () => {
    const file = midiFile({}, melodyTrack([60, 62], 480))
    expect(parseErr(file.slice(0, file.length - 4))).toMatch(/claims more bytes/)
  })

  it('rejects a partial chunk header after the last chunk', () => {
    const file = midiFile({}, melodyTrack([60], 480))
    expect(parseErr(Uint8Array.from([...file, 0x4d, 0x54]))).toMatch(/partial chunk header/)
  })

  it('rejects an event cut short at the end of the file', () => {
    // A note-on missing its velocity byte, with the chunk length to match.
    const file = Uint8Array.from([...headerChunk(1, 1, 480), ...rawTrackChunk([0x00, 0x90, 0x3c])])
    expect(parseErr(file)).toMatch(/ran out of bytes/)
  })

  it('rejects a meta event whose declared length runs off the end', () => {
    const file = Uint8Array.from([
      ...headerChunk(1, 1, 480),
      ...rawTrackChunk([0x00, 0xff, 0x03, 0x20, 0x41]),
    ])
    expect(parseErr(file)).toMatch(/ran out of bytes/)
  })

  it('rejects a variable-length quantity longer than four bytes', () => {
    const body = [0x80, 0x80, 0x80, 0x80, 0x00, 0x90, 0x3c, 0x40]
    const file = Uint8Array.from([...headerChunk(1, 1, 480), ...rawTrackChunk(body)])
    expect(parseErr(file)).toMatch(/longer than four bytes/)
  })

  it('rejects a delta time cut short at the end of the file', () => {
    // 0x81 promises another byte of the quantity that the file never delivers.
    const file = Uint8Array.from([...headerChunk(1, 1, 480), ...rawTrackChunk([0x81])])
    expect(parseErr(file)).toMatch(/ran out of bytes/)
  })
})

// ------------------------------------------------------- variable-length times

/** Boundary values of the 7-bits-per-byte encoding, with their canonical bytes. */
const VLQ_CASES: readonly [number, number[]][] = [
  [0x00, [0x00]],
  [0x7f, [0x7f]],
  [0x80, [0x81, 0x00]],
  [0x3fff, [0xff, 0x7f]],
  [0x4000, [0x81, 0x80, 0x00]],
  [0x200000, [0x81, 0x80, 0x80, 0x00]],
]

describe('parseMidiFile — variable-length quantities', () => {
  it.each(VLQ_CASES)('reads a delta of %i, encoded as the canonical bytes', (delta, encoded) => {
    expect(vlq(delta)).toEqual(encoded)
    const file = midiFile({}, trackChunk([noteOn(delta, 60), noteOff(240, 60)]))
    const notes = parseOk(file).notes
    expect(at(notes, 0).startTick).toBe(delta)
    expect(at(notes, 0).durationTicks).toBe(240)
  })

  it('reads any delta back exactly (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (delta) => {
        const file = midiFile({}, trackChunk([noteOn(delta, 60), noteOff(120, 60)]))
        expect(at(parseOk(file).notes, 0).startTick).toBe(delta)
      }),
    )
  })

  it('rejects a file whose ticks span more bars than are worth importing', () => {
    const file = midiFile({}, trackChunk([noteOn(0x0fffffff, 60), noteOff(240, 60)]))
    expect(parseErr(file)).toMatch(/tick limit/)
  })
})

// ------------------------------------------------------------- channel events

describe('parseMidiFile — note events', () => {
  it('pairs note-on with note-off', () => {
    const file = midiFile({}, trackChunk([noteOn(0, 60, 100), noteOff(720, 60)]))
    const note = at(parseOk(file).notes, 0)
    expect([note.midi, note.startTick, note.durationTicks, note.velocity]).toEqual([
      60, 0, 720, 100,
    ])
  })

  it('treats a note-on with velocity 0 as a note-off', () => {
    const file = midiFile(
      {},
      trackChunk([noteOn(0, 60, 64), noteOn(480, 60, 0), noteOn(0, 62, 64), noteOff(480, 62)]),
    )
    expect(tuples(parseOk(file))).toEqual([
      [60, 0, 480],
      [62, 480, 480],
    ])
  })

  it('carries running status across events, including velocity-0 note-offs', () => {
    // One 0x90 status byte, then bare data pairs: on 60, on 62, off 60, off 62.
    const file = midiFile(
      {},
      trackChunk([noteOn(0, 60, 80), [0, 62, 80], [480, 60, 0], [0, 62, 0]]),
    )
    expect(tuples(parseOk(file))).toEqual([
      [60, 0, 480],
      [62, 0, 480],
    ])
  })

  it('rejects running status before any status byte has been seen', () => {
    const file = Uint8Array.from([...headerChunk(1, 1, 480), ...rawTrackChunk([0x00, 0x40, 0x40])])
    expect(parseErr(file)).toMatch(/running status used before any status byte/)
  })

  it('clears running status after a meta event', () => {
    const file = Uint8Array.from([
      ...headerChunk(1, 1, 480),
      ...rawTrackChunk([0x00, 0x90, 0x3c, 0x40, 0x00, 0xff, 0x01, 0x00, 0x00, 0x3c, 0x00]),
    ])
    expect(parseErr(file)).toMatch(/running status used before any status byte/)
  })

  it('keeps notes on different channels apart', () => {
    const file = midiFile(
      {},
      trackChunk([
        noteOn(0, 60, 64, 0),
        noteOn(0, 60, 64, 3),
        noteOff(480, 60, 0),
        noteOff(480, 60, 3),
      ]),
    )
    expect(tuples(parseOk(file))).toEqual([
      [60, 0, 480],
      [60, 0, 960],
    ])
  })

  it('matches repeated note-ons of the same pitch first-in-first-out', () => {
    const file = midiFile(
      {},
      trackChunk([noteOn(0, 60), noteOn(240, 60), noteOff(240, 60), noteOff(240, 60)]),
    )
    expect(tuples(parseOk(file))).toEqual([
      [60, 0, 480],
      [60, 240, 480],
    ])
  })

  it('ignores a note-off that closes nothing', () => {
    const file = midiFile({}, trackChunk([noteOff(0, 60), noteOn(480, 62), noteOff(480, 62)]))
    expect(tuples(parseOk(file))).toEqual([[62, 480, 480]])
  })

  it('clamps a note-on that is never released to the end of its track', () => {
    const file = midiFile({}, trackChunk([noteOn(0, 60)], { endDelta: 1440 }))
    expect(tuples(parseOk(file))).toEqual([[60, 0, 1440]])
  })

  it('ends a track that has no end-of-track meta at its last event', () => {
    const file = midiFile({}, trackChunk([noteOn(0, 60), noteOff(960, 60)], { eot: false }))
    expect(tuples(parseOk(file))).toEqual([[60, 0, 960]])
  })

  it('stops reading a track at end-of-track and ignores trailing junk', () => {
    const body = [
      ...vlq(0),
      0x90,
      0x3c,
      0x40,
      ...vlq(480),
      0x80,
      0x3c,
      0x40,
      ...vlq(0),
      0xff,
      0x2f,
      0x00,
      0x00,
      0x90,
      0x40,
      0x40, // junk after end-of-track
    ]
    const file = Uint8Array.from([...headerChunk(1, 1, 480), ...rawTrackChunk(body)])
    expect(tuples(parseOk(file))).toEqual([[60, 0, 480]])
  })

  it('skips the channel messages it does not care about without desyncing', () => {
    const file = midiFile(
      {},
      trackChunk([
        [0, 0xb0, 0x40, 0x7f], // sustain pedal down (2 data bytes)
        [0, 0xa0, 0x3c, 0x40], // polyphonic aftertouch (2)
        [0, 0xe0, 0x00, 0x40], // pitch bend (2)
        [0, 0xc0, 0x00], // program change (1)
        [0, 0xd0, 0x40], // channel pressure (1)
        noteOn(0, 60),
        noteOff(480, 60),
      ]),
    )
    expect(tuples(parseOk(file))).toEqual([[60, 0, 480]])
  })

  it('skips SysEx, escaped SysEx and system-common messages', () => {
    const file = midiFile(
      {},
      trackChunk([
        [0, 0xf0, ...vlq(3), 0x7e, 0x7f, 0xf7],
        [0, 0xf7, ...vlq(2), 0x01, 0x02],
        [0, 0xf3, 0x05], // song select: one data byte
        [0, 0xf8], // timing clock: none
        noteOn(0, 60),
        noteOff(480, 60),
      ]),
    )
    expect(tuples(parseOk(file))).toEqual([[60, 0, 480]])
  })

  it('skips unknown meta events, whose length prefix keeps the stream aligned', () => {
    const file = midiFile(
      {},
      trackChunk([
        meta(0, 0x7f, [0x01, 0x02, 0x03]), // sequencer specific
        meta(0, 0x02, [0x28, 0x63, 0x29]), // copyright "(c)"
        meta(0, 0x05, [0x6c, 0x61]), // lyric
        noteOn(0, 60),
        noteOff(480, 60),
      ]),
    )
    expect(tuples(parseOk(file))).toEqual([[60, 0, 480]])
  })
})

// -------------------------------------------------------------- meta → score

describe('parseMidiFile — meta events', () => {
  it('converts a set-tempo event to bpm', () => {
    // 500000 µs per quarter note = 120 bpm; 1000000 = 60 bpm.
    const file = midiFile(
      {},
      trackChunk([tempoMeta(0, 500_000), tempoMeta(1920, 1_000_000)]),
      melodyTrack([60, 62, 64, 65, 67], 480),
    )
    expect(parseOk(file).tempos.map((t) => [t.tick, t.bpm])).toEqual([
      [0, 120],
      [1920, 60],
    ])
  })

  it('defaults to 120 bpm when the file carries no tempo', () => {
    const file = midiFile({}, melodyTrack([60], 480))
    expect(parseOk(file).tempos).toEqual([{ tick: 0, bpm: 120 }])
  })

  it('adds a tick-0 tempo when the first tempo change arrives later', () => {
    const file = midiFile(
      {},
      trackChunk([tempoMeta(1920, 1_000_000)]),
      melodyTrack([60, 62, 64, 65, 67], 480),
    )
    expect(parseOk(file).tempos.map((t) => t.tick)).toEqual([0, 1920])
  })

  it('ignores a set-tempo event of zero microseconds and a malformed one', () => {
    const file = midiFile(
      {},
      trackChunk([tempoMeta(0, 0), meta(0, 0x51, [0x01, 0x02])]),
      melodyTrack([60], 480),
    )
    expect(parseOk(file).tempos).toEqual([{ tick: 0, bpm: 120 }])
  })

  it('keeps only the first of two tempo marks at the same tick', () => {
    const file = midiFile(
      {},
      trackChunk([tempoMeta(0, 500_000), tempoMeta(0, 1_000_000)]),
      melodyTrack([60], 480),
    )
    expect(parseOk(file).tempos).toEqual([{ tick: 0, bpm: 120 }])
  })

  it('derives 3/4 bars from a time-signature event', () => {
    const file = midiFile(
      {},
      trackChunk([timeSigMeta(0, 3, 2)]),
      melodyTrack([60, 62, 64, 65, 67, 69], 480),
    )
    const score = parseOk(file)
    expect(score.measures.map((m) => [m.timeSignature.beats, m.timeSignature.beatType])).toEqual([
      [3, 4],
      [3, 4],
    ])
    expect(score.measures.map((m) => m.durationTicks)).toEqual([1440, 1440])
  })

  it('derives 6/8 bars, where the denominator is 2^3', () => {
    const file = midiFile(
      {},
      trackChunk([timeSigMeta(0, 6, 3)]),
      melodyTrack([60, 62, 64, 65, 67, 69], 240),
    )
    const score = parseOk(file)
    expect(at(score.measures, 0).timeSignature).toEqual({ beats: 6, beatType: 8 })
    expect(at(score.measures, 0).durationTicks).toBe(1440)
  })

  it('defaults to 4/4 when no time signature is given', () => {
    const file = midiFile({}, melodyTrack([60, 62, 64, 65], 480))
    const score = parseOk(file)
    expect(at(score.measures, 0).timeSignature).toEqual({ beats: 4, beatType: 4 })
    expect(score.measures).toHaveLength(1)
  })

  it('cuts a bar short when a time signature changes part-way through it', () => {
    const file = midiFile(
      {},
      trackChunk([timeSigMeta(0, 4, 2), timeSigMeta(960, 3, 2)]),
      melodyTrack([60, 62, 64, 65, 67, 69], 480),
    )
    const score = parseOk(file)
    expect(score.measures.map((m) => [m.startTick, m.durationTicks])).toEqual([
      [0, 960],
      [960, 1440],
      [2400, 1440],
    ])
  })

  it('ignores a time signature that cannot be notated', () => {
    const file = midiFile(
      {},
      trackChunk([timeSigMeta(0, 0, 2), timeSigMeta(0, 4, 9), meta(0, 0x58, [4])]),
      melodyTrack([60], 480),
    )
    expect(at(parseOk(file).measures, 0).timeSignature).toEqual({ beats: 4, beatType: 4 })
  })

  it('reads a key signature, including negative (flat) values', () => {
    // sf = -3 is E flat major / C minor; the byte on the wire is 0xFD.
    const file = midiFile({}, trackChunk([keySigMeta(0, -3)]), melodyTrack([60], 480))
    expect(at(parseOk(file).measures, 0).keyFifths).toBe(-3)
  })

  it('applies a mid-piece key change from the bar it lands on', () => {
    const file = midiFile(
      {},
      trackChunk([keySigMeta(0, 2), keySigMeta(1920, -1)]),
      melodyTrack([60, 62, 64, 65, 67, 69, 71, 72], 480),
    )
    expect(parseOk(file).measures.map((m) => m.keyFifths)).toEqual([2, -1])
  })

  it('ignores an out-of-range or malformed key signature', () => {
    const file = midiFile(
      {},
      trackChunk([keySigMeta(0, 9), meta(0, 0x59, [0x01])]),
      melodyTrack([60], 480),
    )
    expect(at(parseOk(file).measures, 0).keyFifths).toBe(0)
  })

  it('takes the score title from the first track-name meta event', () => {
    const file = midiFile(
      {},
      trackChunk([nameMeta(0, 'Minuet in G')]),
      trackChunk([nameMeta(0, 'Piano RH'), noteOn(0, 60), noteOff(480, 60)]),
    )
    const score = parseOk(file)
    expect(score.meta.title).toBe('Minuet in G')
    expect(score.meta.source).toBe('midi')
  })

  it('leaves the title empty when the file has no track name', () => {
    expect(parseOk(midiFile({}, melodyTrack([60], 480))).meta.title).toBe('')
  })

  it('uses the supplied id, or a stable default', () => {
    const file = midiFile({}, melodyTrack([60], 480))
    expect(parseOk(file).id).toBe('midi-import')
    expect(unwrap(parseMidiFile(file, { id: 'user-import-7' })).id).toBe('user-import-7')
  })
})

// ------------------------------------------------------------------ rescaling

describe('parseMidiFile — division rescaling', () => {
  /** The same two bars of quarter notes, written at three resolutions. */
  const twoBars = (division: number): Uint8Array =>
    midiFile(
      { division },
      trackChunk([timeSigMeta(0, 4, 2), tempoMeta(0, 500_000)]),
      melodyTrack([60, 62, 64, 65, 67, 69, 71, 72], division),
    )

  it('gives the same music at 96, 480 and 960 ticks per quarter note', () => {
    const expected = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => [midi, i * 480, 480])
    for (const division of [96, 480, 960]) {
      expect(tuples(parseOk(twoBars(division)))).toEqual(expected)
    }
    for (const division of [96, 480, 960]) {
      expect(parseOk(twoBars(division)).measures).toHaveLength(2)
    }
  })

  it('rescales any division to a 480-tick quarter note (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(24, 96, 120, 192, 240, 384, 480, 960), (division) => {
        expect(tuples(parseOk(twoBars(division)))).toEqual(tuples(parseOk(twoBars(480))))
      }),
    )
  })

  it('rounds a tick that does not divide evenly', () => {
    // At 96 ticks per quarter, one tick is 5 ticks at 480; 7 ticks → 35.
    const file = midiFile({ division: 96 }, trackChunk([noteOn(7, 60), noteOff(96, 60)]))
    expect(tuples(parseOk(file))).toEqual([[60, 35, 480]])
  })
})

// ---------------------------------------------------------------------- hands

describe('parseMidiFile — hand assignment', () => {
  it('gives the higher-average track to the right hand when exactly two carry notes', () => {
    const file = midiFile(
      {},
      trackChunk([nameMeta(0, 'Conductor')]),
      melodyTrack([72, 74, 76, 77], 480),
      melodyTrack([48, 50, 52, 53], 480, 1),
    )
    const score = parseOk(file)
    expect(score.notes.filter((n) => n.hand === 'right').map((n) => n.midi)).toEqual([
      72, 74, 76, 77,
    ])
    expect(score.notes.filter((n) => n.hand === 'left').map((n) => n.midi)).toEqual([
      48, 50, 52, 53,
    ])
  })

  it('uses average pitch, not track order — a low first track becomes the left hand', () => {
    const file = midiFile({}, melodyTrack([48, 50], 480), melodyTrack([72, 74], 480, 1))
    const score = parseOk(file)
    expect(score.notes.filter((n) => n.hand === 'right').map((n) => n.midi)).toEqual([72, 74])
    expect(score.notes.filter((n) => n.hand === 'left').map((n) => n.midi)).toEqual([48, 50])
  })

  it('gives a tie in average pitch to the earlier track', () => {
    const file = midiFile({}, melodyTrack([60, 64], 480), melodyTrack([62, 62], 480, 1))
    const score = parseOk(file)
    // Both average 62, so the first note-carrying track is taken as the right hand.
    expect(score.notes.filter((n) => n.hand === 'right').map((n) => n.midi)).toEqual([60, 64])
  })

  it('splits a single track at middle C', () => {
    const file = midiFile(
      { format: 0 },
      trackChunk([
        noteOn(0, 72),
        noteOn(0, 60), // middle C itself belongs to the right hand
        noteOn(0, 59),
        noteOn(0, 48),
        noteOff(480, 72),
        noteOff(0, 60),
        noteOff(0, 59),
        noteOff(0, 48),
      ]),
    )
    const score = parseOk(file)
    expect(score.notes.filter((n) => n.hand === 'right').map((n) => n.midi)).toEqual([60, 72])
    expect(score.notes.filter((n) => n.hand === 'left').map((n) => n.midi)).toEqual([48, 59])
  })

  it('splits at middle C when three or more tracks carry notes', () => {
    const file = midiFile(
      {},
      melodyTrack([72], 480),
      melodyTrack([64], 480, 1),
      melodyTrack([40], 480, 2),
    )
    const score = parseOk(file)
    expect(score.notes.map((n) => [n.midi, n.hand])).toEqual([
      [40, 'left'],
      [64, 'right'],
      [72, 'right'],
    ])
  })

  it('puts the right hand on staff 1 and the left on staff 2', () => {
    const file = midiFile({}, melodyTrack([72], 480), melodyTrack([48], 480, 1))
    expect(parseOk(file).staves).toEqual([
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ])
  })
})

// ----------------------------------------------------------- ties and measures

describe('parseMidiFile — barlines', () => {
  it('splits a note that crosses a barline into tied fragments', () => {
    // A note held for six beats in 4/4: four beats in bar 1, two in bar 2.
    const file = midiFile({}, trackChunk([noteOn(0, 60), noteOff(2880, 60)]))
    const notes = parseOk(file).notes
    expect(notes.map((n) => [n.startTick, n.durationTicks, n.tiedTo, n.tiedFrom])).toEqual([
      [0, 1920, true, false],
      [1920, 960, false, true],
    ])
  })

  it('splits a note that crosses several barlines', () => {
    const file = midiFile({}, trackChunk([noteOn(0, 60), noteOff(1920 * 3, 60)]))
    const notes = parseOk(file).notes
    expect(notes.map((n) => n.startTick)).toEqual([0, 1920, 3840])
    expect(notes.map((n) => n.durationTicks)).toEqual([1920, 1920, 1920])
    expect(notes.map((n) => n.measureIndex)).toEqual([0, 1, 2])
  })

  it('does not split a note that stops exactly on the barline', () => {
    const file = midiFile({}, trackChunk([noteOn(0, 60), noteOff(1920, 60)]))
    expect(tuples(parseOk(file))).toEqual([[60, 0, 1920]])
  })

  it('keeps a zero-length note inside a bar of its own', () => {
    const file = midiFile({}, trackChunk([noteOn(0, 60), noteOff(0, 60)]))
    const score = parseOk(file)
    expect(tuples(score)).toEqual([[60, 0, 0]])
    expect(score.measures).toHaveLength(1)
  })

  it('produces one empty bar for a file with no notes at all', () => {
    const score = parseOk(midiFile({}, trackChunk([nameMeta(0, 'Empty')])))
    expect(score.notes).toHaveLength(0)
    expect(score.measures.map((m) => m.durationTicks)).toEqual([1920])
  })

  it('extends the bars to cover a long tail of silence before end-of-track', () => {
    const file = midiFile({}, trackChunk([noteOn(0, 60), noteOff(480, 60)], { endDelta: 1920 * 3 }))
    expect(parseOk(file).measures).toHaveLength(4)
  })
})

// ----------------------------------------------------------- resource limits

describe('parseMidiFile — resource limits', () => {
  /** `count` bars of 1/128, the shortest notatable metre: 15 ticks each. */
  const shortestBars = (count: number): Uint8Array =>
    midiFile(
      {},
      trackChunk([timeSigMeta(0, 1, 7), noteOn(0, 60), noteOff(15, 60)], {
        endDelta: count * 15 - 15,
      }),
    )

  it('refuses a tiny file that asks for more than ten thousand measures', () => {
    // One 1/128 meta (a 15-tick bar) plus one note held 19,000,000 ticks: inside
    // MAX_MUSIC_TICKS, yet 1,266,667 measures and as many tied fragments — a
    // few dozen bytes that took ~2 s and hundreds of MB on the main thread.
    const file = midiFile(
      {},
      trackChunk([timeSigMeta(0, 1, 7), noteOn(0, 60), noteOff(19_000_000, 60)]),
    )
    expect(file.length).toBeLessThan(64)
    expect(parseErr(file)).toMatch(/more than 10000 measures/)
  })

  it('accepts exactly the measure limit and refuses one bar more', () => {
    expect(parseOk(shortestBars(10_000)).measures).toHaveLength(10_000)
    expect(parseErr(shortestBars(10_001))).toMatch(/more than 10000 measures/)
  })

  it('returns an error instead of throwing when the score model refuses the result', () => {
    // An empty id is the one input that reaches makeScore's invariants. The doc
    // promises a Score or an error, so the invariant must not escape.
    const file = midiFile({}, melodyTrack([60], 480))
    const result = parseMidiFile(file, { id: '' })
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(
      /could not build a score: .*score id must not be empty/,
    )
  })
})

// ---------------------------------------------------------------- real music

describe('parseMidiFile — named pieces', () => {
  it('reads the opening of the Ode to Joy', () => {
    // Beethoven, Ninth Symphony, in C: E E F G | G F E D, all quarter notes.
    // MIDI: 64 64 65 67 | 67 65 64 62, onsets every 480 ticks over two 4/4 bars.
    const file = midiFile(
      {},
      trackChunk([nameMeta(0, 'Ode to Joy'), timeSigMeta(0, 4, 2), tempoMeta(0, 500_000)]),
      melodyTrack([64, 64, 65, 67, 67, 65, 64, 62], 480),
    )
    const score = parseOk(file)
    expect(score.meta.title).toBe('Ode to Joy')
    expect(score.notes.map((n) => n.midi)).toEqual([64, 64, 65, 67, 67, 65, 64, 62])
    expect(score.notes.map((n) => n.startTick)).toEqual([0, 480, 960, 1440, 1920, 2400, 2880, 3360])
    expect(score.measures).toHaveLength(2)
    expect(at(score.tempos, 0).bpm).toBe(120)
  })

  it('reads a two-hand Twinkle, Twinkle with the hands separated', () => {
    // RH melody C C G G A A G (60 60 67 67 69 69 67, the last held two beats),
    // LH root C3 (48) as a whole note in each of the two 4/4 bars.
    const rh = trackChunk([
      ...[60, 60, 67, 67].flatMap((p) => [noteOn(0, p), noteOff(480, p)]),
      ...[69, 69].flatMap((p) => [noteOn(0, p), noteOff(480, p)]),
      noteOn(0, 67),
      noteOff(960, 67),
    ])
    const lh = trackChunk([
      noteOn(0, 48, 64, 1),
      noteOff(1920, 48, 1),
      noteOn(0, 48, 64, 1),
      noteOff(1920, 48, 1),
    ])
    const score = parseOk(midiFile({}, rh, lh))
    expect(score.notes.filter((n) => n.hand === 'right').map((n) => n.midi)).toEqual([
      60, 60, 67, 67, 69, 69, 67,
    ])
    expect(
      score.notes
        .filter((n) => n.hand === 'left')
        .map((n) => [n.midi, n.startTick, n.durationTicks]),
    ).toEqual([
      [48, 0, 1920],
      [48, 1920, 1920],
    ])
    expect(score.measures).toHaveLength(2)
  })

  it('reads a C major triad as three simultaneous notes', () => {
    // C4 E4 G4 = 60 64 67, struck together and held for a whole bar.
    const file = midiFile(
      {},
      trackChunk([
        noteOn(0, 60),
        noteOn(0, 64),
        noteOn(0, 67),
        noteOff(1920, 60),
        noteOff(0, 64),
        noteOff(0, 67),
      ]),
    )
    expect(tuples(parseOk(file))).toEqual([
      [60, 0, 1920],
      [64, 0, 1920],
      [67, 0, 1920],
    ])
  })
})

// -------------------------------------------------------------------- writing

const ROUND_TRIP_FIXTURES: readonly [string, Score][] = [
  ['SINGLE_NOTE', SINGLE_NOTE],
  ['C_MAJOR_SCALE_RH', C_MAJOR_SCALE_RH],
  ['TWO_HAND_CHORDS', TWO_HAND_CHORDS],
  ['TIED_NOTES', TIED_NOTES],
  ['PICKUP_MEASURE', PICKUP_MEASURE],
  ['SIX_EIGHT', SIX_EIGHT],
  ['TEMPO_CHANGE', TEMPO_CHANGE],
]

const grid = (score: Score): [number, number][] =>
  score.measures.map((m): [number, number] => [m.startTick, m.durationTicks])

describe('writeMidiFile', () => {
  it('writes a format 1 header at 480 ticks per quarter note', () => {
    const bytes = writeMidiFile(C_MAJOR_SCALE_RH)
    expect([...bytes.slice(0, 4)]).toEqual([0x4d, 0x54, 0x68, 0x64])
    expect([...bytes.slice(4, 8)]).toEqual([0, 0, 0, 6])
    expect([...bytes.slice(8, 10)]).toEqual([0, 1]) // format 1
    expect([...bytes.slice(10, 12)]).toEqual([0, 2]) // conductor + right hand
    expect([...bytes.slice(12, 14)]).toEqual([0x01, 0xe0]) // 480
    expect([...bytes.slice(14, 18)]).toEqual([0x4d, 0x54, 0x72, 0x6b])
  })

  it('writes one track per hand that has notes', () => {
    expect([...writeMidiFile(TWO_HAND_CHORDS).slice(10, 12)]).toEqual([0, 3])
    expect([...writeMidiFile(SINGLE_NOTE).slice(10, 12)]).toEqual([0, 2])
  })

  it('writes only the conductor track for a score with no notes', () => {
    const empty = makeScore({ id: 'empty', measures: [{}], notes: [] })
    const bytes = writeMidiFile(empty)
    expect([...bytes.slice(10, 12)]).toEqual([0, 1])
    expect(parseOk(bytes).notes).toHaveLength(0)
  })

  it.each(ROUND_TRIP_FIXTURES)('round-trips the notes of %s', (_name, score) => {
    expect(tuples(parseOk(writeMidiFile(score)))).toEqual(tuples(score))
  })

  it('round-trips the bars and key signature', () => {
    const parsed = parseOk(writeMidiFile(SIX_EIGHT))
    expect(parsed.measures.map((m) => [m.startTick, m.durationTicks])).toEqual(
      SIX_EIGHT.measures.map((m) => [m.startTick, m.durationTicks]),
    )
    expect(at(parsed.measures, 0).timeSignature).toEqual({ beats: 6, beatType: 8 })
  })

  it('round-trips a pickup bar, which is shorter than its own metre', () => {
    // 3/4 with a one-beat upbeat: 480 | 1440 | 1440. Writing a single 3/4 at
    // tick 0 would lay 1440-tick bars from tick 0 and shift the whole piece.
    const parsed = parseOk(writeMidiFile(PICKUP_MEASURE))
    expect(grid(parsed)).toEqual([
      [0, 480],
      [480, 1440],
      [1920, 1440],
    ])
    expect(grid(parsed)).toEqual(grid(PICKUP_MEASURE))
    expect(at(parsed.measures, 0).timeSignature).toEqual({ beats: 3, beatType: 4 })
  })

  it('keeps the closing dotted half of a pickup score whole, not tied in two', () => {
    // On a grid shifted by the missing pickup, [77, 1920, 1440] comes back as
    // [77, 1920, 960] + [77, 2880, 480].
    const parsed = parseOk(writeMidiFile(PICKUP_MEASURE))
    expect(tuples(parsed).filter(([midi]) => midi === 77)).toEqual([[77, 1920, 1440]])
    expect(parsed.notes.some((n) => n.tiedTo || n.tiedFrom)).toBe(false)
  })

  it('round-trips an incomplete final bar, which has no next barline to cut it', () => {
    const score = makeScore({
      id: 'half-cadence',
      measures: [{}, { durationTicks: 960 }],
      notes: [
        { midi: 60, startTick: 0, durationTicks: 1920, hand: 'right' },
        { midi: 62, startTick: 1920, durationTicks: 960, hand: 'right' },
      ],
    })
    const parsed = parseOk(writeMidiFile(score))
    expect(grid(parsed)).toEqual([
      [0, 1920],
      [1920, 960],
    ])
    expect(tuples(parsed)).toEqual(tuples(score))
  })

  it('writes a bar longer than its metre as the metre it actually fills', () => {
    // A 2400-tick bar labelled 4/4 is five quarter-note beats: written as 5/4,
    // because the reader would otherwise break it at 1920.
    const score = makeScore({
      id: 'extra-beat',
      measures: [{ durationTicks: 2400 }, {}],
      notes: [
        { midi: 60, startTick: 0, durationTicks: 2400, hand: 'right' },
        { midi: 62, startTick: 2400, durationTicks: 1920, hand: 'right' },
      ],
    })
    const parsed = parseOk(writeMidiFile(score))
    expect(grid(parsed)).toEqual([
      [0, 2400],
      [2400, 1920],
    ])
    expect(at(parsed.measures, 0).timeSignature).toEqual({ beats: 5, beatType: 4 })
    expect(tuples(parsed)).toEqual(tuples(score))
  })

  it('re-bars a measure whose length no metre can express, keeping its total length', () => {
    // 2000 ticks is not a whole number of beats of any power-of-two unit, so the
    // reader lays a full 4/4 bar and a 80-tick remainder.
    const score = makeScore({
      id: 'senza-misura',
      measures: [{ durationTicks: 2000 }],
      notes: [{ midi: 60, startTick: 0, durationTicks: 2000, hand: 'right' }],
    })
    const parsed = parseOk(writeMidiFile(score))
    expect(grid(parsed)).toEqual([
      [0, 1920],
      [1920, 80],
    ])
    expect(parsed.notes.map((n) => [n.startTick, n.durationTicks, n.tiedTo])).toEqual([
      [0, 1920, true],
      [1920, 80, false],
    ])
  })

  it('refuses a metre whose beat type is not a power of two', () => {
    // The score model rejects 4/3 too, but a hand-assembled Score must not be
    // quietly published as 4/4 — which is what rounding the exponent did.
    const score = makeScore({ id: 'four-three', measures: [{ durationTicks: 2560 }], notes: [] })
    const bent: Score = {
      ...score,
      measures: score.measures.map((m) => ({ ...m, timeSignature: { beats: 4, beatType: 3 } })),
    }
    expect(() => writeMidiFile(bent)).toThrow(/beat type 3/)
  })

  it('clamps a tempo too slow for the three-byte microsecond field', () => {
    // 60_000_000 / 3 = 20_000_000 µs does not fit in 0xFFFFFF, and truncating
    // the high bits read 3 bpm back as 18.617.
    const slowest = 60_000_000 / 0xffffff
    const score = makeScore({
      id: 'grave',
      measures: [{}],
      notes: [],
      tempos: [{ tick: 0, bpm: 3 }],
    })
    expect(at(parseOk(writeMidiFile(score)).tempos, 0).bpm).toBeCloseTo(slowest, 6)
  })

  it('leaves a tempo just inside the three-byte field alone', () => {
    const score = makeScore({
      id: 'largo',
      measures: [{}],
      notes: [],
      tempos: [{ tick: 0, bpm: 3.6 }],
    })
    expect(at(parseOk(writeMidiFile(score)).tempos, 0).bpm).toBeCloseTo(3.6, 5)
  })

  it('round-trips a key signature of five flats', () => {
    const score = makeScore({
      id: 'db-major',
      measures: [{ keyFifths: -5 }, { keyFifths: -5 }],
      notes: [{ midi: 61, startTick: 0, durationTicks: 480, hand: 'right' }],
    })
    expect(parseOk(writeMidiFile(score)).measures.map((m) => m.keyFifths)).toEqual([-5, -5])
  })

  it('round-trips tempo marks to within rounding of the microsecond encoding', () => {
    const parsed = parseOk(writeMidiFile(TEMPO_CHANGE))
    expect(parsed.tempos.map((t) => t.tick)).toEqual([0, 1920])
    expect(at(parsed.tempos, 0).bpm).toBe(120)
    expect(at(parsed.tempos, 1).bpm).toBeCloseTo(72, 3)
  })

  it('round-trips the title', () => {
    expect(parseOk(writeMidiFile(C_MAJOR_SCALE_RH)).meta.title).toBe('C Major Scale (RH)')
  })

  it('replaces title characters that the 8-bit text encoding cannot hold', () => {
    // SMF text meta events are 8-bit, so 'É' (U+00C9) survives and '変' does not.
    const score = makeScore({ id: 'etude', meta: { title: 'Étude 変' }, measures: [{}], notes: [] })
    expect(parseOk(writeMidiFile(score)).meta.title).toBe('Étude ?')
  })

  it('raises velocity 0 to 1, because a velocity-0 note-on is a note-off', () => {
    const score = makeScore({
      id: 'silent',
      measures: [{}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 480, hand: 'right', velocity: 0 }],
    })
    const parsed = parseOk(writeMidiFile(score))
    expect(parsed.notes).toHaveLength(1)
    expect(at(parsed.notes, 0).velocity).toBe(1)
  })

  it('gives a zero-length note one tick, because SMF cannot express one', () => {
    const score = makeScore({
      id: 'grace',
      measures: [{}],
      notes: [{ midi: 60, startTick: 0, durationTicks: 0, hand: 'right' }],
    })
    expect(tuples(parseOk(writeMidiFile(score)))).toEqual([[60, 0, 1]])
  })

  it('preserves velocity', () => {
    const score = makeScore({
      id: 'dynamics',
      measures: [{}],
      notes: [
        { midi: 60, startTick: 0, durationTicks: 480, hand: 'right', velocity: 127 },
        { midi: 62, startTick: 480, durationTicks: 480, hand: 'right', velocity: 33 },
      ],
    })
    expect(parseOk(writeMidiFile(score)).notes.map((n) => n.velocity)).toEqual([127, 33])
  })

  it('writes note-offs before note-ons at the same tick, so repeats stay separate', () => {
    const score = makeScore({
      id: 'repeated',
      measures: [{}],
      notes: [
        { midi: 60, startTick: 0, durationTicks: 480, hand: 'right' },
        { midi: 60, startTick: 480, durationTicks: 480, hand: 'right' },
      ],
    })
    expect(tuples(parseOk(writeMidiFile(score)))).toEqual([
      [60, 0, 480],
      [60, 480, 480],
    ])
  })

  it('refuses a numerator SMF cannot hold, rather than wrapping it to a different metre', () => {
    // The numerator is one byte. MusicXML's additive form — <beats>200+200</beats>
    // — parses to a perfectly valid 400/4 Score, and `400 & 0xff` is 144: the one
    // 192,000-tick bar was published as 144/4 and read back as three 69,120-tick
    // bars. Same failure class the beat-type guard closed, so it fails the same way.
    const score = makeScore({
      id: 'four-hundred-four',
      measures: [{ timeSignature: { beats: 400, beatType: 4 } }],
      notes: [],
    })
    expect(() => writeMidiFile(score)).toThrow(/400 beats/)
  })

  it('writes the largest numerator the one-byte field holds', () => {
    const score = makeScore({
      id: 'two-fifty-five-four',
      measures: [{ timeSignature: { beats: 255, beatType: 4 } }],
      notes: [],
    })
    const parsed = parseOk(writeMidiFile(score))
    expect(at(parsed.measures, 0).timeSignature).toEqual({ beats: 255, beatType: 4 })
    expect(grid(parsed)).toEqual([[0, 255 * 480]])
  })

  it('clamps a tempo so fast that the microsecond field would round down to zero', () => {
    // The other end of the three-byte set-tempo field: above ~120,000,000 bpm a
    // quarter note is under half a microsecond, so the rounded value is 0 — and a
    // set-tempo of 0 is dropped by the reader, taking the whole mark with it and
    // leaving the score at the 120 bpm default. One microsecond is the floor.
    const score = makeScore({
      id: 'prestissimo',
      measures: [{}],
      notes: [],
      tempos: [{ tick: 0, bpm: 240_000_000 }],
    })
    expect(at(parseOk(writeMidiFile(score)).tempos, 0).bpm).toBe(60_000_000)
  })

  it('is byte-for-byte deterministic', () => {
    expect([...writeMidiFile(TWO_HAND_CHORDS)]).toEqual([...writeMidiFile(TWO_HAND_CHORDS)])
  })
})

// ------------------------------------------------------------------ property

/** A note confined to one bar, with a pitch unique among its bar-mates. */
const noteArb = (min: number, max: number) =>
  fc.record({
    midi: fc.integer({ min, max }),
    startEighths: fc.integer({ min: 0, max: 7 }),
    lengthEighths: fc.integer({ min: 1, max: 8 }),
    velocity: fc.integer({ min: 0, max: 127 }),
  })

const barArb = fc.record({
  right: fc.uniqueArray(noteArb(60, 96), { maxLength: 4, selector: (n) => n.midi }),
  left: fc.uniqueArray(noteArb(21, 59), { maxLength: 4, selector: (n) => n.midi }),
})

const TIME_SIGNATURES: readonly TimeSignature[] = [
  { beats: 4, beatType: 4 },
  { beats: 3, beatType: 4 },
  { beats: 6, beatType: 8 },
  { beats: 2, beatType: 2 },
  { beats: 5, beatType: 8 },
]

const scoreArb = fc
  .record({
    timeSignature: fc.constantFrom(...TIME_SIGNATURES),
    keyFifths: fc.integer({ min: -7, max: 7 }),
    bpm: fc.integer({ min: 30, max: 208 }),
    /** 0 is no upbeat; anything else makes the first bar short. */
    pickupEighths: fc.integer({ min: 0, max: 7 }),
    bars: fc.array(barArb, { minLength: 1, maxLength: 5 }),
  })
  .map(({ timeSignature, keyFifths, bpm, pickupEighths, bars }) => {
    const barTicks = measureDurationTicks(timeSignature)
    // At least one eighth, and at least one eighth short of a full bar.
    const pickupTicks = pickupEighths === 0 ? 0 : Math.min(pickupEighths * 240, barTicks - 240)
    const notes: ScoreNoteInput[] = []
    const measures: MeasureInput[] = []
    let barStart = 0
    bars.forEach((bar, index) => {
      const barLength = index === 0 && pickupTicks > 0 ? pickupTicks : barTicks
      measures.push({
        timeSignature,
        keyFifths,
        ...(barLength === barTicks ? {} : { durationTicks: barLength }),
      })
      for (const [hand, list] of [
        ['right', bar.right],
        ['left', bar.left],
      ] as const) {
        for (const n of list) {
          const offset = Math.min(n.startEighths * 240, barLength - 1)
          notes.push({
            midi: n.midi,
            startTick: barStart + offset,
            durationTicks: Math.min(n.lengthEighths * 240, barLength - offset),
            hand,
            velocity: n.velocity,
          })
        }
      }
      barStart += barLength
    })
    return makeScore({
      id: 'prop',
      meta: { title: 'Property' },
      measures,
      notes,
      tempos: [{ tick: 0, bpm }],
    })
  })

describe('writeMidiFile ∘ parseMidiFile', () => {
  it('round-trips pitch, onset and duration for arbitrary scores', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        expect(tuples(parseOk(writeMidiFile(score)))).toEqual(tuples(score))
      }),
    )
  })

  it('round-trips the bar grid for arbitrary scores', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        const parsed = parseOk(writeMidiFile(score))
        expect(parsed.measures.map((m) => [m.startTick, m.durationTicks, m.keyFifths])).toEqual(
          score.measures.map((m) => [m.startTick, m.durationTicks, m.keyFifths]),
        )
      }),
    )
  })

  it('is idempotent: writing a parsed score reproduces the same bytes', () => {
    fc.assert(
      fc.property(scoreArb, (score) => {
        const once = writeMidiFile(score)
        const twice = writeMidiFile(parseOk(once))
        expect([...twice]).toEqual([...once])
      }),
    )
  })
})
