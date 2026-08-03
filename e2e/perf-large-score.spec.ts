import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Performance proof against a REAL, large score — Pachelbel's Canon in D as
 * exported by MuseScore: 102 measures, 1603 notes, 563KB of MusicXML inside a
 * 16KB `.mxl`. Every other e2e in this suite drives a two-to-six bar fixture,
 * which is exactly why the app's per-frame costs were never visible to any of
 * them: the expensive work here is O(score size) or O(position in score), and
 * on six bars all of it rounds to zero.
 *
 * Reported by the user against this file: notes drifting out of sync with the
 * sound, visible stuttering, and Play/Stop taking a noticeable moment to
 * respond.
 *
 * The numbers asserted below are wall-clock main-thread measurements taken in
 * the running browser, so they are machine-dependent by nature; the budgets
 * are set well above the measured post-fix values and well below the measured
 * pre-fix ones, so they discriminate the regression without being flaky.
 *
 * Both sides, measured on the same machine and the same score, are the reason
 * each budget sits where it does:
 *
 * ```
 *                    before (2.32a-c)   after
 * p95 frame gap          551ms           18ms
 * worst frame gap        564ms           41ms
 * frames in 6s            28             422
 * long tasks (worst)   13 (561ms)      0 (0ms)
 * Stop latency          5339ms           59ms
 * ```
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canon-in-d.mxl')
const FIXTURE_TITLE = 'Canon in D'

/** How long playback runs while frame timings are sampled. */
const SAMPLE_MS = 6000

type PerfSample = {
  readonly longTasks: readonly number[]
  readonly frameGaps: readonly number[]
}

declare global {
  interface Window {
    __perf?: { longTasks: number[]; frameGaps: number[] }
  }
}

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/**
 * Starts sampling two independent signals in the page:
 * - `longtask` PerformanceObserver entries: any main-thread task over 50ms,
 *   which is the browser's own definition of "the UI is now janky".
 * - the gap between consecutive animation frames: what the score cursor and
 *   the audio scheduler both ride on, so a large gap is literally the visual
 *   stutter and the audio-scheduling gap the user reported.
 */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const perf = { longTasks: [] as number[], frameGaps: [] as number[] }
    window.__perf = perf
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) perf.longTasks.push(entry.duration)
    }).observe({ entryTypes: ['longtask'] })
    let last = performance.now()
    const tick = (): void => {
      const now = performance.now()
      perf.frameGaps.push(now - last)
      last = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function readSample(page: Page): Promise<PerfSample> {
  return page.evaluate(() => ({
    longTasks: window.__perf?.longTasks ?? [],
    frameGaps: window.__perf?.frameGaps ?? [],
  }))
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[index] ?? 0
}

test('a 102-measure, 1603-note score plays without blowing the frame budget, and Play/Stop stay responsive', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  const importStart = Date.now()
  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  // Settle point: the loop-range control bounds "to measure" by the imported
  // score's own measure count, so `max="102"` proves the new score has fully
  // replaced the bundled sample (see e2e/read-ahead.spec.ts for why this is
  // the reliable settle signal rather than the heading alone). The `max`
  // attribute, not the value — the value is whatever loop the learner last
  // set, restored from IndexedDB.
  const loopRange = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRange.getByLabel('to measure')).toHaveAttribute('max', '102', {
    timeout: 60_000,
  })
  await expect(page.locator('[data-testid="score-container"] svg')).toBeVisible()
  const importMs = Date.now() - importStart

  await startSampling(page)

  const transport = page.getByRole('group', { name: 'Transport' })
  const playStart = Date.now()
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  // Responsiveness is "the transport actually moved", not "the click landed".
  await expect(async () => {
    const text = (await page.getByLabel('Position').textContent()) ?? ''
    expect(text).not.toMatch(/Measure 1\b.*beat 1\b/)
  }).toPass({ timeout: 20_000 })
  const playLatencyMs = Date.now() - playStart

  await page.waitForTimeout(SAMPLE_MS)
  const sample = await readSample(page)

  const stopStart = Date.now()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByLabel('Position')).toContainText('Measure 1')
  const stopLatencyMs = Date.now() - stopStart

  const worstLongTask = Math.max(0, ...sample.longTasks)
  const worstFrameGap = Math.max(0, ...sample.frameGaps)
  const p95FrameGap = percentile(sample.frameGaps, 95)
  const medianFrameGap = percentile(sample.frameGaps, 50)

  // Printed so a regression run says WHAT got slower, not merely that it did.
  // `console.warn` rather than `console.log` because eslint's `no-console`
  // allows only `warn`/`error` — and a perf number worth reading in CI output
  // is closer to a warning than to debug chatter anyway.
  console.warn(
    JSON.stringify(
      {
        importMs,
        playLatencyMs,
        stopLatencyMs,
        frames: sample.frameGaps.length,
        medianFrameGap: Math.round(medianFrameGap),
        p95FrameGap: Math.round(p95FrameGap),
        worstFrameGap: Math.round(worstFrameGap),
        longTasks: sample.longTasks.length,
        worstLongTask: Math.round(worstLongTask),
      },
      null,
      2,
    ),
  )

  // Budgets — see the module comment's before/after table. Each one is set
  // between the two measured values, so it fails on the old tree and passes on
  // this one with room for a slower machine.
  expect(p95FrameGap).toBeLessThan(50)
  expect(worstFrameGap).toBeLessThan(250)
  expect(worstLongTask).toBeLessThan(250)
  expect(stopLatencyMs).toBeLessThan(1500)

  // The direct "is the app actually animating" check, and the one hardest to
  // satisfy accidentally: 6 seconds of playback must produce at least 200
  // frames (~33fps). The pre-fix tree produced 28.
  expect(sample.frameGaps.length).toBeGreaterThan(200)

  // Deliberately loose, and NOT a latency figure. It measures click-to-
  // "position readout left measure 1 beat 1", which includes up to one whole
  // beat of the score's own tempo — a second on its own at Canon's marked
  // tempo. It is here as a hang detector (the pre-fix tree could sit far past
  // this while the main thread was inside OSMD), not as a budget to tune.
  expect(playLatencyMs).toBeLessThan(3000)

  expect(errors).toEqual([])
})
