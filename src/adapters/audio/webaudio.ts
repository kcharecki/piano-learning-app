/**
 * Web Audio implementation of `AudioOutput` (REQ-4.7 fallback, REQ-4.1 latency
 * budget). Used when there is no MIDI-out device to route to — see
 * `selectAudioOutput` in `./index.ts` for the preference order.
 *
 * This is a synthesised voice, not a sampled instrument: a short-decay
 * oscillator per note with a simple attack/decay/sustain/release envelope. It
 * does not fetch a soundfont or anything else over the network (REQ-4.2 is
 * offline-first) — a real sampled soundfont can replace `createOscillator`
 * here later behind the exact same `AudioOutput` interface, so nothing above
 * this module needs to change when it does. For now it is good enough to
 * hear the metronome pulse and preview a chord.
 *
 * All scheduling is done on the Web Audio clock via `AudioParam` automation
 * and `start`/`stop` times, never `setTimeout` — that is what keeps it sample
 * accurate and immune to JS event-loop jitter.
 */
import type { AudioOutput } from '@core/ports/audio.ts'
import { millis, type Midi, type Millis } from '@core/shared/units.ts'

/** Fraction of a quarter second before a struck note reaches full volume. */
const ATTACK_S = 0.005
/** Time to fall from the attack peak to the sustain level — the "pluck". */
const DECAY_S = 0.12
/** Sustain level as a fraction of the attack peak. */
const SUSTAIN_LEVEL = 0.35
/** Fade-out time once `noteOff` (or the safety net below) releases the note. */
const RELEASE_S = 0.25
/**
 * Safety net: if `noteOff` never arrives for a note (a caller bug, or a
 * sustain pedal state that never got cleared), release it anyway after this
 * long so the oscillator does not run — and leak in the `voices` list —
 * forever. `noteOff`, when it does arrive, simply reschedules the release
 * earlier; the browser keeps only the last-scheduled stop time.
 */
const MAX_HOLD_S = 8
/** Headroom so a full chord of simultaneous notes does not clip. */
const VOICE_PEAK_GAIN = 0.28

const CLICK_DURATION_S = 0.035
const CLICK_FREQUENCY_HZ = 1500
const ACCENTED_CLICK_FREQUENCY_HZ = 2200
const CLICK_PEAK_GAIN = 0.5
const ACCENTED_CLICK_PEAK_GAIN = 0.8
/** `exponentialRampToValueAtTime` can never target exactly 0. */
const CLICK_RAMP_FLOOR = 0.0001

/** A2 = 440 Hz at MIDI note 69, twelve notes to the octave. */
function midiToFrequency(note: Midi): number {
  return 440 * 2 ** ((note - 69) / 12)
}

/** 0 (silent) .. 1 (loudest), from a 0–127 MIDI velocity. */
function velocityToGain(velocity: number): number {
  return Math.max(0, Math.min(1, velocity / 127))
}

type Voice = {
  readonly oscillator: OscillatorNode
  readonly gain: GainNode
  /** `null` for a click voice — clicks are never targeted by `noteOff`. */
  readonly note: Midi | null
  /** The gain value `noteOff` ramps down from. Unused by click voices. */
  readonly sustainGain: number
  released: boolean
}

export type WebAudioOutputOptions = {
  /** What the master gain connects to. Defaults to `ctx.destination`. */
  readonly destination?: AudioNode
  /**
   * Oscillator waveform for the note voice. `'triangle'` by default — enough
   * harmonic content that it does not read as a lab test-tone sine, and
   * cheap to compute. See the module comment: this is a placeholder voice.
   */
  readonly waveform?: OscillatorType
}

/**
 * Build a Web Audio-backed `AudioOutput`. `ctx` is injected (never created
 * here) so the caller controls the `AudioContext` lifecycle — and so tests
 * can pass a fake that records the schedule instead of a real one.
 */
