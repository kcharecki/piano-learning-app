import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ARTICULATIONS, isArticulation, isSticking, STICKINGS } from './articulation.ts'

describe('ARTICULATIONS', () => {
  it('is exactly the spec\'s five articulations', () => {
    expect([...ARTICULATIONS].sort()).toEqual(['buzz', 'choke', 'drag', 'flam', 'open'].sort())
  })

  it('isArticulation accepts every listed articulation and rejects nonsense', () => {
    for (const a of ARTICULATIONS) expect(isArticulation(a)).toBe(true)
    expect(isArticulation('rimshot')).toBe(false)
    expect(isArticulation('')).toBe(false)
  })

  it('property: isArticulation is exactly membership in ARTICULATIONS', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(isArticulation(s)).toBe((ARTICULATIONS as readonly string[]).includes(s))
      }),
    )
  })
})

describe('STICKINGS', () => {
  it('is exactly R and L', () => {
    expect([...STICKINGS].sort()).toEqual(['L', 'R'])
  })

  it('isSticking accepts R/L and rejects anything else', () => {
    expect(isSticking('R')).toBe(true)
    expect(isSticking('L')).toBe(true)
    expect(isSticking('r')).toBe(false)
    expect(isSticking('')).toBe(false)
  })
})
