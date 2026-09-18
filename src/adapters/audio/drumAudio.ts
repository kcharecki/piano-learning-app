/**
 * The app's one entry point for drum sound (docs/drums/features/DR-06):
 * builds the `DrumAudioOutput` the Groove trainer plays through. Lazy
 * module-level singleton, mirroring
 * `app/practice/createDefaultAudioOutput.ts` — the `AudioContext` inside
 * `createDrumSynth` is itself built lazily on the first `strike`/`click`, so
 * nothing here forces one into existence outside a user gesture.
 *
 * The singleton is a ROUTER (roadmap DR-06 wave 2): every call picks its
 * target — the MIDI drum voice (`drumMidiOut.ts`, channel 10, GM notes) when
 * the learner has chosen the MIDI route (`drumAudioRoute.ts`) AND a MIDI
 * output is actually connected (`audioRoute.ts`'s `getConnectedMidiOutput`),
 * the built-in synth otherwise — so flipping the Settings toggle takes
 * effect on the very next strike, with no reload. The MIDI drum voice is
 * built lazily, once per distinct `MidiOutput` instance (a reconnect swaps
 * it, silencing the old instance first — see `ensureMidiTarget` — review A4).
 *
 * The MIDI drum voice's OWN `now` (review A1) is `performance.now()` directly
 * — the same epoch Web MIDI's `port.send(data, atMs)` schedules against and
 * `midiout.ts`'s piano MIDI-out already uses — never `synth.now()`: that is
 * an EMA *estimate* of `performance.now()` re-anchored around the
 * `AudioContext` clock (`drumSynth.ts`'s `updateOffsetAnchor`), which can read
 * meaningfully early right after a context suspension. Feeding that estimate
 * to Web MIDI's exact millisecond scheduling would mis-time the note against
 * the device. The ROUTER's own `now()` stays `synth.now()`, deliberately: that
 * is the audio-epoch clock the trainers actually schedule whole previews
 * from, regardless of which output ends up playing them.
 *
 * `allNotesOff` and `setVolume` always reach BOTH targets, never just the
 * currently-picked one: a route switch mid-ring must not leave a note
 * hanging on the output that is no longer selected, and a volume change must
 * apply to whichever output the learner switches to next, not just the one
 * that happened to be live when the slider moved.
 */
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import type { DrumAudioOutput } from '@core/ports/drumAudio.ts'
import type { MidiOutput } from '@core/ports/midi.ts'
import { millis, type Millis } from '@core/shared/units.ts'
import { getConnectedMidiOutput } from './audioRoute.ts'
import { getDrumAudioRoute, type DrumAudioRoute } from './drumAudioRoute.ts'
import { createMidiDrumOutput } from './drumMidiOut.ts'
import { createDrumSynth, type DrumSynthOptions } from './drumSynth.ts'

/** Injectable seam for tests — defaults to the real route preference and the real live MIDI connection. */
export type DrumAudioRouterDeps = {
  readonly route?: () => DrumAudioRoute
  readonly midi?: () => MidiOutput | undefined
}

let singleton: DrumAudioOutput | undefined

/**
 * Testable seam: builds (and memoizes) the singleton `DrumAudioOutput` from
 * an injected `AudioContext` factory instead of always `new AudioContext()`
 * — lets a test exercise the memoization here without touching real Web
 * Audio. `createDrumAudioOutput` below is just this with the real factory.
 * `deps` overrides the route/live-MIDI lookups the router uses on every call.
 */
export function createDrumAudioOutputWith(
  context: DrumSynthOptions['context'],
  deps?: DrumAudioRouterDeps,
): DrumAudioOutput {
  if (singleton === undefined) {
    singleton = createDrumAudioRouter(context, deps)
  }
  return singleton
}

export function createDrumAudioOutput(): DrumAudioOutput {
  return createDrumAudioOutputWith(() => new AudioContext())
}

/** Builds the router described in this module's comment. Not exported — always go through the two functions above. */
function createDrumAudioRouter(
  context: DrumSynthOptions['context'],
  deps?: DrumAudioRouterDeps,
): DrumAudioOutput {
  const route = deps?.route ?? getDrumAudioRoute
  const getMidi = deps?.midi ?? getConnectedMidiOutput

  const synth = createDrumSynth({ context })
  let midiOutputInstance: MidiOutput | undefined
  let midiDrumOutput: DrumAudioOutput | undefined
  let lastVolume = 1

  /**
   * Lazily builds (once per distinct `MidiOutput` instance) the MIDI drum
   * voice for `output`. A device swap (`output !== midiOutputInstance`)
   * silences whatever the OLD instance was still ringing before the
   * reassignment (review A4) — otherwise a note scheduled on the previous
   * device has no `allNotesOff` left in this router that can ever reach it
   * again, since `midiDrumOutput` is about to stop pointing at it.
   */
  function ensureMidiTarget(output: MidiOutput): DrumAudioOutput {
    if (midiDrumOutput === undefined || output !== midiOutputInstance) {
      midiDrumOutput?.allNotesOff()
      midiOutputInstance = output
      midiDrumOutput = createMidiDrumOutput({ output, now: () => millis(performance.now()) })
      midiDrumOutput.setVolume(lastVolume)
    }
    return midiDrumOutput
  }

  /** The output this call should play through, per this module's routing rule. */
  function pickTarget(): DrumAudioOutput {
    if (route() === 'midi') {
      const output = getMidi()
      if (output !== undefined) return ensureMidiTarget(output)
    }
    return synth
  }

  function strike(pad: MappedDrumPad, velocity: number, atMs?: Millis): void {
    pickTarget().strike(pad, velocity, atMs)
  }

  function click(accented: boolean, atMs?: Millis, gain?: number): void {
    pickTarget().click(accented, atMs, gain)
  }

  function allNotesOff(): void {
    synth.allNotesOff()
    midiDrumOutput?.allNotesOff()
  }

  function setVolume(volume: number): void {
    lastVolume = volume
    synth.setVolume(volume)
    midiDrumOutput?.setVolume(volume)
  }

  function now(): Millis {
    return synth.now()
  }

  return { strike, click, allNotesOff, setVolume, now }
}
