/**
 * The kit-map engine (DR-02): the stateful half of "raw MIDI event stream ->
 * `DrumHit` stream" that `kitMap.ts`'s pure table/CC#4-classifier can't own
 * by itself. One `KitMapEngine` instance tracks, across the life of a
 * connection:
 *  - the last-seen CC#4 value, for the hi-hat state machine (`kitMap.ts`);
 *  - the last-accepted-hit time per pad (and per unmapped note), for debounce.
 *
 * It never reads a clock — every timestamp comes from the `MidiEvent` itself
 * (already `Millis`, straight off the adapter edge), matching every other
 * `RawDrumHit` producer in this codebase.
 *
 * Everything a raw MIDI stream can throw at it becomes one of:
 *  - `{ kind: 'hit', hit }` — a `RawDrumHit` on a real pad (including a choke,
 *    modelled as a hit carrying the `choke` articulation — DR-04 already
 *    defines that vocabulary; poly aftertouch is just a second gesture on an
 *    already-mapped note, not a new event kind);
 *  - `{ kind: 'unmapped', event }` — a note-on the current `KitMap` doesn't
 *    recognise. Never dropped (spec, DR-02 testing section) — this is the
 *    observable bucket the future MIDI-learn wizard consumes to build a
 *    custom map for whatever the presets missed.
 * `noteOff`/`sustain` carry no drum meaning (research §3: "drum note-offs
 * arrive near-instantly; notes are events, not held") and produce nothing.
 */
import { assertNever } from '@core/shared/invariant.ts'
import { millis, type Midi, type Millis } from '@core/shared/units.ts'
import type { MidiEvent } from '@core/ports/midi.ts'
import { makeDrumHit, type RawDrumHit } from '../model/hit.ts'
import type { MappedDrumPad } from '../model/pad.ts'
import { classifyHiHat, DEFAULT_HI_HAT_CONFIG, resolveKitMapTarget, type HiHatState, type KitMap } from './kitMap.ts'

/** The MIDI CC number the hi-hat pedal reports its continuous position on (research §3). */
const HIHAT_CC = 4

const DEFAULT_DEBOUNCE_MS = 20
/**
 * The floor exists so a per-pad ceiling can be raised for a noisy pad, but
 * the default must never swallow a ghost note: research §3 puts ghosts at
 * velocity 30-50, and that must always be signal, not silence. 1 is the
 * lowest velocity a real note-on can carry (0 is note-off), so the default
 * gate is, deliberately, no gate at all until a preset or the wizard raises it.
 */
const DEFAULT_MIN_VELOCITY = 1
/**
 * A kit at rest sits with the hi-hat pedal down (closed). Defaulting the
 * "never seen a CC#4 message yet" state to a fully-closed reading means a
 * hi-hat hit that arrives before the first CC#4 message reads as closed
 * rather than a false open — the safer failure direction: an unexpectedly
 * open hi-hat is loud and obvious to the player, an unexpectedly closed one
 * is just quiet, which is what a never-configured input would look like anyway.
 */
const DEFAULT_INITIAL_CC4 = 127

export type UnmappedNoteEvent = {
  readonly note: Midi
  readonly velocity: number
  readonly time: Millis
}

export type KitMapOutput =
  | { readonly kind: 'hit'; readonly hit: RawDrumHit }
  | { readonly kind: 'unmapped'; readonly event: UnmappedNoteEvent }

export type KitMapEngineConfig = {
  readonly kitMap: KitMap
  /**
   * Per-pad double-trigger suppression window in ms (research §3: "app-side
   * ~10-30 ms per-pad debounce is a reasonable second layer"). Default 20.
   * Each pad (and each distinct unmapped note) tracks its own window
   * independently; the window LENGTH itself is one shared, configurable number.
   */
  readonly debounceMs?: number
  /** Per-pad minimum-velocity gate. A pad not named here uses `defaultMinVelocity`. */
  readonly minVelocity?: Readonly<Partial<Record<MappedDrumPad, number>>>
  readonly defaultMinVelocity?: number
  /** The CC#4 reading assumed before any control-change message arrives. Default 127 (closed) — see module doc. */
  readonly initialCC4?: number
}

export interface KitMapEngine {
  /** Feed one decoded MIDI event; returns the zero or more `DrumHit`/unmapped outputs it produced. */
  handle(event: MidiEvent): readonly KitMapOutput[]
}

