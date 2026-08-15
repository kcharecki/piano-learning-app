import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VELOCITY_THRESHOLDS,
  defaultVelocityForClass,
  velocityClassOf,
  type VelocityThresholds,
} from './velocity.ts'

describe('velocityClassOf', () => {
  it('classifies the default thresholds correctly at the boundaries', () => {
    expect(velocityClassOf(0)).toBe('ghost')
    expect(velocityClassOf(50)).toBe('ghost')
    expect(velocityClassOf(51)).toBe('normal')
    expect(velocityClassOf(99)).toBe('normal')
    expect(velocityClassOf(100)).toBe('accent')
    expect(velocityClassOf(127)).toBe('accent')
  })

  it('honours custom thresholds', () => {
    const thresholds: VelocityThresholds = { ghostMax: 30, accentMin: 110 }
    expect(velocityClassOf(30, thresholds)).toBe('ghost')
    expect(velocityClassOf(31, thresholds)).toBe('normal')
    expect(velocityClassOf(110, thresholds)).toBe('accent')
  })
})

describe('defaultVelocityForClass', () => {
  it('picks a representative velocity inside each class band', () => {
    expect(velocityClassOf(defaultVelocityForClass('ghost'))).toBe('ghost')
    expect(velocityClassOf(defaultVelocityForClass('normal'))).toBe('normal')
    expect(velocityClassOf(defaultVelocityForClass('accent'))).toBe('accent')
  })
})

// A threshold pair with a genuine "normal" band between ghost and accent.
const validThresholds: fc.Arbitrary<VelocityThresholds> = fc
  .tuple(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 61, max: 126 }))
  .map(([ghostMax, accentMin]) => ({ ghostMax, accentMin }))

describe('property: velocity classification', () => {
  it('every velocity 0..127 falls into exactly one class, matching the threshold definition', () => {
    fc.assert(
      fc.property(validThresholds, fc.integer({ min: 0, max: 127 }), (thresholds, velocity) => {
        const cls = velocityClassOf(velocity, thresholds)
        if (velocity <= thresholds.ghostMax) expect(cls).toBe('ghost')
        else if (velocity >= thresholds.accentMin) expect(cls).toBe('accent')
        else expect(cls).toBe('normal')
      }),
    )
  })

  it('defaultVelocityForClass is a fixed point of classification: classifying its own output reproduces the class', () => {
    fc.assert(
      fc.property(fc.constantFrom('ghost', 'normal', 'accent') as fc.Arbitrary<'ghost' | 'normal' | 'accent'>, (cls) => {
        const v = defaultVelocityForClass(cls, DEFAULT_VELOCITY_THRESHOLDS)
        expect(velocityClassOf(v, DEFAULT_VELOCITY_THRESHOLDS)).toBe(cls)
      }),
    )
  })
})
