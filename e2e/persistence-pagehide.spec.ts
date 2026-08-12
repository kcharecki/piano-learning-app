import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap follow-up F.2 (`docs/m4-acceptance-2026-08-12b.md`'s
 * Finding 2): `src/app/state/persistence.ts`'s write queue held at most one
 * `store.put` in flight per slice, and a value produced while an OLDER write
 * for the SAME slice was still in flight sat in `pending` until the drain
 * loop got back around to it — nothing ever drained it early if the tab went
 * away first. The acceptance pass observed this for a track advancement:
 * click "Advance", reload immediately, and the track was back at level 1 and
 * STAYED there for a 10-second poll — not a timing flake, a genuine loss.
 *
 * WHY TWO STATE CHANGES, NOT ONE. `Store.put`'s underlying request is issued
 * SYNCHRONOUSLY the moment a slice's queue is idle (see `persistence.ts`'s
 * module comment) — so a single, isolated click's write is already handed to
 * the browser before the click handler even returns, long before any
 * `pagehide` listener could run. What was actually reliably losing data is a
 * SECOND change to the same slice landing in `pending` while the FIRST is
 * still in flight — exactly what these specs force deterministically by
 * firing two DOM interactions back to back inside a single `page.evaluate`
 * call, so no macrotask boundary (and no chance for the first write to
 * settle) falls between them.
 *
 * WHY THE PASS/FAIL ASSERTION IS A SYNCHRONOUS `put`-CALL COUNT, NOT JUST "did
 * the value survive a reload". Measured directly (see the task report): a
 * real `location.reload()`, even fired synchronously right after forcing the
 * race, routinely gives the OLD document's JS enough real wall-clock time —
 * the local dev server round-trip alone is several milliseconds — for
 * write #1's `put` to settle and the drain loop's own ORDINARY (non-flush)
 * continuation to notice `pending` and send write #2 anyway, with no
 * page-hide listener involved at all. That natural recovery has nothing to
 * do with this fix and made an early version of this spec pass even against
 * the pre-fix `persistence.ts`, proving nothing. Counting native
 * `IDBObjectStore.put` calls and checking the count SYNCHRONOUSLY, in the
 * same browser turn as the `pagehide` dispatch, isolates the one thing under
 * test — whether the dispatch itself caused a second `put` — from that
 * unrelated timing race entirely.
 *
 * Both specs below were confirmed to FAIL without the fix (against the
 * pre-fix `persistence.ts`, which has no `pagehide`/`visibilitychange`
 * listener at all — the synchronous put-count assertion stayed at 1) before
 * being confirmed to pass with it; see the task report for the exact
 * pre-fix failure output. Each also finishes with a REAL reload, to prove
 * the full learner-facing story once the flush-issued write has had a
 * moment to settle.
 */

const DB_NAME = 'piano-learning-app'
const DAY_MS = 24 * 60 * 60 * 1_000

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function nav(page: Page, label: string) {
  return page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true })
}

/** Write one record straight into the app's real IndexedDB (see `e2e/m4-acceptance-dashboard-sections.spec.ts`). */
async function seedStore(page: Page, collection: string, key: string, payload: unknown): Promise<void> {
  const missing = await page.evaluate(
    ({ dbName, storeName, storeKey, value }) =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onupgradeneeded = () => {
          open.transaction?.abort()
        }
        open.onerror = () => reject(open.error as unknown as Error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.close()
            resolve(`the database has no "${storeName}" object store`)
            return
          }
          const tx = db.transaction(storeName, 'readwrite')
          const put = tx.objectStore(storeName).put(value, storeKey)
          put.onerror = () => {
            db.close()
            reject(put.error as unknown as Error)
          }
          tx.oncomplete = () => {
            db.close()
            resolve(null)
          }
        }
      }),
    { dbName: DB_NAME, storeName: collection, storeKey: key, value: payload },
  )
  expect(missing, 'seeding failed').toBeNull()
}

/** Read one record straight back out of the app's real IndexedDB. */
async function readStore(page: Page, collection: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, storeName, storeKey }) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onupgradeneeded = () => {
          open.transaction?.abort()
        }
        open.onerror = () => resolve(undefined)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.close()
            resolve(undefined)
            return
          }
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(storeKey)
          request.onerror = () => {
            db.close()
            reject(request.error as unknown as Error)
          }
          request.onsuccess = () => {
            const value = request.result as unknown
            db.close()
            resolve(value)
          }
        }
      }),
    { dbName: DB_NAME, storeName: collection, storeKey: key },
  )
}

