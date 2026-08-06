/**
 * Real-usage default for `AudioOutput` (roadmap 1.18): Web Audio only, built
 * lazily on the first `play()` press so the `AudioContext` is created inside
 * a user gesture (the browser autoplay policy requires it).
 *
 * REQ-4.7's preferred path — routing to a connected digital piano via
 * MIDI-out — is not wired up here; `@adapters/audio` already implements it
 * (`selectAudioOutput`), it just is not plumbed into the practice screen yet.
 * See the roadmap-1.18 report for why.
 *
 * Seven call sites (metronome, ear training, practice, sight-reading, rhythm
 * drill, the chord/scale reference, and its diatonic-chords sub-panel) each
 * call this on their own first press. A per-call `new AudioContext()` used to
 * mean the count of live contexts equalled the count of screens ever visited
 * this session, and Chrome caps how many a document may construct — the next
 * construction past that cap throws *inside the click handler*, silently
 * killing that Play button. Memoising a module-level singleton here means
 * every caller shares one context no matter how many screens or components
 * ask for it. Still built lazily — this module-level variable starts
 * `undefined` and the `AudioContext` is only constructed the first time any
 * caller actually presses play, inside that press's user gesture, never at
 * import time.
 */
import type { AudioOutput } from '@core/ports/audio.ts'
import { createWebAudioOutput } from '@adapters/audio/index.ts'

let singleton: AudioOutput | undefined

export function createDefaultAudioOutput(): AudioOutput {
  if (singleton === undefined) {
    singleton = createWebAudioOutput(new AudioContext())
  }
  return singleton
}
