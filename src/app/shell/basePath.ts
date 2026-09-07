/**
 * Translation between the app's route paths and the browser's paths (hosting).
 *
 * `route.ts` serializes routes as absolute paths rooted at `/` — `/practice`,
 * `/drums/today`. That is true when the app is served from the root of an
 * origin, which is what the dev server does. It is NOT true on GitHub Pages,
 * where the app lives under `/piano-learning-app/`: there the same route is
 * the browser path `/piano-learning-app/practice`, and a router reading
 * `location.pathname` raw sees a path `parseAppRoute` cannot recognise, falls
 * back to the default screen, and then `replaceState`s the address bar to a
 * URL the host does not serve.
 *
 * Keeping the base out of `route.ts` is deliberate: the route grammar is a
 * property of the app, the base is a property of where it happens to be
 * hosted. Only this module knows about the second, and only the shell's
 * router calls it.
 */

/**
 * Vite's configured base, always with a trailing slash — `/` in dev and in
 * the e2e gate's root-served preview, `/piano-learning-app/` in the deployed
 * build (`vite.config.ts`).
 */
export const BASE_URL: string = import.meta.env.BASE_URL

/** The base with its trailing slash removed: `''` at the root, `/piano-learning-app`. */
export function basePrefix(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base
}

/**
 * A browser pathname, as an app route path. A path that is not under the base
 * at all is returned unchanged, so an unrecognised URL still reaches
 * `parseAppRoute`'s own fallback rather than being mangled here first.
 */
export function toRoutePath(pathname: string, base: string): string {
  const prefix = basePrefix(base)
  if (prefix === '') return pathname
  if (pathname === prefix) return '/'
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length)
  return pathname
}

/** An app route path, as the browser pathname that serves it. */
export function toBrowserPath(routePath: string, base: string): string {
  const prefix = basePrefix(base)
  return prefix === '' ? routePath : `${prefix}${routePath}`
}
