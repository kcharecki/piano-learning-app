import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  andThen,
  collect,
  err,
  isErr,
  isOk,
  mapErr,
  mapResult,
  ok,
  unwrap,
  unwrapOr,
  type Result,
} from './result.ts'

describe('Result', () => {
  it('narrows via isOk / isErr', () => {
    const good: Result<number> = ok(1)
    const bad: Result<number> = err('boom')
    expect(isOk(good)).toBe(true)
    expect(isErr(good)).toBe(false)
    expect(isOk(bad)).toBe(false)
    expect(isErr(bad)).toBe(true)
    if (isOk(good)) expect(good.value).toBe(1)
    if (isErr(bad)) expect(bad.error).toBe('boom')
  })

  it('maps only the success side', () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual(ok(6))
    expect(mapResult(err<string>('nope'), (n: number) => n * 3)).toEqual(err('nope'))
  })

  it('maps only the error side', () => {
    expect(mapErr(err('nope'), (e) => e.toUpperCase())).toEqual(err('NOPE'))
    expect(mapErr(ok(2), (e: string) => e.toUpperCase())).toEqual(ok(2))
  })

  it('short-circuits andThen on the first error', () => {
    const half = (n: number): Result<number> => (n % 2 === 0 ? ok(n / 2) : err('odd'))
    expect(andThen(ok(8), half)).toEqual(ok(4))
    expect(andThen(ok(7), half)).toEqual(err('odd'))
    expect(andThen(err<string>('earlier'), half)).toEqual(err('earlier'))
  })

  it('unwraps with and without a fallback', () => {
    expect(unwrapOr(ok(5), 0)).toBe(5)
    expect(unwrapOr(err<string>('x'), 0)).toBe(0)
    expect(unwrap(ok(5))).toBe(5)
    expect(() => unwrap(err('bad input'))).toThrow(/bad input/)
  })

  it('collect returns the first error, or all values in order', () => {
    expect(collect([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]))
    expect(collect([ok(1), err('second failed'), err('third failed')])).toEqual(
      err('second failed'),
    )
    expect(collect([])).toEqual(ok([]))
  })

  it('mapResult composes like a functor (identity + composition laws)', () => {
    const f = (n: number) => n + 1
    const g = (n: number) => n * 2
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const r = ok(n)
        expect(mapResult(r, (x) => x)).toEqual(r)
        expect(mapResult(mapResult(r, f), g)).toEqual(mapResult(r, (x) => g(f(x))))
      }),
    )
  })
})
