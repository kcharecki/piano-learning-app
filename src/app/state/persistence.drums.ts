/**
 * The drum slices of session persistence (roadmap DR-09/DR-10/DR-11/DR-08/
 * DR-02): the groove trainer's finished runs, the rhythm reading trainer's
 * level + runs, the rudiment trainer's per-rudiment records, the per-input
 * latency offsets, and the learner's chosen kit-map preset. Same contract as
 * every slice in `persistence.ts` — validate then `restoreSlice` on the way
 * in, `createWriteQueue` + a `subscribe` on the way out — split into their
 * own module only because `persistence.ts` hit the 500-line limit.
 *
 * All five reuse `COLLECTIONS.settings` under their own keys rather than
 * declaring new collections: a new key in an object store that already
 * exists needs no IndexedDB migration, and each slice is small and written
 * once per run.
 *
 * `persistence.ts` owns the call order: `restoreDrumsSlices` runs inside
 * `restoreSession`, `persistDrumsSlices` inside `startPersisting`.
 */
import type { KitMap, KitMapEntry } from '@core/drums/kitmap/kitMap.ts'
import type { Store } from '@core/ports/index.ts'
import { COLLECTIONS } from '@core/ports/store.ts'
import { createWriteQueue } from '@app/state/writeQueue.ts'
import { restoreSlice, type PersistedSlice } from '@app/state/persistenceSlice.ts'
import { useDrumsHistoryStore, MAX_STORED_DRUMS_ATTEMPTS } from '@app/state/drumsHistoryStore.ts'
import { useDrumsReadingStore, MAX_STORED_READING_RUNS } from '@app/state/drumsReadingStore.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import { useDrumsLatencyStore } from '@app/state/drumsLatencyStore.ts'
import { useDrumsKitMapStore } from '@app/state/drumsKitMapStore.ts'
import {
  isValidDrumsHistory,
  isValidDrumsLatency,
  isValidDrumsReading,
  isValidDrumsRudiments,
  type PersistedDrumsHistory,
  type PersistedDrumsLatency,
  type PersistedDrumsReading,
  type PersistedDrumsRudiments,
} from '@app/state/persistedShapes.ts'
import { isValidDrumsKitMap, type PersistedDrumsKitMap } from '@app/state/persistedShapes.drumsKitMap.ts'

/**
 * The `restoreSlice` gate for the kit-map slice is deliberately lenient —
 * only `presetName`'s type, not `learned`'s — so a corrupt `learned` blob
 * cannot also take the (perfectly fine) preset name down with it. The full,
 * deep check (`isValidDrumsKitMap`, including every `learned.notes` entry)
 * runs again inside `apply`, below, to decide whether `learned` itself is
 * trustworthy enough to hydrate.
 */
function hasValidPresetName(value: unknown): value is { readonly presetName: string } {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as Record<string, unknown>).presetName === 'string'
}

/** `PersistedDrumsKitMap['learned']` (string-keyed notes) -> `KitMap` (number-keyed notes). */
function toLearnedKitMap(learned: PersistedDrumsKitMap['learned']): KitMap | undefined {
  if (learned === undefined) return undefined
  const notes: Record<number, KitMapEntry> = {}
  for (const [key, entry] of Object.entries(learned.notes)) {
    notes[Number(key)] = entry
  }
  return { name: learned.name, notes }
}

/** `KitMap` (number-keyed notes) -> `PersistedDrumsKitMap['learned']` (string-keyed notes). */
function toPersistedLearned(map: KitMap): NonNullable<PersistedDrumsKitMap['learned']> {
  const notes: Record<string, KitMapEntry> = {}
  for (const [key, entry] of Object.entries(map.notes)) {
    notes[key] = entry
  }
  return { name: map.name, notes }
}

/** The groove trainer's finished runs (roadmap DR-09/T.17). */
export const DRUMS_HISTORY_COLLECTION = COLLECTIONS.settings
export const DRUMS_HISTORY_KEY = 'drumsHistory'

/** The rhythm reading trainer's level and runs (roadmap DR-11). */
export const DRUMS_READING_COLLECTION = COLLECTIONS.settings
export const DRUMS_READING_KEY = 'drumsReading'

/** The rudiment trainer's per-rudiment personal records (roadmap DR-10). */
export const DRUMS_RUDIMENTS_COLLECTION = COLLECTIONS.settings
export const DRUMS_RUDIMENTS_KEY = 'drumsRudiments'

/** The per-input latency offsets (roadmap DR-08). */
export const DRUMS_LATENCY_COLLECTION = COLLECTIONS.settings
export const DRUMS_LATENCY_KEY = 'drumsLatency'

/** The learner's chosen kit-map preset (roadmap DR-02). */
export const DRUMS_KIT_MAP_COLLECTION = COLLECTIONS.settings
export const DRUMS_KIT_MAP_KEY = 'drumsKitMap'

let applyingRestoredDrumsHistory = false
let applyingRestoredDrumsReading = false
let applyingRestoredDrumsRudiments = false
let applyingRestoredDrumsLatency = false
let applyingRestoredDrumsKitMap = false

