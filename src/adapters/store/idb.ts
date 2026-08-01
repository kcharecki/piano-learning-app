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
