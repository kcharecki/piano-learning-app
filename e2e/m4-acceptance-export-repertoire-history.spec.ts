import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * roadmap 4.10 (M4 acceptance pass, 2026-08-12) — the two halves of a
 * repertoire piece's stored progress, driven end to end.
 *
 * The 2026-08-11 pass found REQ-3.8.2's practice history unwired (nothing in
 * `src/app/**` called `recordSession`). Triage T.5 fixed that in
 * `src/app/practice/usePracticeLog.ts`. Test 1 below re-proves the fix the way
 * this project's standard of proof demands — not "the row stopped saying
 * 'never practised'" (an absence, which a vanished row would also satisfy)
 * but: the session actually reaches the real IndexedDB record, AND the number
 * the screen prints is READ BACK from that stored row rather than re-derived.
 * The second half is proved by rewriting the stored `at` timestamp to five
 * days ago and reloading: a screen deriving a plausible number from anything
 * else cannot follow that edit.
 *
 * Test 2 was the gap that re-proving the first half exposed. Now that a
 * piece's `sessions`/`bestAccuracy` finally hold real data, REQ-3.10.4 ("ALL
 * progress data SHALL be exportable") and REQ-4.3 ("simple backup/restore")
 * used to be broken for it: `RepertoirePieceLike` (`src/core/progress/export.ts`)
 * carried only id/title/composer/status/addedAt, so `toRepertoirePieceLike`
 * (`src/app/progress/snapshot.ts`) dropped `level`, `sessions`,
 * `bestAccuracy`, `notes` and `scoreId` on the way out, and
 * `toRepertoirePiece` fabricated them back at defaults on the way in. Because
 * `applyProgressSnapshot` hydrates the repertoire store by REPLACEMENT, a
 * restore did not merely fail to carry the history forward — it destroyed the
 * history that was there. Fixed by roadmap 4.10 (M4 acceptance Defect 2):
 * `RepertoirePieceLike` now carries every field `RepertoirePiece` does, so
 * export-then-restore is lossless; this spec is the regression guard for it.
 */

/** Console/page errors, collected from page creation (see e2e/export-restore.spec.ts). */
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
const REPERTOIRE_COLLECTION = 'repertoire'
const REPERTOIRE_KEY = 'repertoire'

/** Greensleeves is level 3 in the graded catalogue — see src/content/repertoire/gradedPieces.ts:353. */
const TITLE = 'Greensleeves'
const CATALOGUE_LEVEL = 3
/** The first beat's pitches, as e2e/m4-acceptance-repertoire-practice-history.spec.ts plays them. */
const FIRST_BEAT_PITCHES = [69, 45] as const

