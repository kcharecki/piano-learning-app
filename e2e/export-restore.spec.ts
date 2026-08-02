import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * E2E proof for roadmap 4.6b (REQ-3.10.4/4.3): a downloaded export file
 * genuinely restores a WIPED app, not just an in-memory copy of the current
 * session. `round6.spec.ts`'s own export test only proves the Download JSON
 * button fires a real download; `snapshot.test.ts` only proves the snapshot
 * round-trips in memory. Neither proves the file on disk can bring a fresh,
 * empty app back — this test drives exactly that: populate two collections,
 * export, delete the real IndexedDB database, reload (asserting the app is
 * genuinely empty — a wipe that silently did nothing would make the rest of
 * this test trivially pass), then import the downloaded file back through
 * `ExportPanel`'s own file input and prove the state is identical.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/round6.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function nav(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
}

const DB_NAME = 'piano-learning-app'

/** Read one key out of one object store of the app's real IndexedDB database (see e2e/progress-persistence.spec.ts). */
async function readStored(page: Page, collection: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, storeName, storeKey }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName)
        // No upgrade should ever be needed here: this probe must never create
        // the database if it does not already exist (that would leave an
        // empty v1 DB behind and permanently block the app's own `upgrade`).
        // Abort the versionchange transaction to roll the creation back.
        open.onupgradeneeded = () => {
          open.transaction?.abort()
        }
        open.onerror = () => {
          resolve(undefined)
        }
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
            reject(request.error)
          }
          request.onsuccess = () => {
            const result = request.result as unknown
            db.close()
            resolve(result)
          }
        }
      }),
    { dbName: DB_NAME, storeName: collection, storeKey: key },
  )
}

/** Count of stored practice-log entries, or 0 if the collection/key is absent. */
async function practiceEntryCount(page: Page): Promise<number> {
  const stored = (await readStored(page, 'practiceLog', 'practiceLog')) as
    | { readonly practiceEntries?: readonly unknown[] }
    | undefined
  return stored?.practiceEntries?.length ?? 0
}

let downloadDir: string | undefined

test.afterEach(() => {
  if (downloadDir !== undefined) {
    rmSync(downloadDir, { recursive: true, force: true })
    downloadDir = undefined
  }
})

