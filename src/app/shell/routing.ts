/**
 * The impure half of the shell's router (roadmap 5.42): wires `route.ts`'s
 * pure `parseRoute`/`serializeRoute` to the browser's History API. This is
 * the whole router — a hand-rolled one, preferred over adding a routing
 * library for a dozen destinations with no nesting.
 *
 * `useRoute()` is the only export a screen ever needs: the current `Route`
 * (read from `location.pathname`, kept in sync with `popstate`) and a
 * `navigate` function that pushes (or replaces) a new entry. `Shell.tsx`
 * uses it as its single source of navigation truth — see that file for how
 * a `Route`'s generic `params.id`/`level` round-trips through the specific
 * `OpenedTechnique`/`OpenedDeck`/`OpenedTheoryDrill` shapes.
 */
import { useCallback, useEffect, useState } from 'react'
import { parseRoute, serializeRoute, type Route } from './route.ts'

export type NavigateOptions = {
  /** Replace the current history entry instead of pushing a new one — used
   * for the initial normalization of a path `parseRoute` had to fall back
   * on (`/`, an unknown path), so that URL never becomes a Back-button stop
   * of its own. */
  readonly replace?: boolean
}

export type UseRouteResult = {
  readonly route: Route
  navigate(route: Route, options?: NavigateOptions): void
}

function currentRoute(): Route {
  return parseRoute(window.location.pathname)
}

export function useRoute(): UseRouteResult {
  const [route, setRoute] = useState<Route>(currentRoute)

  useEffect(() => {
    // The path the app booted on may not be the canonical serialization of
    // the route it fell back to (an unknown path, or a bare `/`) — replace
    // it so the address bar shows the real destination without adding a
    // Back-button stop for a URL the learner never actually chose.
    const canonical = serializeRoute(route)
    if (window.location.pathname !== canonical) {
      window.history.replaceState(null, '', canonical)
    }
    // Only ever run once, against the route the app booted with — this is
    // not meant to re-run when `route` changes via `navigate` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onPopState(): void {
      setRoute(currentRoute())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((next: Route, options?: NavigateOptions): void => {
    const path = serializeRoute(next)
    if (options?.replace === true) {
      window.history.replaceState(null, '', path)
    } else {
      window.history.pushState(null, '', path)
    }
    setRoute(next)
  }, [])

  return { route, navigate }
}
