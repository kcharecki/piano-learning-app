/**
 * Real-usage default for `AudioOutput` (roadmap 1.18): built lazily on the
 * first `play()` press so, on the Web Audio path, the `AudioContext` is
 * created inside a user gesture (the browser autoplay policy requires it).
 *
 * REQ-4.7's preferred path — routing to a connected digital piano via
 * MIDI-out — is wired as of roadmap U.2: `@adapters/audio`'s
 * `selectAudioOutput` already implements the MIDI-out-first preference; this
 * is the one real call site every screen shares, so it is the one place that
 * needs to ask `@adapters/audio/audioRoute.ts`'s `getPlaybackMidiOutput()`
 * — the learner's Settings > Audio choice, plus a live, device-selected
 * `MidiOutput` if that connection has completed — and hand it in. That
 * connection itself is established from Settings, never here: it is async
 * (`createWebMidi()`), and this function must stay synchronous to build the
 * `AudioContext` inside the gesture. See `audioRoute.ts`'s module comment for
 * what that means for a learner who reloads mid-session.
 *
 * Seven call sites (metronome, ear training, practice, sight-reading, rhythm
 * drill, the chord/scale reference, and its diatonic-chords sub-panel) each
 * call this on their own first press. A per-call `new AudioContext()` used to
 * mean the count of live contexts equalled the count of screens ever visited
 * this session, and Chrome caps how many a document may construct — the next
 * construction past that cap throws *inside the click handler*, silently
 * killing that Play button. Memoising a module-level singleton here means
 * every caller shares one output no matter how many screens or components
 * ask for it — which is also why the MIDI-vs-Web-Audio choice, once made on
 * the first press of a session, is not re-evaluated mid-session even if the
 * learner changes the Settings toggle afterwards: rebuilding the shared
 * singleton mid-session is future work, not a U.2 regression (the pre-U.2
 * singleton never rebuilt either). Still built lazily — this module-level
 * variable starts `undefined`, and nothing is constructed until the first
 * caller actually presses play, inside that press's user gesture, never at
 * import time.
 */
import type { AudioOutput } from '@core/ports/audio.ts'
import { selectAudioOutput } from '@adapters/audio/index.ts'
import { getPlaybackMidiOutput } from '@adapters/audio/audioRoute.ts'

let singleton: AudioOutput | undefined

export function createDefaultAudioOutput(): AudioOutput {
  if (singleton === undefined) {
    const midi = getPlaybackMidiOutput()
    singleton = selectAudioOutput({
      context: () => new AudioContext(),
      ...(midi === undefined ? {} : { midi }),
    })
  }
  return singleton
}
