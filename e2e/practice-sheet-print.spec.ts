import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.47 (REQ-3.10.4): the printable practice sheet, a
 * teacher/parent output distinct from the raw JSON/CSV backup
 * (e2e/export-restore.spec.ts). Two things are proved here, and neither is
 * safe to assume from the component test suite alone:
 *
 * 1. "A week's practice" is REAL data, read out of the app's real store
 *    after a reload — not a fixture the component happens to render nicely.
 *    A week of genuine-looking `PracticeEntry`/`StoredAssessment` rows is
 *    merged directly into IndexedDB (the same technique
 *    e2e/dashboard-populated.spec.ts and e2e/dashboard-assessment.spec.ts
 *    already use), the page is reloaded so the only route to what ends up on
 *    screen is IndexedDB restoration, and the assertions check for the exact
 *    seeded numbers/names, not just "some text appeared".
 * 2. "Prints to one page" is MEASURED, not eyeballed: `page.pdf()` (Chromium
 *    headless only, which is what this project's Playwright config runs)
 *    produces the actual printed document, and `countPdfPages` counts real
 *    `/Type /Page` objects in it — a `@media print` stylesheet that silently
 *    overflowed to a second page would fail this test even though it looks
 *    fine on screen.
 */

const DB_NAME = 'piano-learning-app'
const DAY_MS = 24 * 60 * 60 * 1000

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

type SyntheticPracticeEntry = {
  readonly id: string
  readonly startedAt: number
  readonly endedAt: number
  readonly kind: string
  readonly itemId?: string
  readonly itemName: string
}

type SyntheticAssessment = {
  readonly id: string
  readonly scoreId: string
  readonly scoreTitle: string
  readonly at: number
  readonly result: {
    readonly scoreId: string
    readonly accuracy: number
    readonly timingConsistency: number
    readonly meanAbsDeviationMs: number
    readonly tempoBpm: number
    readonly measures: readonly unknown[]
    readonly counts: { readonly correct: number; readonly wrongPitch: number; readonly missed: number; readonly extra: number }
    readonly completedAt: number
  }
}

/** Writes a whole object store record (not a merge — this spec starts from a fresh profile). */
async function putRecord(page: Page, collection: string, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    ({ dbName, storeName, storeKey, storeValue }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(storeName, 'readwrite')
          const putReq = tx.objectStore(storeName).put(storeValue, storeKey)
          putReq.onerror = () => reject(putReq.error)
          putReq.onsuccess = () => resolve()
        }
      }),
    { dbName: DB_NAME, storeName: collection, storeKey: key, storeValue: value },
  )
}

/**
 * Counts real page objects in a printed PDF buffer by looking for
 * `/Type /Page` dictionary entries, excluding `/Type /Pages` (the page-TREE
 * node, not a page) via the negative lookahead. `page.pdf()`'s Chromium
 * output writes these dictionaries as plain text even though embedded
 * content streams are compressed, so a byte-level scan is reliable here
 * without pulling in a PDF-parsing dependency.
 */
function countPdfPages(pdfBuffer: Buffer): number {
  const text = pdfBuffer.toString('latin1')
  const matches = text.match(/\/Type\s*\/Page(?!s)/g) ?? []
  return matches.length
}

