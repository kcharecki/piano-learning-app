import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.26: the clef/accidental glyphs in `StaffNote.tsx`
 * used to be bare Unicode text in `system-ui`, so on a machine with no music
 * font installed (this Playwright-driven Chromium is exactly such a machine
 * — it ships no SMuFL/music fonts) they had no guarantee of rendering at
 * all. `feature-music-font.css` now bundles Bravura (self-hosted woff2,
 * `src/design-system/fonts/bravura/Bravura.woff2`) and applies it via the
 * `.music-glyph` class.
 *
 * A CSS assertion that `font-family` merely *contains* "Bravura" would prove
 * nothing — that's true whether or not the file actually parses, resolves,
 * or covers the codepoint. The real proof has to be a measured rendering
 * difference: this reads the *actual* clef glyph's `getBBox()` width in the
 * live app (bundled font applied) and compares it against a control element
 * carrying the exact same glyph and font-size but the pre-fix fallback stack
 * (`system-ui, ...` with no music font) — i.e. what StaffNote.tsx rendered
 * before this task, in this same fontless environment.
 */

const CLEF_GLYPH = '\u{1D11E}' // U+1D11E MUSICAL SYMBOL G CLEF — same codepoint StaffNote.tsx uses
const PRE_FIX_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** Renders `glyph` at `fontSize` in an offscreen SVG with the given font-family
 *  and returns its rendered bounding box — the real, measured extent of
 *  whatever glyph (or lack of one) that font stack actually produced. */
async function measureGlyphBBox(
  page: Page,
  glyph: string,
  fontFamily: string,
  fontSize: number,
): Promise<{ width: number; height: number }> {
  return page.evaluate(
    ({ glyph, fontFamily, fontSize }) => {
      const svgNS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(svgNS, 'svg')
      svg.setAttribute('width', '300')
      svg.setAttribute('height', '150')
      svg.style.position = 'absolute'
      svg.style.left = '-9999px'
      svg.style.top = '-9999px'
      const text = document.createElementNS(svgNS, 'text')
      text.setAttribute('font-size', String(fontSize))
      text.style.fontFamily = fontFamily
      text.textContent = glyph
      svg.appendChild(text)
      document.body.appendChild(svg)
      const bbox = text.getBBox()
      document.body.removeChild(svg)
      return { width: bbox.width, height: bbox.height }
    },
    { glyph, fontFamily, fontSize },
  )
}

test('the bundled Bravura font is self-hosted, actually loads, and changes the rendered clef glyph (roadmap 5.26)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  const networkRequests: string[] = []
  page.on('request', (req) => networkRequests.push(req.url()))

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Flashcards', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()

  // The 'staff-to-key' deck is the default — a StaffNote with a clef is on
  // screen with no further interaction needed.
  const clef = page.getByTestId('clef-glyph')
  await expect(clef).toBeVisible()

  // Self-hosted, no network fetch: the font request (if any — Vite may inline
  // small assets, but 316KB will be a real request) must come from this app's
  // own origin, never a third-party host like fonts.googleapis.com/gstatic.
  const fontRequests = networkRequests.filter((url) => /bravura/i.test(url))
  for (const url of fontRequests) {
    expect(new URL(url).origin).toBe(new URL(page.url()).origin)
  }

  // The @font-face actually parsed and loaded — not just declared in CSS.
  const bravuraLoaded = await page.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('34px Bravura')
  })
  expect(bravuraLoaded).toBe(true)

  // The real glyph, as rendered in the live app right now.
  const bundled = await page.evaluate((testId) => {
    const el = document.querySelector(`[data-testid="${testId}"]`)
    if (el === null) throw new Error('clef glyph element not found')
    const bbox = (el as unknown as SVGGraphicsElement).getBBox()
    return { width: bbox.width, height: bbox.height, fontFamily: getComputedStyle(el).fontFamily }
  }, 'clef-glyph')

  expect(bundled.fontFamily).toContain('Bravura')
  expect(bundled.width).toBeGreaterThan(0)
  expect(bundled.height).toBeGreaterThan(0)

  // The control: the exact same codepoint, same size, but the pre-fix font
  // stack (no Bravura) — what this same fontless browser rendered before this
  // task. If the bundled font weren't actually taking effect, these two would
  // be identical.
  const control = await measureGlyphBBox(page, CLEF_GLYPH, PRE_FIX_FONT_STACK, 34)

  // eslint-disable-next-line no-console -- diagnostic only, not an assertion
  console.log('clef glyph bbox — bundled(Bravura):', bundled, 'control(system-ui only):', control)

  expect(bundled.width).toBeGreaterThan(0)
  // Compare rendered area, not just width: a real G clef is a tall glyph that
  // reaches well above and below the staff, so its most reliable fingerprint
  // against a generic/fallback glyph is height, not advance width alone (this
  // codepoint measured 136.8px tall bundled vs. 46px tall for the fallback
  // stack on this same fontless machine — a ~3x difference; width alone can
  // be within a few px of a same-size fallback box and still be a totally
  // different, unrelated glyph shape).
  const bundledArea = bundled.width * bundled.height
  const controlArea = control.width * control.height
  const shapesDiffer =
    controlArea === 0 || Math.abs(bundledArea - controlArea) / bundledArea > 0.5
  expect(shapesDiffer).toBe(true)

  expect(errors).toEqual([])
})
