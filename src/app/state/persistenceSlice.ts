/**
 * The two building blocks every persisted slice shares (split out of
 * `persistence.ts` when that file outgrew the 500-line limit): the guarded,
 * never-throwing restore on the way in, and the shape a `persistXxx` hands
 * back on the way out. Slice modules (`persistence.ts`, `persistence.drums.ts`)
 * import from here; nothing here knows any particular store.
 */
import type { Store } from '@core/ports/index.ts'

/**
 * Reads `key` from `collection`, validates it, and — only if valid — applies
 * it with `setGuard` held `true` for the (synchronous) duration of `apply`.
 * Never throws: a store error, a `isValid` that itself throws, or an invalid
 * payload all resolve to `false` and leave the caller's state on its
 * defaults, because a learner who cannot start the app has lost more than a
 * learner who lost their saved state. The `get` and `isValid` call share one
 * `try` deliberately — a throwing validator must degrade exactly like a
 * throwing store, not escape uncaught and abort every OTHER slice's restore
 * behind it (see `restoreSession`'s "each independent" contract).
 */
export async function restoreSlice<T>(
  store: Store,
  collection: string,
  key: string,
  isValid: (value: unknown) => value is T,
  setGuard: (guarding: boolean) => void,
  apply: (value: T) => void,
): Promise<boolean> {
  let raw: T
  try {
    const value = await store.get<unknown>(collection, key)
    if (!isValid(value)) return false
    raw = value
  } catch {
    return false
  }
  setGuard(true)
  try {
    apply(raw)
  } finally {
    setGuard(false)
  }
  return true
}

/**
 * What every `persistXxx` hands back to `startPersisting`: how to stop
 * listening, and how to best-effort-drain whatever this slice's queue is
 * currently holding (roadmap follow-up F.2's page-hide flush).
 */
export type PersistedSlice = {
  readonly unsubscribe: () => void
  readonly flush: () => void
}
