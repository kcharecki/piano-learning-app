/**
 * A metronome-only `AudioOutput` (roadmap 2.12, REQ-3.4.4). Sight-reading only
 * works if the exercise is genuinely unheard before it is played — an
 * `AudioOutput` that sounds the generated notes (as `usePracticeEngine`'s
 * `dispatchAudio` does for ordinary practice, deliberately, so the learner can
 * hear the piece they are following) would let the learner shadow the audio
 * instead of reading the notation, defeating REQ-3.4.4 entirely.
 *
 * This wraps whatever real `AudioOutput` the trainer is given and passes the
 * metronome click and the panic/volume/clock calls straight through, but
 * drops `noteOn`/`noteOff` — the only two calls that would sound a pitch.
 */
import type { AudioOutput } from '@core/ports/audio.ts'
import type { Midi, Millis } from '@core/shared/units.ts'

export function silentAudioOutput(inner: AudioOutput): AudioOutput {
  return {
    noteOn(_note: Midi, _velocity: number, _atMs?: Millis): void {
      // Deliberately silent — see the module comment.
    },
    noteOff(_note: Midi, _atMs?: Millis): void {
      // Deliberately silent — see the module comment.
    },
    click(accented, atMs) {
      inner.click(accented, atMs)
    },
    allNotesOff() {
      inner.allNotesOff()
    },
    setVolume(volume) {
      inner.setVolume(volume)
    },
    now() {
      return inner.now()
    },
  }
}
