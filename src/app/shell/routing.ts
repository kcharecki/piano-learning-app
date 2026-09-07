/**
 * The impure half of the shell's router (roadmap 5.42, extended DR-01): wires
 * `route.ts`'s pure `parseAppRoute`/`serializeAppRoute` to the browser's
 * History API. This is the whole router — a hand-rolled one, preferred over
 * adding a routing library for a couple dozen destinations with no nesting.
 *
 * `useRoute()` is the only export a screen ever needs: the current `AppRoute`
 * (read from `location.pathname`, kept in sync with `popstate`) and a
 * `navigate` function that pushes (or replaces) a new entry. `Shell.tsx`
 * uses it as its single source of navigation truth — see that file for how
 * a route's generic `params.id`/`level` round-trips through the specific
 * `OpenedTechnique`/`OpenedDeck`/`OpenedTheoryDrill` shapes.
 *
 * DR-01: a bare `/` no longer has a fixed instrument — `parseAppRoute` needs
 * a `defaultInstrument` for that one ambiguous case, and `readInstrumentHint`
 * (the synchronous localStorage hint `instrumentStore.ts` writes on every
 * instrument change) supplies it here, so the FIRST render — before
 * `App.tsx`'s async `restoreSession` ever runs — already lands on whichever
 * instrument the learner left off in. See `instrumentStore.ts`'s module
 * comment for the full reasoning and its honest limit.
 *
 * Every path crossing the boundary between `route.ts` and the History API
 * goes through `basePath.ts`. Route paths are rooted at `/`; browser paths
 * are rooted at wherever the app is hosted, which on GitHub Pages is
 * `/piano-learning-app/`. Skipping that translation makes the deployed app
 * fall back to the default screen on every reload and deep link.
 */
import { useCallback, useEffect, useState } from 'react'
import { parseAppRoute, serializeAppRoute, type AppRoute } from './route.ts'
import { BASE_URL, toBrowserPath, toRoutePath } from './basePath.ts'
import { readInstrumentHint } from '@app/state/instrumentStore.ts'

export type NavigateOptions = {
  /** Replace the current history entry instead of pushing a new one — used
   * for the initial normalization of a path `parseAppRoute` had to fall back
   * on (`/`, an unknown path), so that URL never becomes a Back-button stop
   * of its own. */
  readonly replace?: boolean
}

export type UseRouteResult = {
  readonly route: AppRoute
  navigate(route: AppRoute, options?: NavigateOptions): void
}

function currentAppRoute(): AppRoute {
  return parseAppRoute(toRoutePath(window.location.pathname, BASE_URL), readInstrumentHint())
}

export function useRoute(): UseRouteResult {
  const [route, setRoute] = useState<AppRoute>(currentAppRoute)

  useEffect(() => {
    // The path the app booted on may not be the canonical serialization of
    // the route it fell back to (an unknown path, or a bare `/`) — replace
    // it so the address bar shows the real destination without adding a
    // Back-button stop for a URL the learner never actually chose.
    const canonical = toBrowserPath(serializeAppRoute(route), BASE_URL)
    if (window.location.pathname !== canonical) {
      window.history.replaceState(null, '', canonical)
    }
    // Only ever run once, against the route the app booted with — this is
    // not meant to re-run when `route` changes via `navigate` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onPopState(): void {
      setRoute(currentAppRoute())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((next: AppRoute, options?: NavigateOptions): void => {
    const path = toBrowserPath(serializeAppRoute(next), BASE_URL)
    if (options?.replace === true) {
      window.history.replaceState(null, '', path)
    } else {
      window.history.pushState(null, '', path)
    }
    setRoute(next)
  }, [])

  return { route, navigate }
}
