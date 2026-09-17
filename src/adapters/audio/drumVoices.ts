/**
 * Synthesized drum voices (DR-06, roadmap T.32) — one builder per family,
 * each wiring nodes into the shared master gain at an explicit context time.
 * No samples: every voice is either an oscillator sweep/tone or a filtered
 * slice of one shared noise buffer, so the kit needs no network fetch
 * (offline-first, the same reason `webaudio.ts`'s placeholder piano voice is
 * synthesized rather than sampled).
 *
 * `Voice` is the unit `drumSynth.ts` tracks for `allNotesOff` and for the
 * open-hi-hat choke rule: every builder returns the `GainNode` driving its
 * envelope and the source node making the sound, plus the context time it
 * started, so a caller can cut it short without waiting for its natural
 * decay.
 */

export type Engine = {
  readonly ctx: AudioContext
  readonly masterGain: GainNode
  /** One shared 2s white-noise buffer per context — see `buildNoiseBuffer`. */
  readonly noiseBuffer: AudioBuffer
}

export type Voice = {
  readonly source: OscillatorNode | AudioBufferSourceNode
  readonly gain: GainNode
  readonly startSec: number
  /** When this voice's own `stop()` is scheduled, absent an early choke. */
  readonly stopSec: number
  /** When the attack ramp reaches `peakGain`. */
  readonly attackEndSec: number
  /** The gain value the attack ramp reaches at `attackEndSec`. */
  readonly peakGain: number
  /** When the decay ramp reaches 0, absent an early choke. */
  readonly decayEndSec: number
}

/** Time for a struck voice to reach full volume — fast enough to read as a hit, not a swell. */
export const ATTACK_S = 0.002
/** Slack after a voice's envelope reaches 0 before its source node actually stops. */
export const STOP_TAIL_S = 0.05

/**
 * The longest `decayS` any voice in `drumSynth.ts`'s `buildVoices` table
 * uses (hhOpen, rideEdge, crash1, crash2 all decay over 1.5s) — kept here,
 * not derived from that table, so `buildNoiseBuffer`'s length can be checked
 * against it without a layering inversion (`drumVoices.ts` never imports
 * `drumSynth.ts`). If a future pad's decay grows past this, bump it here too
 * — `drumVoices.test.ts` asserts the noise buffer still outlasts it.
 */
export const LONGEST_VOICE_DECAY_S = 1.5

/** MIDI velocity (1-127) -> gain, per the port contract: shapes loudness, never timing. */
export function velocityToGain(velocity: number): number {
  const clamped = Math.max(1, Math.min(127, velocity))
  return (clamped / 127) ** 1.5
}

/** Length, in seconds, of the shared noise buffer `buildNoiseBuffer` creates. */
export const NOISE_BUFFER_SECONDS = 2

/**
 * One 2-second white-noise buffer, built once per context and shared by
 * every noise-based voice (hi-hats, the snare's noise burst, ride/cymbal
 * family). Two seconds comfortably covers the longest decay any voice here
 * uses (~1.5s), so nothing needs to loop it. Built with a deterministic LCG,
 * not `Math.random()` — an adapter may use real randomness elsewhere, but a
 * fixed seed here is what makes the noise-voice tests assertable at all
 * (the exact sample values are never asserted on; only that the buffer, and
 * therefore the resulting schedule, is reproducible).
 */
export function buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const sampleRate = ctx.sampleRate > 0 ? ctx.sampleRate : 44100
  const length = Math.max(1, Math.round(sampleRate * NOISE_BUFFER_SECONDS))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  let seed = 0x2f6e2b1
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    data[i] = (seed / 0xffffffff) * 2 - 1
  }
  return buffer
}

export type ToneVoiceOptions = {
  readonly startSec: number
  readonly peakGain: number
  readonly waveform: OscillatorType
  /** Starting pitch in Hz. */
  readonly freq: number
  /** When given together with `sweepS`, the oscillator sweeps from `freq` to this pitch. */
  readonly freqTo?: number
  readonly sweepS?: number
  readonly decayS: number
}

/** Sine/triangle sweep-or-tone voice: kick, toms, the snare family's short pitched body, cross stick. */
export function playToneVoice(engine: Engine, opts: ToneVoiceOptions): Voice {
  const { ctx, masterGain } = engine
  const { startSec, peakGain, waveform, freq, freqTo, sweepS, decayS } = opts

  const source = ctx.createOscillator()
  source.type = waveform
  source.frequency.setValueAtTime(freq, startSec)
  if (freqTo !== undefined && sweepS !== undefined && sweepS > 0) {
    // exponentialRampToValueAtTime can never target (or cross) 0 — every
    // pitch used by a voice here is a positive audio-rate frequency, so this
    // is always a legal target.
    source.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), startSec + sweepS)
  }

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, startSec)
  gain.gain.linearRampToValueAtTime(peakGain, startSec + ATTACK_S)
  const decayEndSec = startSec + ATTACK_S + decayS
  gain.gain.linearRampToValueAtTime(0, decayEndSec)

  source.connect(gain)
  gain.connect(masterGain)
  source.start(startSec)
  const stopSec = decayEndSec + STOP_TAIL_S
  source.stop(stopSec)

  return {
    source,
    gain,
    startSec,
    stopSec,
    attackEndSec: startSec + ATTACK_S,
    peakGain,
    decayEndSec,
  }
}

export type NoiseVoiceOptions = {
  readonly startSec: number
  readonly peakGain: number
  readonly filterType: BiquadFilterType
  readonly filterFreq: number
  readonly filterQ?: number
  readonly decayS: number
}

/** Filtered-noise voice: every hi-hat, the snare family's noise burst, ride/cymbal family. */
export function playNoiseVoice(engine: Engine, opts: NoiseVoiceOptions): Voice {
  const { ctx, masterGain, noiseBuffer } = engine
  const { startSec, peakGain, filterType, filterFreq, filterQ, decayS } = opts

  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer

  const filter = ctx.createBiquadFilter()
  filter.type = filterType
  filter.frequency.setValueAtTime(filterFreq, startSec)
  if (filterQ !== undefined) filter.Q.setValueAtTime(filterQ, startSec)

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, startSec)
  gain.gain.linearRampToValueAtTime(peakGain, startSec + ATTACK_S)
  const decayEndSec = startSec + ATTACK_S + decayS
  gain.gain.linearRampToValueAtTime(0, decayEndSec)

  source.connect(filter)
  filter.connect(gain)
  gain.connect(masterGain)
  source.start(startSec)
  const stopSec = decayEndSec + STOP_TAIL_S
  source.stop(stopSec)

  return {
    source,
    gain,
    startSec,
    stopSec,
    attackEndSec: startSec + ATTACK_S,
    peakGain,
    decayEndSec,
  }
}
