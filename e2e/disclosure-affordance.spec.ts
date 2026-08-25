import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * Every `<summary>` in the app must LOOK like it opens something.
 *
 * `primitives.css` sets `summary { display: flex }` app-wide. That one line
 * suppresses the browser's own disclosure triangle on every `<details>` in the
 * app — `display: flex` removes the `list-item` box the marker is drawn as —
 * so a summary with no chevron of its own renders as a plain line of card text
 * with nothing to say it is interactive. A learner does not click it, and the
 * content behind it may as well not exist.
 *
 * Roadmap UI-25 found and fixed exactly this on the Metronome screen, and the
 * fix was a per-screen CSS rule. A per-screen fix does not generalise: the
 * next disclosure someone adds inherits the same suppressed marker and the
 * same invisibility, with every test still green. This spec is the general
 * assertion — it sweeps every nav destination, opens the disclosures that hide
 * other disclosures, and requires each `<summary>` to carry a visible
 * affordance, measured from the rendered box rather than from CSS text:
 *
 *   - an `<svg>` (the app's chevron convention: `.lessons-track-filter`,
 *     `.metronome-config`, `.flashcard-qwerty-hint`, `.repertoire-level-header`), or
 *   - a generated `::before`/`::after` marker with real content and a
 *     non-zero box (`.record-audio-details`' convention), or
 *   - the browser's own marker, still intact because that summary was left as
 *     `display: list-item`.
 *
 * Anything else is a summary the learner cannot tell is a summary.
 */

const NAV_DESTINATIONS = [
  'Today',
  'Lessons',
  'Practice',
  'Sight reading',
  'Flashcards',
  'Ear training',
  'Rhythm',
  'Technique',
  'Metronome',
  'Theory',
  'Repertoire',
  'Progress',
  'Settings',
] as const

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** Mirrors `goTo` in scripts/visual-pass.mjs — the nav is a drawer at <=1024px. */
async function goTo(page: Page, label: string): Promise<void> {
  const opener = page.getByRole('button', { name: 'Open navigation' })
  if (await opener.isVisible()) {
    await opener.click()
    await expect(opener).toHaveAttribute('aria-expanded', 'true')
  }
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
    .click()
}

/**
 * Open every closed `<details>` on the page, repeatedly — a disclosure can
 * nest inside another (Practice's setup panel holds the QWERTY hint; the
 * Record panel holds "Audio recording"), so one pass would never reach the
 * inner ones. Bounded, and stops as soon as a pass opens nothing new.
 */
async function openEveryDisclosure(page: Page): Promise<void> {
  for (let pass = 0; pass < 4; pass += 1) {
    const opened = await page.evaluate(() => {
      const closed = [...document.querySelectorAll('details')].filter((d) => !d.open)
      closed.forEach((d) => {
        d.open = true
      })
      return closed.length
    })
    if (opened === 0) return
    // Let the disclosure-in animation settle so a marker's box is measurable.
    await page.waitForTimeout(120)
  }
}

/**
 * Summaries with no visible open/close affordance, as `"<text>"` labels.
 * Measured from the rendered result — computed styles and real boxes — so a
 * chevron that exists in CSS but collapses to a zero-width box still counts as
 * missing, which is what the learner actually experiences.
 */
async function summariesWithoutAffordance(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = []
    for (const summary of document.querySelectorAll('summary')) {
      if (!summary.checkVisibility()) continue

      // 1. The app's chevron convention: an inline SVG with a real box.
      const svg = [...summary.querySelectorAll('svg')].some((s) => {
        const r = s.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      if (svg) continue

      // 2. A generated marker with content and a non-zero box.
      const generated = (['::before', '::after'] as const).some((pseudo) => {
        const cs = getComputedStyle(summary, pseudo)
        if (cs.content === 'none' || cs.content === 'normal' || cs.content === '') return false
        return parseFloat(cs.width) > 0 || parseFloat(cs.height) > 0
      })
      if (generated) continue

      // 3. The browser's own marker, still drawn because this summary kept the
      //    `list-item` display the global `display: flex` otherwise removes.
      const own = getComputedStyle(summary)
      if (own.display === 'list-item' && own.listStyleType !== 'none') continue

      bad.push(`"${(summary.textContent ?? '').trim().slice(0, 60)}"`)
    }
    return bad
  })
}

test('every disclosure in the app shows that it opens, on every destination', async ({ page }) => {
  const errors = collectErrors(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')

  const offenders: string[] = []
  let summariesSeen = 0

  for (const destination of NAV_DESTINATIONS) {
    await goTo(page, destination)
    await openEveryDisclosure(page)
    summariesSeen += await page.locator('summary').count()
    for (const label of await summariesWithoutAffordance(page)) {
      offenders.push(`${destination}: ${label}`)
    }
  }

  // The sweep is only meaningful if it actually found disclosures to judge —
  // a navigation regression that rendered nothing would otherwise "pass".
  expect(summariesSeen).toBeGreaterThan(8)
  expect(offenders, 'summaries with no visible open/close affordance').toEqual([])
  expect(errors).toEqual([])
})
