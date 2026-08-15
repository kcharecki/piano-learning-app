import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { InvariantError } from '@core/shared/invariant.ts'
import { millis, ticks } from '@core/shared/units.ts'
import { makeDrumHit } from './hit.ts'

describe('makeDrumHit', () => {
  it('builds a valid raw (millisecond) hit', () => {
    const hit = makeDrumHit({ pad: 'snare', velocity: 100, time: millis(1234) })
    expect(hit).toEqual({ pad: 'snare', velocity: 100, time: millis(1234), articulations: [] })
  })

  it('builds a valid aligned (tick) hit, carrying articulations through', () => {
    const hit = makeDrumHit({ pad: 'snare', velocity: 20, time: ticks(480), articulations: ['flam'] })
    expect(hit.articulations).toEqual(['flam'])
    expect(hit.time).toBe(480)
  })

  it('throws on an unknown pad', () => {
    expect(() => makeDrumHit({ pad: 'cowbell' as never, velocity: 90, time: millis(0) })).toThrow(
      InvariantError,
    )
  })

  it('throws on out-of-range velocity', () => {
    expect(() => makeDrumHit({ pad: 'kick', velocity: -1, time: millis(0) })).toThrow(InvariantError)
    expect(() => makeDrumHit({ pad: 'kick', velocity: 128, time: millis(0) })).toThrow(InvariantError)
    expect(() => makeDrumHit({ pad: 'kick', velocity: 63.5, time: millis(0) })).toThrow(InvariantError)
  })

  it('throws on a negative or non-finite time', () => {
    expect(() => makeDrumHit({ pad: 'kick', velocity: 90, time: millis(-1) })).toThrow(InvariantError)
    expect(() => makeDrumHit({ pad: 'kick', velocity: 90, time: millis(Number.NaN) })).toThrow(
      InvariantError,
    )
  })

  it('throws on an unknown articulation', () => {
    expect(() =>
      makeDrumHit({ pad: 'kick', velocity: 90, time: millis(0), articulations: ['paradiddle' as never] }),
    ).toThrow(InvariantError)
  })
})

describe('property: makeDrumHit velocity acceptance', () => {
  it('accepts every integer 0..127 and rejects everything else', () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 200 }), (velocity) => {
        const build = () => makeDrumHit({ pad: 'kick', velocity, time: millis(0) })
        if (velocity >= 0 && velocity <= 127) expect(build()).toMatchObject({ velocity })
        else expect(build).toThrow(InvariantError)
      }),
    )
  })
})