test('a genuine week of practice, restored from IndexedDB after a reload, renders on the practice sheet and prints to exactly one page (roadmap 5.47)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')

  const now = Date.now()
  const practiceEntries: SyntheticPracticeEntry[] = [
    { id: 'sheet-1', startedAt: now - 6 * DAY_MS, endedAt: now - 6 * DAY_MS + 15 * 60_000, kind: 'repertoire', itemId: 'minuet-g', itemName: 'Minuet in G' },
    { id: 'sheet-2', startedAt: now - 5 * DAY_MS, endedAt: now - 5 * DAY_MS + 10 * 60_000, kind: 'technique', itemName: 'Five-finger patterns' },
    { id: 'sheet-3', startedAt: now - 4 * DAY_MS, endedAt: now - 4 * DAY_MS + 8 * 60_000, kind: 'sightreading', itemName: 'Sight-reading exercise' },
    { id: 'sheet-4', startedAt: now - 3 * DAY_MS, endedAt: now - 3 * DAY_MS + 20 * 60_000, kind: 'repertoire', itemId: 'minuet-g', itemName: 'Minuet in G' },
    { id: 'sheet-5', startedAt: now - 1 * DAY_MS, endedAt: now - 1 * DAY_MS + 18 * 60_000, kind: 'repertoire', itemId: 'fur-elise', itemName: 'Fur Elise' },
  ]
  const assessments: SyntheticAssessment[] = [
    {
      id: 'sheet-assess-1',
      scoreId: 'minuet-g',
      scoreTitle: 'Minuet in G',
      at: now - 3 * DAY_MS,
      result: {
        scoreId: 'minuet-g',
        accuracy: 0.82,
        timingConsistency: 0.75,
        meanAbsDeviationMs: 18,
        tempoBpm: 92,
        measures: [],
        counts: { correct: 20, wrongPitch: 3, missed: 1, extra: 0 },
        completedAt: now - 3 * DAY_MS,
      },
    },
  ]

  await putRecord(page, 'practiceLog', 'practiceLog', { practiceEntries })
  await putRecord(page, 'progress', 'assessments', { assessments })

  // Reload: the only way any of the assertions below can pass is IndexedDB
  // restoration, not in-memory state.
  await page.reload()
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  const sheetSection = page.getByRole('region', { name: 'Practice sheet' })
  await sheetSection.getByRole('button', { name: 'Show practice sheet' }).click()

  const sheet = sheetSection.locator('.practice-sheet')
  await expect(page.getByTestId('practice-sheet-empty')).toHaveCount(0)

  // The real per-category minutes: repertoire = 15 + 20 + 18 = 53, technique
  // = 10, sightreading = 8 — a fixture-rendering component with no real store
  // wiring cannot produce these exact, asymmetric numbers.
  await expect(page.getByTestId('practice-sheet-category-repertoire')).toContainText('53')
  await expect(page.getByTestId('practice-sheet-category-technique')).toContainText('10')
  await expect(page.getByTestId('practice-sheet-category-sightreading')).toContainText('8')

  // "Minuet in G" was practiced twice (15 + 20 = 35 minutes, 2 sessions) —
  // proves same-item sessions are combined into one row, not listed twice.
  await expect(sheet).toContainText('Minuet in G')
  await expect(sheet).toContainText('Fur Elise')
  const minuetRow = sheet.locator('tr', { hasText: 'Minuet in G' }).first()
  await expect(minuetRow).toContainText('2')
  await expect(minuetRow).toContainText('35')

  // The assessment: real accuracy (82%), and the caveat about what it does
  // and does not cover — REQ-3.3.4's number is not handed to a parent bare.
  await expect(page.getByTestId('practice-sheet-assessment-0')).toContainText('Minuet in G')
  await expect(page.getByTestId('practice-sheet-assessment-0')).toContainText('82%')
  await expect(sheet).toContainText(/does not measure tone/i)

  expect(errors).toEqual([])

  // Print measurement: emulate print media, then generate the real printed
  // PDF and count its pages — not a visual approximation.
  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf()
  const pageCount = countPdfPages(pdf)
  expect(pageCount, `expected exactly one printed page, got ${pageCount}`).toBe(1)
})

test('printing an unused profile (no practice logged yet) is honest, not blank, and still fits one page (roadmap 5.47)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  const sheetSection = page.getByRole('region', { name: 'Practice sheet' })
  await sheetSection.getByRole('button', { name: 'Show practice sheet' }).click()

  await expect(page.getByTestId('practice-sheet-empty')).toContainText(/no practice recorded/i)
  await expect(page.getByTestId('practice-sheet-summary')).toHaveCount(0)

  expect(errors).toEqual([])

  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf()
  expect(countPdfPages(pdf)).toBe(1)
})
