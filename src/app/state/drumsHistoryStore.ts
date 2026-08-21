/**
 * Graded groove runs (roadmap DR-09) — the store `useGrooveDrill` appends a
 * finished `DrumsGrooveAttempt` to when a run ends, in the same shape
 * `techniqueStore.ts` uses for the piano side's technique attempts.
 *
 * STATE ONLY, matching `techniqueStore`'s own rule: this module never decides
 * whether a run was clean or what any pad's offset was. The caller hands over
 * an already-graded attempt, built by `gradeGroovePerformance`
 * (`@core/drums/practice/grooveGrader.ts`), which is the module that owns that
 * judgement.
 *
 * Newest first, capped at `MAX_STORED_GROOVE_ATTEMPTS` — same reasoning as
 * `techniqueStore`'s cap: this store IS wired into `persistence.ts`'s write
 * queue, so an uncapped history would grow the saved blob without bound.
 * `hydrate` is what the restore calls.
 */
import type { DrumsGrooveAttempt } from '@core/drums/practice/attempt.ts'
import { create } from 'zustand'

/** See the module comment on why this is capped at all. */
export const MAX_STORED_GROOVE_ATTEMPTS = 200

export type DrumsHistoryStoreState = {
  /** Newest first, capped at `MAX_STORED_GROOVE_ATTEMPTS`. */
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
      attempts: [attempt, ...state.attempts].slice(0, MAX_STORED_GROOVE_ATTEMPTS),
    })),
  hydrate: (state) => set(state),
}))
