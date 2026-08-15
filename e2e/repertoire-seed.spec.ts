import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { expandRepertoireLevelGroup } from './repertoire-helpers.ts'

/**
 * E2E proof for roadmap 4.9a (REQ-5.2, REQ-3.8.3) — the shipped graded
 * catalogue (`src/content/repertoire/gradedPieces.ts`) is reachable from the
 * repertoire screen and a catalogue add is a REAL library add, not a
 * catalogue-from-memory render.
 *
 * This spec deliberately does NOT assert "20 rows are visible" — a hardcoded
 * list in the screen would pass that too. Instead it drives the real Add
 * control for ONE named piece, reloads, and reads the persisted record back
 * out of `COLLECTIONS.repertoire` in IndexedDB (same technique as
 * `e2e/repertoire.spec.ts`), so only a real store round-trip through
 * `addPiece` can pass.
 *
 * Roadmap UI-26: the catalogue's level-5 group (this spec's fixed piece is
 * level 5) is collapsed by default on a fresh, level-1 profile — see
 * `e2e/repertoire-helpers.ts`'s own doc comment for why every spec that
 * drives a catalogue row expands its group through that one shared helper.
 */

const DB_NAME = 'piano-learning-app'
const REPERTOIRE_COLLECTION = 'repertoire'
const REPERTOIRE_KEY = 'repertoire'

// A fixed non-level-1 catalogue entry, picked by id so this spec breaks
// loudly (not silently) if `gradedPieces.ts` ever drops or renames it, and so
// the asserted level can only pass if the catalogue's OWN level is preserved
// (a level-1 pick would also pass against a hardcoded `level: 1`).
const CATALOGUE_PIECE_ID = 'bach-invention-no-1-bwv-772'
const CATALOGUE_PIECE_TITLE = 'Invention No. 1 in C major, BWV 772'
const CATALOGUE_PIECE_LEVEL = 5

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

type StoredPiece = { readonly id: string; readonly title: string; readonly level: number }
type StoredRepertoire = { readonly pieces: readonly StoredPiece[] }

/** Read the repertoire record out of the app's real IndexedDB (see e2e/repertoire.spec.ts). */
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

test('adding a graded catalogue piece through the real control persists it into the repertoire library across a reload (roadmap 4.9a)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await navButton(page, 'Repertoire').click()

  const screenRegion = page.getByRole('region', { name: 'Repertoire' })
  const library = page.getByRole('list', { name: 'Repertoire pieces' })
  const catalogueRegion = page.getByRole('region', { name: 'Graded library' })

  // Honest empty library before anything is added.
  await expect(screenRegion.getByText(/No pieces in your library yet/i)).toBeVisible()

  // Roadmap UI-26: this piece's level-5 group is collapsed by default on a
  // fresh (level 1) profile.
  await expandRepertoireLevelGroup(page, CATALOGUE_PIECE_TITLE)

  const catalogueRow = catalogueRegion.getByRole('listitem').filter({ hasText: CATALOGUE_PIECE_TITLE })
  await expect(catalogueRow).toBeVisible()
  await catalogueRow.getByRole('button', { name: 'Add' }).click()

  // The control flips to already-added instead of offering Add twice.
  await expect(catalogueRow.getByText(/already in your library/i)).toBeVisible()
  await expect(catalogueRow.getByRole('button', { name: 'Add' })).toHaveCount(0)

  await expect(library.getByText(CATALOGUE_PIECE_TITLE, { exact: true })).toBeVisible()
  await expect(library.getByText(`Level ${CATALOGUE_PIECE_LEVEL}`)).toBeVisible()

  // The write has to have landed in IndexedDB before it can be read back
  // underneath the app — same pattern as e2e/repertoire.spec.ts.
  await expect(async () => {
    const stored = await readRepertoire(page)
    const piece = stored?.pieces.find((p) => p.id === CATALOGUE_PIECE_ID)
    expect(piece).toBeDefined()
    expect(piece?.level).toBe(CATALOGUE_PIECE_LEVEL)
  }).toPass({ timeout: 10_000 })

  // Reload, and prove the piece is still there — persisted, not re-derived
  // from the catalogue held in memory.
  await page.reload()
  await navButton(page, 'Repertoire').click()

  await expect(library.getByText(CATALOGUE_PIECE_TITLE, { exact: true })).toBeVisible()
  await expect(library.getByText(`Level ${CATALOGUE_PIECE_LEVEL}`)).toBeVisible()

  const stored = await readRepertoire(page)
  const piece = stored?.pieces.find((p) => p.id === CATALOGUE_PIECE_ID)
  expect(piece).toBeDefined()
  expect(piece?.title).toBe(CATALOGUE_PIECE_TITLE)
  expect(piece?.level).toBe(CATALOGUE_PIECE_LEVEL)

  expect(errors).toEqual([])
})
