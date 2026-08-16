/**
 * Round-trip proof for the BLE-MIDI packet decoder: an ENCODER matching the
 * wire format documented in `bleMidiPacket.ts` (timestamp byte before every
 * message, running status when consecutive statuses match, one packet per
 * timestamp-high bucket) is built here, test-only, so packets can be
 * constructed from a list of domain-shaped events and fed back through
 * `createBleMidiDecoder`.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { midi, millis } from '@core/shared/units.ts'
import type { MidiEvent } from '@core/ports/midi.ts'
import { BLE_MIDI_TIMESTAMP_WRAP_MS, createBleMidiDecoder } from './bleMidiPacket.ts'

const HEADER_BIT = 0x80
const TIMESTAMP_HIGH_MASK = 0x3f
const TIMESTAMP_LOW_MASK = 0x7f
const NOTE_OFF_STATUS = 0x80
const NOTE_ON_STATUS = 0x90
const CONTROL_CHANGE_STATUS = 0xb0
const SUSTAIN_CONTROLLER = 64

type RawEvent = { readonly statusByte: number; readonly d1: number; readonly d2: number; readonly trueMs: number }

/**
 * Inverse of `bleMidiPacket.ts`'s `toDomainEvent`, for building test input.
 * This suite only ever generates `noteOn`/`noteOff`/`sustain` fixtures (BLE
 * decoding of DR-02's drum-only `controlChange`/`polyAftertouch` events is
 * untouched by this task and out of scope here) — the throw below is an
 * unreachable-by-construction guard, not a supported path.
 */
function toRaw(event: MidiEvent): { statusByte: number; d1: number; d2: number } {
  if (event.type === 'noteOn') return { statusByte: NOTE_ON_STATUS, d1: event.note, d2: event.velocity }
  if (event.type === 'noteOff') return { statusByte: NOTE_OFF_STATUS, d1: event.note, d2: 0 }
  if (event.type === 'sustain') {
    return { statusByte: CONTROL_CHANGE_STATUS, d1: SUSTAIN_CONTROLLER, d2: event.down ? 127 : 0 }
  }
  throw new Error(`toRaw: this suite never generates ${event.type} fixtures`)
}

/**
 * Encode a list of events (each carrying its own absolute "true" millisecond
 * time, pre-wrap) into one or more BLE-MIDI packets. `splitAfterEventIndex`,
 * if given, breaks that event's two data bytes across a packet boundary —
 * exactly the "message split across two packets" case the real decoder must
 * reassemble via its `pending` state. A new packet always starts when the
 * 13-bit timestamp's high 6 bits change from the current packet's header, so
 * every timestamp byte in a packet is valid against that packet's own header.
 */
function encodeToPackets(events: readonly RawEvent[], splitAfterEventIndex?: number): Uint8Array[] {
  const packets: number[][] = []
  let body: number[] = []
  let high: number | undefined
  let prevStatus: number | undefined

  function flush(): void {
    if (high === undefined) return
    packets.push([HEADER_BIT | high, ...body])
    body = []
    high = undefined
    prevStatus = undefined
  }

  events.forEach((e, idx) => {
    const raw = e.trueMs % BLE_MIDI_TIMESTAMP_WRAP_MS
    const eventHigh = (raw >> 7) & TIMESTAMP_HIGH_MASK
    const low = raw & TIMESTAMP_LOW_MASK
    if (high !== undefined && high !== eventHigh) flush()
    if (high === undefined) high = eventHigh

    body.push(HEADER_BIT | low)
    if (e.statusByte !== prevStatus) {
      body.push(e.statusByte)
      prevStatus = e.statusByte
    }
    const data = [e.d1, e.d2]
    if (idx === splitAfterEventIndex) {
      body.push(data[0] as number)
      flush()
      high = eventHigh
      body.push(data[1] as number)
      prevStatus = e.statusByte
    } else {
      body.push(...data)
    }
  })
  flush()
  return packets.map((p) => Uint8Array.from(p))
}

function decodeAll(packets: readonly Uint8Array[]): MidiEvent[] {
  const decoder = createBleMidiDecoder()
  return packets.flatMap((p) => decoder.decode(p))
}

