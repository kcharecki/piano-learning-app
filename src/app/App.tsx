import { Shell } from '@app/shell/Shell.tsx'
import { restoreSession, startPersisting } from '@app/state/persistence.ts'
import { createIdbStore } from '@adapters/store/idb.ts'
import type { Store } from '@core/ports/index.ts'
import { useEffect } from 'react'

export type AppProps = {
  /** Injection seam for tests; defaults to the real IndexedDB store (roadmap 1.16/1.23). */
  readonly openStore?: () => Promise<Store>
}

export function App({ openStore = createIdbStore }: AppProps = {}) {
  // Roadmap 1.23. Restore first, subscribe second — `startPersisting`'s call
  // order is mandatory, see its comment. Failure to open the database is
  // swallowed: the app runs fine unpersisted, and refusing to start would cost
  // the learner far more than losing their settings.
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    void (async () => {
      const store = await openStore()
      await restoreSession(store)
      if (!cancelled) stop = startPersisting(store)
    })().catch(() => {})
    return () => {
      cancelled = true
      stop?.()
    }
  }, [openStore])

  return <Shell />
}
