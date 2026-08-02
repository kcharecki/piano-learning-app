/**
 * App-wide state: the loaded score, the MIDI device selection, and the
 * transport-facing practice settings (roadmap 1.17).
 *
 * This module holds STATE ONLY. The one exception is calling into `@core` for
 * things that are genuinely just validation of a value the store is about to
 * hold (`clampScale`) — never music logic. Anything that decides what the
 * music *does* (matching, scheduling, generation) belongs in `src/core` and is
 * merely invoked from `src/app/practice`, not reimplemented here.
 *
 * Per-loop tempo (roadmap 2.29, REQ-3.9.3): `settings.tempoScale` is still the
 * ONE number the practice screen reads and the transport applies — nothing
 * else in the app changes how it calls `setTempoScale` or reads
 * `settings.tempoScale`. What changed is what that number remembers. Tempo
 * scale is now kept in two homes: `loopTempoScales`, a map from a loop range
 * (keyed by its tick bounds) to the scale last used on that range, and
 * `unloopedTempoScale`, the one scale used when no loop is active.
 * `settings.tempoScale` is always a COPY of whichever home is currently in
 * effect — `setTempoScale` writes through to that home, and `setLoop` is what
 * moves the "currently in effect" pointer: it banks the outgoing scale into
 * the home it is leaving, then restores (or, for a loop range never seen
 * before, INHERITS the scale that was in effect when the range was entered —
 * see `setLoop` below) the scale for the home it is entering. This is what
 * makes switching loops recall each one's own
 * tempo, and turning looping off restore the whole-piece tempo instead of
 * leaving the last loop's slow-down applied everywhere.
 *
 * `loopTempoScales` is capped at `MAX_LOOP_TEMPO_SCALES` entries and evicts
 * least-recently-used — both `setLoop` (entering a range) and `setTempoScale`
 * (adjusting the active range) count as a "use" that keeps an entry alive.
 * Only `settings.tempoScale`/`settings.loop` are session-persisted (see
 * `persistence.ts`); the per-loop map itself is an in-memory cache and does
 * not survive a reload — a loop's remembered tempo is only recalled within
 * the same session it was set in.
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

/** Cap on how many distinct loop ranges keep their own remembered tempo scale
 * at once — least-recently-used entries are evicted past this so a session
 * that tries many ranges cannot grow the map without bound. */
export const MAX_LOOP_TEMPO_SCALES = 8

/** Stable key for a loop range's tick bounds — two `LoopRange` values with the
 * same bounds (even distinct object instances) must land on the same map
 * entry, so this keys by value, not by reference. */
function loopKey(loop: LoopRange): string {
  return `${loop.startTick}:${loop.endTick}`
}

/**
 * Returns `map` with `key` set to `value` and marked most-recently-used
 * (re-inserted at the end — `Map` iterates in insertion order), evicting the
 * least-recently-used entry (the first key) while over `MAX_LOOP_TEMPO_SCALES`.
 * Always returns a fresh `Map` so zustand's reference-equality change
 * detection sees it.
 */
function withLruSet(
  map: ReadonlyMap<string, number>,
  key: string,
  value: number,
): ReadonlyMap<string, number> {
  const next = new Map(map)
  next.delete(key)
  next.set(key, value)
  for (const oldestKey of next.keys()) {
    if (next.size <= MAX_LOOP_TEMPO_SCALES) break
    next.delete(oldestKey)
  }
  return next
}

