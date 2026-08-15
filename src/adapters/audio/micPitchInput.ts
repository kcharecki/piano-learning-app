/**
 * Microphone pitch-detection input (roadmap 5.7 / B.1, REQ-3.3.7): the only
 * way the practice loop works at all on iPadOS, where WebKit ships no Web
 * MIDI (see `docs/WORKTREES.md`'s platform-reality note, roadmap B.7).
 *
 * Implements `MidiInput` — the same port `webmidi.ts`'s hardware adapter
 * implements — so everything downstream (`createPlayableInput`, the matcher,
 * wait mode, recording) cannot tell a sung/played-acoustically note from a
 * MIDI one. This is the DOM edge only: capture a `MediaStream`, pull a
 * time-domain buffer off an `AnalyserNode` on a schedule, and hand each
 * buffer to `core/audio/pitchDetection.ts` + `core/audio/noteOnsetDetector.ts`
 * for the actual judgement of what note (if any) that buffer represents. No
 * DSP or debounce logic lives here — see those two modules' own comments for
 * why that split exists.
 *
 * Exposes exactly one synthetic device ("Microphone") once permission is
 * granted, mirroring `webmidi.ts`'s device shape closely enough that
 * `MidiDeviceStatus` and friends render it without special-casing — but
 * `selectDevice` is a no-op and `onDevicesChanged` never fires: unlike a MIDI
 * port list, there is nothing here to hot-plug.
 */
import { DEFAULT_ONSET_CONFIG, initialOnsetState, stepOnsetDetector } from '@core/audio/noteOnsetDetector.ts'
import { detectPitch, type PitchDetectionOptions } from '@core/audio/pitchDetection.ts'
import type { Clock, MidiDevice, MidiEvent, MidiInput, Unsubscribe } from '@core/ports/index.ts'
import type { OnsetConfig } from '@core/audio/noteOnsetDetector.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { isValidMidi, midi, millis } from '@core/shared/units.ts'
import { describeMicError } from './micErrorMessage.ts'

const MIC_DEVICE: MidiDevice = { id: 'microphone', name: 'Microphone', manufacturer: 'Built-in' }

/**
 * Velocity for a note detected acoustically. There is no real dynamics
 * signal to report (amplitude reflects mic gain and distance at least as
 * much as how hard the note was played) — same reasoning, and same value,
 * as `playableInput.ts`'s `ON_SCREEN_VELOCITY`.
 */
export const MIC_VELOCITY = 80

export type MicPitchInput = MidiInput & {
  /** Stop the capture loop, close the `AudioContext`, release the microphone track. Call once, on unmount. */
  dispose(): void
}

export type MicPitchInputOptions = {
  /** Test seam for `navigator.mediaDevices.getUserMedia`. */
  readonly getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  /** Builds the `AudioContext`. Defaults to `new AudioContext()`, called lazily after permission is granted. */
  readonly createContext?: () => AudioContext
  readonly clock?: Clock
  /**
   * Drives the capture loop. `tick` returns `false` when the input has been
   * disposed, telling a real scheduler to stop rescheduling itself. Defaults
   * to `requestAnimationFrame`; tests inject a seam that calls `tick`
   * synchronously instead of waiting on the browser's frame clock.
   */
  readonly scheduleTick?: (tick: () => boolean) => Unsubscribe
  readonly fftSize?: number
  readonly onsetConfig?: OnsetConfig
  readonly pitchOptions?: PitchDetectionOptions
}

function defaultGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
    return Promise.reject(new Error('getUserMedia is not available in this browser.'))
  }
  return navigator.mediaDevices.getUserMedia(constraints)
}

function defaultScheduleTick(tick: () => boolean): Unsubscribe {
  let handle = requestAnimationFrame(function loop() {
    if (tick()) handle = requestAnimationFrame(loop)
  })
  return () => cancelAnimationFrame(handle)
}

/**
 * Request microphone access and wrap it as a `MidiInput`. Never throws —
 * permission denial, no microphone, and an unsupported browser all come back
 * as `err(...)`, the same contract `createWebMidi` has.
 */
export async function createMicPitchInput(
  options: MicPitchInputOptions = {},
): Promise<Result<MicPitchInput, string>> {
  const getUserMedia = options.getUserMedia ?? defaultGetUserMedia

  let stream: MediaStream
  try {
    stream = await getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  } catch (cause) {
    return err(describeMicError('createMicPitchInput', cause))
  }

  const ctx = (options.createContext ?? (() => new AudioContext()))()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = options.fftSize ?? 4096
  source.connect(analyser)

  const buffer = new Float32Array(analyser.fftSize)
  const onsetConfig = options.onsetConfig ?? DEFAULT_ONSET_CONFIG
  const pitchOptions = options.pitchOptions
  const clock: Clock = options.clock ?? { now: () => millis(performance.now()) }
  const scheduleTick = options.scheduleTick ?? defaultScheduleTick

  const handlers = new Set<(event: MidiEvent) => void>()
  let onsetState = initialOnsetState
  let disposed = false

  function tick(): boolean {
    if (disposed) return false
    analyser.getFloatTimeDomainData(buffer)
    const sample = detectPitch(buffer, ctx.sampleRate, pitchOptions)
    const step = stepOnsetDetector(onsetState, sample, onsetConfig)
    onsetState = step.state
    if (step.events.length > 0) {
      const time = clock.now()
      for (const event of step.events) {
        // A detection this far outside the piano's own range points to a
        // detector configuration bug, not a real note — dropped rather than
        // handed to `midi()`, which would throw and take the capture loop
        // down with it.
        if (!isValidMidi(event.note)) continue
        const midiEvent: MidiEvent =
          event.type === 'on'
            ? { type: 'noteOn', note: midi(event.note), velocity: MIC_VELOCITY, time }
            : { type: 'noteOff', note: midi(event.note), time }
        for (const handler of handlers) handler(midiEvent)
      }
    }
    return true
  }

  const unsubscribeTick = scheduleTick(tick)

  return ok({
    listDevices(): readonly MidiDevice[] {
      return disposed ? [] : [MIC_DEVICE]
    },
    onEvent(handler: (event: MidiEvent) => void): Unsubscribe {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    onDevicesChanged(): Unsubscribe {
      return () => {}
    },
    selectDevice(): void {},
    selectedDeviceId: MIC_DEVICE.id,
    dispose(): void {
      if (disposed) return
      disposed = true
      unsubscribeTick()
      handlers.clear()
      for (const track of stream.getTracks()) track.stop()
      source.disconnect()
      analyser.disconnect()
      void ctx.close().catch(() => {})
    },
  })
}
