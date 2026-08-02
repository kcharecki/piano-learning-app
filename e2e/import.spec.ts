import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * E2E proof for roadmap 2.19a (REQ-3.2.5): a compressed MusicXML (`.mxl`)
 * import must engrave exactly like a plain `.musicxml`, because the unpacked
 * rootfile IS plain MusicXML. Asserting the score container holds a real OSMD
 * render (not merely that the file was accepted) is the point: `unpackMxl`
 * returning a truncated or wrong archive entry would still load a score object
 * while producing no notation.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MXL_FIXTURE = path.join(__dirname, 'fixtures', 'compressed-six-bars.mxl')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('importing a .mxl archive engraves real notation, not just a loaded score (roadmap 2.19a)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  await page.getByLabel(/Import a score/i).setInputFiles(MXL_FIXTURE)

  // The archive's rootfile is the six-bar fixture, so the heading proves the
  // ZIP was opened and the right entry chosen — the bundled Twinkle sample
  // would still be showing otherwise.
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  // ... and this proves OSMD got real MusicXML text out of it. The element
  // count discriminator is the one established in e2e/smoke.spec.ts: a
  // degenerate render is ~25-35 elements, a hard failure produces no <svg>.
  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible()
  expect(await container.locator('svg *').count()).toBeGreaterThan(50)

  // The MIDI-import explanation must NOT appear: a `.mxl` has notation.
  await expect(page.getByText(/imported from a MIDI file/i)).toHaveCount(0)

  expect(errors).toEqual([])
})