export type ScoreStoreState = {
  readonly loaded: LoadedScore | undefined
  readonly importError: string | undefined
  readonly availableMidiDevices: readonly MidiDevice[]
  readonly selectedMidiDeviceId: string | null
  readonly settings: PracticeSettings
  /** Remembered tempo scale per loop range, keyed by tick bounds — see the
   * module comment. Not part of the public setter contract; read only by this
   * store's own actions and by tests. */
  readonly loopTempoScales: ReadonlyMap<string, number>
  /** The tempo scale in effect while no loop is active — see the module
   * comment. */
  readonly unloopedTempoScale: number
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
  loopTempoScales: new Map(),
  unloopedTempoScale: DEFAULT_SETTINGS.tempoScale,

  loadScore: (loaded) =>
    set((state) => ({
      loaded,
      importError: undefined,
      loopTempoScales: new Map(),
      unloopedTempoScale: DEFAULT_SETTINGS.tempoScale,
      // A loop range and its tempo scale are only meaningful against the
      // score they were set on — tick bounds from the previous score would
      // otherwise silently collide with the new one's. Reset both to the
      // defaults alongside the per-loop map above.
      settings: {
        ...state.settings,
        loop: DEFAULT_SETTINGS.loop,
        tempoScale: DEFAULT_SETTINGS.tempoScale,
      },
    })),
  setImportError: (message) => set({ importError: message }),
  clearImportError: () => set({ importError: undefined }),
  setAvailableMidiDevices: (devices) => set({ availableMidiDevices: devices }),
  selectMidiDevice: (deviceId) => set({ selectedMidiDeviceId: deviceId }),
  // Writes to whichever home is currently in effect — the unlooped scale when
  // no loop is active, otherwise the active loop's own entry — so the caller
  // (the practice screen's tempo slider) never needs to know which one that
  // is; it just keeps calling `setTempoScale` and reading back
  // `settings.tempoScale`. See the module comment.
  setTempoScale: (scale) =>
    set((state) => {
      const clamped = clampScale(scale)
      const loop = state.settings.loop
      if (loop === undefined) {
        return {
          settings: { ...state.settings, tempoScale: clamped },
          unloopedTempoScale: clamped,
        }
      }
      return {
        settings: { ...state.settings, tempoScale: clamped },
        loopTempoScales: withLruSet(state.loopTempoScales, loopKey(loop), clamped),
      }
    }),
  setActiveHands: (hands) =>
    set((state) => ({ settings: { ...state.settings, activeHands: hands } })),
  setMetronomeEnabled: (enabled) =>
    set((state) => ({ settings: { ...state.settings, metronomeEnabled: enabled } })),
  // Banks the outgoing tempo scale into whichever home is being left (the
  // previous loop's entry, or the unlooped scale), then restores the scale
  // for whichever home is being entered. A loop range seen for the FIRST time
  // INHERITS the scale that was in effect when it was entered: a learner who
  // slows the piece to 50% and then loops the bar that is giving them trouble
  // means "keep practising this slowly", and springing back to 100% the
  // instant they check Loop would be the app arguing with them. Only a range
  // that already has a remembered scale overrides the inherited one — that is
  // the whole point of remembering it. See the module comment.
  setLoop: (nextLoop) =>
    set((state) => {
      const prevLoop = state.settings.loop
      const currentScale = state.settings.tempoScale
      let loopTempoScales = state.loopTempoScales
      let unloopedTempoScale = state.unloopedTempoScale

      if (prevLoop === undefined) {
        unloopedTempoScale = currentScale
      } else {
        loopTempoScales = withLruSet(loopTempoScales, loopKey(prevLoop), currentScale)
      }

      let nextTempoScale: number
      if (nextLoop === undefined) {
        nextTempoScale = unloopedTempoScale
      } else {
        const key = loopKey(nextLoop)
        nextTempoScale = loopTempoScales.get(key) ?? currentScale
        // Only refresh recency for a range that already has a remembered
        // scale — a range seen for the first time inherits without being
        // inserted, so transient ranges (e.g. one per keystroke while typing
        // a measure number) don't consume the LRU cap.
        if (loopTempoScales.has(key)) {
          loopTempoScales = withLruSet(loopTempoScales, key, nextTempoScale)
        }
      }

      return {
        settings: { ...state.settings, loop: nextLoop, tempoScale: nextTempoScale },
        loopTempoScales,
        unloopedTempoScale,
      }
    }),
}))
