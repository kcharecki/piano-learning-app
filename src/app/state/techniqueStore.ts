/**
 * Technique drill attempts (roadmap 4.4a, REQ-3.7.2/3.7.3) — the store
 * `useTechniqueDrill` appends a finished `TechniqueAttempt` to after every
 * run, in the same shape `progressStore.ts` uses for its own collections, so
 * the dashboard's `tempoHistory`/`bestCleanBpm` readers
 * (`@core/technique/evenness.ts`) have real data to read. `useDashboard.ts`
 * reads this store directly now; the always-`[]` placeholder it once fell back
 * to is gone.
 *
 * STATE ONLY, matching `progressStore`'s own rule: this module never decides
 * whether an attempt was clean or what its evenness/accuracy figures are —
 * the caller hands over an already-scored `TechniqueAttempt`, built by
 * `evennessOf`/`isClean` (the core module that owns that judgement).
 *
 * Newest first, capped at `MAX_STORED_TECHNIQUE_ATTEMPTS` — the same reasoning
 * as `progressStore`'s own caps: this store IS wired into `persistence.ts`'s
 * write queue (`COLLECTIONS.techniqueHistory`), so an uncapped history would
 * grow the saved blob without bound. `hydrate` is what that restore calls; the
 * note this replaces still described the wiring as future and `hydrate` as
 * unused, long after both stopped being true (2026-08-12 M4 acceptance, F.3).
 */
import type { TechniqueAttempt } from '@core/technique/evenness.ts'
import { create } from 'zustand'

/** See the module comment on why this is capped at all. */
export const MAX_STORED_TECHNIQUE_ATTEMPTS = 200

export type TechniqueStoreState = {
  /** Newest first, capped at `MAX_STORED_TECHNIQUE_ATTEMPTS`. */
  readonly attempts: readonly TechniqueAttempt[]
}

export type TechniqueStoreActions = {
  /** Prepends `attempt`; anything beyond the cap is dropped. */
  addAttempt(attempt: TechniqueAttempt): void
  /** Replaces the whole collection — called by `persistence.ts`'s restore, mirroring `progressStore.hydrate`. */
  hydrate(state: Partial<TechniqueStoreState>): void
}

export type TechniqueStore = TechniqueStoreState & TechniqueStoreActions

export const useTechniqueStore = create<TechniqueStore>((set) => ({
  attempts: [],

  addAttempt: (attempt) =>
    set((state) => ({
      attempts: [attempt, ...state.attempts].slice(0, MAX_STORED_TECHNIQUE_ATTEMPTS),
    })),
  hydrate: (state) => set(state),
}))
