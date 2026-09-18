/**
 * The learner's chosen kit-map preset (roadmap DR-02) — which note number
 * means which pad for THEIR e-kit. `useDrumMidiInput.ts` reads this store
 * whenever its caller does not pass an explicit `kitMap` option (every
 * trainer and the calibration screen call it that way today), resolving the
 * stored name through `presetByName` so a Roland/Alesis/Yamaha kit lands its
 * real notes instead of falling back to General MIDI's.
 *
 * STATE ONLY, the same rule `drumsLatencyStore.ts` holds itself to: nothing
 * here decides what a preset's notes are — `@core/drums/kitmap/presets.ts`
 * owns that. This store only remembers which one the learner picked.
 */
import { create } from 'zustand'
import { GM_KIT_MAP, KIT_MAP_PRESETS } from '@core/drums/kitmap/presets.ts'
import type { KitMap } from '@core/drums/kitmap/kitMap.ts'

export type DrumsKitMapStoreState = {
  readonly presetName: string
}

export type DrumsKitMapStoreActions = {
  setPreset(name: string): void
  /** Replaces the whole collection — called by `persistence.drums.ts`'s restore. */
  hydrate(state: Partial<DrumsKitMapStoreState>): void
}

export type DrumsKitMapStore = DrumsKitMapStoreState & DrumsKitMapStoreActions

export const useDrumsKitMapStore = create<DrumsKitMapStore>((set) => ({
  presetName: GM_KIT_MAP.name,

  setPreset: (name) => set({ presetName: name }),

  hydrate: (state) => set(state),
}))

/**
 * Pure helper: the preset named `name`, or `GM_KIT_MAP` when no shipped
 * preset has that name — a renamed or removed preset (or a stale persisted
 * value) never crashes the hook, it just falls back to General MIDI.
 */
export function presetByName(name: string): KitMap {
  return KIT_MAP_PRESETS.find((preset) => preset.name === name) ?? GM_KIT_MAP
}
