import { defaultParamsForLevel } from '@core/generator/melody.ts'
import { keyFromFifths } from '@core/theory/keys.ts'
import { describe, expect, it } from 'vitest'
import {
  applyCustomization,
  isCustomizationActive,
  HANDS_OPTIONS,
  INDEPENDENCE_OPTIONS,
  MAJOR_KEYS,
  MINOR_KEYS,
  REGISTER_OPTIONS,
  RHYTHM_OPTIONS,
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

/**
 * The class this suite guards (roadmap 5.54 follow-up): a picker whose
 * `<option>` list silently stops covering the union it is built from.
 *
 * Two gates already stand in front of these assertions, and neither is here.
 * `tsc` rejects a label map that misses a union member — the maps in
 * `customization.ts` are `Record`s over their unions. An `invariant` at module
 * load rejects a display order that has a label available and leaves it out.
 * Importing this module at all therefore runs the second gate, so these tests
 * are the third thing: they pin what the two gates cannot say, which is that
 * the resulting list is fit to render and ordered the way a beginner is taught.
 *
 * The concrete instance that motivated all three: `RhythmStyle` gained
 * `'quarter-half'` — level 1's own default rhythm (`levelDefaults.ts`) — and
 * the picker never offered it, so the one style a beginner is actually being
 * taught was the one style they could not select, while the list still led
 * with whole notes.
 */
describe('customization — every picker is fit to render', () => {
  const PICKERS = [
    ['rhythm', RHYTHM_OPTIONS],
    ['hands', HANDS_OPTIONS],
    ['handIndependence', INDEPENDENCE_OPTIONS],
    ['register', REGISTER_OPTIONS],
  ] as const

  it.each(PICKERS)('%s renders no blank or duplicated label', (_name, options) => {
    const labels = options.map((o) => o.label)
    expect(labels.every((l) => l.trim().length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it.each(PICKERS)('%s offers at least two real choices', (_name, options) => {
    expect(options.length).toBeGreaterThan(1)
  })

  it("offers level 1's own default rhythm, ahead of the whole-note style", () => {
    const order = RHYTHM_OPTIONS.map((o) => o.value)
    expect(order).toContain('quarter-half')
    expect(order.indexOf('quarter-half')).toBeLessThan(order.indexOf('whole-half'))
    expect(order.indexOf('quarters')).toBeLessThan(order.indexOf('whole-half'))
  })
})
