/**
 * Real-usage default for `AudioOutput` (roadmap 1.18): Web Audio only, built
 * lazily on the first `play()` press so the `AudioContext` is created inside
 * a user gesture (the browser autoplay policy requires it).
 *
 * REQ-4.7's preferred path — routing to a connected digital piano via
 * MIDI-out — is not wired up here; `@adapters/audio` already implements it
 * (`selectAudioOutput`), it just is not plumbed into the practice screen yet.
 * See the roadmap-1.18 report for why.
 */
import type { AudioOutput } from '@core/ports/audio.ts'
import { createWebAudioOutput } from '@adapters/audio/index.ts'

export function createDefaultAudioOutput(): AudioOutput {
  return createWebAudioOutput(new AudioContext())
}
