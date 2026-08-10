/**
 * Monophonic pitch detection (roadmap 5.7 / B.1, REQ-3.3.7): the algorithm
 * behind the microphone input fallback. Pure DSP over a sample buffer — no
 * `AudioContext`, no `getUserMedia`. `adapters/audio/micPitchInput.ts` owns
 * the browser edge (capturing audio, running this on a schedule, turning a
 * frequency stream into `MidiEvent`s); this module only ever answers "what
 * pitch is in this buffer, if any."
 *
 * Implementation is the YIN algorithm (de Cheveigné & Kawahara, 2002): a
 * squared-difference function, cumulative-mean normalisation (which is what
 * makes it robust to a struck piano note's decaying amplitude, unlike plain
 * autocorrelation), an absolute threshold to pick the first strong period
 * rather than the loudest one (avoiding octave errors), and parabolic
 * interpolation around the chosen lag for sub-sample precision.
 */

export type PitchDetectionResult = {
  readonly frequencyHz: number
  /** 1 = perfectly periodic signal, 0 = pure noise. Threshold-gated: never returned below `threshold`'s implied floor. */
  readonly clarity: number
}

export type PitchDetectionOptions = {
  /** Below this, a candidate period is rejected as noise. YIN's own default. */
  readonly threshold?: number
  /** Frequencies outside [minHz, maxHz] are never reported, even if periodic. */
  readonly minHz?: number
  readonly maxHz?: number
}

const DEFAULT_THRESHOLD = 0.15
/** A0, the lowest piano note. */
const DEFAULT_MIN_HZ = 27.5
/** Comfortably above C8 (4186 Hz), the highest piano note. */
const DEFAULT_MAX_HZ = 4500

/**
 * `samples`: one channel of PCM, roughly [-1, 1]. `sampleRateHz`: the buffer's
 * sample rate. Returns `null` when no sufficiently periodic signal is found
 * in range — silence, noise, or a buffer too short for the frequency floor.
 */
export function detectPitch(
  samples: Float32Array,
  sampleRateHz: number,
  opts: PitchDetectionOptions = {},
): PitchDetectionResult | null {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const minHz = opts.minHz ?? DEFAULT_MIN_HZ
  const maxHz = opts.maxHz ?? DEFAULT_MAX_HZ

  // YIN needs roughly two full periods of the lowest frequency it will be
  // asked to find within the buffer, for the cumulative-mean step below to
  // have enough taus to normalise against.
  const maxTau = Math.min(Math.floor(sampleRateHz / minHz), Math.floor(samples.length / 2))
  const minTau = Math.max(1, Math.floor(sampleRateHz / maxHz))
  if (maxTau <= minTau) return null

  const diff = differenceFunction(samples, maxTau)
  const cmnd = cumulativeMeanNormalizedDifference(diff)

  const tau = absoluteThreshold(cmnd, minTau, maxTau, threshold)
  if (tau === null) return null

  const refinedTau = parabolicInterpolation(cmnd, tau)
  const frequencyHz = sampleRateHz / refinedTau
  if (frequencyHz < minHz || frequencyHz > maxHz) return null

  const clarity = 1 - (cmnd[tau] ?? 1)
  return { frequencyHz, clarity: Math.max(0, Math.min(1, clarity)) }
}

/** d(tau) = sum over the window of (x[j] - x[j + tau])^2, for tau in [0, maxTau). */
function differenceFunction(samples: Float32Array, maxTau: number): Float64Array {
  const diff = new Float64Array(maxTau)
  const windowLength = samples.length - maxTau
  for (let tau = 0; tau < maxTau; tau++) {
    let sum = 0
    for (let j = 0; j < windowLength; j++) {
      const delta = (samples[j] ?? 0) - (samples[j + tau] ?? 0)
      sum += delta * delta
    }
    diff[tau] = sum
  }
  return diff
}

/**
 * d'(0) = 1 by definition; d'(tau) = d(tau) / ((1/tau) * running sum of d(1..tau))
 * for tau >= 1. This is what lets a single threshold work across notes of
 * very different loudness and decay — a raw difference function does not.
 */
function cumulativeMeanNormalizedDifference(diff: Float64Array): Float64Array {
  const cmnd = new Float64Array(diff.length)
  cmnd[0] = 1
  let runningSum = 0
  for (let tau = 1; tau < diff.length; tau++) {
    runningSum += diff[tau] ?? 0
    const mean = runningSum / tau
    cmnd[tau] = mean === 0 ? 1 : (diff[tau] ?? 0) / mean
  }
  return cmnd
}

/**
 * The first local minimum below `threshold`, scanning from `minTau` upward —
 * NOT the global minimum. Taking the global minimum is the classic
 * autocorrelation octave-error bug: a clean tone's 2nd-period lag is often an
 * even better (smaller) match than its true period.
 */
function absoluteThreshold(
  cmnd: Float64Array,
  minTau: number,
  maxTau: number,
  threshold: number,
): number | null {
  for (let tau = minTau; tau < maxTau; tau++) {
    const value = cmnd[tau]
    if (value === undefined || value >= threshold) continue
    // Walk forward while the dip keeps improving, so we settle on the bottom
    // of this minimum rather than its first sample under threshold.
    let candidate = tau
    while (candidate + 1 < maxTau) {
      const next = cmnd[candidate + 1]
      const current = cmnd[candidate]
      if (next === undefined || current === undefined || next >= current) break
      candidate++
    }
    return candidate
  }
  return null
}

/** Fits a parabola through (tau-1, tau, tau+1) and returns its vertex — sub-sample lag precision. */
function parabolicInterpolation(cmnd: Float64Array, tau: number): number {
  const prevTau = tau > 0 ? tau - 1 : tau
  const nextTau = tau < cmnd.length - 1 ? tau + 1 : tau
  const prev = cmnd[prevTau] ?? cmnd[tau] ?? 0
  const center = cmnd[tau] ?? 0
  const next = cmnd[nextTau] ?? cmnd[tau] ?? 0
  const denominator = prev + next - 2 * center
  if (denominator === 0) return tau
  const vertex = (prev - next) / (2 * denominator)
  // A pathological fit can shift outside the immediate neighbourhood; clamp
  // to +/-1 sample since that is all three points can legitimately move it.
  return tau + Math.max(-1, Math.min(1, vertex))
}

/** A4 = MIDI 69 = 440 Hz, twelve-tone equal temperament. */
export function frequencyToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440)
}

export function midiToFrequency(midiNote: number): number {
  return 440 * 2 ** ((midiNote - 69) / 12)
}

export type NearestNote = {
  /** Nearest integer MIDI note number (not clamped or validated against [0,127] — the caller decides what's in range). */
  readonly note: number
  /** How far the detected pitch is from that note's exact frequency, in cents. Range (-50, 50]. */
  readonly centsOff: number
}

/** Rounds a fractional MIDI pitch to its nearest semitone plus a cents-off remainder. */
export function nearestNote(fractionalMidi: number): NearestNote {
  const note = Math.round(fractionalMidi)
  const centsOff = (fractionalMidi - note) * 100
  return { note, centsOff }
}
