import { describe, expect, it } from 'vitest'
import {
  isRecord,
  typeOf,
  requireString,
  optionalString,
  requireFiniteNumber,
  optionalFiniteNumber,
  requireBoolean,
  parseArray,
} from '@core/progress/parseHelpers.ts'
import { err, ok, type Result } from '@core/shared/result.ts'

describe('isRecord', () => {
  it('accepts a plain object', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
  })

  it('rejects arrays, null, and primitives', () => {
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
    expect(isRecord(1)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
  })
})

describe('typeOf', () => {
  it('names null and array distinctly from typeof', () => {
    expect(typeOf(null)).toBe('null')
    expect(typeOf([])).toBe('array')
    expect(typeOf([1, 2])).toBe('array')
  })

  it('falls back to the built-in typeof for everything else', () => {
    expect(typeOf('x')).toBe('string')
    expect(typeOf(1)).toBe('number')
    expect(typeOf(true)).toBe('boolean')
    expect(typeOf(undefined)).toBe('undefined')
    expect(typeOf({})).toBe('object')
  })
})

describe('requireString', () => {
  it('returns the string on the happy path', () => {
    const result = requireString({ name: 'hi' }, 'name', 'root')
    expect(result).toEqual(ok('hi'))
  })

  it('rejects a missing key with the path-prefixed message', () => {
    const result = requireString({}, 'name', 'root')
    expect(result).toEqual(err('root.name: expected string, got undefined'))
  })

  it('rejects a wrong-typed value with the path-prefixed message', () => {
    const result = requireString({ name: 42 }, 'name', 'root')
    expect(result).toEqual(err('root.name: expected string, got number'))
  })
})

describe('optionalString', () => {
  it('returns the string when present', () => {
    expect(optionalString({ name: 'hi' }, 'name', 'root')).toEqual(ok('hi'))
  })

  it('returns undefined (ok) when absent', () => {
    expect(optionalString({}, 'name', 'root')).toEqual(ok(undefined))
  })

  it('distinguishes "absent" from "present but wrong type"', () => {
    const absent = optionalString({}, 'name', 'root')
    const wrongType = optionalString({ name: 42 }, 'name', 'root')
    expect(absent).toEqual(ok(undefined))
    expect(wrongType).toEqual(err('root.name: expected string, got number'))
    expect(absent).not.toEqual(wrongType)
  })
})

describe('requireFiniteNumber', () => {
  it('returns the number on the happy path', () => {
    expect(requireFiniteNumber({ n: 3 }, 'n', 'root')).toEqual(ok(3))
  })

  it('rejects a missing key', () => {
    expect(requireFiniteNumber({}, 'n', 'root')).toEqual(
      err('root.n: expected finite number, got undefined'),
    )
  })

  it('rejects NaN and Infinity, not just wrong types', () => {
    expect(requireFiniteNumber({ n: NaN }, 'n', 'root')).toEqual(
      err('root.n: expected finite number, got number'),
    )
    expect(requireFiniteNumber({ n: Infinity }, 'n', 'root')).toEqual(
      err('root.n: expected finite number, got number'),
    )
  })

  it('rejects a wrong-typed value', () => {
    expect(requireFiniteNumber({ n: '3' }, 'n', 'root')).toEqual(
      err('root.n: expected finite number, got string'),
    )
  })
})

describe('optionalFiniteNumber', () => {
  it('returns the number when present', () => {
    expect(optionalFiniteNumber({ n: 3 }, 'n', 'root')).toEqual(ok(3))
  })

  it('returns undefined (ok) when absent', () => {
    expect(optionalFiniteNumber({}, 'n', 'root')).toEqual(ok(undefined))
  })

  it('distinguishes "absent" from "present but wrong type"', () => {
    const absent = optionalFiniteNumber({}, 'n', 'root')
    const wrongType = optionalFiniteNumber({ n: 'x' }, 'n', 'root')
    expect(absent).toEqual(ok(undefined))
    expect(wrongType).toEqual(err('root.n: expected finite number, got string'))
    expect(absent).not.toEqual(wrongType)
  })

  it('rejects a present-but-non-finite value rather than treating it as absent', () => {
    expect(optionalFiniteNumber({ n: NaN }, 'n', 'root')).toEqual(
      err('root.n: expected finite number, got number'),
    )
  })
})

describe('requireBoolean', () => {
  it('returns the boolean on the happy path', () => {
    expect(requireBoolean({ b: true }, 'b', 'root')).toEqual(ok(true))
    expect(requireBoolean({ b: false }, 'b', 'root')).toEqual(ok(false))
  })

  it('rejects a missing key', () => {
    expect(requireBoolean({}, 'b', 'root')).toEqual(
      err('root.b: expected boolean, got undefined'),
    )
  })

  it('rejects a wrong-typed value', () => {
    expect(requireBoolean({ b: 'true' }, 'b', 'root')).toEqual(
      err('root.b: expected boolean, got string'),
    )
  })
})

describe('parseArray', () => {
  const parseNumber = (item: unknown, itemPath: string): Result<number, string> =>
    typeof item === 'number' ? ok(item) : err(`${itemPath}: expected number, got ${typeOf(item)}`)

  it('parses every item on the happy path', () => {
    expect(parseArray([1, 2, 3], 'root', parseNumber)).toEqual(ok([1, 2, 3]))
  })

  it('rejects a non-array value', () => {
    expect(parseArray({}, 'root', parseNumber)).toEqual(
      err('root: expected array, got object'),
    )
  })

  it('propagates the first item failure with an indexed path', () => {
    expect(parseArray([1, 'x', 3], 'root', parseNumber)).toEqual(
      err('root[1]: expected number, got string'),
    )
  })

  it('short-circuits on the first failure without inspecting later items', () => {
    const seen: unknown[] = []
    const recording = (item: unknown, itemPath: string): Result<number, string> => {
      seen.push(item)
      return parseNumber(item, itemPath)
    }
    parseArray([1, 'x', 'y'], 'root', recording)
    expect(seen).toEqual([1, 'x'])
  })
})
