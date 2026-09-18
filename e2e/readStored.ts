import type { Page } from '@playwright/test'

/**
 * Read one key out of one object store of the app's real IndexedDB database.
 * The same helper `progress-persistence.spec.ts`, `round6.spec.ts` and
 * `acceptance-m3.spec.ts` each carry a private copy of; new specs import this
 * one. Use it to gate a `page.reload()` on a write having actually landed:
 * store updates are synchronous, the IndexedDB write goes through
 * `persistence.ts`'s async write queue, and reloading first destroys it.
 */
export async function readStored(page: Page, collection: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, storeName, storeKey }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains(storeName)) {
            resolve(undefined)
            return
          }
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(storeKey)
          request.onerror = () => reject(request.error)
          request.onsuccess = () => resolve(request.result as unknown)
        }
      }),
    { dbName: 'piano-learning-app', storeName: collection, storeKey: key },
  )
}
