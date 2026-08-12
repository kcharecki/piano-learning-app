/**
 * BLE-MIDI packet format decoder (roadmap B.2, REQ-3.3.1) — the pure byte-level
 * counterpart to `webmidi.ts`'s USB message normalisation, decoding to this
 * repo's own `MidiEvent` shape so a Bluetooth note reaches the matcher through
 * the exact same domain type a USB note does.
 *
 * ## Wire format
 *
 * A BLE-MIDI GATT notification payload is:
 *
 *   [header byte] [timestamp byte] [status/data bytes...]
 *
 *  - Header byte: bit 7 set (fixed), bit 6 reserved (0), bits 5-0 are
 *    `timestampHigh` — the top 6 bits of a 13-bit millisecond timestamp that
 *    wraps at 8192ms. One header byte starts every packet.
 *  - Timestamp byte: bit 7 set, bits 6-0 are `timestampLow` (7 bits). Combined
 *    with the packet's `timestampHigh` this gives the 13-bit raw timestamp for
 *    one MIDI message.
 *  - MIDI bytes: ordinary channel-voice messages (status + data), with the
 *    normal MIDI running-status rule (a status byte may be omitted when it is
 *    identical to the previous message's).
 *
 * The published spec is genuinely ambiguous about exactly when a timestamp
 * byte must appear relative to a running-status continuation (both a status
 * byte and a timestamp byte set bit 7, so the two are indistinguishable by
 * value alone — only position disambiguates them). This decoder resolves that
 * ambiguity with the one rule that keeps the grammar unambiguous and matches
 * the spec's own worked examples: **a timestamp byte precedes every MIDI
 * message in the packet, including running-status continuations.** So the
 * decoder always alternates "expect a timestamp byte" / "expect a status byte
 * (new) or a data byte (running status)". A `noteOn`/`noteOn`/`noteOn` run
 * struck as a chord therefore looks like `ts,status,d1,d2, ts,d1,d2, ts,d1,d2`
 * — the timestamp bytes are "interleaved" between messages, the status byte
 * is not repeated.
 *
 * ## Timestamp unwrapping
 *
 * The 13-bit timestamp wraps every 8192ms. `createBleMidiDecoder` keeps a
 * running "continuous" millisecond counter and folds each new raw 13-bit
 * value against it with a standard modular-unwrap (the same technique RTP
 * timestamp reassembly uses): a big backward jump is treated as a forward
 * wrap, not as time going backwards. This only resolves correctly when
 * consecutive messages are within about 4096ms of each other, which normal
 * BLE-MIDI traffic (notifications several times a second) always is.
 *
 * ## Split messages
 *
 * The BLE notification MTU can end mid-message (typically after the status
 * byte and first data byte, before the second). `createBleMidiDecoder`
 * returns a decoder object precisely so this state — "waiting on N more data
 * bytes to complete the message that started in the previous packet" — can
 * live between calls to `decode()`. The continuation bytes are the very next
 * bytes of the next packet, straight after ITS header byte; no new timestamp
 * byte precedes them, since they are not a new message.
 */
import type { MidiEvent } from '@core/ports/midi.ts'
import { isValidMidi, midi, millis, type Millis } from '@core/shared/units.ts'

/** Bits of resolution in the wire timestamp; it wraps at 2^13 = 8192ms. */
const TIMESTAMP_BITS = 13
export const BLE_MIDI_TIMESTAMP_WRAP_MS = 1 << TIMESTAMP_BITS

const HEADER_BIT = 0x80
const TIMESTAMP_HIGH_MASK = 0x3f
const TIMESTAMP_LOW_MASK = 0x7f

const NOTE_OFF_STATUS = 0x80
const NOTE_ON_STATUS = 0x90
const CONTROL_CHANGE_STATUS = 0xb0
const SUSTAIN_CONTROLLER = 64
const SUSTAIN_THRESHOLD = 64
const SYSTEM_REALTIME_START = 0xf8
const SYSTEM_COMMON_START = 0xf0

/**
 * How many data bytes follow a given status byte. System real-time messages
 * (0xF8-0xFF) carry none. System-common/sysex bytes (0xF0-0xF7) are not
 * decoded by this module (no note/CC traffic uses them) and are treated as
 * carrying none either, so a stray one cannot desync the byte position of
 * whatever follows.
 */
function dataByteCount(statusByte: number): number {
  if (statusByte >= SYSTEM_REALTIME_START) return 0
  if (statusByte >= SYSTEM_COMMON_START) return 0
  const type = statusByte & 0xf0
  return type === 0xc0 || type === 0xd0 ? 1 : 2
}

