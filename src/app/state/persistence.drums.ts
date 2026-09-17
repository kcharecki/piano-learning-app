/**
 * The drum slices of session persistence (roadmap DR-09/DR-10/DR-11): the
 * groove trainer's finished runs, the rhythm reading trainer's level + runs,
 * and the rudiment trainer's per-rudiment records. Same contract as every
 * slice in `persistence.ts` — validate then `restoreSlice` on the way in,
 * `createWriteQueue` + a `subscribe` on the way out — split into their own
 * module only because `persistence.ts` hit the 500-line limit.
 *
 * All three reuse `COLLECTIONS.settings` under their own keys rather than
 * declaring new collections: a new key in an object store that already
 * exists needs no IndexedDB migration, and each slice is small and written
 * once per run.
 *
 * `persistence.ts` owns the call order: `restoreDrumsSlices` runs inside
 * `restoreSession`, `persistDrumsSlices` inside `startPersisting`.
 */
import type { Store } from '@core/ports/index.ts'
import { COLLECTIONS } from '@core/ports/store.ts'
import { createWriteQueue } from '@app/state/writeQueue.ts'
import { restoreSlice, type PersistedSlice } from '@app/state/persistenceSlice.ts'
import { useDrumsHistoryStore, MAX_STORED_DRUMS_ATTEMPTS } from '@app/state/drumsHistoryStore.ts'
import { useDrumsReadingStore, MAX_STORED_READING_RUNS } from '@app/state/drumsReadingStore.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import {
  isValidDrumsHistory,
  isValidDrumsReading,
  isValidDrumsRudiments,
  type PersistedDrumsHistory,
  type PersistedDrumsReading,
  type PersistedDrumsRudiments,
} from '@app/state/persistedShapes.ts'

/** The groove trainer's finished runs (roadmap DR-09/T.17). */
export const DRUMS_HISTORY_COLLECTION = COLLECTIONS.settings
export const DRUMS_HISTORY_KEY = 'drumsHistory'

/** The rhythm reading trainer's level and runs (roadmap DR-11). */
export const DRUMS_READING_COLLECTION = COLLECTIONS.settings
export const DRUMS_READING_KEY = 'drumsReading'

/** The rudiment trainer's per-rudiment personal records (roadmap DR-10). */
export const DRUMS_RUDIMENTS_COLLECTION = COLLECTIONS.settings
export const DRUMS_RUDIMENTS_KEY = 'drumsRudiments'

let applyingRestoredDrumsHistory = false
let applyingRestoredDrumsReading = false
let applyingRestoredDrumsRudiments = false

/** Restores the three drum slices, each independently (a corrupt one never blocks the others). */
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

/** The three drum slices' subscriptions, for `startPersisting` to spread into its list. */
export function persistDrumsSlices(store: Store): readonly PersistedSlice[] {
  return [persistDrumsHistory(store), persistDrumsReading(store), persistDrumsRudiments(store)]
}
