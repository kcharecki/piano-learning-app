import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  detectPitch,
  frequencyToMidi,
  midiToFrequency,
  nearestNote,
} from '@core/audio/pitchDetection.ts'
import { PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI } from '@core/shared/units.ts'

const SAMPLE_RATE = 44100
const BUFFER_LENGTH = 4096

/** A pure sine tone at `frequencyHz`, the input YIN is designed to recover exactly. */
function sineWave(frequencyHz: number, length: number, sampleRateHz: number): Float32Array {
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    samples[i] = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRateHz)
  }
  return samples
}

function whiteNoise(length: number, rng: () => number): Float32Array {
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i++) samples[i] = rng() * 2 - 1
  return samples
}

const arbPianoMidi = fc.integer({ min: PIANO_LOWEST_MIDI, max: PIANO_HIGHEST_MIDI })

describe('detectPitch', () => {
  it('recovers the exact frequency of a pure sine tone at concert pitch (A4, 440 Hz)', () => {
    const result = detectPitch(sineWave(440, BUFFER_LENGTH, SAMPLE_RATE), SAMPLE_RATE)
    expect(result).not.toBeNull()
    expect(result?.frequencyHz).toBeCloseTo(440, 0)
    expect(result?.clarity).toBeGreaterThan(0.9)
  })

  it('property: a sine tone at every piano note round-trips to the same MIDI note, within a few cents', () => {
    // 200 runs of a real O(bufferLength * maxTau) YIN pass comfortably clear
    // the default 5s timeout uninstrumented, but coverage instrumentation
    // slows it enough to need headroom.
    fc.assert(
      fc.property(arbPianoMidi, (midiNote) => {
        const freq = midiToFrequency(midiNote)
        const result = detectPitch(sineWave(freq, BUFFER_LENGTH, SAMPLE_RATE), SAMPLE_RATE)
        expect(result).not.toBeNull()
        const detected = nearestNote(frequencyToMidi(result?.frequencyHz ?? 0))
        expect(detected.note).toBe(midiNote)
        expect(Math.abs(detected.centsOff)).toBeLessThan(10)
      }),
      { numRuns: 200 },
    )
  }, 20000)

  it('returns null for silence', () => {
    expect(detectPitch(new Float32Array(BUFFER_LENGTH), SAMPLE_RATE)).toBeNull()
  })

  it('returns null for white noise (no stable period)', () => {
    // A fixed LCG, not Math.random — deterministic, and core code must never
    // depend on real randomness even inside a test that only feeds a fixture.
    let seed = 42
    const rng = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const result = detectPitch(whiteNoise(BUFFER_LENGTH, rng), SAMPLE_RATE)
    expect(result === null || result.clarity < 0.5).toBe(true)
  })

  it('returns null when the buffer is too short to see the requested minHz', () => {
    // 128 samples at 44.1kHz can't contain even one period of a 27.5 Hz tone.
    const result = detectPitch(sineWave(27.5, 128, SAMPLE_RATE), SAMPLE_RATE)
    expect(result).toBeNull()
  })

  it('rejects a frequency whose fundamental AND every harmonic-of-its-period fall outside an explicit [minHz, maxHz] window', () => {
    // A pure sine is periodic at every integer multiple of its own period, so
    // narrowing the search band only rejects it cleanly when none of those
    // multiples' lags land inside the band either. 880 Hz has period ~50.1
    // samples at 44.1kHz; its first two multiples (50 and 100 samples) both
    // fall outside the [63, 73]-sample band implied by [600, 700] Hz.
    const result = detectPitch(sineWave(880, BUFFER_LENGTH, SAMPLE_RATE), SAMPLE_RATE, {
      minHz: 600,
      maxHz: 700,
    })
    expect(result).toBeNull()
  })

  it('does not octave-error on a tone rich in harmonics (square-ish wave)', () => {
    // Sum of the fundamental plus 3rd and 5th harmonics at typical struck-string
    // ratios — a plain autocorrelation peak-pick tends to lock onto the octave
    // above; YIN's cumulative-mean step and first-dip rule should not.
    const freq = midiToFrequency(60) // middle C
    const samples = new Float32Array(BUFFER_LENGTH)
    for (let i = 0; i < BUFFER_LENGTH; i++) {
      const t = i / SAMPLE_RATE
      samples[i] =
        Math.sin(2 * Math.PI * freq * t) +
        0.5 * Math.sin(2 * Math.PI * freq * 3 * t) +
        0.3 * Math.sin(2 * Math.PI * freq * 5 * t)
    }
    const result = detectPitch(samples, SAMPLE_RATE)
    expect(result).not.toBeNull()
    expect(nearestNote(frequencyToMidi(result?.frequencyHz ?? 0)).note).toBe(60)
  })
})

describe('frequencyToMidi / midiToFrequency', () => {
  it('440 Hz is MIDI 69 (A4)', () => {
    expect(frequencyToMidi(440)).toBeCloseTo(69, 6)
    expect(midiToFrequency(69)).toBeCloseTo(440, 6)
  })

  it('property: midiToFrequency and frequencyToMidi are inverses over the piano range', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 127 }), (n) => {
        expect(frequencyToMidi(midiToFrequency(n))).toBeCloseTo(n, 6)
      }),
    )
  })

  it('property: one octave up doubles frequency', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 115 }), (n) => {
        expect(midiToFrequency(n + 12)).toBeCloseTo(midiToFrequency(n) * 2, 6)
      }),
    )
  })
})

describe('nearestNote', () => {
  it('an exact note frequency rounds with zero cents off', () => {
    expect(nearestNote(69)).toEqual({ note: 69, centsOff: 0 })
  })

  it('property: centsOff is always within a half-semitone (50 cents)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 127, noNaN: true }), (fractional) => {
        const { centsOff } = nearestNote(fractional)
        expect(Math.abs(centsOff)).toBeLessThanOrEqual(50)
      }),
    )
  })
})
