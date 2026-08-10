import { defaultParamsForLevel } from '@core/generator/melody.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { describe, expect, it } from 'vitest'
import {
  applyCustomization,
  isCustomizationActive,
  MAJOR_KEYS,
  MINOR_KEYS,
  keyLabel,
  type SightReadingCustomization,
} from './customization.ts'

describe('customization — isCustomizationActive', () => {
  it('is false for an empty customization', () => {
    expect(isCustomizationActive({})).toBe(false)
  })

  it('is false for register explicitly left at "default"', () => {
    expect(isCustomizationActive({ register: 'default' })).toBe(false)
  })

  it.each<[string, SightReadingCustomization]>([
    ['key', { key: keyFromFifths(1, 'major') }],
    ['hands', { hands: 'left' }],
    ['rhythm', { rhythm: 'eighths' }],
    ['noAccidentals', { noAccidentals: true }],
    ['handIndependence', { handIndependence: 'independent' }],
    ['register: low', { register: 'low' }],
    ['register: high', { register: 'high' }],
  ])('is true once %s is set', (_name, customization) => {
    expect(isCustomizationActive(customization)).toBe(true)
  })
})

describe('customization — applyCustomization', () => {
  const base = defaultParamsForLevel(3) // hands: 'both', has a leftRange, density > 0

  it('passes every field through unchanged when nothing is set', () => {
    expect(applyCustomization(base, {})).toEqual(base)
  })

  it('overrides only the key', () => {
    const gMajor = keyFromFifths(1, 'major')
    const result = applyCustomization(base, { key: gMajor })
    expect(result.key).toBe(gMajor)
    expect(result.hands).toBe(base.hands)
    expect(result.rhythm).toBe(base.rhythm)
  })

  it('overrides hands without touching the ranges the generator reads from', () => {
    const result = applyCustomization(base, { hands: 'left' })
    expect(result.hands).toBe('left')
    expect(result.leftRange).toEqual(base.leftRange)
    expect(result.rightRange).toEqual(base.rightRange)
  })

  it('noAccidentals zeroes the density regardless of the level', () => {
    expect(base.accidentalDensity).toBeGreaterThan(0)
    const result = applyCustomization(base, { noAccidentals: true })
    expect(result.accidentalDensity).toBe(0)
  })

  it('leaves accidentalDensity alone when noAccidentals is not set', () => {
    const result = applyCustomization(base, { key: keyFromFifths(0, 'major') })
    expect(result.accidentalDensity).toBe(base.accidentalDensity)
  })

  it('a "high" register shifts both ranges up an octave, preserving width', () => {
    const result = applyCustomization(base, { register: 'high' })
    expect(result.rightRange).toEqual({ low: base.rightRange.low + 12, high: base.rightRange.high + 12 })
    expect(result.leftRange).toEqual({
      low: (base.leftRange?.low ?? 0) + 12,
      high: (base.leftRange?.high ?? 0) + 12,
    })
  })

  it('a "low" register shifts both ranges down an octave', () => {
    const result = applyCustomization(base, { register: 'low' })
    expect(result.rightRange).toEqual({ low: base.rightRange.low - 12, high: base.rightRange.high - 12 })
  })

  it('clamps a register shift to the real piano range, never widening past it', () => {
    // Level 6's right range already runs 55..88; shifting up must not exceed 108.
    const level6 = defaultParamsForLevel(6)
    const result = applyCustomization(level6, { register: 'high' })
    expect(result.rightRange.high).toBeLessThanOrEqual(108)
  })

  it('never mutates leftRange onto a params shape that had none', () => {
    const level1 = defaultParamsForLevel(1) // 'right' hands only, no leftRange
    expect(level1.leftRange).toBeUndefined()
    const result = applyCustomization(level1, { register: 'high', hands: 'left' })
    expect(result.leftRange).toBeUndefined()
  })

  it('applies every field together, all at once', () => {
    const key = keyFromFifths(-2, 'minor')
    const result = applyCustomization(base, {
      key,
      hands: 'right',
      rhythm: 'syncopated',
      noAccidentals: true,
      register: 'low',
    })
    expect(result).toMatchObject({
      key,
      hands: 'right',
      rhythm: 'syncopated',
      accidentalDensity: 0,
    })
    expect(result.rightRange.low).toBe(base.rightRange.low - 12)
  })
})

describe('customization — key lists', () => {
  it('has 15 major keys and 15 relative minors, in matching fifths order', () => {
    expect(MAJOR_KEYS).toHaveLength(15)
    expect(MINOR_KEYS).toHaveLength(15)
    MAJOR_KEYS.forEach((major, i) => {
      expect(MINOR_KEYS[i]?.signature.fifths).toBe(major.signature.fifths)
      expect(MINOR_KEYS[i]?.mode).toBe('minor')
    })
  })

  it('labels a key by its real name', () => {
    expect(keyLabel(keyFromFifths(1, 'major'))).toBe('G major')
    expect(keyLabel(keyFromFifths(0, 'minor'))).toBe('A minor')
  })
})