const keyboard = (page: Page) => page.getByRole('group', { name: 'Play the score' })
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteLabel(note: number): string {
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`
}
const key = (page: Page, note: number) => keyboard(page).getByRole('button', { name: noteLabel(note) })

type StoredSession = {
  readonly at: number
  readonly minutes: number
  readonly accuracy?: number
  readonly tempoBpm?: number
}
type StoredPiece = {
  readonly id: string
  readonly title: string
  readonly level: number
  readonly notes: string
  readonly bestAccuracy: number
  readonly sessions: readonly StoredSession[]
}

/** Read the app's real persisted repertoire record out of IndexedDB. */
async function readPieces(page: Page): Promise<readonly StoredPiece[]> {
  const stored = await page.evaluate(
    ({ dbName, storeName, storeKey }) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        // Never create the database from a probe — see e2e/export-restore.spec.ts.
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
            reject(request.error)
          }
          request.onsuccess = () => {
            const value = request.result as unknown
            db.close()
            resolve(value)
          }
        }
      }),
    { dbName: DB_NAME, storeName: REPERTOIRE_COLLECTION, storeKey: REPERTOIRE_KEY },
  )
  const record = stored as { readonly pieces?: readonly StoredPiece[] } | undefined
  return record?.pieces ?? []
}

/**
 * Rewrite the stored `at` of every session on every piece to `atEpochMs`,
 * straight into the real IndexedDB record. Nothing in the app can observe this
 * except by reading that record back, which is the point: it is what separates
 * "the screen prints a stored value" from "the screen prints a plausible one".
 */
async function backdateStoredSessions(page: Page, atEpochMs: number): Promise<void> {
  await page.evaluate(
    ({ dbName, storeName, storeKey, at }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onupgradeneeded = () => {
          open.transaction?.abort()
        }
        open.onerror = () => reject(open.error as unknown as Error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(storeName, 'readwrite')
          const objectStore = tx.objectStore(storeName)
          const get = objectStore.get(storeKey)
          get.onerror = () => {
            db.close()
            reject(get.error as unknown as Error)
          }
          get.onsuccess = () => {
            const record = get.result as {
              pieces?: { sessions?: { at: number }[] }[]
            }
            for (const piece of record.pieces ?? []) {
              for (const session of piece.sessions ?? []) session.at = at
            }
            const put = objectStore.put(record, storeKey)
            put.onerror = () => {
              db.close()
              reject(put.error as unknown as Error)
            }
            put.onsuccess = () => {
              tx.oncomplete = () => {
                db.close()
                resolve()
              }
            }
          }
        }
      }),
    { dbName: DB_NAME, storeName: REPERTOIRE_COLLECTION, storeKey: REPERTOIRE_KEY, at: atEpochMs },
  )
}

/** Add Greensleeves from the graded catalogue, play it in Practice, stop. */
async function addAndPractise(page: Page): Promise<void> {
  await nav(page, 'Repertoire').click()
  const catalogue = page.getByRole('list', { name: 'Graded pieces' })
  await catalogue.getByRole('listitem').filter({ hasText: TITLE }).getByRole('button', { name: 'Add' }).click()

  const library = page.getByRole('list', { name: 'Repertoire pieces' })
  const row = library.getByRole('listitem').filter({ hasText: TITLE })
  await expect(row.getByText('never practised')).toBeVisible()
  await expect(row.getByText(`Level ${CATALOGUE_LEVEL}`)).toBeVisible()
  await row.getByRole('button', { name: 'Open in Practice' }).click()

  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible()
  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  for (const pitch of FIRST_BEAT_PITCHES) await key(page, pitch).click()
  // Must clear usePracticeLog's MIN_REPERTOIRE_SESSION_MS floor (1s).
  await page.waitForTimeout(1_500)
  await transport.getByRole('button', { name: 'Stop', exact: true }).click()
}

test('REQ-3.8.2: a practice run stores a real session row, and the screen reads its date back from storage', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await addAndPractise(page)

  // (1) The session reached the real persisted record — not just a zustand store.
  await expect
    .poll(async () => (await readPieces(page)).find((p) => p.title === TITLE)?.sessions.length ?? 0, {
      message: 'the practice session never reached the repertoire record in IndexedDB',
    })
    .toBeGreaterThan(0)
  const pieces = await readPieces(page)
  const stored = pieces.find((p) => p.title === TITLE)
  expect(stored, 'Greensleeves is missing from the stored repertoire record').toBeDefined()
  if (stored === undefined) return
  const session = stored.sessions[0]
  expect(session, 'no session row was stored').toBeDefined()
  if (session === undefined) return
  // REQ-3.8.2's "best assessment result": PracticeScreen always passes the run's
  // accuracy to stop(), so the stored session carries one and bestAccuracy is
  // derived from it inside core's recordSession.
  expect(typeof session.accuracy, 'the stored session carries no accuracy').toBe('number')
  expect(stored.bestAccuracy).toBe(session.accuracy)

  // (2) The displayed figure is READ FROM that stored row. Backdate the stored
  // session by five days behind the app's back and reload: a screen deriving
  // "days since last practice" from anything but this record cannot follow.
  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1_000
  await backdateStoredSessions(page, Date.now() - FIVE_DAYS_MS)
  await page.reload()
  await nav(page, 'Repertoire').click()
  const row = page.getByRole('list', { name: 'Repertoire pieces' }).getByRole('listitem').filter({ hasText: TITLE })
  await expect(row.getByText('5 days since last practice')).toBeVisible()

  expect(errors).toEqual([])
})

test('REQ-3.10.4/REQ-4.3: an exported backup carries a repertoire piece’s practice history, level and notes', async ({
  page,
}) => {
  test.setTimeout(120_000)
  let downloadDir: string | undefined
  try {
    await page.goto('/')
    await addAndPractise(page)

    // Give the piece a level and some notes worth backing up, then confirm the
    // history landed before exporting anything.
    await nav(page, 'Repertoire').click()
    const library = page.getByRole('list', { name: 'Repertoire pieces' })
    const row = library.getByRole('listitem').filter({ hasText: TITLE })
    await row.getByLabel('Notes').fill('Rubato in the B section; watch the LH thumb.')
    await expect
      .poll(async () => (await readPieces(page)).find((p) => p.title === TITLE)?.sessions.length ?? 0)
      .toBeGreaterThan(0)

    // Export the real downloaded file.
    await nav(page, 'Progress').click()
    const exportGroup = page.getByRole('group', { name: 'Export progress' })
    const downloadPromise = page.waitForEvent('download')
    await exportGroup.getByRole('button', { name: /download json/i }).click()
    const download = await downloadPromise
    downloadDir = mkdtempSync(path.join(tmpdir(), 'm4-repertoire-export-'))
    const filePath = path.join(downloadDir, download.suggestedFilename())
    await download.saveAs(filePath)

    // The claim REQ-3.10.4 makes: ALL progress data is in that file.
    const snapshot = JSON.parse(readFileSync(filePath, 'utf8')) as {
      readonly repertoire?: readonly Record<string, unknown>[]
    }
    const exported = (snapshot.repertoire ?? []).find((p) => p['title'] === TITLE)
    expect(exported, 'the exported snapshot has no Greensleeves entry at all').toBeDefined()
    expect(exported?.['sessions'], 'the export dropped the practice history').toBeDefined()
    expect(exported?.['bestAccuracy'], 'the export dropped the best assessment result').toBeDefined()
    expect(exported?.['level'], 'the export dropped the manually assigned level (REQ-3.8.3)').toBe(
      CATALOGUE_LEVEL,
    )
    expect(exported?.['notes'], 'the export dropped the piece notes').toBe(
      'Rubato in the B section; watch the LH thumb.',
    )

    // And restoring it must not destroy what is already there.
    const restoreGroup = page.getByRole('group', { name: 'Restore progress' })
    await restoreGroup.getByLabel(/restore from a file/i).setInputFiles(filePath)
    const confirmGroup = restoreGroup.getByRole('group', { name: /confirm restore/i })
    await confirmGroup.getByRole('button', { name: /replace my progress/i }).click()
    await expect(restoreGroup.getByRole('status').filter({ hasText: /restored progress/i })).toBeVisible()

    await nav(page, 'Repertoire').click()
    const restoredRow = library.getByRole('listitem').filter({ hasText: TITLE })
    await expect(
      restoredRow.getByText('never practised'),
      'the restore wiped the practice history it had just exported',
    ).toBeHidden()
    await expect(
      restoredRow.getByText(`Level ${CATALOGUE_LEVEL}`),
      'the restore reset the manually assigned level',
    ).toBeVisible()

    // "never practised" being hidden is an ABSENCE, which a row that vanished
    // or that renders nothing at all would satisfy just as well (roadmap 4.10,
    // acceptance pass 2026-08-12b). Assert the restored values POSITIVELY,
    // straight off the persisted record the restore wrote and off the screen:
    // the session, its accuracy-derived `bestAccuracy`, and the notes.
    const restored = (await readPieces(page)).find((p) => p.title === TITLE)
    expect(restored, 'Greensleeves is missing from the repertoire record after the restore').toBeDefined()
    expect(restored?.sessions.length, 'the restore dropped the practice sessions').toBeGreaterThan(0)
    expect(restored?.bestAccuracy, 'the restore dropped the best assessment result').toBeGreaterThan(0)
    expect(restored?.level, 'the restore reset the stored level').toBe(CATALOGUE_LEVEL)
    expect(restored?.notes, 'the restore dropped the piece notes').toBe(
      'Rubato in the B section; watch the LH thumb.',
    )
    await expect(
      restoredRow.getByLabel('Notes'),
      'the restored notes are not on screen',
    ).toHaveValue('Rubato in the B section; watch the LH thumb.')
  } finally {
    if (downloadDir !== undefined) rmSync(downloadDir, { recursive: true, force: true })
  }
})
