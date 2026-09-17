/**
 * Per-rudiment personal records (roadmap DR-10) — the rudiment trainer's
 * tempo ladder (`@app/drums/rudiments/useRudimentTrainer.ts`) writes here
 * whenever it has a clean pass to report, keyed by rudiment id.
 *
 * STATE ONLY, the same rule `drumsHistoryStore.ts` holds itself to: nothing
 * here decides whether a pass was clean, what the next tempo is, or how the
 * ladder ends — `@core/drums/rudiment/tempoLadder.ts` and the trainer hook own
 * all of that. This store only remembers the best of what it is told.
 */
import { create } from 'zustand'

export type RudimentRecord = {
  readonly bestCleanBpm: number
  readonly lastBpm: number
  /** epoch ms */
  readonly at: number
}

export type DrumsRudimentStoreState = {
  /** by rudiment id */
  readonly records: Readonly<Record<string, RudimentRecord>>
}

export type DrumsRudimentStoreActions = {
  /** Keeps the max `bestCleanBpm` seen for this rudiment across calls; `lastBpm`/`at` take the latest call's values. */
  recordRun(rudimentId: string, record: RudimentRecord): void
  /** Replaces the whole collection — called by `persistence.ts`'s restore. */
  hydrate(state: Partial<DrumsRudimentStoreState>): void
}

export type DrumsRudimentStore = DrumsRudimentStoreState & DrumsRudimentStoreActions

export const useDrumsRudimentStore = create<DrumsRudimentStore>((set) => ({
  records: {},

  recordRun: (rudimentId, record) =>
    set((state) => {
      const previous = state.records[rudimentId]
      const bestCleanBpm =
        previous === undefined ? record.bestCleanBpm : Math.max(previous.bestCleanBpm, record.bestCleanBpm)
      return {
        records: {
          ...state.records,
          [rudimentId]: { ...record, bestCleanBpm },
        },
      }
    }),
  hydrate: (state) => set(state),
}))
