/**
 * Web MIDI adapter. Implements the core `MidiInput`/`MidiOutput` ports on top
 * of `navigator.requestMIDIAccess`, normalising the wire protocol (running
 * status, velocity-0 note-on, channel, sustain threshold) so the domain only
 * ever sees `MidiEvent`.
 *
 * The `WebMidi` ambient type namespace from `@types/webmidi` is deliberately
 * never referenced by name here — this module exports its own `WebMidi` type,
 * which would shadow the ambient namespace identifier for the whole file.
 * Instead every browser type is derived structurally from `Navigator`.
 */
import type { MidiDevice, MidiEvent, MidiInput, MidiOutput, Unsubscribe } from '@core/ports/midi.ts'
import { millis, midi, type Midi, type Millis } from '@core/shared/units.ts'
import { err, ok, type Result } from '@core/shared/result.ts'

// Structural types derived from `Navigator`, never naming the ambient
// `WebMidi` namespace (see module comment above).
type MidiAccessHandle = Awaited<ReturnType<Navigator['requestMIDIAccess']>>
type InputPortHandle = MidiAccessHandle['inputs'] extends ReadonlyMap<string, infer P> ? P : never
type OutputPortHandle = MidiAccessHandle['outputs'] extends ReadonlyMap<string, infer P> ? P : never
type MidiMessageEventHandle =
  NonNullable<InputPortHandle['onmidimessage']> extends (event: infer E) => void ? E : never

export type WebMidi = { input: MidiInput; output: MidiOutput; dispose(): void }

const NOTE_OFF_STATUS = 0x80
const NOTE_ON_STATUS = 0x90
const CONTROL_CHANGE_STATUS = 0xb0
const SUSTAIN_CONTROLLER = 64
const SUSTAIN_THRESHOLD = 64
const ALL_NOTES_OFF_CONTROLLER = 123
const SYSTEM_REALTIME_START = 0xf8
const SYSTEM_COMMON_START = 0xf0
const STATUS_BIT = 0x80

/** Request Web MIDI access and wrap it as the two domain-facing ports. Never throws. */
export async function createWebMidi(opts?: { sysex?: boolean }): Promise<Result<WebMidi, string>> {
  if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
    return err('Web MIDI API is not available in this browser.')
  }

  let access: MidiAccessHandle
  try {
    access = opts?.sysex
      ? await navigator.requestMIDIAccess({ sysex: true, software: false })
      : await navigator.requestMIDIAccess()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return err(`MIDI access request failed: ${message}`)
  }

  const input = new WebMidiInputAdapter(access)
  const output = new WebMidiOutputAdapter(access)
  input.attachAll()
  access.onstatechange = () => {
    input.refresh()
  }

  return ok({
    input,
    output,
    dispose(): void {
      access.onstatechange = null
      input.detachAll()
    },
  })
}

/** A parsed channel voice message: status byte plus up to two data bytes. */
type ChannelMessage = { readonly statusByte: number; readonly d1: number; readonly d2: number }

/** Program change and channel pressure carry one data byte; everything else we care about carries two. */
function dataByteCount(statusByte: number): number {
  const type = statusByte & 0xf0
  return type === 0xc0 || type === 0xd0 ? 1 : 2
}

/**
 * Walk a raw MIDI byte buffer, expanding running status, and return the
 * channel voice messages it contains. System realtime bytes are skipped in
 * place; a system-common/sysex byte ends parsing of this buffer (sysex framing
 * is not relevant to note/CC traffic and is deliberately not decoded) and
 * clears running status, per the MIDI spec.
 */
function parseChannelMessages(
  data: Uint8Array,
  runningStatus: Map<string, number>,
  portId: string,
): ChannelMessage[] {
  const messages: ChannelMessage[] = []
  let status = runningStatus.get(portId)
  let i = 0
  while (i < data.length) {
    const byte = data[i] ?? 0
    if (byte >= SYSTEM_REALTIME_START) {
      i += 1
      continue
    }
    if (byte >= SYSTEM_COMMON_START) {
      status = undefined
      break
    }
    if (byte >= STATUS_BIT) {
      status = byte
      i += 1
      continue
    }
    if (status === undefined) {
      i += 1
      continue
    }
    const need = dataByteCount(status)
    if (i + need > data.length) break
    const d1 = data[i] ?? 0
    const d2 = need === 2 ? (data[i + 1] ?? 0) : 0
    i += need
    messages.push({ statusByte: status, d1, d2 })
  }
  if (status === undefined) runningStatus.delete(portId)
  else runningStatus.set(portId, status)
  return messages
}

