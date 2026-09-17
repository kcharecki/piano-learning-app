/**
 * `DrumAudioOutput` — the one sound port the drum side of the domain may use
 * (docs/drums/features/DR-06). The piano side speaks in pitches through
 * `AudioOutput.noteOn`; a drum kit has no pitches, only pads, so the port
 * speaks in pads and leaves "what a snare sounds like" to the adapter.
 *
 * `atMs` is an absolute instant on the **`Clock` epoch** — the same one
 * `Clock.now()` and Web MIDI's `event.timeStamp` use (`performance.now()` in
 * the browser) — never an implementation's own internal clock. Omit for
 * "now". This is binding on every implementation, for the same reason it is
 * on `AudioOutput`: the trainer schedules a whole preview from one clock
 * reading and hands the instants to whichever output it was given.
 *
 * ## The open hi-hat is released by the next hi-hat event, not by a timer
 *
 * `hhOpen` sustains until the next `hhClosed`, `hhPedal` or `hhOpen` strike on
 * this output, whether that strike is scheduled ahead (a preview) or arrives
 * live (the learner's own pad). Roadmap T.32 records why a wall-clock ring
 * length is wrong: at 200 bpm a fixed 240 ms covers the next three strokes the
 * staff draws under it. An implementation is free to also fade the open hat
 * on its own after a musically long time (a couple of seconds), so a lone
 * open hat with nothing after it does not ring forever.
 *
 * ## `click`'s `gain` (roadmap DR-12)
 *
 * The drums metronome suite voices each click of a bar independently — a
 * downbeat at full volume, a subdivision click faded down so a learner can
 * wean themselves off the crutch (`@core/timing/clickFilters.ts`'s
 * `voiceClicks`) — so the port needs a per-click loudness, not just the
 * binary accent it already had. `gain` is 0..1, multiplies into whatever
 * peak the click would otherwise play at, and defaults to 1 (unchanged
 * behaviour for every caller that does not pass it). `gain <= 0` must
 * schedule nothing at all — a muted subdivision click is not a click played
 * at an inaudible volume, it is no click.
 */
import type { MappedDrumPad } from '../drums/model/pad.ts'
import type { Millis } from '../shared/units.ts'

export interface DrumAudioOutput {
  /** Strike a pad. `velocity` is MIDI 1–127 and shapes loudness, never timing. */
  strike(pad: MappedDrumPad, velocity: number, atMs?: Millis): void
  /**
   * Metronome click. Accented clicks mark the downbeat. Same contract as
   * `AudioOutput.click`, plus `gain` (0..1, default 1) — see the module
   * comment. `gain <= 0` schedules nothing.
   */
  click(accented: boolean, atMs?: Millis, gain?: number): void
  /** Panic — silence everything now, including a ringing open hat and any scheduled strikes. */
  allNotesOff(): void
  /** 0–1. Applied to app-generated sound. */
  setVolume(volume: number): void
  /** The current instant on the `Clock` epoch `atMs` is on — see the module comment. */
  now(): Millis
}
