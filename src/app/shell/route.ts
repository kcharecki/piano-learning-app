/**
 * The pure half of the shell's router (roadmap 5.42, DR-01): a path string
 * and an `AppRoute` object, and nothing else — no `window`, no `history`, no
 * React. `routing.ts` is the impure half that wires this to the History API.
 *
 * DR-01 added a concept ABOVE the original single-app `Route`: `AppRoute`
 * names an `Instrument` ('piano' | 'drums') plus that instrument's own
 * `PianoRoute`/`DrumsRoute` — a discriminated union, not a bare `{
 * instrument, route: Route }` pair, so `appRoute.instrument === 'piano'`
 * narrows `appRoute.route` to `PianoRoute` at the type level (no cast, no
 * runtime check duplicated). Piano keeps its original 13 screens and every
 * deep-link identity (technique drill, flashcard deck, theory quiz — see
 * `Shell.tsx`'s `OpenedTechnique`/`OpenedDeck`/`OpenedTheoryDrill`) exactly
 * as roadmap 5.42 left them; drums gets its own, currently one-screen, union
 * that grows per phase. `/drums/...` is the only new URL space — every
 * existing piano path stays unprefixed and canonical (no `/piano/`
 * migration, no broken bookmark).
 *
 * `parseAppRoute`'s `defaultInstrument` parameter exists for exactly one
 * case: a bare `/` (or any path with no leading segment at all) names no
 * instrument, so the caller decides which home it falls back to — `routing.ts`
 * passes the learner's last-used instrument (read synchronously from a
 * localStorage hint, `instrumentStore.ts`'s `readInstrumentHint`, the same
 * "IndexedDB can't be read synchronously so cache the paint-time answer"
 * pattern `themeStore.ts` already uses). Every OTHER path is unambiguous —
 * a `/drums/...` prefix or a real piano screen segment always wins over the
 * default, which the round-trip property test below proves.
 *
 * Lessons, Practice, Repertoire and the rest route at screen granularity
 * only: `LessonsScreen` keeps its selected lesson in its own `useState`
 * (`useLessons.ts`) with no prop or store to seed it from outside, so a
 * lesson body's own selection is not deep-linkable without editing that
 * screen — out of scope for this file, see the shell task's own report.
 */

export type Instrument = 'piano' | 'drums'

export const PIANO_SCREEN_IDS = [
  'today',
  'lessons',
  'practice',
  'sight-reading',
  'flashcards',
  'ear-training',
  'rhythm',
  'technique',
  'metronome',
  'theory',
  'repertoire',
  'progress',
  'settings',
] as const

export type PianoScreenId = (typeof PIANO_SCREEN_IDS)[number]

const PIANO_SCREEN_ID_SET: ReadonlySet<string> = new Set<string>(PIANO_SCREEN_IDS)

/**
 * Drums' own screen union (DR-01, phase D0): just the placeholder home for
 * now — "Drums — start here" (`src/app/drums/DrumsTodayScreen.tsx`). Every
 * later DR item that adds a drums screen adds its id here, exactly like
 * `PIANO_SCREEN_IDS` above.
 */
export const DRUMS_SCREEN_IDS = ['drums-today', 'drums-notation-dev'] as const

export type DrumsScreenId = (typeof DRUMS_SCREEN_IDS)[number]

/**
 * Drums screen id -> URL segment (DR-01). The id itself carries a `drums-`
 * prefix so `DrumsScreenId` values read unambiguously at any call site
 * (switch statements, test tables) without leaning on the surrounding type —
 * but the URL already spells out the instrument via its own `/drums` prefix,
 * so repeating "drums" in the segment would stutter (`/drums/drums-today`).
 * Each screen therefore also gets a leaner URL segment; `serializeAppRoute`
 * writes it, `parseDrumsRoute` (via the reverse map below) reads it back.
 */
const DRUMS_SCREEN_SEGMENTS: Record<DrumsScreenId, string> = {
  'drums-today': 'today',
  // DR-05's development gallery (`/drums/notation-dev`): URL-only, never a
  // nav item — the proof surface for the groove renderer until DR-09 gives
  // it a real trainer home.
  'drums-notation-dev': 'notation-dev',
}

const DRUMS_SEGMENT_TO_SCREEN: ReadonlyMap<string, DrumsScreenId> = new Map(
  (Object.entries(DRUMS_SCREEN_SEGMENTS) as ReadonlyArray<[DrumsScreenId, string]>).map(
    ([screen, segment]) => [segment, screen],
  ),
)

/** Kept generic (`id`/`level`) rather than a per-screen shape — see the module comment. */
export type RouteParams = {
  readonly id?: string
  readonly level?: number
}

export type PianoRoute = {
  readonly screen: PianoScreenId
  readonly params?: RouteParams
}

export type DrumsRoute = {
  readonly screen: DrumsScreenId
  readonly params?: RouteParams
}

/** Either instrument's route shape, with no instrument tag of its own — see `AppRoute`. */
export type Route = PianoRoute | DrumsRoute

/**
 * The router's real top-level type (DR-01): which instrument, plus that
 * instrument's own route, discriminated on `instrument` so narrowing one
 * narrows the other for free.
 */
