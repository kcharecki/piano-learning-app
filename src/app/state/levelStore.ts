/**
 * Per-track level store (roadmap 2.36, REQ-2.1–2.3) — a plain state container,
 * mirroring `techniqueStore.ts`/`repertoireStore.ts`'s shape exactly: this
 * store never decides what a valid level is, whether an override sticks, or
 * whether advancement criteria are met. Every one of those decisions belongs
 * to `@core/progress/levels.ts` (`setLevel`/`advance`); this module just holds
 * the resulting `LevelState` and calls through.
 *
 * Roadmap 4.3 claimed "the dashboard shows three independent track levels; a
 * manual override moves one and survives a reload" while nothing in
 * `src/app` imported `@core/progress/levels.ts` — this store (plus its
 * `persistence.ts` slice) is the missing wiring for the "survives a reload"
 * half of that claim. The dashboard read + override UI is a separate module.
 */
import {
  advance as advanceCore,
  initialLevelState,
  setLevel as setLevelCore,
  type LevelState,
  type ProgressEvidence,
} from '@core/progress/levels.ts'
import type { CurriculumLevel, Track } from '@core/curriculum/types.ts'
import { create } from 'zustand'

export type LevelStoreState = {
  readonly levelState: LevelState
}

export type LevelStoreActions = {
  /** REQ-2.3 manual placement: clamps to MIN_LEVEL..MAX_LEVEL and marks the track overridden. */
  setTrackLevel(track: Track, levelNumber: number): void
  /**
   * REQ-2.2 gated advancement; a no-op on an overridden track, when criteria
   * are unmet, or when `level.number` does not match the track's current
   * level (a mismatched level is a caller error handled as a no-op here,
   * rather than throwing `@core`'s invariant into a React event handler).
   */
  advanceTrack(level: CurriculumLevel, track: Track, evidence: ProgressEvidence): void
  /** Replaces the whole slice — for persistence restore, mirroring the sibling stores. */
  hydrate(state: Partial<LevelStoreState>): void
}

export type LevelStore = LevelStoreState & LevelStoreActions

export const useLevelStore = create<LevelStore>((set, get) => ({
  levelState: initialLevelState(),

  setTrackLevel: (track, levelNumber) =>
    set({ levelState: setLevelCore(get().levelState, track, levelNumber) }),

  advanceTrack: (level, track, evidence) => {
    const state = get().levelState
    if (level.number !== state.levels[track]) return
    set({ levelState: advanceCore(state, level, track, evidence) })
  },

  hydrate: (state) => set(state),
}))
