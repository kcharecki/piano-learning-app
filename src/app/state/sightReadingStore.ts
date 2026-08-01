/**
 * Sight-reading trainer state (roadmap 2.12, REQ-3.4.1/3/4/6): the level the
 * generator draws exercises at, and the read history `isRetired` /
 * `nextExerciseParams` / `adaptLevel` (all `core/sightreading/*`) need.
 *
 * STATE ONLY, matching `scoreStore.ts`'s own rule: this module never decides
 * *what* the next level should be — `useSightReadingTrainer.ts` computes that
 * with `adaptLevel` and hands the result to `setLevel`. `addRecord` is a thin
 * wrapper over `retire()` so this store never re-implements the append-only
 * rule that function already encodes.
 *
 * `hydrate` (roadmap 1.24, REQ-3.4.3/3.4.6) replaces `level` and `history`
 * wholesale in one `set`. It exists only for `persistence.ts`'s
 * `restoreSession` to apply a previously-saved level + retirement history —
 * every other caller keeps using `setLevel`/`addRecord`, which is why this is
 * a separate action rather than folded into either of them.
 */
import { retire, type SightReadingRecord } from '@core/sightreading/session.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { create } from 'zustand'

export type SightReadingStoreState = {
  readonly level: number
  readonly history: readonly SightReadingRecord[]
}

export type SightReadingStoreActions = {
  setLevel(level: number): void
  addRecord(record: SightReadingRecord): void
  hydrate(level: number, history: readonly SightReadingRecord[]): void
}

export type SightReadingStore = SightReadingStoreState & SightReadingStoreActions

export const useSightReadingStore = create<SightReadingStore>((set) => ({
  level: MIN_LEVEL,
  history: [],

  setLevel: (level) => set({ level }),
  addRecord: (record) => set((state) => ({ history: retire(state.history, record) })),
  hydrate: (level, history) => set({ level, history }),
}))