export type AppRoute =
  | { readonly instrument: 'piano'; readonly route: PianoRoute }
  | { readonly instrument: 'drums'; readonly route: DrumsRoute }

/** The default destination within each instrument (roadmap 5.39 for piano; DR-01 for drums). */
export const PIANO_DEFAULT_ROUTE: PianoRoute = { screen: 'today' }
export const DRUMS_DEFAULT_ROUTE: DrumsRoute = { screen: 'drums-today' }


/**
 * `path/to/thing` -> `['path', 'to', 'thing']`, ignoring leading/trailing
 * slashes and collapsing empties (`//`) so `/today/`, `/today` and `today`
 * all parse the same way.
 */
function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter((s) => s.length > 0)
}

/**
 * The second/third segments -> `RouteParams`, shared by piano and drums
 * (both route at `screen[/id[/level]]` granularity — see the module
 * comment). A second segment becomes `id`; a third becomes `level`, kept
 * only when it parses as a finite number (a non-numeric third segment is
 * dropped, not carried through as garbage).
 */
function paramsFrom(idSegment: string | undefined, levelSegment: string | undefined): RouteParams | undefined {
  if (idSegment === undefined) return undefined
  const id = decodeURIComponent(idSegment)
  if (levelSegment === undefined) return { id }
  const level = Number(levelSegment)
  return Number.isFinite(level) ? { id, level } : { id }
}

function serializeParams(params: RouteParams | undefined): string {
  if (params?.id === undefined) return ''
  const id = `/${encodeURIComponent(params.id)}`
  return params.level === undefined ? id : `${id}/${params.level}`
}

/**
 * `segments` (no leading `drums`, already stripped by `parseAppRoute`) -> a
 * `PianoRoute`. An unknown or empty screen segment falls back to
 * `PIANO_DEFAULT_ROUTE` rather than producing an invalid route — there is no
 * "not found" screen to send it to, and a parser that can fail to produce a
 * route at all would push that case onto every caller.
 */
export function parsePianoRoute(segments: readonly string[]): PianoRoute {
  const [screenSegment, idSegment, levelSegment] = segments
  if (screenSegment === undefined || !PIANO_SCREEN_ID_SET.has(screenSegment)) return PIANO_DEFAULT_ROUTE
  const screen = screenSegment as PianoScreenId
  const params = paramsFrom(idSegment, levelSegment)
  return params === undefined ? { screen } : { screen, params }
}

/**
 * `segments` (with the leading `drums` already stripped by `parseAppRoute`)
 * -> a `DrumsRoute`. The first segment is a URL segment (`DRUMS_SCREEN_SEGMENTS`'
 * values, e.g. `today`), not a raw `DrumsScreenId` — `DRUMS_SEGMENT_TO_SCREEN`
 * does the lookup. `/drums` bare and an unknown `/drums/<x>` both fall back
 * to `DRUMS_DEFAULT_ROUTE` (drums-today) — the same "no dead end" contract
 * `parsePianoRoute` gives piano.
 */
export function parseDrumsRoute(segments: readonly string[]): DrumsRoute {
  const [screenSegment, idSegment, levelSegment] = segments
  const screen = screenSegment === undefined ? undefined : DRUMS_SEGMENT_TO_SCREEN.get(screenSegment)
  if (screen === undefined) return DRUMS_DEFAULT_ROUTE
  const params = paramsFrom(idSegment, levelSegment)
  return params === undefined ? { screen } : { screen, params }
}

/**
 * A URL path -> the `AppRoute` it names (DR-01). A leading `drums` segment
 * selects the drums instrument and hands the rest to `parseDrumsRoute`;
 * anything else is piano's own namespace, unprefixed and unchanged since
 * roadmap 5.42. A path with NO leading segment at all (`/`, `''`) names no
 * instrument, so `defaultInstrument` (the caller's last-used instrument —
 * see the module comment) decides which home it falls back to; every other
 * path is unambiguous regardless of what `defaultInstrument` is.
 */
export function parseAppRoute(path: string, defaultInstrument: Instrument = 'piano'): AppRoute {
  const [first, ...rest] = segmentsOf(path)
  if (first === 'drums') return { instrument: 'drums', route: parseDrumsRoute(rest) }
  if (first === undefined) {
    return defaultInstrument === 'drums'
      ? { instrument: 'drums', route: DRUMS_DEFAULT_ROUTE }
      : { instrument: 'piano', route: PIANO_DEFAULT_ROUTE }
  }
  return { instrument: 'piano', route: parsePianoRoute(segmentsOf(path)) }
}

/**
 * An `AppRoute` -> the URL path that reaches it, the exact inverse of
 * `parseAppRoute` for every route it can itself produce (round-trips:
 * `parseAppRoute(serializeAppRoute(r))` always equals `r` for any concrete
 * `AppRoute`, regardless of `defaultInstrument`, because a concrete route
 * always serializes to an explicit, unambiguous path — see the property test
 * in `route.test.ts`).
 */
export function serializeAppRoute(appRoute: AppRoute): string {
  if (appRoute.instrument === 'drums') {
    const { screen, params } = appRoute.route
    return `/drums/${DRUMS_SCREEN_SEGMENTS[screen]}${serializeParams(params)}`
  }
  const { screen, params } = appRoute.route
  return `/${screen}${serializeParams(params)}`
}
