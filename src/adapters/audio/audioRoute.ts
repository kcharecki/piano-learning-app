/**
 * Learner's chosen audio output route (roadmap U.2, REQ-4.7). `selectAudioOutput`
 * (this directory's `index.ts`) already implements MIDI-out-first routing, but
 * it needs two things that, before U.2, existed nowhere in the app: a stated
 * preference, and a `MidiOutput` with a device actually selected. This module
 * owns both, so `@app/practice/createDefaultAudioOutput.ts` — the one real
 * call site every screen shares — can consult them.
 *
 * The preference is a plain `localStorage` read/write, not the app's usual
 * IndexedDB-backed `persistence.ts` (`app/state/*`): that store is
 * integrator-owned, single-writer, for the parallel-worktree round this
 * shipped in, and this is one small setting, not shape-versioned domain data.
 * `THEME_PAINT_HINT_KEY` in `app/state/themeStore.ts` already uses the same
 * primitive as a *cache in front of* the versioned store; here it is the
 * actual source of truth. Worth folding into that mechanism later if this
 * setting grows a second field.
 *
 * The live MIDI-out connection is established explicitly — `connectMidiOutputRoute`,
 * called from Settings when the learner picks this route, and again whenever
 * Settings mounts with the route already chosen (mirroring how
 * `useMidiConnection` reconnects its input per-mount rather than at app boot,
 * see that file's own module comment) — never implicitly from
 * `createDefaultAudioOutput`, which must stay synchronous: its `AudioContext`
 * is built inside a Web Audio user gesture, and `createWebMidi()` is a
 * `Promise`. A learner who reloads mid-session and goes straight to Practice
 * without revisiting Settings gets Web Audio until they do — a real, stated
 * limitation, not a silent wrong answer.
 *
 * This intentionally opens a MIDI connection independent of
 * `useMidiConnection.ts`'s (which is for the input side, and discards the
 * `MidiOutput` `createWebMidi` also hands back — see that file's module
 * comment). Two independent `requestMIDIAccess()` calls when both the Input
 * and Audio sections are live is a little wasteful, not incorrect: browsers
 * serve every caller from the same underlying device state.
 */
import { createWebMidi } from '@adapters/midi/index.ts'
import type { MidiOutput } from '@core/ports/midi.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { DRUM_MIDI_CHANNEL } from './drumMidiOut.ts'

export type AudioOutputRoute = 'webaudio' | 'midi'

const ROUTE_STORAGE_KEY = 'piano-audio-output-route'

/** Reads the learner's stored preference; defaults to the always-available Web Audio route. */
export function getAudioOutputRoute(): AudioOutputRoute {
  try {
    return localStorage.getItem(ROUTE_STORAGE_KEY) === 'midi' ? 'midi' : 'webaudio'
  } catch {
    return 'webaudio'
  }
}

/** Persists the learner's choice. Best-effort — storage being blocked or full must not crash Settings. */
export function setAudioOutputRoute(route: AudioOutputRoute): void {
  try {
    localStorage.setItem(ROUTE_STORAGE_KEY, route)
  } catch {
    /* storage unavailable — the route still applies for the rest of this session */
  }
}

/**
 * The learner's remembered MIDI output PORT (roadmap DR-06 wave 12) — distinct
 * from `ROUTE_STORAGE_KEY` above, which is "Web Audio vs MIDI", not "which
 * port". A learner with a piano AND a drum module has two output ports;
 * without this, both the piano's "My instrument" route and the drum "MIDI
 * out" route silently went to whichever port `listDevices()` happened to
 * enumerate first.
 */
export const MIDI_OUTPUT_PORT_STORAGE_KEY = 'piano-midi-output-port'

