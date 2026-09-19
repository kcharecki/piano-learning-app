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
import { createMidiDrumOutput, type MidiDrumOutput } from './drumMidiOut.ts'
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
  /** The `output.selectedDeviceId` the current `midiDrumOutput` voice was built (or last reset) for — DR-06 port switch, see `ensureMidiTarget`. */
  let midiSelectedId: string | null = null
  let midiDrumOutput: MidiDrumOutput | undefined
  let lastVolume = 1
  /** Unsubscribes the current voice's `onDevicesChanged` listener below — re-armed on every device swap. */
  let unsubscribeDeviceChange: (() => void) | undefined

  /**
   * Lazily builds (once per distinct `MidiOutput` instance) the MIDI drum
   * voice for `output`. A device swap (`output !== midiOutputInstance`)
   * silences whatever the OLD instance was still ringing before the
   * reassignment (review A4) — otherwise a note scheduled on the previous
   * device has no `allNotesOff` left in this router that can ever reach it
   * again, since `midiDrumOutput` is about to stop pointing at it.
   *
   * Also subscribes to `output.onDevicesChanged` (review amber 5, then RED
   * round 2): the per-hit `reset()` in `pickTarget` only runs when a
   * strike/click actually lands DURING an outage — an unplug immediately
   * followed by a re-plug with no hit in between never calls `pickTarget`
   * while the device is unlisted, so that per-hit reset alone would leave a
   * stale `openHat` set and the FIRST hi-hat after the re-plug would still
   * send a stray `noteOff`. But `MidiAccess.onstatechange` (`webmidi.ts`)
   * fires for EVERY port on the system, input or output — plugging in the
   * learner's piano while the drum module never moved must not reset a
   * legitimately still-ringing open hat and drop its real note-off. So the
   * handler checks the emitted `devices` payload itself: a device-list event
   * that DROPS the selected output makes its hat state unknown and is what
   * resets it, not any device-list event. The old subscription is torn down
   * before a new one is added on a device swap; there is no router-level
   * `dispose()` to also unsubscribe from (`DrumAudioOutput` has none, and
   * this router's own return value below adds none) — this module-level
   * singleton is assumed to live for the app's lifetime, same as `synth`.
   *
   * ## Port switch on the SAME instance (DR-06 wave 14)
   *
   * `selectMidiOutputPort` (`audioRoute.ts`) picks a different device by
   * calling `readyMidiOutput.selectDevice(id)` on the one live `MidiOutput`
   * instance — it never swaps in a new instance, so the `output !==
   * midiOutputInstance` check above cannot see a mid-session port change at
   * all. Left alone, the cached voice keeps believing whatever `openHat`
   * rang on the OLD port and would send that note's `noteOff` to the NEW
   * port on the next hi-hat hit — a port that never had it on.
   *
   * A true panic of the OLD port cannot happen HERE, in this router:
   * `WebMidiOutputAdapter` resolves the destination port at SEND time from
   * its own mutable `selectedDeviceId`, not at `noteOn`/`noteOff`
   * time-of-scheduling (`webmidi.ts`'s `currentPort()`/`send()`), and by the
   * time a strike reaches `ensureMidiTarget`, Settings has already called
   * `selectDevice(id)` on this very instance — so `output.selectedDeviceId`
   * already reads the NEW id, and an `allNotesOff()` issued here would
   * resolve to the NEW port, not silence the old one. The real panic already
   * happened earlier and elsewhere: `selectMidiOutputPort` (`audioRoute.ts`)
   * calls `readyMidiOutput.allNotesOff(...)` on the OLD selection the
   * instant BEFORE reassigning it — see that function's own comment for why
   * that timing makes the panic land correctly. What is left to do here is
   * only this router's own bookkeeping: CC 123 silences the device but knows
   * nothing about this module's `openHat` memory, so `reset()` still forgets
   * it, separately, so the next hi-hat hit does not send a stray release for
   * a note the new port never asked to have on.
   */
  function ensureMidiTarget(output: MidiOutput): MidiDrumOutput {
    if (
      midiDrumOutput !== undefined &&
      output === midiOutputInstance &&
      output.selectedDeviceId !== midiSelectedId
    ) {
      midiDrumOutput.reset()
      midiSelectedId = output.selectedDeviceId
      return midiDrumOutput
    }
    if (midiDrumOutput === undefined || output !== midiOutputInstance) {
      midiDrumOutput?.allNotesOff()
      unsubscribeDeviceChange?.()
      midiOutputInstance = output
      midiSelectedId = output.selectedDeviceId
      midiDrumOutput = createMidiDrumOutput({ output, now: () => millis(performance.now()) })
      midiDrumOutput.setVolume(lastVolume)
      unsubscribeDeviceChange = output.onDevicesChanged((devices) => {
        if (!devices.some((d) => d.id === output.selectedDeviceId)) {
          midiDrumOutput?.reset()
        }
      })
    }
    return midiDrumOutput
  }

  /**
   * The output this call should play through, per this module's routing
   * rule. `output !== undefined` alone is not "connected" (roadmap DR-06
   * review RED): `WebMidiOutputAdapter.listDevices()` drops a port the
   * instant its `state` stops being `'connected'`, but `selectedDeviceId`
   * itself is never cleared (see that adapter's own comment) — so an
   * unplugged selection still passes `output !== undefined` while every
   * `send()` on it is silently swallowed. Checking the selection is still
   * among `listDevices()` here is what actually falls back to the synth.
   * The listed-or-not answer is deliberately never cached here — every call
   * re-checks `listDevices()` (cheap: `WebMidiOutputAdapter` caches ITS side,
   * see that adapter's own comment) so a re-plug resumes MIDI on the very
   * next call, with no Settings visit needed to "notice".
   *
   * A fallback while a `midiDrumOutput` voice is already cached (DR-06
   * review nit) resets it: the device stopping being listed does not rebuild
   * the voice on a later re-plug (`ensureMidiTarget` only rebuilds on a
   * DIFFERENT `MidiOutput` instance, and a re-plug of the same device is the
   * same instance) — so any `hhOpen` it still remembers as ringing must be
   * forgotten now, or the first hi-hat event after the re-plug would send a
   * stray `noteOff` for a note the device never asked to have released (see
   * `drumMidiOut.ts`'s `reset()`).
   */
  function pickTarget(): DrumAudioOutput {
    if (route() === 'midi') {
      const output = getMidi()
      if (output !== undefined) {
        if (output.listDevices().some((d) => d.id === output.selectedDeviceId)) {
          return ensureMidiTarget(output)
        }
        midiDrumOutput?.reset()
      }
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
