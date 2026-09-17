/**
 * The app's one entry point for drum sound (docs/drums/features/DR-06):
 * builds the `DrumAudioOutput` the Groove trainer plays through. Lazy
 * module-level singleton, mirroring
 * `app/practice/createDefaultAudioOutput.ts` — the `AudioContext` inside
 * `createDrumSynth` is itself built lazily on the first `strike`/`click`, so
 * nothing here forces one into existence outside a user gesture.
 *
 * MIDI-out routing (General MIDI percussion notes, via `pad.ts`'s
 * `gmNoteOf`, on channel 10) is later work, not this slice — this always
 * returns the synthesized voice.
 */
import type { DrumAudioOutput } from '@core/ports/drumAudio.ts'
import { createDrumSynth, type DrumSynthOptions } from './drumSynth.ts'

let singleton: DrumAudioOutput | undefined

/**
 * Testable seam: builds (and memoizes) the singleton `DrumAudioOutput` from
 * an injected `AudioContext` factory instead of always `new AudioContext()`
 * — lets a test exercise the memoization here without touching real Web
 * Audio. `createDrumAudioOutput` below is just this with the real factory.
 */
export function createDrumAudioOutputWith(context: DrumSynthOptions['context']): DrumAudioOutput {
  if (singleton === undefined) {
    singleton = createDrumSynth({ context })
  }
  return singleton
}

export function createDrumAudioOutput(): DrumAudioOutput {
  return createDrumAudioOutputWith(() => new AudioContext())
}
