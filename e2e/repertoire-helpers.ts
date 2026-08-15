import { expect, type Page } from '@playwright/test'

/**
 * Shared driving helper for roadmap UI-26 (2026-08-12 UI audit's "no shape
 * to the page" finding): `RepertoireScreen`'s graded catalogue now groups by
 * level behind a native `<details>`/`<summary>` disclosure, open by default
 * ONLY for the group matching the learner's own playing-track level (level 1
 * on a fresh profile — see `RepertoireScreen.tsx`'s own doc comment). Every
 * e2e spec that drives a catalogue row from a level other than the one
 * auto-open on load must expand that piece's own group first, or the row is
 * genuinely not visible/actionable in a real browser (unlike the
 * component's own `happy-dom` unit tests, which don't hide collapsed
 * `<details>` content, since `happy-dom` does no real layout).
 *
 * A single shared helper, not copy-pasted `summary.click()` calls per spec,
 * so no spec has to hand-derive which level a piece belongs to (a duplicated
 * "Greensleeves is level 3" comment drifting out of sync with
 * `gradedPieces.ts` would be a silent, hard-to-notice failure mode). Matches
 * this directory's existing convention for a driving helper shared across
 * spec files (`e2e/keyboard-helpers.ts`, `e2e/seedLevel.ts`,
 * `e2e/practice-setup.ts`).
 *
 * Not in `RepertoireScreen`'s task file list — added because acceptance
 * criterion 4 explicitly calls for a shared exported helper, and this
 * codebase never imports one `*.spec.ts` file from another (confirmed by a
 * repo-wide grep before adding this): a spec file's `test(...)` calls are
 * meant to run exactly once, associated with the file Playwright loaded as
 * an entry point, and importing one spec from another risks double-
 * registering its tests. A plain, non-spec helper module — this file — is
 * the safe, established shape.
 */
export async function expandRepertoireLevelGroup(page: Page, pieceTitle: string): Promise<void> {
  const catalogueRegion = page.getByRole('region', { name: 'Graded library' })
  const row = catalogueRegion.getByRole('listitem').filter({ hasText: pieceTitle })

  // Already visible — either it's in the group open by default, or a search
  // filter already forced every matching group open. Expanding an
  // already-open <details> a second time would collapse it, so this is a
  // deliberate no-op rather than an unconditional click.
  if (await row.isVisible()) return

  const group = catalogueRegion.locator('details.repertoire-level-group').filter({ hasText: pieceTitle })
  await group.locator('summary').click()
  await expect(row).toBeVisible()
}
