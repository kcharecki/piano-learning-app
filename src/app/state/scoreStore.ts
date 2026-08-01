/**
 * App-wide state: the loaded score, the MIDI device selection, and the
 * transport-facing practice settings (roadmap 1.17).
 *
 * This module holds STATE ONLY. The one exception is calling into `@core` for
 * things that are genuinely just validation of a value the store is about to
 * hold (`clampScale`) — never music logic. Anything that decides what the
 * music *does* (matching, scheduling, generation) belongs in `src/core` and is
 * merely invoked from `src/app/practice`, not reimplemented here.
 */
import type { Hand, Score } from '@core/notation/score.ts'
import type { MidiDevice } from '@core/ports/index.ts'
import { clampScale } from '@core/timing/tempo.ts'
import type { LoopRange } from '@core/timing/transport.ts'
import { create } from 'zustand'

export type LoadedScore = {
  readonly score: Score
  readonly sourceName: string
  /** The markup OSMD renders. Absent when the score came from a MIDI import. */
  readonly musicXml: string | undefined
}

export type PracticeSettings = {
  readonly tempoScale: number
  readonly activeHands: readonly Hand[]
  readonly metronomeEnabled: boolean
  readonly loop: LoopRange | undefined
}

const DEFAULT_SETTINGS: PracticeSettings = {
  tempoScale: 1,
  activeHands: ['left', 'right'],
  metronomeEnabled: false,
  loop: undefined,
}

export type ScoreStoreState = {
  readonly loaded: LoadedScore | undefined
  readonly importError: string | undefined
  readonly availableMidiDevices: readonly MidiDevice[]
  readonly selectedMidiDeviceId: string | null
  readonly settings: PracticeSettings
}

export type ScoreStoreActions = {
  loadScore(loaded: LoadedScore): void
  setImportError(message: string): void
  clearImportError(): void
  setAvailableMidiDevices(devices: readonly MidiDevice[]): void
  selectMidiDevice(deviceId: string | null): void
  setTempoScale(scale: number): void
  setActiveHands(hands: readonly Hand[]): void
  setMetronomeEnabled(enabled: boolean): void
  setLoop(loop: LoopRange | undefined): void
}

export type ScoreStore = ScoreStoreState & ScoreStoreActions

export const useScoreStore = create<ScoreStore>((set) => ({
  loaded: undefined,
  importError: undefined,
  availableMidiDevices: [],
  selectedMidiDeviceId: null,
  settings: DEFAULT_SETTINGS,

  loadScore: (loaded) => set({ loaded, importError: undefined }),
  setImportError: (message) => set({ importError: message }),
  clearImportError: () => set({ importError: undefined }),
  setAvailableMidiDevices: (devices) => set({ availableMidiDevices: devices }),
  selectMidiDevice: (deviceId) => set({ selectedMidiDeviceId: deviceId }),
  setTempoScale: (scale) =>
    set((state) => ({ settings: { ...state.settings, tempoScale: clampScale(scale) } })),
  setActiveHands: (hands) =>
    set((state) => ({ settings: { ...state.settings, activeHands: hands } })),
  setMetronomeEnabled: (enabled) =>
    set((state) => ({ settings: { ...state.settings, metronomeEnabled: enabled } })),
  setLoop: (loop) => set((state) => ({ settings: { ...state.settings, loop } })),
}))
