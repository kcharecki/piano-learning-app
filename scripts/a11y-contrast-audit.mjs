#!/usr/bin/env node
/**
 * The accessibility contrast audit — a narrower, dev-only companion to
 * `scripts/review-probe.mjs contrast`. That tool already computes AA
 * contrast off the live CSSOM; this one exists to be the thing a builder
 * agent runs by hand while iterating on ONE screen's colors, with output
 * shaped as an explicit table (screen / theme / selector / colors / ratio /
 * threshold) and a small set of justified exclusions carved out up front,
 * rather than re-deriving "is this failure real or noise" every time.
 *
 * Exclusions (each one is a deliberate scope cut, not an oversight — an
 * exclusion nobody can justify is how an audit rots into decoration):
 *
 *   - `.notation-frame` subtrees — OSMD engraves its own ink onto
 *     `--paper` and is governed by docs/DESIGN.md rule 8 ("notation
 *     always sits on --paper"), not by the app's token contrast rules.
 *     Auditing engraver-drawn SVG here would flag colors this codebase
 *     does not own and cannot change.
 *   - `aria-hidden="true"` subtrees — content pulled from the
 *     accessibility tree is, by construction, never read by assistive
 *     tech. The brief's own rule is "icons are always aria-hidden — text
 *     carries meaning", i.e. anything still aria-hidden is decorative by
 *     design; auditing its color as if a learner reads it is a false
 *     failure.
 *   - zero-size elements (`getBoundingClientRect` width or height 0) —
 *     nothing is painted at zero area; there is no pixel for a contrast
 *     ratio to describe.
 *   - `visibility: hidden` — reserves layout space but paints nothing.
 *   - `display: none` — not in the render tree at all.
 *
 * Usage:
 *   node scripts/a11y-contrast-audit.mjs --url http://localhost:5173
 *
 * Requires a dev server already running at --url (this repo runs one on
 * :5173 — do not start a second one).
 *
 * Exits 1 if any (non-excluded, i.e. informational) text fails its WCAG
 * 2.1 threshold, so this is a check and not a claim. Exits 0 otherwise.
 */
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const urlAt = args.indexOf('--url')
const url = urlAt === -1 ? 'http://localhost:5173' : (args[urlAt + 1] ?? 'http://localhost:5173')

/** sRGB relative luminance, WCAG 2.x definition. */
function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function ratio(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * The in-page collector. Runs inside the browser via page.evaluate.
 * Returns raw rgb triples + sizes for every visible, non-excluded,
 * text-bearing element.
 */
const COLLECT = () => {
  // Rasterise the computed color rather than regex it: getComputedStyle is
  // free to hand back `color(srgb …)`, `oklch(…)` or `color-mix(…)`, and a
  // rgb()-only regex would silently treat any of those as "no background".
  // A 1x1 canvas resolves every CSS colour syntax the browser itself
  // accepts, exactly as it will paint it.
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const parse = (value) => {
    if (value === '' || value === 'transparent' || value === 'none') return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = value
    // An unparseable value leaves fillStyle at the previous one; a genuine
    // black is indistinguishable from that, which is harmless (black is a
    // real colour and the ratio computed from it is real).
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    if (r === undefined || g === undefined || b === undefined || a === undefined) return null
    return { rgb: [r, g, b], alpha: a / 255 }
  }
  // Effective background: walk up ancestors past transparent / rgba(...,0)
  // surfaces until a painted one is found.
  const backgroundOf = (element) => {
    let node = element
    while (node !== null) {
      const parsed = parse(getComputedStyle(node).backgroundColor)
      if (parsed !== null && parsed.alpha > 0.9) return parsed.rgb
      node = node.parentElement
    }
    return [0, 0, 0]
  }
  const isExcluded = (element) => {
    for (let n = element; n !== null; n = n.parentElement) {
      if (n.classList && n.classList.contains('notation-frame')) return true
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return true
    }
    return false
  }
  const describe = (n) =>
    `${n.tagName.toLowerCase()}${n.className && typeof n.className === 'string' ? `.${n.className.trim().split(/\s+/).join('.')}` : ''}`
  const out = []
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    // Only elements that render their OWN text — an element whose text all
    // lives in children would double-count its children's colours.
    const own = Array.from(element.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent ?? '').trim())
      .join(' ')
      .trim()
    if (own.length === 0) continue
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    if (isExcluded(element)) continue
    const parsed = parse(style.color)
    if (parsed === null || parsed.alpha < 0.9) continue
    // The ancestor chain, not just the element: a bare `<span>` failing AA
    // is unactionable without knowing which feature owns it.
    const chain = []
    for (let n = element; n !== null && chain.length < 4; n = n.parentElement) chain.push(describe(n))
    out.push({
      text: own.slice(0, 60),
      selector: chain.join(' < '),
      fg: parsed.rgb,
      bg: backgroundOf(element),
      px: parseFloat(style.fontSize),
      weight: Number(style.fontWeight) || 400,
    })
  }
  return out
}

async function destinationsOf(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main"]')
    if (nav === null) return []
    return Array.from(nav.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '')
  })
}

async function goTo(page, label) {
  // At <=1024px the nav is an off-canvas drawer: it has to be opened before
  // a destination is clickable, and closed again or it covers the screen.
  const opener = page.getByRole('button', { name: 'Open navigation' })
  if (await opener.isVisible()) await opener.click()
  await page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(400)
  if (await opener.isVisible()) await page.keyboard.press('Escape')
  await page.waitForTimeout(1600)
}

const browser = await chromium.launch()
const failures = []

for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme })
  const page = await context.newPage()
  await page.goto(url)
  // The app honours an explicit data-theme over the media query, and the
  // brief asks for BOTH themes as first-class, so set it explicitly on the
  // root element rather than relying on colorScheme alone.
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
  await page.waitForTimeout(1500)

  const destinations = await destinationsOf(page)
  if (destinations.length === 0) {
    console.error(`no nav destinations found at ${url} — is the dev server actually up?`)
    process.exit(2)
  }

  for (const destination of destinations) {
    await goTo(page, destination)
    const samples = await page.evaluate(COLLECT)
    const seen = new Set()
    for (const sample of samples) {
      const large = sample.px >= 24 || (sample.px >= 18.66 && sample.weight >= 700)
      const threshold = large ? 3.0 : 4.5
      const value = ratio(sample.fg, sample.bg)
      if (value >= threshold) continue
      const key = `${theme}|${destination}|${sample.selector}|${sample.fg.join(',')}|${sample.bg.join(',')}`
      if (seen.has(key)) continue
      seen.add(key)
      failures.push({
        screen: destination,
        theme,
        selector: sample.selector,
        text: sample.text,
        fg: `rgb(${sample.fg.join(',')})`,
        bg: `rgb(${sample.bg.join(',')})`,
        ratio: value.toFixed(2),
        threshold: threshold.toFixed(1),
      })
    }
  }
  await context.close()
}

await browser.close()

if (failures.length === 0) {
  console.log(`AUDIT: 0 contrast failures across ${['dark', 'light'].length} themes.`)
  process.exit(0)
}

console.log(`AUDIT: ${failures.length} contrast failure(s):\n`)
console.table(
  failures.map((f) => ({
    screen: f.screen,
    theme: f.theme,
    selector: f.selector,
    text: f.text,
    fg: f.fg,
    bg: f.bg,
    ratio: f.ratio,
    threshold: f.threshold,
  })),
)
console.log(`\nAA FAILURES: ${failures.length}`)
process.exit(1)
