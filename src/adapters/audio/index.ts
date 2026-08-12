/**
 * Chooses the `AudioOutput` implementation per REQ-4.7's preference order:
 * MIDI-out to the connected digital piano first (zero synthesis latency, the
 * instrument's own sound), Web Audio synthesis second, as the offline-first
 * fallback when there is no output device to route to.
 */
import type { AudioOutput } from '@core/ports/audio.ts'
import type { MidiOutput } from '@core/ports/midi.ts'
import { createMidiAudioOutput } from './midiout.ts'
import { createWebAudioOutput } from './webaudio.ts'

export { createWebAudioOutput, type WebAudioOutputOptions } from './webaudio.ts'
// roadmap B.5's `createAudioRecorder`/`createAudioPlayback` are deliberately NOT
// re-exported here: `app/practice/useRecorder.ts` imports them from
// `./audioRecorder.ts` directly, so a barrel re-export would be an export
// nothing imports — which is exactly what `knip` fails the build over.

export type SelectAudioOutputOptions = {
  /** The MIDI-out port, if Web MIDI access was granted. */
  readonly midi?: MidiOutput
  /** Builds the `AudioContext` for the Web Audio fallback, called lazily. */
  readonly context?: () => AudioContext
}

/**
 * `midi` is only used when it has a device actually selected — a `MidiOutput`
 * with no `selectedDeviceId` has nowhere to send notes, which is exactly the
 * "no MIDI output device" case the fallback exists for. `context` is a
 * thunk, not an `AudioContext`, so the (comparatively expensive, and
 * autoplay-gated) context is only ever constructed when it is actually the
 * chosen output.
 *
 * @public — completes this module's live `createWebAudioOutput` export with
 * REQ-4.7's full MIDI-out-first preference order. `app/practice/createDefaultAudioOutput.ts`
 * calls `createWebAudioOutput` directly instead of this (documented there,
 * and in ROADMAP.md 1.18, as MIDI-out not yet plumbed to the practice
 * screen — `useMidiConnection` discards the `MidiOutput` it gets from
 * `createWebMidi`, so there is nothing to pass in yet). Not a duplicate to
 * dedupe: `createDefaultAudioOutput` never attempts MIDI selection itself.
 */
export function selectAudioOutput(opts: SelectAudioOutputOptions): AudioOutput {
  if (opts.midi !== undefined && opts.midi.selectedDeviceId !== null) {
    return createMidiAudioOutput(opts.midi)
  }
  if (opts.context !== undefined) {
    return createWebAudioOutput(opts.context())
  }
  throw new Error('selectAudioOutput: no MIDI device selected and no AudioContext factory provided')
}
