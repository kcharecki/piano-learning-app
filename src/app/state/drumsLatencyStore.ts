/**
 * Per-input-device latency offsets (roadmap DR-08) — the calibration screen
 * (`@app/drums/calibration/useCalibration.ts`) writes here once a run
 * produces a `CalibrationSummary`, keyed by input device id, and
 * `useGrooveRun`'s `inputOffsetMs` option reads the stored offset back out
 * through `offsetFor` so a constant late-reading rig stops misgrading every
 * hit as late.
 *
 * STATE ONLY, the same rule `drumsRudimentStore.ts` holds itself to: nothing
 * here decides how an offset is measured or when it should be trusted —
 * `@core/drums/scoring/latency.ts` owns that. This store only remembers what
 * it is told, one record per device.
 */
import { create } from 'zustand'

/** Key for hits that come from the on-screen pads or the keyboard rather than a MIDI device. */
export const LOCAL_INPUT_ID = 'local'

export type LatencyRecord = {
  readonly offsetMs: number
  readonly spreadMs: number
  readonly samples: number
  /** epoch ms */
  readonly at: number
}

export type DrumsLatencyStoreState = {
  /** by input id — `LOCAL_INPUT_ID` for the pads/keyboard, a MIDI device id otherwise. */
  readonly offsets: Readonly<Record<string, LatencyRecord>>
}

export type DrumsLatencyStoreActions = {
  setOffset(inputId: string, record: LatencyRecord): void
  clearOffset(inputId: string): void
  /** Replaces the whole collection — called by `persistence.ts`'s restore. */
  hydrate(state: Partial<DrumsLatencyStoreState>): void
}

export type DrumsLatencyStore = DrumsLatencyStoreState & DrumsLatencyStoreActions

export const useDrumsLatencyStore = create<DrumsLatencyStore>((set) => ({
  offsets: {},

  setOffset: (inputId, record) =>
    set((state) => ({
      offsets: { ...state.offsets, [inputId]: record },
    })),

  clearOffset: (inputId) =>
    set((state) => {
      if (!(inputId in state.offsets)) return state
      const next = { ...state.offsets }
      delete next[inputId]
      return { offsets: next }
    }),

  hydrate: (state) => set(state),
}))

/** Pure selector helper: the offset to subtract for `inputId`, 0 when none stored. */
export function offsetFor(state: DrumsLatencyStoreState, inputId: string | undefined): number {
  if (inputId === undefined) return 0
  return state.offsets[inputId]?.offsetMs ?? 0
}
