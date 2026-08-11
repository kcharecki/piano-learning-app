import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { DEFAULT_ROUTE, SCREEN_IDS, parseRoute, serializeRoute, type Route } from './route.ts'

const screenArb = fc.constantFrom(...SCREEN_IDS)
// Printable ASCII excluding '/', so a round-trip through `serializeRoute` ->
// `parseRoute` never has to reason about a literal slash inside an id.
const idArb = fc
  .string({ minLength: 1, maxLength: 12, unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_. ") })
  .filter((s) => s.trim().length > 0)
const levelArb = fc.integer({ min: 0, max: 99 })

const routeArb: fc.Arbitrary<Route> = fc.oneof(
  screenArb.map((screen): Route => ({ screen })),
  fc.record({ screen: screenArb, id: idArb }).map(({ screen, id }): Route => ({ screen, params: { id } })),
  fc
    .record({ screen: screenArb, id: idArb, level: levelArb })
    .map(({ screen, id, level }): Route => ({ screen, params: { id, level } })),
)

describe('parseRoute', () => {
  it('maps the root path to the default route (Today, roadmap 5.39)', () => {
    expect(parseRoute('/')).toEqual(DEFAULT_ROUTE)
    expect(parseRoute('')).toEqual(DEFAULT_ROUTE)
  })

  it('falls back to the default route for an unknown screen segment', () => {
    expect(parseRoute('/nope')).toEqual(DEFAULT_ROUTE)
    expect(parseRoute('/../etc/passwd')).toEqual(DEFAULT_ROUTE)
  })

  it('parses a bare screen path', () => {
    expect(parseRoute('/practice')).toEqual({ screen: 'practice' })
    expect(parseRoute('/lessons')).toEqual({ screen: 'lessons' })
  })

  it('tolerates a trailing slash', () => {
    expect(parseRoute('/practice/')).toEqual({ screen: 'practice' })
  })

  it('parses a screen + id', () => {
    expect(parseRoute('/technique/scale-c-major')).toEqual({
      screen: 'technique',
      params: { id: 'scale-c-major' },
    })
  })

  it('parses a screen + id + level', () => {
    expect(parseRoute('/flashcards/interval-on-staff/2')).toEqual({
      screen: 'flashcards',
      params: { id: 'interval-on-staff', level: 2 },
    })
  })

  it('drops a non-numeric level segment rather than carrying it through', () => {
    expect(parseRoute('/theory/triads/not-a-number')).toEqual({
      screen: 'theory',
      params: { id: 'triads' },
    })
  })

  it('decodes a percent-encoded id segment', () => {
    expect(parseRoute('/technique/a%2Fb')).toEqual({ screen: 'technique', params: { id: 'a/b' } })
  })
})

describe('serializeRoute', () => {
  it('serializes a bare screen route', () => {
    expect(serializeRoute({ screen: 'today' })).toBe('/today')
  })

  it('serializes a screen + id route', () => {
    expect(serializeRoute({ screen: 'technique', params: { id: 'scale-c-major' } })).toBe(
      '/technique/scale-c-major',
    )
  })

  it('serializes a screen + id + level route', () => {
    expect(
      serializeRoute({ screen: 'flashcards', params: { id: 'interval-on-staff', level: 2 } }),
    ).toBe('/flashcards/interval-on-staff/2')
  })

  it('percent-encodes an id containing a slash', () => {
    expect(serializeRoute({ screen: 'technique', params: { id: 'a/b' } })).toBe('/technique/a%2Fb')
  })
})

describe('parseRoute / serializeRoute round-trip (property)', () => {
  it('parsing a serialized route always reproduces it', () => {
    fc.assert(
      fc.property(routeArb, (route) => {
        expect(parseRoute(serializeRoute(route))).toEqual(route)
      }),
    )
  })

  it('serializing is stable under a second round-trip through parseRoute', () => {
    // Guards the id-encoding path specifically: any parsed route, re-serialized,
    // parses back to the exact same route a second time — not just "some" route.
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (path) => {
        const once = parseRoute(path)
        const twice = parseRoute(serializeRoute(once))
        expect(twice).toEqual(once)
      }),
    )
  })
})
