import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * UI-37: navigating away from Practice while OSMD is still engraving used to
 * throw `Cannot set properties of null (setting 'vexFlowCanvasContext')`.
 * Every other e2e spec that imports a score waits for the engraved `<svg>`
 * before doing anything else (see e2e/perf-practice-nav.spec.ts,
 * e2e/perf-large-score.spec.ts), which is exactly why the e2e suite never
 * caught this: nothing ever navigated away DURING an import.
 *
 * This spec is a best-effort regression guard, not the primary proof.
 * Diagnosed properly (reading OSMD 1.9.9's actual bundled source, not
 * guessing): for this app's exact usage — always an already-decompressed,
 * already-valid MusicXML string, never a URL or Blob, and `autoResize: false`
 * (see osmdEngraver.ts's `DEFAULT_OSMD_OPTIONS`) — OSMD's `load()` and
 * `render()` are BOTH entirely synchronous, and OSMD registers no internal
 * timer/observer under that configuration. There is no real event-loop
 * window for a genuine navigation click to land inside mid-engrave, which
 * static analysis (no `ResizeObserver`, no `fonts.ready`, no other
 * `addEventListener` besides the disabled autoResize path, confirmed by
 * grepping the bundled `opensheetmusicdisplay.min.js`) and three independent,
 * increasingly aggressive attempts here (plain click, CPU-throttled
 * Playwright click, CPU-throttled raw-DOM click bypassing Playwright's
 * actionability polling — all captured a `destroy()` firing strictly AFTER
 * `render()` had already returned) both confirm. So the throw this task
 * describes cannot be the literal "browser click during OSMD's own await"
 * race for this codebase today.
 *
 * The real, still-real bug: `osmdEngraver.ts`'s render wrapper
 * (`instance.render = () => { originalRender(); ... }`, installed once per
 * OSMD instance) ran `originalRender()` unconditionally for ANY caller —
 * not just this file's own `osmd?.render()` call sites, which `destroy()`
 * already neutralised by clearing the `osmd` closure variable. A call
 * landing on `instance.render` directly (OSMD's own internal machinery in a
 * future version or configuration; a stray reference held elsewhere) would
 * still run the real render against a host `destroy()` had already removed
 * from the DOM — exactly the shape of a null-property write on teardown.
 * The fix (`host.isConnected` guard in the wrapper) and its red/green proof
 * live in `osmdEngraverLifecycle.test.ts`'s "render calls that arrive after
 * destroy (UI-37)" suite, using the `createOsmd` injection seam to call
 * `instance.render()` directly post-destroy — the one thing a real browser
 * click cannot be made to do on demand, but a stray reference to the
 * instance can.
 *
 * This spec stays as a real-browser safety net: CPU throttling (via CDP)
 * widens the window as far as this harness honestly can, on Canon in D (102
 * measures, 1603 notes) — large enough that OSMD's own parse+layout takes
 * real wall-clock time, unlike the two-to-six-bar fixtures every other spec
 * drives — so if a future change (a URL/Blob load path, `autoResize: true`,
 * a new OSMD version with its own internal timer) reintroduces a genuine
 * async window, this is positioned to catch it.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canon-in-d.mxl')

/** Long enough for the abandoned OSMD load/render to actually resolve (or
 *  throw) in the background after teardown — the perf specs measure the full
 *  (unthrottled) engrave of this same score at well under this. */
const SETTLE_MS = 8_000

/** Slows down JS execution so the async engrave window is wide enough for a
 *  real Playwright click (locate + actionability + dispatch) to land inside
 *  it reliably — see the module comment. */
const CPU_THROTTLE_RATE = 12

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('navigating away from Practice while a large score is still engraving throws nothing', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE })

  await page.goto('/')
  const nav = page.getByRole('navigation', { name: /main/i })
  await nav.getByRole('button', { name: 'Practice', exact: true }).click()

  // Start importing a score big enough that OSMD's own engrave is still
  // running well after this resolves — see the module comment.
  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  // Settle point: our own (fast) parse succeeded and the store swapped in the
  // new score, which is exactly when `ScoreViewer` remounts and kicks off
  // OSMD's own (much slower, under throttling) engrave of the same MusicXML.
  // Deliberately NOT waiting for `[data-testid="score-container"] svg` — that
  // is the state every other spec waits for, and waiting for it here would
  // defeat the point: the engraving must still be in flight when we navigate
  // away.
  await expect(page.getByRole('heading', { name: 'Canon in D' })).toBeVisible({ timeout: 60_000 })

  // Navigate away mid-engrave via a raw DOM click dispatched straight into
  // the page (rather than Playwright's `.click()`), which insists on an
  // "actionability" stability check that needs a free main thread to settle
  // — precisely what the abandoned OSMD engrave is monopolising right now.
  // A raw click still has to wait its turn on the same event loop, but it
  // queues immediately instead of polling for stability first, which is
  // what lands it inside the async `load()` window instead of after it.
  await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main"], nav[aria-label="main"]')
    const buttons = nav ? Array.from(nav.querySelectorAll('button')) : []
    const metronome = buttons.find((b) => b.textContent?.trim() === 'Metronome')
    metronome?.click()
  })
  await expect(page.locator('[data-testid="score-container"]')).toHaveCount(0)

  // Give the abandoned engrave time to actually finish (or throw) in the
  // background — this is exactly when the teardown bug fires. Restore full
  // speed first so the wait itself does not also cost 8 throttled seconds.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await page.waitForTimeout(SETTLE_MS)

  expect(errors).toEqual([])
})