/** Reads the learner's preferred port id; `undefined` if never set or storage is unavailable. */
export function getPreferredMidiOutputPortId(): string | undefined {
  try {
    return localStorage.getItem(MIDI_OUTPUT_PORT_STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/** Persists the learner's preferred port id. `undefined` removes it. Best-effort, same as `setAudioOutputRoute`. */
export function setPreferredMidiOutputPortId(id: string | undefined): void {
  try {
    if (id === undefined) localStorage.removeItem(MIDI_OUTPUT_PORT_STORAGE_KEY)
    else localStorage.setItem(MIDI_OUTPUT_PORT_STORAGE_KEY, id)
  } catch {
    /* storage unavailable — the pick still applies for the rest of this session */
  }
}

export type ConnectMidiOutput = () => Promise<Result<{ readonly output: MidiOutput }, string>>

async function defaultConnectMidiOutput(): Promise<Result<{ readonly output: MidiOutput }, string>> {
  const result = await createWebMidi()
  if (!result.ok) return result
  return ok({ output: result.value.output })
}

/** The live, device-selected MIDI output, once `connectMidiOutputRoute` has succeeded this session. */
let readyMidiOutput: MidiOutput | undefined

/**
 * Connects Web MIDI and selects an output port (REQ-4.6: a single-user app
 * with one instrument plugged in has nothing to ask about) — the learner's
 * remembered port (`getPreferredMidiOutputPortId`) when it is still among
 * the listed devices, the first port otherwise (a fresh connection, or the
 * remembered device unplugged; the preference itself is left alone in that
 * case, since the device may simply be unplugged, not un-chosen — see
 * `selectMidiOutputPort` for the only place that preference actually
 * changes). Then caches the result so `getPlaybackMidiOutput` can hand it to
 * `createDefaultAudioOutput` synchronously. Call this from Settings — never
 * from inside the Web Audio user-gesture path.
 */
export async function connectMidiOutputRoute(
  connect: ConnectMidiOutput = defaultConnectMidiOutput,
): Promise<Result<void, string>> {
  const result = await connect()
  if (!result.ok) {
    readyMidiOutput = undefined
    return result
  }
  const devices = result.value.output.listDevices()
  const preferred = getPreferredMidiOutputPortId()
  const pick = devices.find((d) => d.id === preferred) ?? devices[0]
  if (pick === undefined) {
    readyMidiOutput = undefined
    return err('No MIDI output device found. Connect your instrument and try again.')
  }
  result.value.output.selectDevice(pick.id)
  readyMidiOutput = result.value.output
  return ok(undefined)
}

/**
 * Explicit port pick (roadmap DR-06 wave 12) — the one place
 * `MIDI_OUTPUT_PORT_STORAGE_KEY` actually changes; `connectMidiOutputRoute`
 * above only ever READS it. `err` covers the two ways Settings' select can
 * be driven stale: nothing connected yet (the control only renders once
 * something is, but a caller could still race it), or the picked id no
 * longer among `listDevices()` (the device was unplugged between render and
 * click). Neither error path below touches the live output — a failed pick
 * must not silence a port that is still legitimately in use.
 *
 * ## Panicking the OLD port before the switch (DR-06 wave 14, RED-SPEC round 2)
 *
 * `readyMidiOutput` is one `MidiOutput` instance for the session — picking a
 * different port only ever calls `selectDevice(id)` on it, never swaps in a
 * new instance (`drumAudio.ts`'s `ensureMidiTarget` has the consuming side
 * of this). `WebMidiOutputAdapter.send()` (`webmidi.ts`) resolves the
 * destination port fresh, at send time, from its own mutable
 * `selectedDeviceId` — so the ONLY moment `allNotesOff` can still reach the
 * outgoing port is right here, the instant before `selectDevice(id)`
 * reassigns it below; one line later would already be too late (it would
 * land on the new port instead, same as `ensureMidiTarget` found for a
 * strike arriving after the switch). `WebMidiOutputAdapter.allNotesOff` also
 * `clear()`s the port's own queued sends first (see that method's comment),
 * so this additionally cancels anything already scheduled ahead on the old
 * port, not just notes already sounding.
 *
 * Two calls, not one: `MidiOutput.allNotesOff(channel?)` silences one MIDI
 * channel per call, not "every channel" — the drum voice lives on channel 10
 * (`DRUM_MIDI_CHANNEL`, `drumMidiOut.ts`) and the piano voice
 * (`midiout.ts`'s `createMidiAudioOutput`) on the default channel (0, the
 * parameter omitted). Both may be ringing on the port being switched away
 * from, since this router has no visibility into which one actually is.
 *
 * ## Re-picking the SAME port (Settings re-click) is not a switch
 *
 * `id === readyMidiOutput.selectedDeviceId` is not a port change at all —
 * nothing is "outgoing", so there is nothing to panic, and `selectDevice(id)`
 * would be a harmless same-value reassignment. Sending the two `allNotesOff`
 * calls anyway would still be wrong: a note legitimately ringing on this
 * still-selected port (this drum router's own `openHat`, or a genuinely held
 * piano note) would be cut off for no reason — a re-click must be inert, not
 * a panic button. So this returns early with exactly the same success value
 * the normal path returns (`ok(undefined)`) and sends nothing at all;
 * `ensureMidiTarget` (`drumAudio.ts`) has the matching same-id no-op on the
 * consuming side. `setPreferredMidiOutputPortId(id)` is kept even on this
 * early path — re-writing the same id is idempotent, and it keeps the
 * persisted preference in step with the live selection either way, at
 * negligible cost.
 */
export function selectMidiOutputPort(id: string): Result<void, string> {
  if (readyMidiOutput === undefined) return err('No MIDI output is connected.')
  const stillListed = readyMidiOutput.listDevices().some((d) => d.id === id)
  if (!stillListed) return err('That MIDI output is no longer listed.')
  if (id === readyMidiOutput.selectedDeviceId) {
    setPreferredMidiOutputPortId(id)
    return ok(undefined)
  }
  readyMidiOutput.allNotesOff(DRUM_MIDI_CHANNEL)
  readyMidiOutput.allNotesOff()
  readyMidiOutput.selectDevice(id)
  setPreferredMidiOutputPortId(id)
  return ok(undefined)
}

/**
 * `createDefaultAudioOutput`'s synchronous read of "is a MIDI-out route
 * actually ready right now". `undefined` means fall back to Web Audio,
 * covering both "learner prefers Web Audio" and "prefers MIDI, but no
 * connection has completed yet".
 */
export function getPlaybackMidiOutput(): MidiOutput | undefined {
  return getAudioOutputRoute() === 'midi' ? readyMidiOutput : undefined
}

/**
 * The connected MIDI output regardless of the piano route preference —
 * unlike `getPlaybackMidiOutput`, this does not gate on `getAudioOutputRoute`.
 * DR-06's drum router uses this: a learner can route drum voices to MIDI
 * while the piano itself still plays through Web Audio (or vice versa), so
 * "is a MIDI output connected" and "does the piano route to it" are two
 * different questions. `undefined` until `connectMidiOutputRoute` has
 * succeeded this session.
 */
export function getConnectedMidiOutput(): MidiOutput | undefined {
  return readyMidiOutput
}

/**
 * Test-only: clears the cached live MIDI-out connection. `readyMidiOutput`
 * is module-level state by design (see this module's own comment), which
 * leaks between tests in a file that shares one module instance across its
 * `it()` blocks rather than `vi.resetModules()`-ing per test — call this
 * from such a file's `afterEach` so "no MIDI output connected yet" stays
 * true regardless of test order or a `--sequence.shuffle.tests` seed.
 */
export function __resetMidiOutputRoute(): void {
  readyMidiOutput = undefined
}
