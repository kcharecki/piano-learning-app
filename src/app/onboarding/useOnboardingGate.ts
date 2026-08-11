/**
 * Whether the first-run flow has been completed (roadmap 5.40). Mirrors
 * `@app/session/useSessionRun.ts`'s own pattern deliberately: it opens its
 * OWN `Store` connection (default `createIdbStore`, injectable for tests)
 * rather than threading through `App.tsx`/`persistence.ts` — both outside
 * this task's file boundary (`docs/agent-brief.md`) — and reuses
 * `COLLECTIONS.settings` under its own key, the established "no IndexedDB
 * migration needed" pattern every other settings-collection slice already
 * follows (`levelState`, `earTraining`, `todaySessionRun`). IndexedDB
 * natively supports multiple independent connections to the same database,
 * so this neither races nor conflicts with the app's main connection.
 *
 * ## Fail OPEN, not fail closed
 *
 * Same philosophy as `persistence.ts` and `useSessionRun.ts`: a `Store` the
 * browser cannot open must never trap the learner behind an onboarding flow
 * they cannot complete or skip. On a read error, `completed` resolves to
 * `true` — indistinguishable from "already onboarded" — rather than
 * `false`. Only a genuinely empty, SUCCESSFULLY read store (a real fresh
 * install) leaves `completed` at its default `false`, which is what shows
 * the first-run banner at all.
 *
 * This also happens to be why unit-testing `Shell` needs no onboarding seam
 * of its own: happy-dom has no `indexedDB` global at all, so `createIdbStore`
 * always throws there — the fail-open path — and every existing `Shell`
 * test keeps seeing its screen render immediately, exactly as before this
 * roadmap item existed.
 */
import { useEffect, useRef, useState } from 'react'
import type { Store } from '@core/ports/index.ts'
import { COLLECTIONS } from '@core/ports/store.ts'
import { createIdbStore } from '@adapters/store/idb.ts'

export const ONBOARDING_COLLECTION: string = COLLECTIONS.settings
export const ONBOARDING_KEY = 'onboarding'

export type OnboardingRecord = {
  readonly completed: boolean
}

function isValidOnboardingRecord(value: unknown): value is OnboardingRecord {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as Record<string, unknown>).completed === 'boolean'
}

export type UseOnboardingGateOptions = {
  /** Injection seam for tests; defaults to the real IndexedDB store. */
  readonly openStore?: () => Promise<Store>
}

export type UseOnboardingGateResult = {
  /** True once the initial restore attempt has resolved (found, not found, or failed). */
  readonly hydrated: boolean
  readonly completed: boolean
  /** Marks onboarding done — Finish and Skip both call this — and persists it. */
  markCompleted(): void
}

export function useOnboardingGate(options: UseOnboardingGateOptions = {}): UseOnboardingGateResult {
  const openStoreImpl = useRef(options.openStore ?? createIdbStore)
  const storePromiseRef = useRef<Promise<Store> | undefined>(undefined)
  function getStore(): Promise<Store> {
    storePromiseRef.current ??= openStoreImpl.current()
    return storePromiseRef.current
  }

  const [hydrated, setHydrated] = useState(false)
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const store = await getStore()
        const raw = await store.get<unknown>(ONBOARDING_COLLECTION, ONBOARDING_KEY)
        if (!cancelled && isValidOnboardingRecord(raw)) {
          setCompleted(raw.completed)
        }
        // No record found: a genuinely fresh install — `completed` stays false.
      } catch {
        // Fail open — see the module doc.
        if (!cancelled) setCompleted(true)
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
    // One-shot, mount-only restore — `getStore` is stable for this hook's lifetime.
  }, [])

  function markCompleted(): void {
    setCompleted(true)
    void (async () => {
      try {
        const store = await getStore()
        await store.put<OnboardingRecord>(ONBOARDING_COLLECTION, ONBOARDING_KEY, { completed: true })
      } catch {
        // Swallowed — a failed save must not crash the app; worst case the
        // banner reappears next boot, which is annoying, not broken.
      }
    })()
  }

  return { hydrated, completed, markCompleted }
}
