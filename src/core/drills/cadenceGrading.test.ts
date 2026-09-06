import { describe, expect, it } from 'vitest'
import { midi, type Midi } from '@core/shared/units.ts'
import { chordForRomanNumeral } from '@core/theory/harmony.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { toMidi, pitchClass } from '@core/theory/pitch.ts'
import { cadenceGroupMatches, type CadenceAnswer } from './cadenceGrading.ts'

const C_MAJOR = keyFromFifths(0, 'major')

function chord(numeral: string) {
  const result = chordForRomanNumeral(numeral, C_MAJOR)
  if (!result.ok) throw new Error(`'${numeral}' must be diatonic in C major: ${result.error}`)
  return result.value
}

function answer(type: CadenceAnswer['type'], first: string, second: string): CadenceAnswer {
  return {
    type,
    chords: [chord(first), chord(second)],
    tonicPitchClass: pitchClass(toMidi(C_MAJOR.tonic)),
  }
}

const notes = (...ns: readonly number[]): readonly Midi[] => ns.map((n) => midi(n))

const PAC = answer('perfect-authentic', 'V', 'I')

describe('cadenceGroupMatches — is this the chord?', () => {
  it('accepts the complete triad, in any octave arrangement', () => {
    expect(cadenceGroupMatches(PAC, 0, notes(67, 71, 74))).toBe(true)
    // G2 D4 B5 — same three pitch classes, spread over three octaves, bass
    // still the root.
    expect(cadenceGroupMatches(PAC, 0, notes(43, 62, 83))).toBe(true)
  })

  it('accepts any doubling of chord tones', () => {
    expect(cadenceGroupMatches(PAC, 0, notes(55, 67, 71, 74, 79))).toBe(true)
  })

  it('accepts a chord with the fifth omitted — root, third, doubled root', () => {
    expect(cadenceGroupMatches(PAC, 1, notes(60, 64, 72))).toBe(true)
  })

  it('refuses a chord missing its third, which is what fixes the quality', () => {
    // C4 G4 C5: an open fifth is not a triad.
    expect(cadenceGroupMatches(PAC, 1, notes(60, 67, 72))).toBe(false)
  })

  it('refuses a chord missing its root', () => {
    // E4 G4 E5 — the third and fifth alone.
    expect(cadenceGroupMatches(PAC, 1, notes(64, 67, 76))).toBe(false)
  })

  it('refuses any note that is not a chord tone', () => {
    // C4 E4 G4 A4 — A belongs to neither chord.
    expect(cadenceGroupMatches(PAC, 1, notes(60, 64, 67, 69))).toBe(false)
  })

  it('refuses an empty group', () => {
    expect(cadenceGroupMatches(PAC, 0, [])).toBe(false)
  })
})

describe('cadenceGroupMatches — root position, for a perfect authentic cadence', () => {
  it('refuses an inverted dominant', () => {
    // B3 D4 G4 — V6.
    expect(cadenceGroupMatches(PAC, 0, notes(59, 62, 67))).toBe(false)
  })

  it('refuses an inverted tonic even when the soprano is right', () => {
    // E4 G4 C5 C6 — tonic on top, third in the bass.
    expect(cadenceGroupMatches(PAC, 1, notes(64, 67, 72, 84))).toBe(false)
  })

  it('does not impose root position on a half, plagal or deceptive cadence', () => {
    const half = answer('half', 'I', 'V')
    const plagal = answer('plagal', 'IV', 'I')
    const deceptive = answer('deceptive', 'V', 'vi')
    // I6 — third in the bass — opening a half cadence is still a half cadence.
    expect(cadenceGroupMatches(half, 0, notes(64, 67, 72))).toBe(true)
    // IV6.
    expect(cadenceGroupMatches(plagal, 0, notes(69, 72, 77))).toBe(true)
    // V6 into a deceptive cadence.
    expect(cadenceGroupMatches(deceptive, 0, notes(59, 62, 67))).toBe(true)
  })
})

describe('cadenceGroupMatches — the tonic on top, for the final chord only', () => {
  it('accepts the tonic in the highest voice', () => {
    expect(cadenceGroupMatches(PAC, 1, notes(60, 64, 67, 72))).toBe(true)
  })

  it('refuses the fifth in the highest voice — that is an IMPERFECT authentic cadence', () => {
    expect(cadenceGroupMatches(PAC, 1, notes(60, 64, 67, 79))).toBe(false)
  })

  it('refuses the third in the highest voice', () => {
    expect(cadenceGroupMatches(PAC, 1, notes(60, 64, 67, 76))).toBe(false)
  })

  it('does not require a tonic soprano on the PENULTIMATE chord', () => {
    // D5 on top of the dominant — the requirement is about the tonic chord.
    expect(cadenceGroupMatches(PAC, 0, notes(67, 71, 74))).toBe(true)
  })

  it('does not require a tonic soprano at all on a half cadence', () => {
    const half = answer('half', 'I', 'V')
    expect(cadenceGroupMatches(half, 1, notes(67, 71, 74))).toBe(true)
  })
})