export function createWebAudioOutput(
  ctx: AudioContext,
  opts: WebAudioOutputOptions = {},
): AudioOutput {
  const waveform = opts.waveform ?? 'triangle'
  const masterGain = ctx.createGain()
  masterGain.connect(opts.destination ?? ctx.destination)

  const voices: Voice[] = []

  function currentMs(): number {
    return ctx.currentTime * 1000
  }

  function removeVoice(voice: Voice): void {
    const i = voices.indexOf(voice)
    if (i !== -1) voices.splice(i, 1)
  }

  function noteOn(note: Midi, velocity: number, atMs?: Millis): void {
    const startSec = (atMs ?? currentMs()) / 1000
    const peak = VOICE_PEAK_GAIN * velocityToGain(velocity)
    const sustainGain = peak * SUSTAIN_LEVEL

    const oscillator = ctx.createOscillator()
    oscillator.type = waveform
    oscillator.frequency.setValueAtTime(midiToFrequency(note), startSec)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, startSec)
    gain.gain.linearRampToValueAtTime(peak, startSec + ATTACK_S)
    gain.gain.linearRampToValueAtTime(sustainGain, startSec + ATTACK_S + DECAY_S)
    gain.gain.setValueAtTime(sustainGain, startSec + MAX_HOLD_S)
    gain.gain.linearRampToValueAtTime(0, startSec + MAX_HOLD_S + RELEASE_S)

    oscillator.connect(gain)
    gain.connect(masterGain)
    oscillator.start(startSec)
    oscillator.stop(startSec + MAX_HOLD_S + RELEASE_S)

    const voice: Voice = { oscillator, gain, note, sustainGain, released: false }
    oscillator.onended = () => removeVoice(voice)
    voices.push(voice)
  }

  function noteOff(note: Midi, atMs?: Millis): void {
    const offSec = (atMs ?? currentMs()) / 1000
    const voice = voices.find((v) => v.note === note && !v.released)
    if (voice === undefined) return
    voice.released = true
    voice.gain.gain.cancelScheduledValues(offSec)
    voice.gain.gain.setValueAtTime(voice.sustainGain, offSec)
    voice.gain.gain.linearRampToValueAtTime(0, offSec + RELEASE_S)
    voice.oscillator.stop(offSec + RELEASE_S)
  }

  function click(accented: boolean, atMs?: Millis): void {
    const startSec = (atMs ?? currentMs()) / 1000
    const freq = accented ? ACCENTED_CLICK_FREQUENCY_HZ : CLICK_FREQUENCY_HZ
    const peak = accented ? ACCENTED_CLICK_PEAK_GAIN : CLICK_PEAK_GAIN

    const oscillator = ctx.createOscillator()
    // Square, not the note voice's triangle: bright and harmonically dense
    // enough that a 35 ms burst reads as a click, not a pitch.
    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(freq, startSec)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, startSec)
    gain.gain.linearRampToValueAtTime(peak, startSec + 0.001)
    gain.gain.exponentialRampToValueAtTime(CLICK_RAMP_FLOOR, startSec + CLICK_DURATION_S)
    gain.gain.setValueAtTime(0, startSec + CLICK_DURATION_S)

    oscillator.connect(gain)
    gain.connect(masterGain)
    oscillator.start(startSec)
    oscillator.stop(startSec + CLICK_DURATION_S)

    const voice: Voice = { oscillator, gain, note: null, sustainGain: 0, released: true }
    oscillator.onended = () => removeVoice(voice)
    voices.push(voice)
  }

  function allNotesOff(): void {
    const now = ctx.currentTime
    for (const voice of voices) {
      // Cut every voice, including ones whose `start(atMs)` is still in the
      // future: stopping before a node's own start time means it never
      // sounds at all, which is exactly what a panic on seek/loop-wrap needs.
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setValueAtTime(0, now)
      voice.oscillator.stop(now)
    }
    voices.length = 0
  }

  function setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume))
    masterGain.gain.setValueAtTime(clamped, ctx.currentTime)
  }

  function now(): Millis {
    return millis(currentMs())
  }

  return { noteOn, noteOff, click, allNotesOff, setVolume, now }
}