test('a downloaded export restores a wiped app to the same state (roadmap 4.6b)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)

  await page.goto('/')

  // Populate #1: answer a flashcard — writes COLLECTIONS.srsCards (see e2e/persistence.spec.ts).
  await nav(page, 'Flashcards').click()
  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
  await keyboard.getByRole('button').first().click()
  await expect(page.getByTestId('flashcard-feedback')).toBeVisible()
  await expect(page.getByTestId('flashcard-stats-total')).toHaveText('1')

  // Capture the state to compare after restore — every stat, not just total,
  // so a restore that resets ease/due/young/mature back to naive defaults
  // still fails even though "total" alone would look right.
  const statsBefore = {
    total: await page.getByTestId('flashcard-stats-total').textContent(),
    due: await page.getByTestId('flashcard-stats-due').textContent(),
    young: await page.getByTestId('flashcard-stats-young').textContent(),
    mature: await page.getByTestId('flashcard-stats-mature').textContent(),
    ease: await page.getByTestId('flashcard-stats-ease').textContent(),
  }

  // Populate #2: a practice run on Practice with the bundled sample — writes
  // practiceLog (see e2e/progress-persistence.spec.ts's Play/wait/Stop edge).
  await nav(page, 'Practice').click()
  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(1_200)
  await transport.getByRole('button', { name: 'Stop', exact: true }).click()

  await expect.poll(() => practiceEntryCount(page), {
    message: 'practice-log entry never reached IndexedDB before export',
  }).toBeGreaterThan(0)
  const practiceLogBefore = await readStored(page, 'practiceLog', 'practiceLog')

  // Export: download the JSON snapshot, capturing the REAL file Playwright saved.
  await nav(page, 'Progress').click()
  const exportGroup = page.getByRole('group', { name: 'Export progress' })
  await expect(exportGroup).toBeVisible()
  // Dashboard-rendered figure derived from the same practiceEntries, so the
  // restore proof covers the dashboard, not only the raw IndexedDB record
  // and the SRS stats (roadmap 4.6b's proof action names the dashboard).
  const weeklyMinutesBefore = await page.getByTestId('dashboard-weekly-minutes').textContent()
  const downloadPromise = page.waitForEvent('download')
  await exportGroup.getByRole('button', { name: /download json/i }).click()
  const download = await downloadPromise
  // Copied to a stable path we own: Playwright's own artifact for `download`
  // is not guaranteed to survive the page reloads below (the WIPE and the
  // post-restore reload both navigate this same page), so `download.path()`
  // read later can point at a file Playwright has already cleaned up.
  downloadDir = mkdtempSync(path.join(tmpdir(), 'export-restore-'))
  const filePath = path.join(downloadDir, download.suggestedFilename())
  await download.saveAs(filePath)

  // WIPE: delete the real IndexedDB database and reload.
  await page.evaluate(
    (dbName) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName)
        request.onsuccess = () => resolve()
        request.onblocked = () => resolve()
        request.onerror = () => reject(request.error as unknown as Error)
      }),
    DB_NAME,
  )
  await page.reload()

  // Load-bearing negative assertion: the app must actually be empty now, or
  // every assertion after the restore below would pass trivially even if the
  // "wipe" above did nothing at all. This IndexedDB-level check is the one
  // that gates: `flashcard-stats-total` below reads '0' on every cold boot
  // before hydration lands (App.tsx restores asynchronously in a useEffect),
  // so it cannot by itself distinguish a real wipe from an unhydrated store —
  // it is kept only as a readability aid, not as the proof.
  expect(await practiceEntryCount(page), 'the wipe did not clear practiceLog').toBe(0)
  await nav(page, 'Flashcards').click()
  await expect(page.getByTestId('flashcard-stats-total')).toHaveText('0')

  // RESTORE: import the downloaded file back through ExportPanel's own file input.
  await nav(page, 'Progress').click()
  const restoreGroup = page.getByRole('group', { name: 'Restore progress' })
  await restoreGroup.getByLabel(/restore from a file/i).setInputFiles(filePath)

  const confirmGroup = restoreGroup.getByRole('group', { name: /confirm restore/i })
  await expect(confirmGroup).toBeVisible()
  await confirmGroup.getByRole('button', { name: /replace my progress/i }).click()
  await expect(restoreGroup.getByRole('status').filter({ hasText: /restored progress/i })).toBeVisible()

  // The write-through to IndexedDB is asynchronous (persistence.ts's write
  // queue) — wait for it to actually land before reloading, or the reload
  // below could race an in-flight `put` and silently lose it.
  await expect.poll(() => practiceEntryCount(page), {
    message: 'restored practice-log entry never reached IndexedDB',
  }).toBeGreaterThan(0)

  // Reload — this is the assertion that actually proves the restore is real:
  // a restore that only lives in the in-memory zustand store (never reaching
  // IndexedDB) would look identical up to this point and then vanish here.
  await page.reload()

  await nav(page, 'Progress').click()
  await expect(page.getByTestId('dashboard-weekly-minutes')).toHaveText(weeklyMinutesBefore ?? '')

  await nav(page, 'Flashcards').click()

  await expect(page.getByTestId('flashcard-stats-total')).toHaveText(statsBefore.total ?? '')
  await expect(page.getByTestId('flashcard-stats-due')).toHaveText(statsBefore.due ?? '')
  await expect(page.getByTestId('flashcard-stats-young')).toHaveText(statsBefore.young ?? '')
  await expect(page.getByTestId('flashcard-stats-mature')).toHaveText(statsBefore.mature ?? '')
  await expect(page.getByTestId('flashcard-stats-ease')).toHaveText(statsBefore.ease ?? '')

  const practiceLogAfter = await readStored(page, 'practiceLog', 'practiceLog')
  expect(practiceLogAfter).toEqual(practiceLogBefore)

  expect(errors).toEqual([])
})
