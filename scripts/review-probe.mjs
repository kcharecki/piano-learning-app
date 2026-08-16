#!/usr/bin/env node
/**
 * The acceptance-review probe (roadmap 5.49), as a tool.
 *
 * `scripts/visual-pass.mjs` exists because the 2026-08-08 session wrote and
 * threw away six one-off Playwright scripts. This file exists for the same
 * reason one level up: the 2026-08-06 UX/pedagogy review's METHOD — drive
 * every nav destination from an empty IndexedDB as a beginner, and measure
 * contrast from the live CSSOM rather than from the token file — was
 * re-implemented by hand for the 2026-08-12 re-score. It is kept so the next
 * acceptance pass re-runs it instead of rebuilding it.
 *
 *   node scripts/review-probe.mjs walk    --url http://localhost:5280
 *   node scripts/review-probe.mjs contrast --url http://localhost:5280
 *
 * `walk`     — visits every destination in the live nav (the list is READ off
 *              the running app, never hardcoded, so a destination added since
 *              the last pass cannot be silently skipped) against a fresh,
 *              empty IndexedDB and reports, per destination: heading, visible
 *              interactive-control count, full scroll height, and the first
 *              600 chars a learner actually reads.
 * `contrast` — computes the contrast ratio of every visible text-bearing
 *              element against its own effective (first non-transparent
 *              ancestor) background, at BOTH themes, on every destination, and
 *              reports every pair below the WCAG AA threshold for its own
 *              rendered size. This is deliberately broader than the original
 *              review's six-token table: a token pair passing in isolation
 *              says nothing about the pair the learner is actually looking at.
 *
 * Exits 1 if `contrast` found an AA failure, so it is a check and not a claim.
 * Requires a dev server already running at --url.
 */
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const mode = args[0]
const urlAt = args.indexOf('--url')
const url = urlAt === -1 ? 'http://localhost:5173' : (args[urlAt + 1] ?? 'http://localhost:5173')

if (mode !== 'walk' && mode !== 'contrast' && mode !== 'claims') {
  console.error('usage: node scripts/review-probe.mjs <walk|claims|contrast> [--url http://localhost:5280]')
  process.exit(2)
}

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

/** The in-page collector for `contrast`. Returns raw rgb triples + sizes. */
const COLLECT_CONTRAST = () => {
  // Rasterise rather than regex the computed value. `getComputedStyle` is free
  // to hand back `color(srgb …)`, `oklch(…)` or `color-mix(…)` — an earlier
  // rgb()-only regex here silently treated every one of those as "no
  // background" and walked past a genuinely painted surface, inventing an AA
  // failure on a white piano key. A 1x1 canvas resolves every CSS colour
  // syntax the browser itself accepts, exactly as it will paint it.
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
  const backgroundOf = (element) => {
    let node = element
    while (node !== null) {
      const parsed = parse(getComputedStyle(node).backgroundColor)
      if (parsed !== null && parsed.alpha > 0.9) return parsed.rgb
      node = node.parentElement
    }
    return [0, 0, 0]
  }
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
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.1) continue
    const parsed = parse(style.color)
    if (parsed === null || parsed.alpha < 0.9) continue
    // The ancestor chain, not just the element: a bare `<span>` failing AA is
    // unactionable without knowing which feature owns it.
    const describe = (n) =>
      `${n.tagName.toLowerCase()}${n.className && typeof n.className === 'string' ? `.${n.className.trim().split(/\s+/).join('.')}` : ''}`
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

/** The in-page collector for `walk`. */
const COLLECT_WALK = () => {
  const nav = document.querySelector('nav[aria-label="Main"]')
  const controls = Array.from(document.querySelectorAll('main button, main input, main select, main textarea, main a[href]'))
  const visible = controls.filter((c) => {
    const box = c.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  })
  const main = document.querySelector('main')
  return {
    heading: document.querySelector('main h1, main h2')?.textContent?.trim() ?? '(no heading)',
    controls: visible.length,
    disabledControls: visible.filter((c) => c.disabled === true).length,
    scrollHeight: main === null ? 0 : main.scrollHeight,
    navCount: nav === null ? 0 : nav.querySelectorAll('button').length,
    text: (main?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
  }
}

async function destinationsOf(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main"]')
    if (nav === null) return []
    return Array.from(nav.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '')
  })
}

async function goTo(page, label) {
  const opener = page.getByRole('button', { name: 'Open navigation' })
  if (await opener.isVisible()) await opener.click()
  await page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(400)
  if (await opener.isVisible()) await page.keyboard.press('Escape')
  await page.waitForTimeout(1600)
}

const browser = await chromium.launch()
let failures = 0

