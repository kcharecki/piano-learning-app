import { describe, expect, it } from 'vitest'
import { assertNever, at, invariant, InvariantError } from './invariant.ts'

describe('invariant', () => {
  it('passes through truthy conditions', () => {
    expect(() => invariant(true, 'fine')).not.toThrow()
    expect(() => invariant(1, 'fine')).not.toThrow()
    expect(() => invariant('x', 'fine')).not.toThrow()
  })

  it('throws InvariantError on falsy conditions', () => {
    expect(() => invariant(false, 'tempo must be positive')).toThrow(InvariantError)
    expect(() => invariant(0, 'zero')).toThrow(/Invariant violated: zero/)
    expect(() => invariant(null, 'null')).toThrow(InvariantError)
    expect(() => invariant(undefined, 'undefined')).toThrow(InvariantError)
  })

  it('narrows the type after the call', () => {
    const value: string | undefined = 'present'
    invariant(value !== undefined, 'value')
    // Type-level assertion: this line only compiles because `value` narrowed.
    expect(value.length).toBe(7)
  })
})

describe('assertNever', () => {
  it('always throws, reporting the unexpected value', () => {
    expect(() => assertNever('surprise' as never)).toThrow(/surprise/)
    expect(() => assertNever(3 as never, 'bad clef')).toThrow(/bad clef: 3/)
  })
})

describe('at', () => {
  it('returns the element at an in-bounds index', () => {
    expect(at([10, 20, 30], 1)).toBe(20)
  })

  it('throws rather than returning undefined out of bounds', () => {
    expect(() => at([1, 2], 5)).toThrow(/index 5 out of bounds \(length 2\)/)
    expect(() => at([], 0)).toThrow(InvariantError)
    expect(() => at([1, 2], -1)).toThrow(InvariantError)
  })

  it('throws for a genuinely undefined element (sparse array)', () => {
    const sparse = [1, undefined, 3]
    expect(() => at(sparse, 1)).toThrow(InvariantError)
  })
})
