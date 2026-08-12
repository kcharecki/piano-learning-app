/**
 * IndexedDB implementation of the Store port (REQ-4.2 local persistence,
 * REQ-4.3 exportable data), backed by the `idb` wrapper around the native
 * IndexedDB API.
 *
 * One object store per collection in `COLLECTIONS`, created up front in the
 * `upgrade` callback so a fresh database has every collection from the
 * start. When a future collection is added to the port, bump `DB_VERSION`
 * and the upgrade callback will create only the stores that are missing —
 * existing stores and their data are untouched, because
 * `IDBDatabase.createObjectStore` is only ever called for names the database
 * does not already have.
 */
import { openDB, type IDBPDatabase } from 'idb'
import type { Store } from '@core/ports/store.ts'
import { COLLECTIONS } from '@core/ports/store.ts'

/**
 * A recording's optional audio track (roadmap B.5, REQ-3.9.2 "audio recording
 * is optional"). Deliberately NOT a field on `Recording` itself
 * (`core/practice/recorder.ts`) — that type is pure-core and already
 * persisted wholesale, as one array, under `RECORDINGS_KEY` by
 * `app/state/persistence.ts`; folding a multi-megabyte `Blob` into that same
 * array would mean re-writing every OTHER recording's bytes on every change
 * to any one of them. Instead this reuses `COLLECTIONS.recordings` — the
 * object store already created for the MIDI recordings array — under a
 * SEPARATE key per recording, the same "shared collection, separated by key"
 * pattern `persistence.ts`'s module comment documents for `COLLECTIONS.settings`.
 * No `DB_VERSION` bump is needed: the object store already exists.
 */
export type StoredRecordingAudio = {
  /** The `Recording.id` this audio belongs to. */
  readonly recordingId: string
  readonly blob: Blob
  /** What `AudioRecorder.mimeType` reported when this was captured. */
  readonly mimeType: string
  /**
   * Milliseconds from the MIDI recording's own time origin (`Recording`'s
   * `t=0`, set by `MidiRecorder.start()`) to the audio blob's first sample.
   * Positive: the audio started after the MIDI origin — replay waits this
   * long before playing it. Negative: the audio started first — replay
   * begins the clip that many ms into itself. See `useAudioRecording`
   * (`app/practice/useRecorder.ts`) for how this is measured and used.
   */
  readonly offsetMs: number
}

const RECORDING_AUDIO_KEY_PREFIX = 'audio:'

function recordingAudioKey(recordingId: string): string {
  return `${RECORDING_AUDIO_KEY_PREFIX}${recordingId}`
}

/**
 * What actually goes over `Store.put` — the `Blob` converted to an
 * `ArrayBuffer` up front, not stored as a `Blob` directly. `structuredClone`
 * (which `IdbStore.put`'s `cloneForStorage` calls, and which `MemoryStore`
 * uses too) reliably preserves an `ArrayBuffer` end-to-end; a `Blob` is not
 * guaranteed to survive that same clone with its data intact in every
 * environment this port runs under (this project's own test environment,
 * happy-dom, is one — its `structuredClone` degrades a `Blob` to a plain
 * `{ type }` object with the bytes gone). Converting at the edge sidesteps
 * that entirely rather than depending on it.
 */
type StoredRecordingAudioRecord = {
  readonly recordingId: string
  readonly bytes: ArrayBuffer
  readonly mimeType: string
  readonly offsetMs: number
}

/** Stores (or replaces) `audio`'s blob, keyed by its own `recordingId`. */
export async function putRecordingAudio(store: Store, audio: StoredRecordingAudio): Promise<void> {
  const record: StoredRecordingAudioRecord = {
    recordingId: audio.recordingId,
    bytes: await audio.blob.arrayBuffer(),
    mimeType: audio.mimeType,
    offsetMs: audio.offsetMs,
  }
  await store.put(COLLECTIONS.recordings, recordingAudioKey(audio.recordingId), record)
}

/**
 * `undefined` both for a recording that never had audio captured, and for one
 * made before this feature shipped — the same "absent key" case, which is
 * exactly what makes an old MIDI-only `Recording` load and replay unchanged.
 */
export async function getRecordingAudio(
  store: Store,
  recordingId: string,
): Promise<StoredRecordingAudio | undefined> {
  const record = await store.get<StoredRecordingAudioRecord>(
    COLLECTIONS.recordings,
    recordingAudioKey(recordingId),
  )
  if (record === undefined) return undefined
  return {
    recordingId: record.recordingId,
    blob: new Blob([record.bytes], { type: record.mimeType }),
    mimeType: record.mimeType,
    offsetMs: record.offsetMs,
  }
}

/** Deletes just the audio for `recordingId`, leaving the MIDI recording itself untouched. A no-op if there was none. */
export async function deleteRecordingAudio(store: Store, recordingId: string): Promise<void> {
  await store.delete(COLLECTIONS.recordings, recordingAudioKey(recordingId))
}

const DEFAULT_DB_NAME = 'piano-learning-app'
const DB_VERSION = 1

/**
 * Creates any object store in `collections` that the database does not
 * already have. Exported so the "add a collection without losing data"
 * migration path can be exercised directly in tests, independent of the
 * production `COLLECTIONS` list and `DB_VERSION`.
 */
export function createMissingStores(database: IDBPDatabase, collections: readonly string[]): void {
  for (const collection of collections) {
    if (!database.objectStoreNames.contains(collection)) {
      database.createObjectStore(collection)
    }
  }
}

/**
 * Clones `value` up front so a later caller mutation cannot affect what was
 * stored, and so a value that cannot be cloned fails with a clear message
 * here rather than opaquely deep inside idb's own structured-clone step.
 */
function cloneForStorage<T>(value: T, context: string): T {
  try {
    return structuredClone(value)
  } catch (cause) {
    throw new Error(
      `Store.put(${context}): value cannot be structured-cloned, so it cannot be persisted`,
      { cause },
    )
  }
}

class IdbStore implements Store {
  private readonly db: IDBPDatabase

  constructor(db: IDBPDatabase) {
    this.db = db
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const value = await this.db.get(collection, id)
    return value as T | undefined
  }

  async getAll<T>(collection: string): Promise<T[]> {
    const values = await this.db.getAll(collection)
    return values as T[]
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    const cloned = cloneForStorage(value, `${collection}/${id}`)
    await this.db.put(collection, cloned, id)
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.db.delete(collection, id)
  }

  async clear(collection: string): Promise<void> {
    await this.db.clear(collection)
  }

  async collections(): Promise<string[]> {
    const names = Array.from(this.db.objectStoreNames)
    const counts = await Promise.all(names.map((name) => this.db.count(name)))
    return names.filter((_, i) => (counts[i] ?? 0) > 0)
  }
}

/**
 * Opens (creating if needed) the app's IndexedDB database and returns a
 * `Store` backed by it — one object store per entry in `COLLECTIONS`.
 */
export async function createIdbStore(name = DEFAULT_DB_NAME): Promise<Store> {
  const db = await openDB(name, DB_VERSION, {
    upgrade(database) {
      createMissingStores(database, Object.values(COLLECTIONS))
    },
  })
  return new IdbStore(db)
}
