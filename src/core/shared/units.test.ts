import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  addTicks,
  dotted,
  EIGHTH,
  HALF,
  isValidMidi,
  midi,
  PIANO_HIGHEST_MIDI,
  PIANO_LOWEST_MIDI,
  QUARTER,
  SIXTEENTH,
  subTicks,
  ticks,
  TICKS_PER_QUARTER,
  TRIPLET_EIGHTH,
  WHOLE,
} from './units.ts'

describe('tick constants', () => {
  it('uses a resolution that keeps common subdivisions integral', () => {
    expect(TICKS_PER_QUARTER).toBe(480)
    for (const divisor of [2, 3, 4, 5, 6, 8, 10, 12, 16]) {
      expect(Number.isInteger(TICKS_PER_QUARTER / divisor)).toBe(true)
    }
  })

  it('relates note values correctly', () => {
    expect(WHOLE).toBe(QUARTER * 4)
    expect(HALF).toBe(QUARTER * 2)
    expect(EIGHTH).toBe(QUARTER / 2)
    expect(SIXTEENTH).toBe(QUARTER / 4)
    expect(TRIPLET_EIGHTH * 3).toBe(QUARTER)
  })

  it('dots a value by adding half of it', () => {
    expect(dotted(QUARTER)).toBe(720)
    expect(dotted(HALF)).toBe(1440)
    expect(dotted(EIGHTH)).toBe(360)
  })
})

describe('tick arithmetic', () => {
  it('adds and subtracts', () => {
    expect(addTicks(ticks(100), ticks(50))).toBe(150)
    expect(subTicks(ticks(100), ticks(50))).toBe(50)
  })

  it('subtraction inverts addition', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e6 }), fc.integer({ min: 0, max: 1e6 }), (a, b) => {
        expect(subTicks(addTicks(ticks(a), ticks(b)), ticks(b))).toBe(a)
      }),
    )
  })
})

describe('midi', () => {
  it('accepts the full MIDI range', () => {
    expect(midi(0)).toBe(0)
    expect(midi(60)).toBe(60)
    expect(midi(127)).toBe(127)
  })

  it('rejects out-of-range and non-integer values', () => {
    expect(() => midi(-1)).toThrow(RangeError)
    expect(() => midi(128)).toThrow(RangeError)
    expect(() => midi(60.5)).toThrow(RangeError)
    expect(() => midi(NaN)).toThrow(RangeError)
  })

  it('isValidMidi agrees with the constructor on every input', () => {
    fc.assert(
      fc.property(fc.double({ min: -200, max: 300, noNaN: true }), (n) => {
        const valid = isValidMidi(n)
        if (valid) expect(midi(n)).toBe(n)
        else expect(() => midi(n)).toThrow(RangeError)
      }),
    )
  })

  it('covers the 88-key piano range A0–C8', () => {
    expect(PIANO_LOWEST_MIDI).toBe(21)
    expect(PIANO_HIGHEST_MIDI).toBe(108)
    expect(PIANO_HIGHEST_MIDI - PIANO_LOWEST_MIDI + 1).toBe(88)
  })
})
