/**
 * Deterministic implementations of every port.
 *
 * These are the reason the test suite has no sleeps, no timers, no flake and no
 * jsdom: time is advanced by hand, randomness is seeded, MIDI events are
 * scripted, and audio calls are recorded for assertion.
 */
import type {
  AudioOutput,
  Clock,
  DateSource,
  MidiDevice,
  MidiEvent,
  MidiInput,
  MidiOutput,
  Rng,
  Scheduler,
  Store,
  Unsubscribe,
} from '@core/ports/index.ts'
import { millis, type Midi, type Millis } from '@core/shared/units.ts'

/** A clock that only moves when the test tells it to. */
export class FakeClock implements Clock, DateSource, Scheduler {
  private current: number
  private nextHandle = 1
  private tasks = new Map<number, { at: number; fn: () => void }>()

  constructor(startMs = 0) {
    this.current = startMs
  }

  now(): Millis {
    return millis(this.current)
  }

  epochMillis(): number {
    return this.current
  }

  schedule(delayMs: number, fn: () => void): number {
    const handle = this.nextHandle++
    this.tasks.set(handle, { at: this.current + delayMs, fn })
    return handle
  }

  cancel(handle: number): void {
    this.tasks.delete(handle)
  }

  /** Move time forward, firing scheduled callbacks in chronological order. */
  advance(deltaMs: number): void {
    const target = this.current + deltaMs
    for (;;) {
      const due = [...this.tasks.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])
      const next = due[0]
      if (!next) break
      const [handle, task] = next
      this.tasks.delete(handle)
      this.current = task.at
      task.fn()
    }
    this.current = target
  }

  /** Jump to an absolute time. Rejects going backwards — a monotonic clock cannot. */
  setTime(ms: number): void {
    if (ms < this.current) throw new Error(`FakeClock cannot go backwards: ${ms} < ${this.current}`)
    this.advance(ms - this.current)
  }

  get pendingCount(): number {
    return this.tasks.size
  }
}

/** An Rng returning a fixed script, then cycling. Use for exact-value assertions. */
export function scriptedRng(values: readonly number[]): Rng {
  if (values.length === 0) throw new Error('scriptedRng needs at least one value')
  let i = 0
  return { next: () => values[i++ % values.length] as number }
}

export type RecordedAudioCall =
  | { kind: 'noteOn'; note: number; velocity: number; at: number }
  | { kind: 'noteOff'; note: number; at: number }
  | { kind: 'click'; accented: boolean; at: number }
  | { kind: 'allNotesOff'; at: number }
  | { kind: 'volume'; volume: number; at: number }

/** Records every call so tests can assert on what would have been heard. */
export class RecordingAudioOutput implements AudioOutput {
  readonly calls: RecordedAudioCall[] = []
  private readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  private at(explicit?: Millis): number {
    return explicit ?? this.clock.now()
  }

  noteOn(note: Midi, velocity: number, atMs?: Millis): void {
    this.calls.push({ kind: 'noteOn', note, velocity, at: this.at(atMs) })
  }

  noteOff(note: Midi, atMs?: Millis): void {
    this.calls.push({ kind: 'noteOff', note, at: this.at(atMs) })
  }

  click(accented: boolean, atMs?: Millis): void {
    this.calls.push({ kind: 'click', accented, at: this.at(atMs) })
  }

  allNotesOff(): void {
    this.calls.push({ kind: 'allNotesOff', at: this.at() })
  }

  setVolume(volume: number): void {
    this.calls.push({ kind: 'volume', volume, at: this.at() })
  }

  now(): Millis {
    return this.clock.now()
  }

  /** Notes sounded, in order — the common assertion. */
  get playedNotes(): number[] {
    return this.calls.filter((c) => c.kind === 'noteOn').map((c) => c.note)
  }

  get clicks(): { accented: boolean; at: number }[] {
    return this.calls
      .filter((c) => c.kind === 'click')
      .map((c) => ({ accented: c.accented, at: c.at }))
  }

  reset(): void {
    this.calls.length = 0
  }
}

const DEFAULT_DEVICE: MidiDevice = {
  id: 'fake-piano',
  name: 'Fake Digital Piano',
  manufacturer: 'Test',
}

/** A MIDI keyboard the test plays by calling `emit`. */
export class FakeMidiInput implements MidiInput {
  private devices: MidiDevice[]
  private handlers = new Set<(event: MidiEvent) => void>()
  private deviceHandlers = new Set<(devices: readonly MidiDevice[]) => void>()
  selectedDeviceId: string | null

  constructor(devices: MidiDevice[] = [DEFAULT_DEVICE]) {
    this.devices = devices
    this.selectedDeviceId = devices[0]?.id ?? null
  }

  listDevices(): readonly MidiDevice[] {
    return this.devices
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

  /** Deliver an event to subscribers, as the real device would. */
  emit(event: MidiEvent): void {
    for (const handler of this.handlers) handler(event)
  }

  /** Convenience: note-on then note-off, as one played note. */
  play(note: Midi, atMs: number, durationMs = 100, velocity = 80): void {
    this.emit({ type: 'noteOn', note, velocity, time: millis(atMs) })
    this.emit({ type: 'noteOff', note, time: millis(atMs + durationMs) })
  }

  /** Simulate hot-plug. */
  setDevices(devices: MidiDevice[]): void {
    this.devices = devices
    for (const handler of this.deviceHandlers) handler(devices)
  }
}

export class RecordingMidiOutput implements MidiOutput {
  readonly sent: { kind: 'noteOn' | 'noteOff' | 'allNotesOff'; note?: number; at?: number }[] = []
  selectedDeviceId: string | null = DEFAULT_DEVICE.id

  listDevices(): readonly MidiDevice[] {
    return [DEFAULT_DEVICE]
  }

  selectDevice(deviceId: string | null): void {
    this.selectedDeviceId = deviceId
  }

  noteOn(note: Midi, _velocity: number, atMs?: Millis): void {
    this.sent.push({ kind: 'noteOn', note, ...(atMs === undefined ? {} : { at: atMs }) })
  }

  noteOff(note: Midi, atMs?: Millis): void {
    this.sent.push({ kind: 'noteOff', note, ...(atMs === undefined ? {} : { at: atMs }) })
  }

  allNotesOff(): void {
    this.sent.push({ kind: 'allNotesOff' })
  }
}

/** In-memory Store. Deep-clones on write so tests cannot mutate stored state by reference. */
export class MemoryStore implements Store {
  private data = new Map<string, Map<string, unknown>>()

  private collection(name: string): Map<string, unknown> {
    let c = this.data.get(name)
    if (!c) {
      c = new Map()
      this.data.set(name, c)
    }
    return c
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const value = this.collection(collection).get(id)
    return value === undefined ? undefined : (structuredClone(value) as T)
  }

  async getAll<T>(collection: string): Promise<T[]> {
    return [...this.collection(collection).values()].map((v) => structuredClone(v) as T)
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    this.collection(collection).set(id, structuredClone(value))
  }

  async delete(collection: string, id: string): Promise<void> {
    this.collection(collection).delete(id)
  }

  async clear(collection: string): Promise<void> {
    this.collection(collection).clear()
  }

  async collections(): Promise<string[]> {
    return [...this.data.entries()].filter(([, c]) => c.size > 0).map(([name]) => name)
  }
}
