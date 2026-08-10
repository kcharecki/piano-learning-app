import type { Page } from '@playwright/test'

/**
 * Seeds the `playing`/`sight-reading`/`theory` track levels straight into the
 * app's real IndexedDB (`COLLECTIONS.settings`, key `'levelState'` — see
 * `src/app/state/persistence.ts`'s `LEVELS_COLLECTION`/`LEVELS_KEY`), the same
 * `db.transaction(...).objectStore(...).put(...)` shape every other e2e seed
 * helper in this directory uses (e.g. `streak-any-activity.spec.ts`'s
 * `setPracticeEntries`).
 *
 * Exists for roadmap 5.17 (`PracticeScreen`'s progressive disclosure gated by
 * the `playing` track's level): specs that drive wait mode, an assessment
 * run, read-ahead or a fingering annotation need a `playing` level at or past
 * `PracticeScreen`'s own gate thresholds, which a fresh app always starts
 * below (`initialLevelState()` puts every track at level 1).
 *
 * The database must already exist (visit the app once — `page.goto('/')` —
 * before calling this) and the page must be reloaded afterwards for the
 * seeded level to actually reach `useLevelStore` on start-up.
 */
export async function seedPlayingLevel(page: Page, level: number): Promise<void> {
  await page.evaluate(
    ({ dbName, level }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const levelState = {
            levels: { playing: level, 'sight-reading': level, theory: level },
            overridden: { playing: false, 'sight-reading': false, theory: false },
          }
          const putReq = db
            .transaction('settings', 'readwrite')
            .objectStore('settings')
            .put({ levelState }, 'levelState')
          putReq.onerror = () => reject(putReq.error)
          putReq.onsuccess = () => resolve()
        }
      }),
    { dbName: 'piano-learning-app', level },
  )
}
