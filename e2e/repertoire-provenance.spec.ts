import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.52 — the "playable content" finding from the
 * 2026-08-12 ux-pedagogy review: the Repertoire catalogue row used to read
 * "Für Elise (Theme A) / Ludwig van Beethoven (1770–1827) / Level 3 / Add"
 * and disclose nothing about what the bundled file actually IS, while
 * `src/content/scores/LICENSE.md` and `gradedPieces.ts`'s own module doc
 * were candid that it is not a verified transcription. `GradedPiece.provenance`
 * (`gradedPieces.ts`) now surfaces that ledger on screen, per piece.
 *
 * This reads the provenance line off the REAL running Repertoire row for two
 * different pieces and asserts they read DIFFERENTLY — asserting a line
 * merely exists would prove nothing, since a generic disclaimer would pass
 * that too — then follows the flagged piece into Practice and checks the
 * same disclosure is still there, per the roadmap 5.52 proof action.
 */

/** Level 1, `provenance.tier: 'source-verified'`, no `excerptNote` — checked
 *  against a named source this app names in `LICENSE.md`, and the FULL
 *  remembered tune (not a partial extract of a larger work). */
const VERIFIED_TITLE = 'Mary Had a Little Lamb'
/** Level 3, `provenance.tier: 'source-verified'` too, but flagged as a
 *  partial excerpt (the opening A section only, not the full rondo) — the
 *  exact piece the 2026-08-12 review named. Source-verified AND flagged as
 *  an excerpt at once is exactly why this spec compares full TEXT, not tier
 *  alone: same tier as the piece above, different, longer, disclosure. */
const FLAGGED_TITLE = 'Für Elise (Theme A)'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function navButton(page: Page, label: string) {
  return page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true })
}

test('the Repertoire catalogue row discloses a per-piece provenance line, and it follows the piece into Practice (roadmap 5.52)', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = collectErrors(page)

  await page.goto('/practice')
  await navButton(page, 'Repertoire').click()

  const catalogue = page.getByRole('list', { name: 'Graded pieces' })
  const verifiedRow = catalogue.getByRole('listitem').filter({ hasText: VERIFIED_TITLE })
  const flaggedRow = catalogue.getByRole('listitem').filter({ hasText: FLAGGED_TITLE })
  await expect(verifiedRow).toBeVisible()
  await expect(flaggedRow).toBeVisible()

  const verifiedText = (
    await verifiedRow.locator('.repertoire-catalogue-provenance').textContent()
  )?.trim()
  const flaggedText = (
    await flaggedRow.locator('.repertoire-catalogue-provenance').textContent()
  )?.trim()

  // Both lines are real text, and they are NOT the same string — the point
  // of this proof. A row that always printed "not a verified transcription"
  // regardless of piece would pass an "exists" check but fail this one.
  expect(verifiedText).toBeTruthy()
  expect(flaggedText).toBeTruthy()
  expect(verifiedText).not.toBe(flaggedText)
  expect(verifiedText).toBe('Source-verified transcription')
  expect(flaggedText).toContain('Source-verified transcription')
  expect(flaggedText).toContain('Opening A section only, not the full rondo')

  // Follow the flagged piece into Practice — the disclosure must travel
  // with it, not stay behind on the Repertoire row.
  await flaggedRow.getByRole('button', { name: 'Add' }).click()
  const library = page.getByRole('list', { name: 'Repertoire pieces' })
  const libraryRow = library.getByRole('listitem').filter({ hasText: FLAGGED_TITLE })
  await libraryRow.getByRole('button', { name: 'Open in Practice' }).click()

  await expect(page.getByRole('heading', { name: FLAGGED_TITLE })).toBeVisible()
  const practiceProvenance = page.locator('.practice-piece-provenance')
  await expect(practiceProvenance).toBeVisible()
  await expect(practiceProvenance).toContainText('Opening A section only, not the full rondo')

  expect(errors).toEqual([])
})
