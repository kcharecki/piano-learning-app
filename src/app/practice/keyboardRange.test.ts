import { describe, expect, it } from 'vitest'
import { buildTestScore } from '@test/fixtures.ts'
import { PIANO_HIGHEST_MIDI, PIANO_LOWEST_MIDI } from '@core/shared/units.ts'
import { keyboardRangeFor } from './keyboardRange.ts'

const scoreWith = (midis: readonly number[]) =>
  buildTestScore(
    midis.map((midi, i) => ({ midi, startTick: i * 120 })),
    { measureCount: 4 },
  )

describe('keyboardRangeFor', () => {
  it('defaults to C3–B5 when there is no score', () => {
    expect(keyboardRangeFor(undefined)).toEqual({ low: 48, high: 83 })
  })

  it('defaults when the score has no notes at all', () => {
    expect(keyboardRangeFor(buildTestScore([], { measureCount: 2 }))).toEqual({ low: 48, high: 83 })
  })

  it('widens out to whole octaves — C at the bottom, B at the top', () => {
    // D4 (62) .. F5 (77) -> C4 (60) .. B5 (83).
    const range = keyboardRangeFor(scoreWith([62, 77]))
    expect(range.low % 12).toBe(0)
    expect((range.high + 1) % 12).toBe(0)
    expect(range.low).toBeLessThanOrEqual(62)
    expect(range.high).toBeGreaterThanOrEqual(77)
  })

  it('always contains every note of the score', () => {
    for (const midis of [[60], [21, 108], [40, 41], [72, 73, 74], [36, 96]]) {
      const range = keyboardRangeFor(scoreWith(midis))
      for (const midi of midis) {
        expect(midi).toBeGreaterThanOrEqual(range.low)
        expect(midi).toBeLessThanOrEqual(range.high)
      }
    }
  })

  it('widens a narrow piece to a playable number of keys', () => {
    // A single note would otherwise draw one octave; 25 keys is two.
    const range = keyboardRangeFor(scoreWith([60]))
    expect(range.high - range.low + 1).toBeGreaterThanOrEqual(25)
  })

  it('never runs off the ends of an 88-key instrument', () => {
    const range = keyboardRangeFor(scoreWith([21, 108]))
    expect(range.low).toBeGreaterThanOrEqual(PIANO_LOWEST_MIDI)
    expect(range.high).toBeLessThanOrEqual(PIANO_HIGHEST_MIDI)
  })
})
