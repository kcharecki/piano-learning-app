#!/usr/bin/env node
/**
 * The experience gate's visual pass (docs/PROCESS.md step 3), as a tool.
 *
 * Screenshots one nav destination at BOTH widths and BOTH themes and reports
 * every console error and page error it saw, because the gate asks for exactly
 * that and nothing in the repo did it. The 2026-08-08 session wrote and threw
 * away six one-off Playwright scripts to run this pass by hand; that cost is
 * what this file exists to remove.
 *
 *   node scripts/visual-pass.mjs Theory
 *   node scripts/visual-pass.mjs Practice --level theory=4
 *   node scripts/visual-pass.mjs "Ear training" --select "#eartraining-drill-select=Melodic dictation"
 *   node scripts/visual-pass.mjs Theory --out ./shots
 *
 * Options:
 *   --level <track>=<n>   raise a track's level through the dashboard's own
 *                         override first (the route a learner takes), so
 *                         level-gated UI is actually on screen
 *   --select <sel>=<label>  choose an option in a <select> on the destination
 *   --click <label>       click a button by accessible name on the destination,
 *                         in order given — for reaching a post-interaction state
 *                         (e.g. "Add" a catalogue piece, then screenshot the row
 *                         that only appears once something is in the library)
 *   --out <dir>           where the PNGs go (default: ./visual-pass)
 *   --url <url>           dev server (default: http://localhost:5173)
 *   --wait <ms>           extra wait AFTER the clicks and the built-in 2500ms
 *                         settle time, before the screenshot — for a state
 *                         that only exists after real wall-clock time passes
 *                         (e.g. the roadmap-3.21 clap-back drill's audible
 *                         "listening" run auto-advancing to "tapping").
 *                         Default 0.
 *
 * Exits 1 if any console/page error was seen, so "console clean" is a check
 * rather than a claim. Requires `npm run dev` to be running.
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const WIDTHS = [1280, 1024]
const THEMES = ['dark', 'light']
const HEIGHT = 900

function parseArgs(argv) {
  const [destination, ...rest] = argv
  const opts = { destination, out: './visual-pass', url: 'http://localhost:5173', levels: [], selects: [], clicks: [], wait: 0 }
  for (let i = 0; i < rest.length; i += 2) {
    const value = rest[i + 1]
    if (value === undefined) break
    if (rest[i] === '--out') opts.out = value
    else if (rest[i] === '--url') opts.url = value
    else if (rest[i] === '--level') opts.levels.push(value)
    else if (rest[i] === '--select') opts.selects.push(value)
    else if (rest[i] === '--click') opts.clicks.push(value)
    else if (rest[i] === '--wait') opts.wait = Number(value)
  }
  return opts
}

/** Splits "a=b" on its FIRST `=` only — a CSS selector may contain more. */
function splitPair(pair) {
  const at = pair.indexOf('=')
  return at === -1 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)]
}

async function goTo(page, label) {
  // At <=1024px the nav is an off-canvas drawer: it has to be opened before a
  // destination is clickable, and closed again or it covers the screenshot.
  const opener = page.getByRole('button', { name: 'Open navigation' })
  if (await opener.isVisible()) await opener.click()
  await page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(300)
  if (await opener.isVisible()) await page.keyboard.press('Escape')
}

const opts = parseArgs(process.argv.slice(2))
if (opts.destination === undefined) {
  console.error('usage: node scripts/visual-pass.mjs <nav destination> [--level track=n] [--select sel=label] [--out dir]')
  process.exit(2)
}

mkdirSync(opts.out, { recursive: true })
const slug = opts.destination.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const problems = []
const browser = await chromium.launch()

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: HEIGHT }, colorScheme: theme })
    const page = await context.newPage()
    const where = `[${theme} ${width}]`
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`${where} ${m.type()}: ${m.text()}`)
    })
    page.on('pageerror', (e) => problems.push(`${where} pageerror: ${e.message}`))

    await page.goto(opts.url)
    // Both themes are first-class (docs/DESIGN.md rule 8) and the app honours
    // an explicit data-theme over the media query, so set both.
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)

    for (const level of opts.levels) {
      const [track, value] = splitPair(level)
      await goTo(page, 'Progress')
      await page.getByTestId(`dashboard-level-select-${track}`).selectOption(value)
    }

    await goTo(page, opts.destination)
    for (const select of opts.selects) {
      const [selector, label] = splitPair(select)
      await page.locator(selector).selectOption({ label })
    }
    for (const label of opts.clicks) {
      await page.getByRole('button', { name: label, exact: true }).first().click()
    }
    // Long enough for an OSMD engrave to settle; the gate is about what the
    // learner ends up looking at, not about first paint.
    await page.waitForTimeout(2500)
    if (opts.wait > 0) await page.waitForTimeout(opts.wait)

    const file = `${opts.out}/${slug}-${theme}-${width}.png`
    await page.screenshot({ path: file, fullPage: true })
    console.log(`wrote ${file}`)
    await context.close()
  }
}

await browser.close()

if (problems.length === 0) {
  console.log('console clean in all four configurations')
  process.exit(0)
}
console.error(`\n${problems.length} console/page problems:`)
for (const problem of problems) console.error(`  ${problem}`)
process.exit(1)
