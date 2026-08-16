import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  DRUMS_DEFAULT_ROUTE,
  DRUMS_SCREEN_IDS,
  PIANO_DEFAULT_ROUTE,
  PIANO_SCREEN_IDS,
  parseAppRoute,
  parseDrumsRoute,
  parsePianoRoute,
  serializeAppRoute,
  type AppRoute,
  type Instrument,
} from './route.ts'

const pianoScreenArb = fc.constantFrom(...PIANO_SCREEN_IDS)
const drumsScreenArb = fc.constantFrom(...DRUMS_SCREEN_IDS)
const instrumentArb: fc.Arbitrary<Instrument> = fc.constantFrom('piano', 'drums')
// Printable ASCII excluding '/', so a round-trip through `serializeAppRoute` ->
// `parseAppRoute` never has to reason about a literal slash inside an id.
const idArb = fc
  .string({ minLength: 1, maxLength: 12, unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_. ") })
  .filter((s) => s.trim().length > 0)
const levelArb = fc.integer({ min: 0, max: 99 })

const appRouteArb: fc.Arbitrary<AppRoute> = fc.oneof(
  pianoScreenArb.map((screen): AppRoute => ({ instrument: 'piano', route: { screen } })),
  fc
    .record({ screen: pianoScreenArb, id: idArb })
    .map(({ screen, id }): AppRoute => ({ instrument: 'piano', route: { screen, params: { id } } })),
  fc
    .record({ screen: pianoScreenArb, id: idArb, level: levelArb })
    .map(({ screen, id, level }): AppRoute => ({ instrument: 'piano', route: { screen, params: { id, level } } })),
  drumsScreenArb.map((screen): AppRoute => ({ instrument: 'drums', route: { screen } })),
  fc
    .record({ screen: drumsScreenArb, id: idArb })
    .map(({ screen, id }): AppRoute => ({ instrument: 'drums', route: { screen, params: { id } } })),
)

describe('parseAppRoute', () => {
  it('maps the root path to the default instrument\'s home when nothing else names one', () => {
    expect(parseAppRoute('/')).toEqual({ instrument: 'piano', route: PIANO_DEFAULT_ROUTE })
    expect(parseAppRoute('')).toEqual({ instrument: 'piano', route: PIANO_DEFAULT_ROUTE })
  })

  it('honours the caller\'s defaultInstrument for a bare root path only', () => {
    expect(parseAppRoute('/', 'drums')).toEqual({ instrument: 'drums', route: DRUMS_DEFAULT_ROUTE })
    expect(parseAppRoute('', 'drums')).toEqual({ instrument: 'drums', route: DRUMS_DEFAULT_ROUTE })
    expect(parseAppRoute('/', 'piano')).toEqual({ instrument: 'piano', route: PIANO_DEFAULT_ROUTE })
  })

  it('falls back to piano\'s default for an unknown, non-drums path regardless of defaultInstrument', () => {
    expect(parseAppRoute('/nope')).toEqual({ instrument: 'piano', route: PIANO_DEFAULT_ROUTE })
    expect(parseAppRoute('/nope', 'drums')).toEqual({ instrument: 'piano', route: PIANO_DEFAULT_ROUTE })
    expect(parseAppRoute('/../etc/passwd')).toEqual({ instrument: 'piano', route: PIANO_DEFAULT_ROUTE })
  })

  it('parses a bare piano screen path, unprefixed', () => {
    expect(parseAppRoute('/practice')).toEqual({ instrument: 'piano', route: { screen: 'practice' } })
    expect(parseAppRoute('/lessons')).toEqual({ instrument: 'piano', route: { screen: 'lessons' } })
  })

  it('a bare /drums normalises to the drums home', () => {
    expect(parseAppRoute('/drums')).toEqual({ instrument: 'drums', route: DRUMS_DEFAULT_ROUTE })
    expect(parseAppRoute('/drums/')).toEqual({ instrument: 'drums', route: DRUMS_DEFAULT_ROUTE })
  })

  it('parses the drums home screen from its URL segment, not its (differently-named) screen id', () => {
    expect(parseAppRoute('/drums/today')).toEqual({ instrument: 'drums', route: { screen: 'drums-today' } })
    // The raw screen id is not itself a valid URL segment (see DRUMS_SCREEN_SEGMENTS in route.ts) —
    // it falls back to the drums default like any other unknown /drums/<x> would.
    expect(parseAppRoute('/drums/drums-today')).toEqual({ instrument: 'drums', route: DRUMS_DEFAULT_ROUTE })
  })

  it('an unknown /drums/<x> falls back to the drums home, same as an unknown piano path does today', () => {
    expect(parseAppRoute('/drums/nope')).toEqual({ instrument: 'drums', route: DRUMS_DEFAULT_ROUTE })
  })

  it('tolerates a trailing slash on a piano path', () => {
    expect(parseAppRoute('/practice/')).toEqual({ instrument: 'piano', route: { screen: 'practice' } })
  })

  it('parses a piano screen + id', () => {
    expect(parseAppRoute('/technique/scale-c-major')).toEqual({
      instrument: 'piano',
      route: { screen: 'technique', params: { id: 'scale-c-major' } },
    })
  })

  it('parses a piano screen + id + level', () => {
    expect(parseAppRoute('/flashcards/interval-on-staff/2')).toEqual({
      instrument: 'piano',
      route: { screen: 'flashcards', params: { id: 'interval-on-staff', level: 2 } },
    })
  })

  it('drops a non-numeric level segment rather than carrying it through', () => {
    expect(parseAppRoute('/theory/triads/not-a-number')).toEqual({
      instrument: 'piano',
      route: { screen: 'theory', params: { id: 'triads' } },
    })
  })

  it('decodes a percent-encoded id segment', () => {
    expect(parseAppRoute('/technique/a%2Fb')).toEqual({
      instrument: 'piano',
      route: { screen: 'technique', params: { id: 'a/b' } },
    })
  })

  it('every existing piano screen still resolves, unprefixed (roadmap 5.42 contract untouched)', () => {
    for (const screen of PIANO_SCREEN_IDS) {
      expect(parseAppRoute(`/${screen}`)).toEqual({ instrument: 'piano', route: { screen } })
    }
  })
})

describe('parsePianoRoute / parseDrumsRoute (the segment-level parsers parseAppRoute delegates to)', () => {
  it('parsePianoRoute falls back to the piano default on an empty or unknown segment list', () => {
    expect(parsePianoRoute([])).toEqual(PIANO_DEFAULT_ROUTE)
    expect(parsePianoRoute(['nope'])).toEqual(PIANO_DEFAULT_ROUTE)
  })

  it('parseDrumsRoute falls back to the drums default on an empty or unknown segment list', () => {
    expect(parseDrumsRoute([])).toEqual(DRUMS_DEFAULT_ROUTE)
    expect(parseDrumsRoute(['nope'])).toEqual(DRUMS_DEFAULT_ROUTE)
  })
})

describe('serializeAppRoute', () => {
  it('serializes a bare piano screen route unprefixed', () => {
    expect(serializeAppRoute({ instrument: 'piano', route: { screen: 'today' } })).toBe('/today')
  })

  it('serializes the drums home under /drums, using the URL segment, not the (differently-named) screen id — no /drums/drums-today stutter', () => {
    expect(serializeAppRoute({ instrument: 'drums', route: DRUMS_DEFAULT_ROUTE })).toBe('/drums/today')
  })

  it('serializes a piano screen + id route', () => {
    expect(
      serializeAppRoute({ instrument: 'piano', route: { screen: 'technique', params: { id: 'scale-c-major' } } }),
    ).toBe('/technique/scale-c-major')
  })

  it('serializes a piano screen + id + level route', () => {
    expect(
      serializeAppRoute({
        instrument: 'piano',
        route: { screen: 'flashcards', params: { id: 'interval-on-staff', level: 2 } },
      }),
    ).toBe('/flashcards/interval-on-staff/2')
  })

  it('percent-encodes an id containing a slash', () => {
    expect(
      serializeAppRoute({ instrument: 'piano', route: { screen: 'technique', params: { id: 'a/b' } } }),
    ).toBe('/technique/a%2Fb')
  })
})

describe('parseAppRoute / serializeAppRoute round-trip (property)', () => {
  it('parsing a serialized route always reproduces it, regardless of defaultInstrument', () => {
    fc.assert(
      fc.property(appRouteArb, instrumentArb, (appRoute, defaultInstrument) => {
        expect(parseAppRoute(serializeAppRoute(appRoute), defaultInstrument)).toEqual(appRoute)
      }),
    )
  })

  it('serializing is stable under a second round-trip through parseAppRoute', () => {
    // Guards the id-encoding path specifically: any parsed route, re-serialized,
    // parses back to the exact same route a second time — not just "some" route.
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), instrumentArb, (path, defaultInstrument) => {
        const once = parseAppRoute(path, defaultInstrument)
        const twice = parseAppRoute(serializeAppRoute(once), defaultInstrument)
        expect(twice).toEqual(once)
      }),
    )
  })
})
