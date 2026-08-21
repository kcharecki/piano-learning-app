import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { EIGHTH, HALF, QUARTER, SIXTEENTH, TRIPLET_EIGHTH } from '@core/shared/units.ts'
import { writtenTicks, type Tuplet } from './tuplet.ts'

const triplet = (position: Tuplet['position']): Tuplet => ({ actual: 3, normal: 2, position })

describe('writtenTicks', () => {
  // The bug this module exists to prevent: 160 ticks read as a raw duration
  // is a 16th, and a triplet eighth engraved as a 16th is simply wrong.
  it('writes a 160-tick triplet eighth as an eighth, not a sixteenth', () => {
    expect(writtenTicks(TRIPLET_EIGHTH, triplet('start'))).toBe(EIGHTH)
    expect(TRIPLET_EIGHTH).toBeLessThan(EIGHTH)
    expect(TRIPLET_EIGHTH).toBeGreaterThan(SIXTEENTH)
  })

  it('is independent of where the note sits in its bracket', () => {
    for (const position of ['start', 'inner', 'stop'] as const) {
      expect(writtenTicks(TRIPLET_EIGHTH, triplet(position))).toBe(EIGHTH)
    }
  })

  it('leaves a note outside any tuplet exactly as it sounds', () => {
    expect(writtenTicks(QUARTER)).toBe(QUARTER)
    expect(writtenTicks(EIGHTH, undefined)).toBe(EIGHTH)
  })

  it('handles a duplet — two in the time of three', () => {
    expect(writtenTicks(720, { actual: 2, normal: 3, position: 'start' })).toBe(480)
  })

  // Property: the definition itself — `actual` notes SOUND for as long as
  // `normal` of them are WRITTEN. This is what keeps a group filling a whole
  // beat instead of drifting off it, and it is the invariant a wrong ratio
  // breaks. (An earlier draft of this test compared the written total against
  // the sounding total and failed: those differ by exactly the ratio, which is
  // the entire point of a tuplet.)
  it('property: `actual` notes sound for exactly as long as `normal` are written', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 9 }),
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom<number>(QUARTER, EIGHTH, HALF),
        (actual, normal, unit) => {
          const sounding = (unit * normal) / actual
          const written = writtenTicks(sounding, { actual, normal, position: 'inner' })
          expect(actual * sounding).toBeCloseTo(normal * written, 6)
        },
      ),
    )
  })
})