/** Map one normalised channel message to the domain event it represents, if any. */
function toDomainEvent(msg: ChannelMessage, time: Millis): MidiEvent | undefined {
  const type = msg.statusByte & 0xf0
  if (type === NOTE_ON_STATUS) {
    return msg.d2 === 0
      ? { type: 'noteOff', note: midi(msg.d1), time }
      : { type: 'noteOn', note: midi(msg.d1), velocity: msg.d2, time }
  }
  if (type === NOTE_OFF_STATUS) {
    return { type: 'noteOff', note: midi(msg.d1), time }
  }
  if (type === CONTROL_CHANGE_STATUS && msg.d1 === SUSTAIN_CONTROLLER) {
    return { type: 'sustain', down: msg.d2 >= SUSTAIN_THRESHOLD, time }
  }
  return undefined
}

/** Only ports the browser currently reports as connected are visible devices. */
function connectedDevices<
  P extends { id: string; name?: string; manufacturer?: string; state: string },
>(ports: ReadonlyMap<string, P>): MidiDevice[] {
  const devices: MidiDevice[] = []
  for (const port of ports.values()) {
    if (port.state !== 'connected') continue
    devices.push({
      id: port.id,
      name: port.name ?? 'Unknown device',
      manufacturer: port.manufacturer ?? 'Unknown',
    })
  }
  return devices
}

class WebMidiInputAdapter implements MidiInput {
  private readonly access: MidiAccessHandle
  private readonly handlers = new Set<(event: MidiEvent) => void>()
  private readonly deviceHandlers = new Set<(devices: readonly MidiDevice[]) => void>()
  private readonly runningStatus = new Map<string, number>()
  private readonly attached = new Set<InputPortHandle>()
  selectedDeviceId: string | null = null

  constructor(access: MidiAccessHandle) {
    this.access = access
  }

  listDevices(): readonly MidiDevice[] {
    return connectedDevices(this.access.inputs)
  }

  onEvent(handler: (event: MidiEvent) => void): Unsubscribe {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  onDevicesChanged(handler: (devices: readonly MidiDevice[]) => void): Unsubscribe {
    this.deviceHandlers.add(handler)
    return () => this.deviceHandlers.delete(handler)
  }

  selectDevice(deviceId: string | null): void {
    this.selectedDeviceId = deviceId
  }

  /** Attach the message handler to every input port we don't already listen to. */
  attachAll(): void {
    for (const port of this.access.inputs.values()) this.attachPort(port)
  }

  /** Re-attach to any newly appeared ports and re-emit the current device list. */
  refresh(): void {
    this.attachAll()
    const devices = this.listDevices()
    for (const handler of this.deviceHandlers) handler(devices)
  }

  /** Detach every handler this adapter installed on the browser's ports. */
  detachAll(): void {
    for (const port of this.attached) port.onmidimessage = null
    this.attached.clear()
    for (const port of this.access.inputs.values()) port.onmidimessage = null
    this.handlers.clear()
    this.deviceHandlers.clear()
  }

  private attachPort(port: InputPortHandle): void {
    if (this.attached.has(port)) return
    port.onmidimessage = (event) => this.handleMessage(port.id, event)
    this.attached.add(port)
  }

  private handleMessage(portId: string, event: MidiMessageEventHandle): void {
    if (portId !== this.selectedDeviceId) return
    const time = millis(event.timeStamp)
    for (const msg of parseChannelMessages(event.data, this.runningStatus, portId)) {
      const domainEvent = toDomainEvent(msg, time)
      if (domainEvent !== undefined) this.emit(domainEvent)
    }
  }

  private emit(event: MidiEvent): void {
    for (const handler of this.handlers) handler(event)
  }
}

class WebMidiOutputAdapter implements MidiOutput {
  private readonly access: MidiAccessHandle
  selectedDeviceId: string | null = null

  constructor(access: MidiAccessHandle) {
    this.access = access
  }

  listDevices(): readonly MidiDevice[] {
    return connectedDevices(this.access.outputs)
  }

  selectDevice(deviceId: string | null): void {
    this.selectedDeviceId = deviceId
  }

  noteOn(note: Midi, velocity: number, atMs?: Millis): void {
    this.send([NOTE_ON_STATUS, note, velocity], atMs)
  }

  noteOff(note: Midi, atMs?: Millis): void {
    this.send([NOTE_OFF_STATUS, note, 0], atMs)
  }

  allNotesOff(): void {
    this.send([CONTROL_CHANGE_STATUS, ALL_NOTES_OFF_CONTROLLER, 0])
  }

  private currentPort(): OutputPortHandle | undefined {
    if (this.selectedDeviceId === null) return undefined
    const port = this.access.outputs.get(this.selectedDeviceId)
    return port !== undefined && port.state === 'connected' ? port : undefined
  }

  /** A device that has vanished or was never selected is a silent no-op, never a throw. */
  private send(data: number[], atMs?: Millis): void {
    const port = this.currentPort()
    if (port === undefined) return
    if (atMs === undefined) port.send(data)
    else port.send(data, atMs)
  }
}