/** Map one channel-voice message to the domain event it represents, if any. */
function toDomainEvent(statusByte: number, d1: number, d2: number, time: Millis): MidiEvent | undefined {
  const type = statusByte & 0xf0
  if (type === NOTE_ON_STATUS) {
    if (!isValidMidi(d1)) return undefined
    return d2 === 0
      ? { type: 'noteOff', note: midi(d1), time }
      : { type: 'noteOn', note: midi(d1), velocity: d2, time }
  }
  if (type === NOTE_OFF_STATUS) {
    if (!isValidMidi(d1)) return undefined
    return { type: 'noteOff', note: midi(d1), time }
  }
  if (type === CONTROL_CHANGE_STATUS && d1 === SUSTAIN_CONTROLLER) {
    return { type: 'sustain', down: d2 >= SUSTAIN_THRESHOLD, time }
  }
  return undefined
}

type PendingMessage = {
  readonly statusByte: number
  readonly time: Millis
  readonly need: number
  collected: number[]
}

export type BleMidiDecoder = {
  /**
   * Decode one GATT notification's bytes into zero or more domain events, in
   * order. Carries running status, timestamp-unwrap state and a possible
   * split-message tail across calls — always feed packets to ONE decoder
   * instance, in arrival order.
   */
  decode(packet: Uint8Array): MidiEvent[]
}

/** A fresh decoder: no running status, no unwrap history, nothing pending. */
export function createBleMidiDecoder(): BleMidiDecoder {
  let lastRaw: number | undefined
  let continuousBase: number | undefined
  let runningStatus: number | undefined
  let pending: PendingMessage | undefined

  /** Fold a new raw 13-bit timestamp against the running continuous counter. */
  function unwrap(raw: number): Millis {
    if (lastRaw === undefined || continuousBase === undefined) {
      lastRaw = raw
      continuousBase = raw
      return millis(raw)
    }
    let delta = raw - lastRaw
    const half = BLE_MIDI_TIMESTAMP_WRAP_MS / 2
    if (delta < -half) delta += BLE_MIDI_TIMESTAMP_WRAP_MS
    else if (delta > half) delta -= BLE_MIDI_TIMESTAMP_WRAP_MS
    continuousBase += delta
    lastRaw = raw
    return millis(continuousBase)
  }

  function decode(packet: Uint8Array): MidiEvent[] {
    const events: MidiEvent[] = []
    if (packet.length === 0) return events
    const header = packet[0] ?? 0
    const timestampHigh = header & TIMESTAMP_HIGH_MASK
    let i = 1

    // Resume a message split across the previous packet: its remaining data
    // bytes are the very next bytes here, no timestamp byte precedes them.
    if (pending !== undefined) {
      const current = pending
      while (i < packet.length && current.collected.length < current.need) {
        current.collected.push(packet[i] ?? 0)
        i++
      }
      if (current.collected.length === current.need) {
        const [d1, d2] = current.collected
        const evt = toDomainEvent(current.statusByte, d1 ?? 0, d2 ?? 0, current.time)
        if (evt !== undefined) events.push(evt)
        runningStatus = current.statusByte
        pending = undefined
      } else {
        // The whole rest of this packet continued the same message and it is
        // STILL incomplete — nothing more to parse.
        return events
      }
    }

    while (i < packet.length) {
      const tsByte = packet[i]
      if (tsByte === undefined || (tsByte & HEADER_BIT) === 0) {
        // A byte with no status context in a position a timestamp byte was
        // expected: not well-formed, skip it defensively rather than throw.
        i++
        continue
      }
      const raw = ((timestampHigh << 7) | (tsByte & TIMESTAMP_LOW_MASK)) & (BLE_MIDI_TIMESTAMP_WRAP_MS - 1)
      const time = unwrap(raw)
      i++
      if (i >= packet.length) break // packet ended right after a timestamp byte

      const next = packet[i]
      let statusByte: number
      if (next !== undefined && (next & HEADER_BIT) !== 0) {
        statusByte = next
        i++
      } else if (runningStatus !== undefined) {
        statusByte = runningStatus
      } else {
        i++ // stray data byte with no running status to attach it to
        continue
      }

      const need = dataByteCount(statusByte)
      if (need === 0) {
        const evt = toDomainEvent(statusByte, 0, 0, time)
        if (evt !== undefined) events.push(evt)
        if (statusByte < SYSTEM_REALTIME_START) runningStatus = statusByte
        continue
      }

      const collected: number[] = []
      while (collected.length < need && i < packet.length) {
        collected.push(packet[i] ?? 0)
        i++
      }
      if (collected.length < need) {
        pending = { statusByte, time, need, collected }
        runningStatus = statusByte
        break
      }
      const [d1, d2] = collected
      const evt = toDomainEvent(statusByte, d1 ?? 0, d2 ?? 0, time)
      if (evt !== undefined) events.push(evt)
      runningStatus = statusByte
    }

    return events
  }

  return { decode }
}
