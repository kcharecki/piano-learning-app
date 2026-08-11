import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * roadmap 4.10 (M4 acceptance pass) — independent re-check of REQ-3.8.2/3.8.3
 * ("each repertoire piece has a status and stores practice history" / "the
 * user can add any imported score to the repertoire and assign it a level
 * manually").
 *
 * `e2e/repertoire.spec.ts` already covers this ground in full (including the
 * 21-day maintenance interval), but it currently FAILS on this worktree —
 * not because the feature regressed, but because `screen.getByLabel('Level')`
 * has become ambiguous: roadmap 5.3 added a "Below my level (playing level
 * N)" filter checkbox whose accessible name also contains the word "Level",
 * so Playwright's strict mode now finds two matches where the original spec
 * expected one. See the M4 acceptance report for the proposed fix (scope the
 * existing spec's locator to `{ exact: true }` on the `<select>`'s own label).
 *
 * This spec re-drives the "add, assign level, mark maintained, and see it
 * appear in the review-due list" chain with an unambiguous locator, to
 * confirm the underlying capability — as opposed to the existing test's
 * plumbing — still works. It stops short of the existing spec's 2-day/40-day
 * interval injection (that arithmetic is core-tested separately in
 * `core/repertoire/repertoire.test.ts`); what this re-proves is the wiring:
 * that setting 'maintained' through the real screen actually reaches
 * `maintenanceDue` and surfaces in the named due-list region.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

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

test('an imported score can still be added to the repertoire with a manually assigned level, and its status can be set to maintained (REQ-3.8.2/3.8.3)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await navButton(page, 'Practice').click()
  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  await navButton(page, 'Repertoire').click()
  const screen = page.getByRole('region', { name: 'Repertoire' })
  const library = page.getByRole('list', { name: 'Repertoire pieces' })
  const dueList = page.getByRole('list', { name: 'Pieces due for review' })
  const due = page.getByRole('region', { name: 'Review due' })

  await expect(due.getByText('Nothing due for review.')).toBeVisible()

  // The exact-match label is the fix the ambiguous existing spec needs.
  await screen.getByLabel('Level', { exact: true }).selectOption('3')
  await screen.getByRole('button', { name: 'Add loaded score' }).click()

  await expect(library.getByText(FIXTURE_TITLE, { exact: true })).toBeVisible()
  await expect(library.getByText('Level 3')).toBeVisible()
  await expect(library.getByText('never practised')).toBeVisible()

  // Still 'learning', so nothing is due yet (REQ-3.8.4 is about MAINTAINED
  // pieces decaying, not new ones).
  await expect(due.getByText('Nothing due for review.')).toBeVisible()

  const statusSelect = library.getByLabel('Status')
  await statusSelect.selectOption('maintained')
  await expect(statusSelect).toHaveValue('maintained')
  await expect(library.locator('.badge', { hasText: 'maintained' })).toBeVisible()

  // roadmap 4.5's own proof action: a maintained, never-practised piece is
  // due immediately, and it has to be THIS piece by name, not just any entry.
  await expect(dueList.getByText(new RegExp(`${FIXTURE_TITLE}.*never practised`))).toBeVisible()

  expect(errors).toEqual([])
})
