/**
 * The pure half of the shell's router (roadmap 5.42): a path string and a
 * `Route` object, and nothing else — no `window`, no `history`, no React.
 * `routing.ts` is the impure half that wires this to the History API.
 *
 * A `Route` names a destination screen and, for the three destinations the
 * shell already tracks a deep-link identity for (technique drill, flashcard
 * deck, theory quiz — see `Shell.tsx`'s `OpenedTechnique` / `OpenedDeck` /
 * `OpenedTheoryDrill`), an optional `id` and `level`. Those are kept as
 * plain strings/numbers here rather than the richer types `Shell.tsx` uses
 * internally, so this module never needs to import screen-specific unions —
 * `Shell.tsx` does the narrowing (`DECK_KINDS.has(id)`, `techniqueDrillById`,
 * …) both when it builds a `Route` and when it reads one back after a
 * popstate.
 *
 * Lessons, Practice, Repertoire and the rest route at screen granularity
 * only: `LessonsScreen` keeps its selected lesson in its own `useState`
 * (`useLessons.ts`) with no prop or store to seed it from outside, so a
 * lesson body's own selection is not deep-linkable without editing that
 * screen — out of scope for this file, see the shell's task report.
 */

export const SCREEN_IDS = [
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

export type ScreenId = (typeof SCREEN_IDS)[number]

const SCREEN_ID_SET: ReadonlySet<string> = new Set<string>(SCREEN_IDS)

/** Kept generic (`id`/`level`) rather than a per-screen shape — see the module comment. */
export type RouteParams = {
  readonly id?: string
  readonly level?: number
}

export type Route = {
  readonly screen: ScreenId
  readonly params?: RouteParams
}

/** The default destination (roadmap 5.39) — the front door, not Practice. */
export const DEFAULT_ROUTE: Route = { screen: 'today' }

/**
 * `path/to/thing` -> `['path', 'to', 'thing']`, ignoring leading/trailing
 * slashes and collapsing empties (`//`) so `/today/`, `/today` and `today`
 * all parse the same way.
 */
function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter((s) => s.length > 0)
}

/**
 * A URL path -> the `Route` it names. Unknown or empty paths (`/`, `/xyz`,
 * a stale/mistyped link) fall back to `DEFAULT_ROUTE` rather than producing
 * an invalid `Route` — there is no "not found" screen to send them to, and a
 * router that can fail to produce a `Route` at all would push that case onto
 * every caller.
 *
 * A second segment becomes `params.id`; a third becomes `params.level`, kept
 * only when it parses as a finite number (a non-numeric third segment is
 * dropped, not carried through as garbage). Both are opaque strings/numbers
 * here — see the module comment for why the screen-specific validation
 * happens in `Shell.tsx`, not here.
 */
export function parseRoute(path: string): Route {
  const [screenSegment, idSegment, levelSegment] = segmentsOf(path)
  if (screenSegment === undefined || !SCREEN_ID_SET.has(screenSegment)) return DEFAULT_ROUTE
  const screen = screenSegment as ScreenId

  if (idSegment === undefined) return { screen }
  const id = decodeURIComponent(idSegment)

  if (levelSegment === undefined) return { screen, params: { id } }
  const level = Number(levelSegment)
  if (!Number.isFinite(level)) return { screen, params: { id } }
  return { screen, params: { id, level } }
}

/**
 * A `Route` -> the URL path that reaches it, the exact inverse of
 * `parseRoute` for every route `parseRoute` can itself produce (round-trips:
 * `parseRoute(serializeRoute(r)) `always equals a route `parseRoute` could
 * have produced for `r`, which is what the reload proof in 5.42 depends on).
 */
export function serializeRoute(route: Route): string {
  const id = route.params?.id
  const level = route.params?.level
  let path = `/${route.screen}`
  if (id === undefined) return path
  path += `/${encodeURIComponent(id)}`
  if (level === undefined) return path
  path += `/${level}`
  return path
}