/** Restores the five drum slices, each independently (a corrupt one never blocks the others). */
export async function restoreDrumsSlices(store: Store): Promise<void> {
  await restoreSlice(
    store,
    DRUMS_HISTORY_COLLECTION,
    DRUMS_HISTORY_KEY,
    isValidDrumsHistory,
    (guarding) => {
      applyingRestoredDrumsHistory = guarding
    },
    (data) =>
      useDrumsHistoryStore
        .getState()
        .hydrate({ attempts: data.attempts.slice(0, MAX_STORED_DRUMS_ATTEMPTS) }),
  )

  await restoreSlice(
    store,
    DRUMS_READING_COLLECTION,
    DRUMS_READING_KEY,
    isValidDrumsReading,
    (guarding) => {
      applyingRestoredDrumsReading = guarding
    },
    (data) =>
      useDrumsReadingStore
        .getState()
        .hydrate({ level: data.level, runs: data.runs.slice(0, MAX_STORED_READING_RUNS) }),
  )

  await restoreSlice(
    store,
    DRUMS_RUDIMENTS_COLLECTION,
    DRUMS_RUDIMENTS_KEY,
    isValidDrumsRudiments,
    (guarding) => {
      applyingRestoredDrumsRudiments = guarding
    },
    (data) => useDrumsRudimentStore.getState().hydrate({ records: data.records }),
  )

  await restoreSlice(
    store,
    DRUMS_LATENCY_COLLECTION,
    DRUMS_LATENCY_KEY,
    isValidDrumsLatency,
    (guarding) => {
      applyingRestoredDrumsLatency = guarding
    },
    (data) => useDrumsLatencyStore.getState().hydrate({ offsets: data.offsets }),
  )

  await restoreSlice(
    store,
    DRUMS_KIT_MAP_COLLECTION,
    DRUMS_KIT_MAP_KEY,
    hasValidPresetName,
    (guarding) => {
      applyingRestoredDrumsKitMap = guarding
    },
    (data) =>
      useDrumsKitMapStore.getState().hydrate({
        presetName: data.presetName,
        learned: isValidDrumsKitMap(data) ? toLearnedKitMap(data.learned) : undefined,
      }),
  )
}

/** Subscribes to the groove trainer's history and writes `attempts` on every change. */
function persistDrumsHistory(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedDrumsHistory>(
    store,
    DRUMS_HISTORY_COLLECTION,
    DRUMS_HISTORY_KEY,
  )
  const unsubscribe = useDrumsHistoryStore.subscribe((state, prevState) => {
    if (applyingRestoredDrumsHistory) return
    if (state.attempts === prevState.attempts) return
    write({ attempts: state.attempts })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the reading trainer's store and writes level + runs on every change. */
function persistDrumsReading(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedDrumsReading>(
    store,
    DRUMS_READING_COLLECTION,
    DRUMS_READING_KEY,
  )
  const unsubscribe = useDrumsReadingStore.subscribe((state, prevState) => {
    if (applyingRestoredDrumsReading) return
    if (state.level === prevState.level && state.runs === prevState.runs) return
    write({ level: state.level, runs: state.runs })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the rudiment trainer's records and writes them on every change. */
function persistDrumsRudiments(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedDrumsRudiments>(
    store,
    DRUMS_RUDIMENTS_COLLECTION,
    DRUMS_RUDIMENTS_KEY,
  )
  const unsubscribe = useDrumsRudimentStore.subscribe((state, prevState) => {
    if (applyingRestoredDrumsRudiments) return
    if (state.records === prevState.records) return
    write({ records: state.records })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the latency store and writes the offsets on every change. */
function persistDrumsLatency(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedDrumsLatency>(
    store,
    DRUMS_LATENCY_COLLECTION,
    DRUMS_LATENCY_KEY,
  )
  const unsubscribe = useDrumsLatencyStore.subscribe((state, prevState) => {
    if (applyingRestoredDrumsLatency) return
    if (state.offsets === prevState.offsets) return
    write({ offsets: state.offsets })
  })
  return { unsubscribe, flush: write.flush }
}

/** Subscribes to the kit-map store and writes the chosen preset name on every change. */
function persistDrumsKitMap(store: Store): PersistedSlice {
  const write = createWriteQueue<PersistedDrumsKitMap>(
    store,
    DRUMS_KIT_MAP_COLLECTION,
    DRUMS_KIT_MAP_KEY,
  )
  const unsubscribe = useDrumsKitMapStore.subscribe((state, prevState) => {
    if (applyingRestoredDrumsKitMap) return
    if (state.presetName === prevState.presetName && state.learned === prevState.learned) return
    write({
      presetName: state.presetName,
      ...(state.learned === undefined ? {} : { learned: toPersistedLearned(state.learned) }),
    })
  })
  return { unsubscribe, flush: write.flush }
}

/** The five drum slices' subscriptions, for `startPersisting` to spread into its list. */
export function persistDrumsSlices(store: Store): readonly PersistedSlice[] {
  return [
    persistDrumsHistory(store),
    persistDrumsReading(store),
    persistDrumsRudiments(store),
    persistDrumsLatency(store),
    persistDrumsKitMap(store),
  ]
}
