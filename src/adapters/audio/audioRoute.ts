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

export type ConnectMidiOutput = () => Promise<Result<{ readonly output: MidiOutput }, string>>

async function defaultConnectMidiOutput(): Promise<Result<{ readonly output: MidiOutput }, string>> {
  const result = await createWebMidi()
  if (!result.ok) return result
  return ok({ output: result.value.output })
}

/** The live, device-selected MIDI output, once `connectMidiOutputRoute` has succeeded this session. */
let readyMidiOutput: MidiOutput | undefined

/**
 * Connects Web MIDI and auto-selects the first output port found (REQ-4.6: a
 * single-user app with one instrument plugged in has nothing to ask about),
 * then caches it so `getPlaybackMidiOutput` can hand it to
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
  const first = result.value.output.listDevices()[0]
  if (first === undefined) {
    readyMidiOutput = undefined
    return err('No MIDI output device found. Connect your instrument and try again.')
  }
  result.value.output.selectDevice(first.id)
  readyMidiOutput = result.value.output
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
