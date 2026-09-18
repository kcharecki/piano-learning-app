/**
 * Learner's chosen drum audio route (roadmap DR-06): built-in synth or MIDI
 * out on channel 10. Same pattern as `audioRoute.ts` (`localStorage`,
 * try/catch, best effort — see that module's comment for why this is a plain
 * `localStorage` read/write and not the app's usual IndexedDB-backed
 * `persistence.ts`), plus `subscribeDrumAudioRoute`: unlike the piano route,
 * which only ever changes from inside `SettingsScreen` itself, `drumAudio.ts`'s
 * router reads this on every `strike`/`click` call from wherever the Groove
 * trainer is mounted, so the Settings control needs a way to re-render itself
 * when the learner flips the choice — `useSyncExternalStore` over these
 * in-memory listeners, fired synchronously by `setDrumAudioRoute`.
 */
export type DrumAudioRoute = 'synth' | 'midi'

export const DRUM_ROUTE_STORAGE_KEY = 'drums-audio-output-route'

const listeners = new Set<(route: DrumAudioRoute) => void>()

/**
 * In-memory cache of the current route, read from `localStorage` once and
 * kept in sync by `setDrumAudioRoute` — `getDrumAudioRoute` is `Settings`'s
 * `useSyncExternalStore` `getSnapshot`, called on every render, so hitting
 * `localStorage` (a synchronous, occasionally slow browser API) that often
 * is real, avoidable work. `undefined` means "not read yet".
 */
let cachedRoute: DrumAudioRoute | undefined

function readStoredRoute(): DrumAudioRoute {
  try {
    return localStorage.getItem(DRUM_ROUTE_STORAGE_KEY) === 'midi' ? 'midi' : 'synth'
  } catch {
    return 'synth'
  }
}

/** Reads the learner's stored preference (cached after the first read); defaults to the always-available built-in synth. */
export function getDrumAudioRoute(): DrumAudioRoute {
  if (cachedRoute === undefined) cachedRoute = readStoredRoute()
  return cachedRoute
}

/**
 * Persists the learner's choice and notifies subscribers. Best-effort on
 * storage — being blocked or full must not crash Settings, and must not stop
 * the choice applying for the rest of this session, so the cache updates and
 * listeners still fire even when the write itself failed.
 */
export function setDrumAudioRoute(route: DrumAudioRoute): void {
  cachedRoute = route
  try {
    localStorage.setItem(DRUM_ROUTE_STORAGE_KEY, route)
  } catch {
    /* storage unavailable — the route still applies for the rest of this session */
  }
  for (const listener of listeners) listener(route)
}

/**
 * Test-only: clears the in-memory cache so the next `getDrumAudioRoute` read
 * hits `localStorage` again — call from a test file's `afterEach` alongside
 * `localStorage.clear()` when that file shares one module instance across
 * its `it()` blocks rather than `vi.resetModules()`-ing per test.
 */
export function __resetDrumAudioRouteCache(): void {
  cachedRoute = undefined
}

/** Subscribe to route changes fired by `setDrumAudioRoute`. Returns an unsubscribe function. */
export function subscribeDrumAudioRoute(listener: (route: DrumAudioRoute) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
