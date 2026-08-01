/**
 * MIDI-out implementation of `AudioOutput` (REQ-4.7, preferred): routes notes
 * to the connected digital piano over `MidiOutput` so the instrument makes
 * its own sound, with zero synthesis latency.
 *
 * `MidiOutput` is not a domain port — see `core/ports/midi.ts` — this is the
 * one place that is allowed, and meant, to import it.
 *
 * `AudioOutput.click` has no MIDI equivalent, so it is synthesised as a very
 * short, hard-hit note at a fixed, easily distinguished pitch: high and loud
 * for the accent, lower and softer otherwise. It will sound like the piano's
 * own voice, not a drum click — an accepted trade-off of not owning the
 * device's channel routing.
 *
 * `noteOff` and `noteOn` both take an absolute `atMs`, which `MidiOutput`
 * schedules on the device's own clock (see `webmidi.ts`'s `port.send(data,
 * atMs)`) — no `setTimeout` needed for the click's timed release either.
 * `atMs` and `now()` are on the `Clock` epoch (`performance.now()`, per
 * `core/ports/audio.ts`) — which this adapter gets for free, since
 * `performance.now()` and Web MIDI's own `event.timeStamp` already share
 * that epoch. Nothing here needs converting; `webaudio.ts` is the
 * implementation that does, because `AudioContext.currentTime` does not.
 *
 * `allNotesOff` has a real limitation here: Web MIDI has no way to cancel a
 * message already handed to the device with a future timestamp. What this
 * does is the best available mitigation — send an immediate `noteOff` for
 * every note this adapter believes is still open, ahead of the device's own
 * `allNotesOff` (CC 123) — which pre-empts anything not yet due. A future
 * note-on already queued for a time before this call runs will still have
 * sounded; there is no fix for that within the `MidiOutput` interface.
 */
import type { AudioOutput } from '@core/ports/audio.ts'
import type { MidiOutput } from '@core/ports/midi.ts'
import { midi, millis, type Midi, type Millis } from '@core/shared/units.ts'

const CLICK_NOTE = midi(88)
const ACCENTED_CLICK_NOTE = midi(93)
const CLICK_VELOCITY = 90
const ACCENTED_CLICK_VELOCITY = 120
const CLICK_DURATION_MS = 20

export function createMidiAudioOutput(output: MidiOutput): AudioOutput {
  // Reference-counted: a click and a genuinely held note can share a pitch,
  // and a fast double-click on the same note must not clear tracking on the
  // first of the two note-offs.
  const openNotes = new Map<Midi, number>()

  function noteOn(note: Midi, velocity: number, atMs?: Millis): void {
    openNotes.set(note, (openNotes.get(note) ?? 0) + 1)
    output.noteOn(note, velocity, atMs)
  }

  function noteOff(note: Midi, atMs?: Millis): void {
    const count = openNotes.get(note) ?? 0
    if (count <= 1) openNotes.delete(note)
    else openNotes.set(note, count - 1)
    output.noteOff(note, atMs)
  }

  function click(accented: boolean, atMs?: Millis): void {
    const note = accented ? ACCENTED_CLICK_NOTE : CLICK_NOTE
    const velocity = accented ? ACCENTED_CLICK_VELOCITY : CLICK_VELOCITY
    const onAt = atMs ?? now()
    noteOn(note, velocity, onAt)
    noteOff(note, millis(onAt + CLICK_DURATION_MS))
  }

  function allNotesOff(): void {
    for (const note of openNotes.keys()) output.noteOff(note)
    openNotes.clear()
    output.allNotesOff()
  }

  function setVolume(_volume: number): void {
    // Routing to the instrument's own sound (REQ-4.7): the piano makes its
    // own sound and there is no software volume knob on it here. Velocity,
    // set per note by the caller, is MIDI's only per-note loudness control.
  }

  function now(): Millis {
    return millis(performance.now())
  }

  return { noteOn, noteOff, click, allNotesOff, setVolume, now }
}