if (mode === 'walk') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
  const page = await context.newPage()
  const problems = []
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  await page.goto(url)
  await page.waitForTimeout(2000)

  const destinations = await destinationsOf(page)
  console.log(`NAV DESTINATIONS (${destinations.length}): ${destinations.join(' | ')}`)
  console.log(`LANDED ON: ${await page.evaluate(() => window.location.pathname)}`)
  console.log(`FIRST SCREEN TEXT: ${(await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 900)}`)

  for (const destination of destinations) {
    await goTo(page, destination)
    const info = await page.evaluate(COLLECT_WALK)
    console.log(`\n=== ${destination} === url=${await page.evaluate(() => window.location.pathname)}`)
    console.log(`heading="${info.heading}" controls=${info.controls} (disabled ${info.disabledControls}) scrollHeight=${info.scrollHeight}px`)
    console.log(`text: ${info.text}`)
  }
  console.log(`\nCONSOLE PROBLEMS: ${problems.length}`)
  for (const problem of problems) console.log(`  ${problem}`)
  await context.close()
}

if (mode === 'contrast') {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme })
    const page = await context.newPage()
    await page.goto(url)
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
    await page.waitForTimeout(2000)
    const destinations = await destinationsOf(page)
    for (const destination of destinations) {
      await goTo(page, destination)
      const samples = await page.evaluate(COLLECT_CONTRAST)
      const seen = new Set()
      for (const sample of samples) {
        const large = sample.px >= 24 || (sample.px >= 18.66 && sample.weight >= 700)
        const threshold = large ? 3.0 : 4.5
        const value = ratio(sample.fg, sample.bg)
        if (value >= threshold) continue
        const key = `${sample.selector}|${sample.fg.join(',')}|${sample.bg.join(',')}`
        if (seen.has(key)) continue
        seen.add(key)
        failures += 1
        console.log(
          `[${theme}] ${destination}: ${value.toFixed(2)} (needs ${threshold}) ` +
            `${sample.selector} px=${sample.px} rgb(${sample.fg.join(',')}) on rgb(${sample.bg.join(',')}) — "${sample.text}"`,
        )
      }
    }
    await context.close()
  }
  console.log(`\nAA FAILURES: ${failures}`)
}