describe('createBleMidiDecoder — round trip', () => {
  it('decodes a single note-on packet', () => {
    const events: MidiEvent[] = [{ type: 'noteOn', note: midi(60), velocity: 100, time: millis(10) }]
    const raw = events.map((e) => ({ ...toRaw(e), trueMs: e.time }))
    const packets = encodeToPackets(raw)

    expect(decodeAll(packets)).toEqual(events)
  })

  it('decodes a running-status run (chord struck as three note-ons) without repeating the status byte', () => {
    const events: MidiEvent[] = [
      { type: 'noteOn', note: midi(60), velocity: 100, time: millis(5) },
      { type: 'noteOn', note: midi(64), velocity: 90, time: millis(5) },
      { type: 'noteOn', note: midi(67), velocity: 80, time: millis(6) },
    ]
    const raw = events.map((e) => ({ ...toRaw(e), trueMs: e.time }))
    const packets = encodeToPackets(raw)
    // Only ONE status byte for all three note-ons: header(1) + [ts,status,d1,d2](4)
    // + [ts,d1,d2](3) + [ts,d1,d2](3) = 11 bytes, not 13 (which a status byte per
    // message would need).
    expect(packets).toHaveLength(1)
    expect(packets[0]?.length).toBe(11)

    expect(decodeAll(packets)).toEqual(events)
  })

  it('decodes a message split across two packets', () => {
    const events: MidiEvent[] = [
      { type: 'noteOn', note: midi(60), velocity: 100, time: millis(1) },
      { type: 'noteOff', note: midi(60), time: millis(500) },
    ]
    const raw = events.map((e) => ({ ...toRaw(e), trueMs: e.time }))
    const packets = encodeToPackets(raw, 1) // split the noteOff's data bytes
    expect(packets.length).toBeGreaterThanOrEqual(2)

    expect(decodeAll(packets)).toEqual(events)
  })

  it('unwraps the 13-bit timestamp across a wrap boundary', () => {
    const events: MidiEvent[] = [
      { type: 'noteOn', note: midi(60), velocity: 100, time: millis(BLE_MIDI_TIMESTAMP_WRAP_MS - 20) },
      { type: 'noteOff', note: midi(60), time: millis(BLE_MIDI_TIMESTAMP_WRAP_MS + 30) },
    ]
    const raw = events.map((e) => ({ ...toRaw(e), trueMs: e.time }))
    const packets = encodeToPackets(raw)
    expect(packets.length).toBe(2) // high bucket changes, forcing a new packet

    expect(decodeAll(packets)).toEqual(events)
  })

  it('normalises a note-on with velocity 0 to a noteOff, matching webmidi.ts', () => {
    const packet = Uint8Array.from([HEADER_BIT | 0, HEADER_BIT | 0, NOTE_ON_STATUS, 60, 0])
    const decoder = createBleMidiDecoder()

    expect(decoder.decode(packet)).toEqual([{ type: 'noteOff', note: 60, time: 0 }])
  })

  it('reports sustain down/up at the >=64 threshold', () => {
    const events: MidiEvent[] = [
      { type: 'sustain', down: true, time: millis(1) },
      { type: 'sustain', down: false, time: millis(2) },
    ]
    const raw = events.map((e) => ({ ...toRaw(e), trueMs: e.time }))
    const packets = encodeToPackets(raw)

    expect(decodeAll(packets)).toEqual(events)
  })

  it('an empty packet decodes to no events and does not throw', () => {
    const decoder = createBleMidiDecoder()
    expect(() => decoder.decode(new Uint8Array())).not.toThrow()
    expect(decoder.decode(new Uint8Array())).toEqual([])
  })
})

const eventArb: fc.Arbitrary<{ kind: 'on' | 'off' | 'sustain'; note: number; velocity: number; down: boolean }> =
  fc.record({
    kind: fc.constantFrom('on', 'off', 'sustain'),
    note: fc.integer({ min: 0, max: 127 }),
    velocity: fc.integer({ min: 1, max: 127 }),
    down: fc.boolean(),
  })

/** A stream of events with bounded, non-decreasing deltas — see the module doc on unwrap ambiguity. */
const streamArb = fc
  .array(fc.record({ event: eventArb, deltaMs: fc.integer({ min: 0, max: 2000 }) }), {
    minLength: 1,
    maxLength: 10,
  })
  .map((items) => {
    let t = 0
    return items.map(({ event, deltaMs }) => {
      t += deltaMs
      return { event, trueMs: t }
    })
  })

function toDomain(kind: 'on' | 'off' | 'sustain', note: number, velocity: number, down: boolean, trueMs: number): MidiEvent {
  if (kind === 'on') return { type: 'noteOn', note: midi(note), velocity, time: millis(trueMs) }
  if (kind === 'off') return { type: 'noteOff', note: midi(note), time: millis(trueMs) }
  return { type: 'sustain', down, time: millis(trueMs) }
}

describe('createBleMidiDecoder — property: round trip for any well-formed event stream', () => {
  it('reconstructs the same events, in order, with monotonic non-decreasing times', () => {
    fc.assert(
      fc.property(streamArb, fc.option(fc.nat(), { nil: undefined }), (items, splitIdx) => {
        const domainEvents = items.map((i) => toDomain(i.event.kind, i.event.note, i.event.velocity, i.event.down, i.trueMs))
        const raw: RawEvent[] = domainEvents.map((e, idx) => ({ ...toRaw(e), trueMs: items[idx]?.trueMs ?? 0 }))
        const splitAfter =
          splitIdx !== undefined && raw.length > 0 ? splitIdx % raw.length : undefined
        const packets = encodeToPackets(raw, splitAfter)

        const decoded = decodeAll(packets)

        expect(decoded).toEqual(domainEvents)
        for (let i = 1; i < decoded.length; i++) {
          const prev = decoded[i - 1]
          const cur = decoded[i]
          if (prev !== undefined && cur !== undefined) expect(cur.time).toBeGreaterThanOrEqual(prev.time)
        }
      }),
    )
  })
})
