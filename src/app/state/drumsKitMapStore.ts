/**
 * The learner's chosen kit-map preset (roadmap DR-02) — which note number
 * means which pad for THEIR e-kit. `useDrumMidiInput.ts` reads this store
 * whenever its caller does not pass an explicit `kitMap` option (every
 * trainer and the calibration screen call it that way today), resolving the
 * stored name through `kitMapFor` so a Roland/Alesis/Yamaha kit lands its
 * real notes instead of falling back to General MIDI's — or, for a kit none
 * of the shipped presets fit, the learner's own MIDI-learned map
 * (`KitMapLearnCard.tsx` builds it via `@core/drums/kitmap/learn.ts`).
 *
 * STATE ONLY, the same rule `drumsLatencyStore.ts` holds itself to: nothing
 * here decides what a preset's notes are, or how the wizard builds a learned
 * one — this store only remembers which one the learner picked, and holds
 * the one learned map itself (there is only ever one; learning again
 * overwrites it).
 */
import { create } from 'zustand'
import { LEARNED_KIT_MAP_NAME } from '@core/drums/kitmap/learn.ts'
import { GM_KIT_MAP, KIT_MAP_PRESETS } from '@core/drums/kitmap/presets.ts'
import type { KitMap } from '@core/drums/kitmap/kitMap.ts'

export type DrumsKitMapStoreState = {
  readonly presetName: string
  /** The learner's own MIDI-learned map, if they have built one. There is at most one. */
  readonly learned: KitMap | undefined
}

export type DrumsKitMapStoreActions = {
  setPreset(name: string): void
  /** Stores the learned map and selects it — finishing the wizard is a picker choice like any preset. */
  setLearned(map: KitMap): void
  /** Discards the learned map. Falls back to General MIDI if it was the active selection. */
  clearLearned(): void
  /** Replaces the whole collection — called by `persistence.drums.ts`'s restore. */
  hydrate(state: Partial<DrumsKitMapStoreState>): void
}

export type DrumsKitMapStore = DrumsKitMapStoreState & DrumsKitMapStoreActions

export const useDrumsKitMapStore = create<DrumsKitMapStore>((set, get) => ({
  presetName: GM_KIT_MAP.name,
  learned: undefined,

  setPreset: (name) => set({ presetName: name }),

  setLearned: (map) => set({ learned: map, presetName: LEARNED_KIT_MAP_NAME }),

  clearLearned: () => {
    const { presetName } = get()
    set({
      learned: undefined,
      presetName: presetName === LEARNED_KIT_MAP_NAME ? GM_KIT_MAP.name : presetName,
    })
  },

  hydrate: (state) => set(state),
}))

/**
 * Pure helper: the preset named `name`, or `GM_KIT_MAP` when no shipped
 * preset has that name — a renamed or removed preset (or a stale persisted
 * value) never crashes the hook, it just falls back to General MIDI. Never
 * resolves the learned map itself — see `kitMapFor` for that.
 */
export function presetByName(name: string): KitMap {
  return KIT_MAP_PRESETS.find((preset) => preset.name === name) ?? GM_KIT_MAP
}

/**
 * The map a `presetName`/`learned` pair resolves to: the learned map when
 * `presetName` names it AND one has actually been built, else the matching
 * shipped preset (or GM, via `presetByName`) — covers "learned selected but
 * somehow absent" (a stale persisted selection after `clearLearned`) the
 * same way `presetByName` covers an unknown preset name: fail to GM, never
 * throw.
 */
export function kitMapFor(presetName: string, learned: KitMap | undefined): KitMap {
  if (presetName === LEARNED_KIT_MAP_NAME && learned !== undefined) return learned
  return presetByName(presetName)
}
