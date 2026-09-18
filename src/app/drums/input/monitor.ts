/**
 * `InputMonitor`'s pure half (roadmap DR-08): turns each raw MIDI event the
 * hook sees, plus what the kit-map engine (`@core/drums/kitmap/engine.ts`)
 * did with it, into one ring-buffer entry and one learner-facing line. Kept
 * pure and DOM-free so `useDrumMidiInput.ts`'s per-event hot path — the one
 * the graded trainers run through on every stroke — can be reasoned about
 * and tested without React or a browser.
 *
 * `describe`'s rules are deliberately narrower than "whatever the engine
 * returned": a note-on with a `hit` output is `pad`, a note-on with an
 * `unmapped` output is `unmapped`, a note-on with NO output is `dropped`
 * (the engine's debounce/velocity gate swallowed it), CC#4 is always
 * `position` regardless of what the engine did with it (it never produces an
 * output for CC#4 — see `engine.ts`'s `handle`), poly aftertouch on a mapped
 * note is `pad` too (`engine.ts`'s `handlePolyAftertouch` turns it into a
 * choke `hit` — a choke IS a hit, not a different thing), and everything else
 * (note-off, sustain, other CCs, aftertouch with no output) is `ignored`. A
 * `pad` verdict can carry a `choke` articulation from either a note-on or an
 * aftertouch event — `monitorLine` renders that regardless of how the entry
 * was built.
 *
 * `monitorGapText` reports the ms gap since the previous entry (newest-first
 * order, so "previous" means the OLDER neighbour): a several-ms gap between
 * two note-ons on the same pad is what tells a learner a hit was dropped as
 * a bounce rather than swallowed for some other reason.
 */
import { GROOVE_PAD_LABEL } from '@app/drums/groove/padLabels.ts'
import type { KitMapOutput } from '@core/drums/kitmap/engine.ts'
import type { Articulation } from '@core/drums/model/articulation.ts'
import { isMappedDrumPad, type MappedDrumPad } from '@core/drums/model/pad.ts'
import type { MidiEvent } from '@core/ports/midi.ts'
import { assertNever, invariant } from '@core/shared/invariant.ts'

export const MONITOR_CAPACITY = 24

export type MonitorRaw =
  | { readonly kind: 'noteOn'; readonly note: number; readonly velocity: number }
  | { readonly kind: 'noteOff'; readonly note: number }
  | { readonly kind: 'cc'; readonly controller: number; readonly value: number }
  | { readonly kind: 'aftertouch'; readonly note: number; readonly pressure: number }
  | { readonly kind: 'sustain'; readonly down: boolean }

export type MonitorVerdict =
  | { readonly kind: 'pad'; readonly pad: MappedDrumPad; readonly articulations: readonly Articulation[] }
  | { readonly kind: 'unmapped' }
  | { readonly kind: 'dropped' }
  | { readonly kind: 'position'; readonly value: number }
  | { readonly kind: 'ignored' }

export type MonitorEntry = {
  readonly seq: number
  readonly atMs: number
  readonly raw: MonitorRaw
  readonly verdict: MonitorVerdict
}

/** Newest first, capped at MONITOR_CAPACITY; always a new array (the oldest entry falls off at capacity). */
export function appendEntry(
  entries: readonly MonitorEntry[],
  entry: MonitorEntry,
): readonly MonitorEntry[] {
  const next = [entry, ...entries]
  return next.length > MONITOR_CAPACITY ? next.slice(0, MONITOR_CAPACITY) : next
}

const HIHAT_CC = 4

function hitVerdict(outputs: readonly KitMapOutput[]): MonitorVerdict | undefined {
  const hitOutput = outputs.find((output) => output.kind === 'hit')
  if (hitOutput === undefined) return undefined
  const { hit } = hitOutput
  invariant(isMappedDrumPad(hit.pad), `engine produced a hit for an unmapped pad: ${hit.pad}`)
  return { kind: 'pad', pad: hit.pad, articulations: hit.articulations }
}