/**
 * Wraps the native `IDBObjectStore.prototype.put` to count calls into
 * `window.__putCount`, before any app write happens. Test-only instrumentation
 * living entirely in the page's own JS realm — it does not touch, mock, or
 * bypass any app or `Store`-port code, so a call it counts is a REAL native
 * IndexedDB request the app actually issued.
 */
async function instrumentPutCalls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as unknown as { __putCount: number }
    win.__putCount = 0
    const proto = IDBObjectStore.prototype
    const original = proto.put
    proto.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      win.__putCount += 1
      return original.apply(this, args)
    }
  })
}

test('an Advance click and an immediate second level change both survive a page-hide, with no poll (roadmap F.2, small payload: levelState)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  // Level 1's only sight-reading exit criterion (see
  // e2e/m4-acceptance-dashboard-sections.spec.ts): three real-shaped reads at
  // 92% satisfy it, so "Advance" is enabled with no clock advanced and no
  // level set by hand.
  const now = Date.now()
  await seedStore(page, 'sightReadingHistory', 'sightReadingHistory', {
    level: 1,
    history: [
      { pieceId: 'f2-read-1', readAt: now - 3 * DAY_MS, accuracy: 0.92, level: 1 },
      { pieceId: 'f2-read-2', readAt: now - 2 * DAY_MS, accuracy: 0.93, level: 1 },
      { pieceId: 'f2-read-3', readAt: now - DAY_MS, accuracy: 0.91, level: 1 },
    ],
  })
  await page.reload()
  await nav(page, 'Progress').click()
  await expect(page.getByTestId('dashboard-advance-sight-reading')).toBeEnabled({ timeout: 10_000 })

  await instrumentPutCalls(page)

  // Force the race AND dispatch the page-hide path, ALL inside one
  // synchronous script, with the put counts sampled at each step and
  // returned together. This is deliberate, not merely tidy: an earlier
  // version split "force the race" and "dispatch pagehide" into two separate
  // `page.evaluate` calls, and even that one Playwright round-trip (a few ms
  // of CDP overhead) was consistently enough real wall-clock time for
  // write #1's `put` to settle and the drain loop's own ORDINARY (non-flush)
  // continuation to notice `pending` and send write #2 anyway — before
  // `pagehide` was ever dispatched at all. Doing everything in one
  // synchronous turn is what makes "was write #2 sent because of the
  // dispatch, specifically" measurable at all: nothing asynchronous can run
  // between forcing the race and reading `__putCount` a moment later.
  const { afterRace, afterPagehide } = await page.evaluate(() => {
    const advanceButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="dashboard-advance-sight-reading"]',
    )
    const theorySelect = document.querySelector<HTMLSelectElement>('[data-testid="dashboard-level-select-theory"]')
    if (advanceButton === null || theorySelect === null) throw new Error('controls not found')
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    if (nativeSelectValueSetter === undefined) throw new Error('no native value setter')
    const win = window as unknown as { __putCount: number }

    advanceButton.click() // write #1: issued synchronously, in flight
    nativeSelectValueSetter.call(theorySelect, '3')
    theorySelect.dispatchEvent(new Event('change', { bubbles: true })) // write #2: queued behind #1
    const afterRace = win.__putCount
    window.dispatchEvent(new Event('pagehide'))
    const afterPagehide = win.__putCount
    return { afterRace, afterPagehide }
  })
  // Sanity-check the race is real: only write #1 had actually reached
  // IndexedDB before the dispatch — if this were 2 already, nothing below
  // would prove anything about the page-hide flush.
  expect(afterRace, 'the race did not set up as expected').toBe(1)
  // THE assertion. Pre-fix (no listener registered) this stays 1. Post-fix,
  // `flush()` issues write #2's `put` synchronously, inside the dispatch,
  // making it 2.
  expect(afterPagehide, 'pagehide did not flush the queued write').toBe(2)

  // End-to-end: let the flush-issued write settle, then prove the full
  // learner-facing story — reading it back off the live screen AND out of
  // the real IndexedDB record survives an actual reload.
  await expect
    .poll(async () => {
      const stored = (await readStore(page, 'settings', 'levelState')) as
        | { readonly levelState?: { readonly levels?: Record<string, number> } }
        | undefined
      return stored?.levelState?.levels?.theory
    }, { timeout: 10_000 })
    .toBe(3)

  await page.reload()
  await nav(page, 'Progress').click()

  await expect(page.getByTestId('dashboard-level-sight-reading')).toContainText('level 2', { timeout: 10_000 })
  await expect(page.getByTestId('dashboard-level-sight-reading')).not.toContainText('(overridden)')
  await expect(page.getByTestId('dashboard-level-theory')).toContainText('level 3')
  await expect(page.getByTestId('dashboard-level-theory')).toContainText('(overridden)')

  const stored = (await readStore(page, 'settings', 'levelState')) as
    | {
        readonly levelState?: {
          readonly levels?: Record<string, number>
          readonly overridden?: Record<string, boolean>
        }
      }
    | undefined
  expect(stored?.levelState?.levels?.['sight-reading']).toBe(2)
  expect(stored?.levelState?.overridden?.['sight-reading']).toBe(false)
  expect(stored?.levelState?.levels?.theory).toBe(3)
  expect(stored?.levelState?.overridden?.theory).toBe(true)

  expect(errors).toEqual([])
})

