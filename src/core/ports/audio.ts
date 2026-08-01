import type { Midi, Millis } from '../shared/units.ts'

/**
 * Sound output as the domain sees it. Backed either by MIDI-out to the digital
 * piano (preferred, REQ-4.7) or by a Web Audio soundfont. The domain never
 * knows which, so playback logic is testable against a recording fake.
 */
export interface AudioOutput {
  /**
   * Play a note. `atMs` is an absolute time on the **`Clock` epoch** — the same
   * one `Clock.now()`, `Transport.originMs` and Web MIDI's `event.timeStamp`
   * use (`performance.now()`, in the browser) — never an implementation's own
   * internal clock. Omit for "now".
   *
   * This is binding on every `AudioOutput` implementation, not a convention:
   * the domain builds one `atMs` per event from a single `Clock` reading and
   * hands it to whichever output `selectAudioOutput` returned, without
   * knowing which. An implementation whose own timer runs on a different
   * epoch (an `AudioContext`'s `currentTime`, for instance, which starts at 0
   * when the context is constructed, not when the page loaded) must convert
   * internally — capture the offset once and shift every `atMs` it is given —
   * rather than leaking its epoch to callers.
   */
  noteOn(note: Midi, velocity: number, atMs?: Millis): void
  noteOff(note: Midi, atMs?: Millis): void
  /** Metronome click. Accented clicks mark the downbeat. */
  click(accented: boolean, atMs?: Millis): void
  /** Panic — release everything. Used on stop, seek and loop wrap. */
  allNotesOff(): void
  /** 0–1. Applied to app-generated sound; ignored when routing to a MIDI instrument. */
  setVolume(volume: number): void
  /**
   * The current instant, converted to the same `Clock` epoch `atMs` is on
   * (see `noteOn`) — not necessarily the output's own internal clock. Used
   * for look-ahead scheduling by callers who otherwise never read a clock
   * directly.
   */
  now(): Millis
}
