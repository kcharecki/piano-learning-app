import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * E2E proof for roadmap 2.33 (REQ-3.8.2/3.8.3/3.8.4) — and, finally, roadmap
 * 4.5's OWN original proof action, which was written when 4.5 was ticked and
 * never actually driven: "add the imported score to the repertoire, set it to
 * maintained, and see it appear in the review-due list once its interval has
 * passed."
 *
 * `core/repertoire/repertoire.ts` was a complete, fully-tested domain module
 * with no consuming store or screen anywhere in the app. This spec drives the
 * whole chain that was missing: the screen, the store, and the ninth
 * persistence slice.
 *
 * ## Why the due list is asserted in BOTH directions, twice
 *
 * A maintained piece that has never been practised is due immediately (core
 * `maintenanceDue` treats "no bound on how overdue it is" as most-overdue), so
 * an assertion that only ever says "maintained piece appears under Review due"
 * is satisfied by an implementation that lists every maintained piece and
 * never consults an interval at all. The interval is the actual requirement.
 * So this spec also drives the two cases that can only pass if core
 * `maintenanceDue` is really being called with a real `now`:
 * - a session 2 days ago -> NOT due (21-day default interval),
 * - a session 40 days ago -> due again.
 *
 * ## Why sessions are injected rather than played
 *
 * There is no UI that records a repertoire practice session yet (that is the
 * `usePracticeLog.stop()` wiring roadmap 2.33 leaves for later), and you
 * cannot practise something 40 DAYS AGO inside a test either way. The
 * injection goes through the app's own persisted record in IndexedDB and is
 * followed by a full reload, so every assertion after it also proves the
 * repertoire slice restores — the same technique, and the same reasoning, as
 * `e2e/dashboard-populated.spec.ts`'s synthetic practice entries.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

const DB_NAME = 'piano-learning-app'
const REPERTOIRE_COLLECTION = 'repertoire'
const REPERTOIRE_KEY = 'repertoire'
const DAY_MS = 24 * 60 * 60 * 1000

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function navButton(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
}

type StoredPiece = { readonly id: string; readonly status: string; sessions: unknown[] }
type StoredRepertoire = { readonly pieces: readonly StoredPiece[] }

/** Read the repertoire record out of the app's real IndexedDB (see e2e/dashboard-populated.spec.ts). */
async function readRepertoire(page: Page): Promise<StoredRepertoire | undefined> {
  return page.evaluate(
    ({ dbName, storeName, storeKey }) =>
      new Promise<StoredRepertoire | undefined>((resolve, reject) => {
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
          request.onsuccess = () => resolve(request.result as StoredRepertoire | undefined)
        }
      }),
    { dbName: DB_NAME, storeName: REPERTOIRE_COLLECTION, storeKey: REPERTOIRE_KEY },
  )
}

/**
 * Replaces every stored piece's `sessions` with a single session `daysAgo`
 * days old. Deliberately a read-modify-write of the app's OWN record rather
 * than a synthetic one, so a spec that somehow ran before the app had written
 * anything would inject into nothing and fail loudly at the next assertion
 * instead of quietly fabricating a library.
 */
async function injectSessionDaysAgo(page: Page, daysAgo: number): Promise<void> {
  await page.evaluate(
    ({ dbName, storeName, storeKey, at }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(storeName, 'readwrite')
          const store = tx.objectStore(storeName)
          const getReq = store.get(storeKey)
          getReq.onerror = () => reject(getReq.error)
          getReq.onsuccess = () => {
            const current = getReq.result as { pieces?: unknown[] } | undefined
            const pieces = Array.isArray(current?.pieces) ? current.pieces : []
            const updated = pieces.map((piece) => ({
              ...(piece as Record<string, unknown>),
              sessions: [{ at, minutes: 20 }],
            }))
            const putReq = store.put({ pieces: updated }, storeKey)
            putReq.onerror = () => reject(putReq.error)
            putReq.onsuccess = () => resolve()
          }
        }
      }),
    {
      dbName: DB_NAME,
      storeName: REPERTOIRE_COLLECTION,
      storeKey: REPERTOIRE_KEY,
      at: Date.now() - daysAgo * DAY_MS,
    },
  )
}

test('a loaded score joins the repertoire, and a maintained piece appears in the review-due list exactly when its interval has passed (roadmap 2.33 / 4.5)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await navButton(page, 'Practice').click()
  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  await navButton(page, 'Repertoire').click()
  const screen = page.getByRole('region', { name: 'Repertoire' })
  const due = page.getByRole('region', { name: 'Review due' })
  // The review-due section is nested inside the Repertoire region, so every
  // "is it in the library" assertion targets the NAMED library list — reading
  // them off the region matched the due list too, which would let a due-list
  // entry stand in for a library entry.
  const library = page.getByRole('list', { name: 'Repertoire pieces' })
  const dueList = page.getByRole('list', { name: 'Pieces due for review' })

  // Honest empty states before anything is added.
  await expect(screen.getByText(/No pieces in your library yet/i)).toBeVisible()
  await expect(due.getByText('Nothing due for review.')).toBeVisible()

  // REQ-3.8.3: the level is assigned manually on the way in.
  // `exact: true` because roadmap 5.3 added a "Below my level (playing level N)"
  // filter checkbox whose accessible name also contains "Level", which makes a
  // substring match resolve to two elements under Playwright's strict mode.
  await screen.getByLabel('Level', { exact: true }).selectOption('3')
  await screen.getByRole('button', { name: 'Add loaded score' }).click()

  await expect(library.getByText(FIXTURE_TITLE, { exact: true })).toBeVisible()
  await expect(library.getByText('Level 3')).toBeVisible()
  await expect(library.getByText('never practised')).toBeVisible()
  // Adding the same score twice is refused, and the reason is on screen.
  await expect(screen.getByRole('button', { name: 'Add loaded score' })).toBeDisabled()
  await expect(screen.getByText(/already in your repertoire/i)).toBeVisible()

  // Still 'learning', so nothing is due — this is what stops the later
  // "maintained piece is due" assertion from being a tautology about any
  // piece existing at all.
  await expect(due.getByText('Nothing due for review.')).toBeVisible()

  await library.getByLabel('Status').selectOption('maintained')
  // A maintained piece never practised is due immediately (see the module comment).
  await expect(dueList.getByText(new RegExp(`${FIXTURE_TITLE}.*never practised`))).toBeVisible()

  // The write has to have landed before it can be edited underneath the app.
  await expect(async () => {
    const stored = await readRepertoire(page)
    expect(stored?.pieces.map((p) => p.status)).toEqual(['maintained'])
  }).toPass({ timeout: 10_000 })

  // --- practised 2 days ago: inside the 21-day interval, so NOT due ---
  await injectSessionDaysAgo(page, 2)
  await page.reload()
  await navButton(page, 'Repertoire').click()

  // Everything after the reload also proves the ninth persistence slice
  // restores — the piece is only on screen at all because it came back out of
  // IndexedDB.
  await expect(library.getByText(FIXTURE_TITLE, { exact: true })).toBeVisible()
  await expect(library.getByText('2 days since last practice')).toBeVisible()
  await expect(due.getByText('Nothing due for review.')).toBeVisible()
  await expect(dueList).toHaveCount(0)

  // --- practised 40 days ago: past the interval, so due again ---
  await injectSessionDaysAgo(page, 40)
  await page.reload()
  await navButton(page, 'Repertoire').click()

  await expect(
    dueList.getByText(new RegExp(`${FIXTURE_TITLE}.*40 days since last practice`)),
  ).toBeVisible()

  expect(errors).toEqual([])
})