class Engine implements KitMapEngine {
  private readonly kitMap: KitMap
  private readonly hiHatConfig: NonNullable<KitMap['hiHat']>
  private readonly debounceMs: number
  private readonly minVelocity: Readonly<Partial<Record<MappedDrumPad, number>>>
  private readonly defaultMinVelocity: number
  private lastCC4Value: number
  /** Last ACCEPTED hit time, keyed by resolved pad for mapped hits, or `note:<n>` for unmapped ones. */
  private readonly lastHitTimeMs = new Map<string, number>()

  constructor(config: KitMapEngineConfig) {
    this.kitMap = config.kitMap
    this.hiHatConfig = config.kitMap.hiHat ?? DEFAULT_HI_HAT_CONFIG
    this.debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.minVelocity = config.minVelocity ?? {}
    this.defaultMinVelocity = config.defaultMinVelocity ?? DEFAULT_MIN_VELOCITY
    this.lastCC4Value = config.initialCC4 ?? DEFAULT_INITIAL_CC4
  }

  handle(event: MidiEvent): readonly KitMapOutput[] {
    switch (event.type) {
      case 'noteOn':
        // Defense in depth: `MidiNoteOn.velocity` is documented as never 0
        // (the adapter normalises velocity-0 note-on to noteOff), but the
        // spec calls this out explicitly, so a caller feeding the engine
        // directly (a test, or a future non-adapter source) is still safe.
        if (event.velocity === 0) return []
        return this.handleNoteOn(event.note, event.velocity, event.time)
      case 'noteOff':
      case 'sustain':
        return []
      case 'controlChange':
        if (event.controller === HIHAT_CC) this.lastCC4Value = event.value
        return []
      case 'polyAftertouch':
        return this.handlePolyAftertouch(event.note, event.pressure, event.time)
      default:
        return assertNever(event)
    }
  }

  private handleNoteOn(note: Midi, velocity: number, timeMs: Millis): readonly KitMapOutput[] {
    const entry = this.kitMap.notes[note]
    if (entry === undefined) return this.handleUnmapped(note, velocity, timeMs)

    const { pad: resolvedPad, articulations } = resolveKitMapTarget(entry, this.hiHatState())
    if (velocity < (this.minVelocity[resolvedPad] ?? this.defaultMinVelocity)) return []
    if (this.isDebounced(resolvedPad, timeMs)) return []

    this.recordHit(resolvedPad, timeMs)
    return [{ kind: 'hit', hit: makeDrumHit({ pad: resolvedPad, velocity, time: millis(timeMs), articulations }) }]
  }

  /** Poly aftertouch on a note the kit map doesn't recognise carries no pad identity to choke — dropped, not bucketed (see module doc: the unmapped bucket is for capture-worthy note-ONs, not a follow-on gesture). */
  private handlePolyAftertouch(note: Midi, pressure: number, timeMs: Millis): readonly KitMapOutput[] {
    const entry = this.kitMap.notes[note]
    if (entry === undefined) return []

    const { pad: resolvedPad } = resolveKitMapTarget(entry, this.hiHatState())
    if (this.isDebounced(resolvedPad, timeMs)) return []

    this.recordHit(resolvedPad, timeMs)
    const hit = makeDrumHit({ pad: resolvedPad, velocity: pressure, time: millis(timeMs), articulations: ['choke'] })
    return [{ kind: 'hit', hit }]
  }

  private handleUnmapped(note: Midi, velocity: number, timeMs: Millis): readonly KitMapOutput[] {
    const key = `note:${note}`
    if (this.isDebounced(key, timeMs)) return []
    this.recordHit(key, timeMs)
    return [{ kind: 'unmapped', event: { note, velocity, time: millis(timeMs) } }]
  }

  private hiHatState(): HiHatState {
    return classifyHiHat(this.lastCC4Value, this.hiHatConfig)
  }

  private isDebounced(key: string, timeMs: number): boolean {
    const last = this.lastHitTimeMs.get(key)
    return last !== undefined && timeMs - last < this.debounceMs
  }

  private recordHit(key: string, timeMs: number): void {
    this.lastHitTimeMs.set(key, timeMs)
  }
}

export function createKitMapEngine(config: KitMapEngineConfig): KitMapEngine {
  return new Engine(config)
}