if (mode === 'claims') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForTimeout(2000)

  // --- Sight reading: what leap does a level ACTUALLY generate? ------------
  // `levelDefaults.ts` sets a per-level `maxLeapSemitones` ceiling, but the
  // ceiling is documented as sized for the generator's own cadence
  // reachability, not for pedagogy. What matters to a learner is the interval
  // actually printed, so read it off the engraving rather than the table.
  //
  // roadmap 5.53 review F4/F12: this used to measure the RIGHT HAND ONLY —
  // its own comment said so — which missed `doubleHand`'s leap-bound bug
  // (F1) entirely, since that only ever showed up on the SECOND hand. A
  // note's id is `m{measure}.{r|l}.{startTick}.{midi}` (`score.ts`'s
  // `noteId`, `#2`/`#3`… suffixed on a collision); parse hand and startTick
  // out of it and measure both hands' own consecutive-note sequences
  // separately — a leap is between consecutive notes of ONE hand's line,
  // never across hands, and never between simultaneous notes of the same
  // hand (`'blocked-chords'` stacks 3 notes on one onset — a chord tone, not
  // a melodic step; `maxLeapSemitones` never governs those in `melody.ts`).
  const parts = (id) => String(id).split('#')[0].split('.')
  const handOf = (id) => parts(id)[1]
  const tickOf = (id) => Number(parts(id)[2])
  const midiOf = (id) => Number(parts(id).pop())
  /** `hand`'s melodic pitch sequence, onset order, simultaneities dropped. */
  const monophonicSequence = (ids, hand) => {
    const byTick = new Map()
    for (const id of ids) {
      if (handOf(id) !== hand) continue
      const t = tickOf(id)
      const pitches = byTick.get(t) ?? []
      pitches.push(midiOf(id))
      byTick.set(t, pitches)
    }
    const ticks = [...byTick.keys()].sort((a, b) => a - b)
    return ticks.filter((t) => byTick.get(t).length === 1).map((t) => byTick.get(t)[0])
  }
  const consecutiveIntervals = (ids, hand) => {
    const seq = monophonicSequence(ids, hand)
    const out = []
    for (let i = 1; i < seq.length; i += 1) out.push(Math.abs(seq[i] - seq[i - 1]))
    return out
  }
  // The screen has NO level control — the ladder is adaptive only
  // (`SightReadingScreen.tsx:47` renders `Level {n}` as a <p>). The level it
  // draws at is NOT the `sight-reading` TRACK level in `settings/levelState`
  // (seeding that leaves the screen reading "Level 1" — checked); it is the
  // trainer's own adaptive level, persisted by `persistence.ts` in
  // `COLLECTIONS.sightReadingHistory` under key `sightReadingHistory` as
  // `{ level, history }`. Seed that.
  const seedLevel = async (level) => {
    await page.evaluate(
      ({ dbName, level }) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open(dbName)
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const put = open.result
              .transaction('sightReadingHistory', 'readwrite')
              .objectStore('sightReadingHistory')
              .put({ level, history: [] }, 'sightReadingHistory')
            put.onerror = () => reject(put.error)
            put.onsuccess = () => resolve(null)
          }
        }),
      { dbName: 'piano-learning-app', level },
    )
    await page.reload()
    await page.waitForTimeout(2000)
  }

  for (const level of [1, 2, 3, 4, 5, 6]) {
    const leapsByHand = { r: [], l: [] }
    let reported = null
    for (let draw = 0; draw < 5; draw += 1) {
      // Re-seed before EVERY draw, not once per level: navigating away to
      // grade the previous draw (below) retires it with whatever accuracy
      // the probe's non-playing walk produced — near 0% — and the trainer's
      // own `adaptLevel` (`useSightReadingTrainer.ts`) can demote the level
      // in response. Seeding once per level let that demotion silently drift
      // later draws in a level-4 (`'blocked-chords'`) batch down onto level
      // 3 material, which is how a supposedly chords-only left hand produced
      // non-zero monophonic left-hand intervals in an earlier run of this
      // probe. Re-seeding pins every draw to the level under test.
      await seedLevel(level)
      // Bounce off another destination first: `Start exercise` only renders in
      // the `idle` phase, and a drawn exercise sits in a 30-second preview.
      // Navigating away grades and retires it (the screen's own rule), which
      // is also the only way back to idle without waiting out the preview.
      await goTo(page, 'Metronome')
      await goTo(page, 'Sight reading')
      reported = await page.getByTestId('sight-reading-level').innerText().catch(() => '?')
      await page.getByRole('button', { name: 'Start exercise', exact: true }).click()
      await page.waitForTimeout(2200)
      const ids = await page.locator('[data-note-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-note-id') ?? ''))
      leapsByHand.r.push(...consecutiveIntervals(ids, 'r'))
      leapsByHand.l.push(...consecutiveIntervals(ids, 'l'))
    }
    const summarize = (leaps) => ({
      n: leaps.length,
      max: leaps.length === 0 ? null : Math.max(...leaps),
      distribution: leaps.reduce((a, l) => ({ ...a, [l]: (a[l] ?? 0) + 1 }), {}),
    })
    const right = summarize(leapsByHand.r)
    const left = summarize(leapsByHand.l)
    const both = [...leapsByHand.r, ...leapsByHand.l]
    const combinedMax = both.length === 0 ? null : Math.max(...both)
    console.log(
      `SIGHTREAD seeded level ${level} (screen reads "${reported}"): ` +
        `right hand ${right.n} intervals max=${right.max} ${JSON.stringify(right.distribution)}; ` +
        `left hand ${left.n} intervals max=${left.max} ${JSON.stringify(left.distribution)}; ` +
        `both-hands max = ${combinedMax} semitones over ${both.length} sampled intervals`,
    )
  }

  // --- Repertoire: is the score's provenance disclosed to the learner? -----
  await goTo(page, 'Repertoire')
  const rowText = await page
    .locator('li, tr, div')
    .filter({ hasText: /F.r Elise/ })
    .last()
    .innerText()
    .catch(() => '(row not found)')
  console.log(`\nREPERTOIRE Für Elise row text:\n${rowText.replace(/\s+/g, ' ').slice(0, 400)}`)
  const disclosure = await page.evaluate(() =>
    /rendition|excerpt|not a verified|approximation|arrangement/i.test(document.querySelector('main')?.innerText ?? ''),
  )
  console.log(`REPERTOIRE screen discloses score provenance anywhere: ${disclosure}`)

  // --- Progress: does the screen follow STORED data, or re-derive it? ------
  // The project's own standard: seed IndexedDB behind the app's back with a
  // value the app could not plausibly have computed, then read the screen.
  const DB = 'piano-learning-app'
  const day = 24 * 60 * 60 * 1000
  const now = Date.now()
  const seeded = [1, 2, 3, 4, 5].map((back) => ({
    id: `probe-${back}`,
    startedAt: now - back * day - 3_600_000,
    endedAt: now - back * day - 3_600_000 + 41 * 60_000,
    kind: 'eartraining',
    itemName: 'probe entry',
  }))
  await page.evaluate(
    ({ dbName, entries }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('practiceLog', 'readwrite')
          const put = tx.objectStore('practiceLog').put({ practiceEntries: entries }, 'practiceLog')
          put.onerror = () => reject(put.error)
          put.onsuccess = () => resolve(null)
        }
      }),
    { dbName: DB, entries: seeded },
  )
  await page.reload()
  await page.waitForTimeout(2500)
  await goTo(page, 'Progress')
  const progressText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  console.log(`\nPROGRESS after seeding 5 days x 41 min of 'eartraining' (205 min total, streak should be 0 today/5 consecutive ending yesterday):`)
  console.log(progressText.slice(0, 1500))

  await context.close()
}

await browser.close()
process.exit(mode === 'contrast' && failures > 0 ? 1 : 0)
