/**
 * Rhythm reading trainer state (roadmap DR-11): the level the generator draws
 * exercises at, and the run history `adaptReadingLevel`
 * (`@core/drums/reading/index.ts`) needs to decide whether to move it.
 *
 * STATE ONLY, the same rule `drumsHistoryStore.ts` holds itself to: this
 * module never decides whether a level should move — `useReadingTrainer.ts`
 * computes that with `adaptReadingLevel` and hands the result to `setLevel`.
 *
 * Newest first and capped, because this store is wired into the app's
 * persistence write queue — an uncapped history grows the saved blob without
 * bound, the same reasoning `drumsHistoryStore.ts` documents for itself.
 */
import type { ReadingLevel, ReadingRunRecord } from '@core/drums/reading/index.ts'
import { create } from 'zustand'

/** See the module comment on why this is capped at all. */
export const MAX_STORED_READING_RUNS = 30

export type DrumsReadingStoreState = {
  readonly level: ReadingLevel
  /** Newest first, capped at `MAX_STORED_READING_RUNS`. */
  readonly runs: readonly ReadingRunRecord[]
}

export type DrumsReadingStoreActions = {
  setLevel(level: ReadingLevel): void
  /** Prepends `run`; anything beyond the cap is dropped. */
  addRun(run: ReadingRunRecord): void
  /** Replaces level and/or runs wholesale — called by persistence's restore. */
  hydrate(state: Partial<DrumsReadingStoreState>): void
}

export type DrumsReadingStore = DrumsReadingStoreState & DrumsReadingStoreActions

export const useDrumsReadingStore = create<DrumsReadingStore>((set) => ({
  level: 1,
  runs: [],

  setLevel: (level) => set({ level }),
  addRun: (run) =>
    set((state) => ({
      runs: [run, ...state.runs].slice(0, MAX_STORED_READING_RUNS),
    })),
  hydrate: (state) => set(state),
}))
