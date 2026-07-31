import type { Midi, Millis } from '../shared/units.ts'

/**
 * Sound output as the domain sees it. Backed either by MIDI-out to the digital
 * piano (preferred, REQ-4.7) or by a Web Audio soundfont. The domain never
 * knows which, so playback logic is testable against a recording fake.
 */
export interface AudioOutput {
  /** Play a note. `atMs` is an absolute time on the audio clock; omit for "now". */
  noteOn(note: Midi, velocity: number, atMs?: Millis): void
  noteOff(note: Midi, atMs?: Millis): void
  /** Metronome click. Accented clicks mark the downbeat. */
  click(accented: boolean, atMs?: Millis): void
  /** Panic — release everything. Used on stop, seek and loop wrap. */
  allNotesOff(): void
  /** 0–1. Applied to app-generated sound; ignored when routing to a MIDI instrument. */
  setVolume(volume: number): void
  /** Current time on the output's own clock, for look-ahead scheduling. */
  now(): Millis
}
