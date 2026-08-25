import type { Midi, Millis } from '../shared/units.ts'

/**
 * MIDI events as the domain sees them: pitch, time, velocity. Everything
 * device-specific (running status, channel juggling, SysEx) is the adapter's
 * problem and never reaches the core.
 */
export type MidiNoteOn = {
  readonly type: 'noteOn'
  readonly note: Midi
  /** 1–127. A note-on with velocity 0 is normalised to a note-off by the adapter. */
  readonly velocity: number
  readonly time: Millis
}

export type MidiNoteOff = {
  readonly type: 'noteOff'
  readonly note: Midi
  readonly time: Millis
}

export type MidiSustain = {
  readonly type: 'sustain'
  readonly down: boolean
  readonly time: Millis
}

/**
 * A control-change message the adapter does not already give its own
 * dedicated event for (sustain/CC64 keeps its `MidiSustain` shape unchanged —
 * see `webmidi.ts`). Added for DR-02: the e-drum hi-hat pedal reports its
 * continuous position on CC#4, which piano input never sent and the adapter
 * used to drop silently.
 */
export type MidiControlChange = {
  readonly type: 'controlChange'
  readonly controller: number
  readonly value: number
  readonly time: Millis
}

/**
 * Polyphonic key/channel pressure (status `0xA0`). Piano input never sends
 * this; the adapter used to drop it silently. DR-02 reads it as a cymbal
 * choke gesture on an e-kit.
 */
export type MidiPolyAftertouch = {
  readonly type: 'polyAftertouch'
  readonly note: Midi
  readonly pressure: number
  readonly time: Millis
}

export type MidiEvent = MidiNoteOn | MidiNoteOff | MidiSustain | MidiControlChange | MidiPolyAftertouch

export type MidiDevice = {
  readonly id: string
  readonly name: string
  readonly manufacturer: string
}

export type Unsubscribe = () => void

/** Input side: the keyboard the learner plays. */
export interface MidiInput {
  listDevices(): readonly MidiDevice[]
  /** Subscribe to note events from the currently selected device. */
  onEvent(handler: (event: MidiEvent) => void): Unsubscribe
  /** Subscribe to device connect/disconnect (hot-plug is common in practice). */
  onDevicesChanged(handler: (devices: readonly MidiDevice[]) => void): Unsubscribe
  selectDevice(deviceId: string | null): void
  readonly selectedDeviceId: string | null
}

/**
 * Output side: preferred sound source per REQ-4.7 — send notes to the digital
 * piano and let the instrument make the sound, avoiding synthesis latency.
 *
 * NOT a domain port. Domain code uses `AudioOutput` and never imports this;
 * this is the interface the MIDI-out implementation of `AudioOutput` is written
 * against, declared here because it describes the same device as `MidiInput`.
 * A domain caller appearing here is a design mistake, not a feature.
 */
export interface MidiOutput {
  listDevices(): readonly MidiDevice[]
  selectDevice(deviceId: string | null): void
  noteOn(note: Midi, velocity: number, atMs?: Millis): void
  noteOff(note: Midi, atMs?: Millis): void
  allNotesOff(): void
  readonly selectedDeviceId: string | null
}
