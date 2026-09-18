/**
 * MIDI-out implementation of `DrumAudioOutput` (roadmap DR-06): routes drum
 * strikes and metronome clicks to a connected MIDI device on channel 10
 * (index 9), the General MIDI percussion channel, using `gmNoteOf` (from
 * `@core/drums/model/pad.ts`) to translate a pad to its GM percussion note.
 *
 * `MidiOutput` is not a domain port — see `core/ports/midi.ts` — this is one
 * of the few places that is allowed, and meant, to import it. `atMs`/`now()`
 * are always on the epoch handed in via `opts.now`, never read directly here
 * — `drumAudio.ts`'s router decides what clock that is, and (review A1)
 * deliberately hands this module `performance.now()` directly rather than
 * the synth's own `now()`, which is an EMA *estimate* of it re-anchored
 * around the `AudioContext` clock and can read meaningfully early right
 * after a context suspension — wrong for Web MIDI's exact millisecond
 * scheduling, right only for the synth's own audio graph.
 *
 * `click` has no GM drum-kit equivalent for "metronome tick", so it reuses
 * the GM wood-block notes (76 hi / 77 lo) — a real percussion sound, unlike
 * `midiout.ts`'s borrowed-piano-pitch click, because channel 10 already
 * speaks percussion.
 *
 * ## The open hi-hat (review A3, round 3 RED 2 + NIT)
 *
 * `core/ports/drumAudio.ts`'s module comment is binding here same as any
 * other `DrumAudioOutput`: `hhOpen` sustains until the next `hhClosed`/
 * `hhPedal`/`hhOpen` strike on THIS output, never released by a wall-clock
 * gate. So unlike every other pad, `hhOpen`'s `noteOn` gets no scheduled
 * `noteOff` at `+STRIKE_GATE_MS` at all — this module instead remembers the
 * ringing note AND the `at` it started ringing, and releases it the moment
 * the next hi-hat event arrives, whichever pad that turns out to be,
 * including another `hhOpen` (a fresh ring restarts the sustain).
 *
 * A releasing strike only actually releases when its own `at` is not
 * earlier than `openHat.at` (review round 4 AMBER 1). A trainer dispatches a
 * whole pass (count-in plus every hit) up front with future `atMs` values,
 * while a live hit from the input adapter arrives stamped at `now()` — so a
 * closing strike can be scheduled BEFORE the still-open strike's own onset
 * (e.g. a scheduled `hhOpen` at 2000 with a live `hhClosed` arriving at
 * 500). Clamping the release forward to the onset's own instant (an earlier
 * revision of this file did, via `Math.max`) stamps a note-off at the exact
 * same instant as its note-on — a zero-length note that reads as "silence
 * the open hat right at its onset" to any device that honours it. Instead,
 * an out-of-order release is simply skipped: `openHat` stays set, and the
 * next hi-hat event that arrives with `at >= openHat.at` releases it.
 *
 * The release also runs BEFORE the silence guard (`volume`/`velocity` <= 0):
 * a muted strike is still a real hi-hat gesture and must still choke the
 * ringing note, even though it plays nothing of its own.
 *
 * `allNotesOff` forgets the ringing note too — the underlying
 * `output.allNotesOff` (CC 123, channel 10) is what actually silences it at
 * the device.
 */
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { gmNoteOf } from '@core/drums/model/pad.ts'
import type { DrumAudioOutput } from '@core/ports/drumAudio.ts'
import type { MidiOutput } from '@core/ports/midi.ts'
import { midi, millis, type Millis } from '@core/shared/units.ts'

/** MIDI channel index for General MIDI percussion — "channel 10" in 1-based MIDI terms. */
export const DRUM_MIDI_CHANNEL = 9
/** GM percussion note: Hi Wood Block — the metronome's accented click. */
export const CLICK_ACCENT_NOTE = 76
/** GM percussion note: Low Wood Block — the metronome's plain click. */
export const CLICK_NOTE = 77
/** How long after `noteOn` the matching `noteOff` is scheduled — every pad except a ringing `hhOpen` (see the module comment). */
export const STRIKE_GATE_MS = 60

export type MidiDrumOutputOptions = {
  readonly output: MidiOutput
  /** The epoch "now" this output schedules against — see the module comment. */
  readonly now: () => Millis
}

function clampVelocity(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)))
}

function isHiHatEvent(pad: MappedDrumPad): boolean {
  return pad === 'hhClosed' || pad === 'hhPedal' || pad === 'hhOpen'
}

/** Build a `DrumAudioOutput` that plays through `opts.output` on MIDI channel 10. */
export function createMidiDrumOutput(opts: MidiDrumOutputOptions): DrumAudioOutput {
  const { output, now } = opts
  let volume = 1
  /** The still-ringing `hhOpen`'s GM note and the `at` it started ringing at, or `undefined` — see the module comment. */
  let openHat: { readonly note: number; readonly at: number } | undefined

  function strike(pad: MappedDrumPad, velocity: number, atMs?: Millis): void {
    const at = atMs ?? now()
    // `gmNoteOf` only returns `undefined` for `'unmapped'`, which
    // `MappedDrumPad` excludes by construction — narrowed by the parameter's
    // own type, not a runtime check for a branch that can never run.
    const note = gmNoteOf(pad) as number

    // Release any still-ringing open hat first — but only when this strike's
    // `at` is not earlier than the open hat's own onset (module comment) —
    // and before the silence guard below, so a muted choke still chokes.
    // An out-of-order release (this strike's `at` earlier than the open
    // hat's) is skipped entirely: `openHat` stays set for a later, correctly
    // ordered hi-hat event to release.
    if (isHiHatEvent(pad) && openHat !== undefined && at >= openHat.at) {
      output.noteOff(midi(openHat.note), at, DRUM_MIDI_CHANNEL)
      openHat = undefined
    }

    // A muted output (volume 0) or a note-off-shaped velocity plays nothing
    // of its own — the synth is silent at volume 0 too (review A2); this
    // must match it, not send a floored, audible velocity-1 note instead.
    if (volume <= 0 || velocity <= 0) return

    const gated = midi(note)
    output.noteOn(gated, clampVelocity(velocity * volume), at, DRUM_MIDI_CHANNEL)
    if (pad === 'hhOpen') {
      openHat = { note, at }
    } else {
      output.noteOff(gated, millis(at + STRIKE_GATE_MS), DRUM_MIDI_CHANNEL)
    }
  }

  function click(accented: boolean, atMs?: Millis, gain = 1): void {
    if (volume <= 0 || gain <= 0) return
    const at = atMs ?? now()
    const note = midi(accented ? CLICK_ACCENT_NOTE : CLICK_NOTE)
    output.noteOn(note, clampVelocity(127 * gain * volume), at, DRUM_MIDI_CHANNEL)
    output.noteOff(note, millis(at + STRIKE_GATE_MS), DRUM_MIDI_CHANNEL)
  }

  function allNotesOff(): void {
    openHat = undefined
    output.allNotesOff(DRUM_MIDI_CHANNEL)
  }

  function setVolume(v: number): void {
    volume = Math.max(0, Math.min(1, v))
  }

  return { strike, click, allNotesOff, setVolume, now }
}
