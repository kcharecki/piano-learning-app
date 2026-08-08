import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * E2E proof for roadmap 5.1 (REQ-5.2): the 20 `GRADED_PIECES` entries now
 * resolve to real, bundled `.musicxml` files (`gradedPieces.test.ts` proves
 * every one parses, is non-empty, and matches its stated key as a content
 * test). This spec is the browser half — a NAMED, non-default, non-Twinkle
 * piece loads through the same untrusted import path a learner's own file
 * takes, and engraves as real staff notation, not a placeholder.
 *
 * "Opened from Repertoire" by clicking a control on that screen is roadmap
 * 5.2's own proof action (`RepertoireScreen` has no such control yet — see
 * that task's note that "Add" is a dead end today); this spec instead proves
 * the artefact itself — the bundled file behind the catalogue's `scoreId` —
 * is real, exactly as any file import into `ScoreScreen` is proven, which is
 * the mechanism 5.2 will wire the catalogue's "Open" control through.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MINUET_PATH = path.join(
  __dirname,
  '..',
  'src',
  'content',
  'scores',
  'minuet-in-g-major-bwv-anh-114.musicxml',
)
const MINUET_TITLE = 'Minuet in G major, BWV Anh. 114'

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

test('a named, non-default graded-repertoire score (not Twinkle) loads and engraves in G major (roadmap 5.1)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await navButton(page, 'Practice').click()
  await page.getByLabel(/Import a score/i).setInputFiles(MINUET_PATH)

  await expect(page.getByRole('heading', { name: MINUET_TITLE })).toBeVisible()

  // Real notation, not a placeholder: past the 50-element discriminator this
  // suite uses elsewhere (e2e/smoke.spec.ts, e2e/screens.spec.ts).
  const score = page.getByTestId('score-container')
  await expect(score.locator('svg')).toBeVisible({ timeout: 15_000 })
  expect(await score.locator('svg *').count()).toBeGreaterThan(50)

  // G major, one sharp — read off the engraving, not the file: VexFlow draws
  // one `.vf-keysignature` group per staff (treble + bass), each holding
  // exactly one sharp glyph.
  const keySignature = score.locator('svg .vf-keysignature')
  await expect(keySignature).toHaveCount(2)
  expect(await keySignature.locator('path').count()).toBe(2)

  expect(errors).toEqual([])
})