/** One MIDI event plus what the engine did with it, turned into a raw record and a verdict — see the module doc for the rules. */
function describe(
  event: MidiEvent,
  outputs: readonly KitMapOutput[],
): { readonly raw: MonitorRaw; readonly verdict: MonitorVerdict } {
  switch (event.type) {
    case 'noteOn': {
      const raw: MonitorRaw = { kind: 'noteOn', note: event.note, velocity: event.velocity }
      const pad = hitVerdict(outputs)
      if (pad !== undefined) return { raw, verdict: pad }
      const unmappedOutput = outputs.find((output) => output.kind === 'unmapped')
      return { raw, verdict: unmappedOutput !== undefined ? { kind: 'unmapped' } : { kind: 'dropped' } }
    }
    case 'noteOff':
      return { raw: { kind: 'noteOff', note: event.note }, verdict: { kind: 'ignored' } }
    case 'controlChange': {
      const raw: MonitorRaw = { kind: 'cc', controller: event.controller, value: event.value }
      const verdict: MonitorVerdict =
        event.controller === HIHAT_CC ? { kind: 'position', value: event.value } : { kind: 'ignored' }
      return { raw, verdict }
    }
    case 'polyAftertouch': {
      const raw: MonitorRaw = { kind: 'aftertouch', note: event.note, pressure: event.pressure }
      const pad = hitVerdict(outputs)
      return { raw, verdict: pad ?? { kind: 'ignored' } }
    }
    case 'sustain':
      return { raw: { kind: 'sustain', down: event.down }, verdict: { kind: 'ignored' } }
    default:
      return assertNever(event)
  }
}

/** Builds the entry for one MIDI event given what the engine returned for it. */
export function classify(
  seq: number,
  atMs: number,
  event: MidiEvent,
  outputs: readonly KitMapOutput[],
): MonitorEntry {
  const { raw, verdict } = describe(event, outputs)
  return { seq, atMs, raw, verdict }
}

/** The ` (choke)` suffix shared by the noteOn and aftertouch pad lines. */
function chokeSuffix(articulations: readonly Articulation[]): string {
  return articulations.includes('choke') ? ' (choke)' : ''
}

function padLine(raw: Extract<MonitorRaw, { kind: 'noteOn' }>, verdict: MonitorVerdict): string {
  const prefix = `note ${raw.note} · vel ${raw.velocity}`
  switch (verdict.kind) {
    case 'pad':
      return `${prefix} → ${GROOVE_PAD_LABEL[verdict.pad]}${chokeSuffix(verdict.articulations)}`
    case 'unmapped':
      return `${prefix} → not in the map`
    case 'dropped':
      return `${prefix} → dropped (bounce or too soft)`
    case 'position':
    case 'ignored':
      return `${prefix} → ignored`
    default:
      return assertNever(verdict)
  }
}

function aftertouchLine(raw: Extract<MonitorRaw, { kind: 'aftertouch' }>, verdict: MonitorVerdict): string {
  const prefix = `aftertouch note ${raw.note} · pressure ${raw.pressure}`
  return verdict.kind === 'pad'
    ? `${prefix} → ${GROOVE_PAD_LABEL[verdict.pad]}${chokeSuffix(verdict.articulations)}`
    : `${prefix} → ignored`
}

/** One learner-facing line — see the module doc for examples. */
export function monitorLine(entry: MonitorEntry): string {
  const { raw, verdict } = entry
  switch (raw.kind) {
    case 'noteOn':
      return padLine(raw, verdict)
    case 'noteOff':
      return `note off ${raw.note} → ignored`
    case 'cc':
      return verdict.kind === 'position'
        ? `CC ${raw.controller} = ${raw.value} → pedal position`
        : `CC ${raw.controller} = ${raw.value} → ignored`
    case 'aftertouch':
      return aftertouchLine(raw, verdict)
    case 'sustain':
      return `sustain ${raw.down ? 'down' : 'up'} → ignored`
    default:
      return assertNever(raw)
  }
}

/** The ms gap since the OLDER neighbour (entries are newest-first, so that is the next entry in the list) — `''` for the oldest entry shown. */
export function monitorGapText(entry: MonitorEntry, older: MonitorEntry | undefined): string {
  if (older === undefined) return ''
  return `+${Math.max(0, Math.round(entry.atMs - older.atMs))} ms`
}