test('two rapid edits to a repertoire piece both survive a page-hide, with no poll (roadmap F.2, bigger payload: the repertoire library)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  const PIECE_ID = 'f2-audit-piece'
  await seedStore(page, 'repertoire', 'repertoire', {
    pieces: [
      {
        id: PIECE_ID,
        title: 'F.2 Audit Piece',
        composer: 'Anon.',
        level: 2,
        status: 'learning',
        sessions: [],
        bestAccuracy: 0,
        notes: 'original notes',
      },
    ],
  })
  await page.reload()
  await nav(page, 'Repertoire').click()
  await expect(page.getByRole('heading', { name: 'Repertoire', exact: true })).toBeVisible()
  await expect(page.locator(`#repertoire-status-${PIECE_ID}`)).toBeVisible()

  await instrumentPutCalls(page)

  // Two edits to the SAME piece (status, then notes), and the page-hide
  // dispatch, ALL inside one synchronous script — see the level-state spec's
  // identical comment above for why splitting this into separate
  // `page.evaluate` calls lets the ordinary drain loop rescue write #2 on its
  // own, proving nothing. The status change's write is issued synchronously
  // and is still in flight when the notes change fires, so the notes write
  // lands in `pending` — the bigger-payload analogue of the level-state race,
  // on `COLLECTIONS.repertoire` instead of the shared `settings` collection.
  const { afterRace, afterPagehide } = await page.evaluate(({ pieceId }) => {
    const statusSelect = document.querySelector<HTMLSelectElement>(`#repertoire-status-${pieceId}`)
    const notesArea = document.querySelector<HTMLTextAreaElement>(`#repertoire-notes-${pieceId}`)
    if (statusSelect === null || notesArea === null) throw new Error('controls not found')
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set
    if (nativeSelectValueSetter === undefined || nativeTextareaValueSetter === undefined) {
      throw new Error('no native value setter')
    }
    const win = window as unknown as { __putCount: number }

    nativeSelectValueSetter.call(statusSelect, 'maintained')
    statusSelect.dispatchEvent(new Event('change', { bubbles: true })) // write #1: in flight
    nativeTextareaValueSetter.call(notesArea, 'edited during page-hide race')
    notesArea.dispatchEvent(new Event('input', { bubbles: true })) // write #2: queued behind #1
    const afterRace = win.__putCount
    window.dispatchEvent(new Event('pagehide'))
    const afterPagehide = win.__putCount
    return { afterRace, afterPagehide }
  }, { pieceId: PIECE_ID })
  expect(afterRace, 'the race did not set up as expected').toBe(1)
  expect(afterPagehide, 'pagehide did not flush the queued write').toBe(2)

  await expect
    .poll(async () => {
      const stored = (await readStore(page, 'repertoire', 'repertoire')) as
        | { readonly pieces?: readonly { readonly id?: string; readonly notes?: string }[] }
        | undefined
      return stored?.pieces?.find((p) => p.id === PIECE_ID)?.notes
    }, { timeout: 10_000 })
    .toBe('edited during page-hide race')

  await page.reload()
  await nav(page, 'Repertoire').click()

  await expect(page.locator(`#repertoire-status-${PIECE_ID}`)).toHaveValue('maintained', { timeout: 10_000 })
  await expect(page.locator(`#repertoire-notes-${PIECE_ID}`)).toHaveValue('edited during page-hide race')

  const stored = (await readStore(page, 'repertoire', 'repertoire')) as
    | { readonly pieces?: readonly { readonly id?: string; readonly status?: string; readonly notes?: string }[] }
    | undefined
  const piece = stored?.pieces?.find((p) => p.id === PIECE_ID)
  expect(piece?.status).toBe('maintained')
  expect(piece?.notes).toBe('edited during page-hide race')

  expect(errors).toEqual([])
})
