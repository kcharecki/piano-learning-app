import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  classifyHiHat,
  DEFAULT_HI_HAT_CLOSED_THRESHOLD,
  DEFAULT_HI_HAT_CONFIG,
  HI_HAT,
  pad,
  resolveKitMapTarget,
  type HiHatConfig,
} from './kitMap.ts'

describe('pad / HI_HAT builders', () => {
  it('pad() builds a fixed-pad entry', () => {
    expect(pad('kick')).toEqual({ kind: 'pad', pad: 'kick' })
  })

  it('HI_HAT is the CC#4-gated entry', () => {
    expect(HI_HAT).toEqual({ kind: 'hiHat' })
  })
})

describe('classifyHiHat — binary (no half zone)', () => {
  it('defaults to the Roland TD closed threshold of 90', () => {
    expect(DEFAULT_HI_HAT_CONFIG.closedThreshold).toBe(90)
    expect(DEFAULT_HI_HAT_CLOSED_THRESHOLD).toBe(90)
  })

  it('reads exactly at the closed threshold as closed, not half or open', () => {
    expect(classifyHiHat(90)).toBe('closed')
  })

  it('reads one below the closed threshold as open when no half zone is configured', () => {
    expect(classifyHiHat(89)).toBe('open')
  })

  it('reads the extremes correctly', () => {
    expect(classifyHiHat(127)).toBe('closed')
    expect(classifyHiHat(0)).toBe('open')
  })

  it('property: without a half zone, every value is closed or open, never half', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 127 }), fc.integer({ min: 1, max: 127 }), (value, closedThreshold) => {
        const state = classifyHiHat(value, { closedThreshold })
        expect(state === 'closed' || state === 'open').toBe(true)
        expect(state).toBe(value >= closedThreshold ? 'closed' : 'open')
      }),
    )
  })
})

describe('classifyHiHat — with a half zone', () => {
  const config: HiHatConfig = { closedThreshold: 90, halfThreshold: 40 }

  it('reads exactly at the half threshold as half', () => {
    expect(classifyHiHat(40, config)).toBe('half')
  })

  it('reads one below the half threshold as open', () => {
    expect(classifyHiHat(39, config)).toBe('open')
  })

  it('reads one below the closed threshold as half', () => {
    expect(classifyHiHat(89, config)).toBe('half')
  })

  it('property: a configured half zone always sorts into exactly one of the three states, by threshold order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 127 }),
        fc.integer({ min: 1, max: 127 }),
        fc.integer({ min: 0, max: 126 }),
        (value, closedThreshold, half) => {
          fc.pre(half < closedThreshold)
          const state = classifyHiHat(value, { closedThreshold, halfThreshold: half })
          if (value >= closedThreshold) expect(state).toBe('closed')
          else if (value >= half) expect(state).toBe('half')
          else expect(state).toBe('open')
        },
      ),
    )
  })
})

describe('resolveKitMapTarget', () => {
  it('a fixed pad entry passes the pad through with no articulation', () => {
    expect(resolveKitMapTarget(pad('crash1'), 'closed')).toEqual({ pad: 'crash1', articulations: [] })
    // The hi-hat state is irrelevant to a fixed entry — it never looks at it.
    expect(resolveKitMapTarget(pad('crash1'), 'open')).toEqual({ pad: 'crash1', articulations: [] })
  })

  it('a hiHat entry resolves closed to hhClosed with no articulation', () => {
    expect(resolveKitMapTarget(HI_HAT, 'closed')).toEqual({ pad: 'hhClosed', articulations: [] })
  })

  it('a hiHat entry resolves open to hhOpen WITH the open articulation (matches referenceGrooves.ts convention)', () => {
    expect(resolveKitMapTarget(HI_HAT, 'open')).toEqual({ pad: 'hhOpen', articulations: ['open'] })
  })

  it('a hiHat entry resolves half to hhOpen with no articulation — distinguishable from open only by the flag', () => {
    expect(resolveKitMapTarget(HI_HAT, 'half')).toEqual({ pad: 'hhOpen', articulations: [] })
  })
})
