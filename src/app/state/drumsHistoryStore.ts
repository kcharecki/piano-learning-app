/**
 * Finished groove runs (roadmap DR-09/T.17) — the store the trainer appends a
 * scored `DrumsGrooveAttempt` to when a run ends, and reads back as "Last
 * run: …" when the learner returns to the screen.
 *
 * STATE ONLY, the same rule `techniqueStore.ts` and `progressStore.ts` hold
 * themselves to: nothing here decides whether a run was steady or what a
 * limb's offset was. `@core/drums/practice/grade.ts` owns that judgement and
 * the caller hands over an already-scored attempt.
 *
 * Newest first and capped, because this store IS wired into `persistence.ts`'s
 * write queue — an uncapped history grows the saved blob without bound.
 */
import type { DrumsGrooveAttempt } from '@core/drums/practice/attempt.ts'
import { create } from 'zustand'

/** See the module comment on why this is capped at all. */
export const MAX_STORED_DRUMS_ATTEMPTS = 100

export type DrumsHistoryStoreState = {
  /** Newest first, capped at `MAX_STORED_DRUMS_ATTEMPTS`. */
  readonly attempts: readonly DrumsGrooveAttempt[]
}

export type DrumsHistoryStoreActions = {
  /** Prepends `attempt`; anything beyond the cap is dropped. */
  addAttempt(attempt: DrumsGrooveAttempt): void
  /** Replaces the whole collection — called by `persistence.ts`'s restore. */
  hydrate(state: Partial<DrumsHistoryStoreState>): void
}

export type DrumsHistoryStore = DrumsHistoryStoreState & DrumsHistoryStoreActions

export const useDrumsHistoryStore = create<DrumsHistoryStore>((set) => ({
  attempts: [],

  addAttempt: (attempt) =>
    set((state) => ({
      attempts: [attempt, ...state.attempts].slice(0, MAX_STORED_DRUMS_ATTEMPTS),
    })),
  hydrate: (state) => set(state),
}))
