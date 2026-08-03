import { expect, test, type Page } from '@playwright/test'

/**
 * MEASUREMENT spec for roadmap 2.32e — not a fix. `src/adapters/audio/webaudio.ts`
 * captures `clockOffsetMs = performance.now() - ctx.currentTime * 1000` ONCE at
 * construction and never re-anchors it. `performance.now()` (system monotonic
 * clock) and `AudioContext.currentTime` (audio hardware clock) are driven by
 * different oscillators, so that offset can drift over a long session — and a
 * drifting offset means every note scheduled through `toCtxSeconds` lands
 * progressively further from where the transport thinks it is.
 *
 * The roadmap is explicit that a fix here needs a measurement behind it first:
 * "A fix with no measurement behind it cannot be told from a no-op." This spec
 * is that measurement. It samples the same two clocks the adapter compares,
 * over a sustained ~45s window in a real browser, and logs the drift rate so
 * the orchestrator (or a human) can decide whether re-anchoring is warranted.
 *
 * It intentionally does NOT touch `src/adapters/audio/webaudio.ts` or import
 * from it — the quantity under measurement (`performance.now() - ctx.currentTime
 * * 1000`) is reproduced directly against a real `AudioContext`, which is all
 * that module does with these two clocks.
 *
 * This is a PROXY measurement of the raw clock pair, not of the adapter's
 * effective scheduling error (which also includes the `Math.max(ctx.currentTime,
 * seconds)` clamp in `webaudio.ts`). Treat 2.32e as measured-but-not-fixed until
 * something drives the app's own transport and samples the real output instance.
 *
 * `performance.now() - ctx.currentTime * 1000` is NOT smooth: `currentTime`
 * advances in audio-buffer-sized steps while `performance.now()` advances
 * continuously, producing a sawtooth with measured peak-to-peak amplitude on
 * the order of 10ms. A two-point (first-vs-last sample) estimate reports where
 * in that sawtooth two arbitrary samples happened to land, not drift — its own
 * noise floor over a 45s window is comparable to or larger than every drift
 * figure this measurement has produced. The estimate below is therefore a
 * least-squares fit over every sample, with the fit residual spread logged
 * alongside it so a reader can see whether the slope clears its own noise.
 */

/** Wall-clock length of the sampling window. ~45s per the roadmap task. */
const WINDOW_MS = 45_000
/** A few samples a second — enough resolution without flooding the page. */
const SAMPLE_INTERVAL_MS = 250
/** Generous headroom over WINDOW_MS for page setup, teardown and CI jitter. */
const TEST_TIMEOUT_MS = 90_000
/**
 * Warm-up discarded from the front of the sampling window before fitting.
 * Immediately after `resume()` resolves, `ctx.currentTime` can still be
 * pinned at 0 while the audio render thread has not actually started —
 * `ctx.state === 'running'` flips before the clock ticks. Samples taken
 * during that pin contain zero information about the clock's rate and would
 * fold pure startup latency into the drift estimate as if it were drift.
 */
const WARMUP_MS = 2_000

type ClockState = 'suspended' | 'running' | 'closed'

type RawSample = {
  /** `performance.now()` at the moment this sample was taken. */
  readonly tMs: number
  /** `performance.now() - ctx.currentTime * 1000` at the moment this sample was taken. */
  readonly offsetMs: number
}

type DriftMeasurement = {
  /** `ctx.state` immediately after `resume()` resolved. */
  readonly stateAfterResume: ClockState
  /** `ctx.state` at the end of the sampling window. */
  readonly stateAtEnd: ClockState
  /** Wall-clock ms spent spinning after `resume()` for `ctx.currentTime` to leave 0. */
  readonly startupPinMs: number
  readonly samples: readonly RawSample[]
}

/**
 * Runs entirely inside the page: creates a real `AudioContext`, resumes it,
 * and — only if it actually reached `running` (a suspended context's
 * `currentTime` never advances, which would fake a perfect zero-drift result)
 * — spins until `ctx.currentTime` actually leaves 0 (the render thread has
 * genuinely started), then samples the clock-offset quantity every
 * `sampleIntervalMs` for `windowMs` of real wall time.
 */
async function measureClockDrift(
  page: Page,
  windowMs: number,
  sampleIntervalMs: number,
): Promise<DriftMeasurement> {
  return page.evaluate<
    DriftMeasurement,
    { windowMs: number; sampleIntervalMs: number }
  >(
    async ({ windowMs, sampleIntervalMs }) => {
      const ctx = new AudioContext()
      await ctx.resume()
      const stateAfterResume = ctx.state
      const samples: { tMs: number; offsetMs: number }[] = []
      let startupPinMs = 0

      if (stateAfterResume === 'running') {
        const pinStart = performance.now()
        while (ctx.currentTime === 0) {
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        startupPinMs = performance.now() - pinStart

        const start = performance.now()
        while (performance.now() - start < windowMs) {
          const tMs = performance.now()
          const offsetMs = tMs - ctx.currentTime * 1000
          samples.push({ tMs, offsetMs })
          await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs))
        }
      }

      const stateAtEnd = ctx.state
      await ctx.close()
      return { stateAfterResume, stateAtEnd, startupPinMs, samples }
    },
    { windowMs, sampleIntervalMs },
  )
}

/**
 * Ordinary least-squares fit of `offsetMs` against `tMs`: returns the slope
 * (ms of offset change per ms of elapsed time) and the max-min spread of the
 * fit residuals, so a caller can compare the slope's implied drift against
 * the noise it was extracted from.
 */
function fitDrift(samples: readonly RawSample[]): { slopePerMs: number; residualSpreadMs: number } {
  const n = samples.length
  let sumT = 0
  let sumO = 0
  for (const s of samples) {
    sumT += s.tMs
    sumO += s.offsetMs
  }
  const meanT = sumT / n
  const meanO = sumO / n

  let covariance = 0
  let variance = 0
  for (const s of samples) {
    const dt = s.tMs - meanT
    covariance += dt * (s.offsetMs - meanO)
    variance += dt * dt
  }
  const slopePerMs = variance === 0 ? 0 : covariance / variance
  const intercept = meanO - slopePerMs * meanT

  let residualMin = Number.POSITIVE_INFINITY
  let residualMax = Number.NEGATIVE_INFINITY
  for (const s of samples) {
    const fitted = intercept + slopePerMs * s.tMs
    const residual = s.offsetMs - fitted
    residualMin = Math.min(residualMin, residual)
    residualMax = Math.max(residualMax, residual)
  }

  return { slopePerMs, residualSpreadMs: residualMax - residualMin }
}

test('measures AudioContext clock-offset drift over a sustained session (roadmap 2.32e)', async ({
  page,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS)

  await page.goto('/')
  // A real gesture, registered on the page, so the browser's autoplay policy
  // lets the AudioContext created below actually reach `running` rather than
  // starting (and staying) `suspended`.
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()
  await expect(page.getByRole('group', { name: 'Transport' })).toBeVisible()

  const result = await measureClockDrift(page, WINDOW_MS, SAMPLE_INTERVAL_MS)

  // Essential: a suspended context's `currentTime` does not advance, which
  // would otherwise fake a perfect-looking drift of exactly zero. Without
  // this check the measurement below would be worthless.
  expect(result.stateAfterResume, 'AudioContext did not reach "running" — see autoplay policy').toBe(
    'running',
  )
  expect(result.stateAtEnd).toBe('running')
  // The startup-pin spin loop must have actually found something to discard;
  // if it were always zero-length the warm-up guard above would be inert.
  expect(result.startupPinMs).toBeGreaterThan(0)

  const rawSamples = result.samples
  expect(rawSamples.length, 'no samples were collected during the window').toBeGreaterThan(2)

  const first = rawSamples[0]
  if (first === undefined) {
    throw new Error('unreachable: rawSamples.length was just asserted > 2')
  }
  // Discard the warm-up window from the front of the sampling loop itself
  // (in addition to the startup pin already skipped before sampling began) —
  // belt-and-braces against any residual settling in the first couple of
  // seconds of real sampling.
  const samples = rawSamples.filter((s) => s.tMs - first.tMs >= WARMUP_MS)
  expect(samples.length, 'nothing survived the warm-up discard').toBeGreaterThan(0)

  const firstSample = samples[0]
  const lastSample = samples[samples.length - 1]
  if (firstSample === undefined || lastSample === undefined) {
    throw new Error('unreachable: samples.length was just asserted > 0')
  }

  const startOffsetMs = firstSample.offsetMs
  const endOffsetMs = lastSample.offsetMs
  const elapsedMs = lastSample.tMs - firstSample.tMs
  const windowSeconds = elapsedMs / 1000

  const { slopePerMs, residualSpreadMs } = fitDrift(samples)
  const driftMsPerMinute = Math.round(slopePerMs * 60_000 * 100) / 100
  // ppm: the drift, as a fraction of elapsed time, in parts per million —
  // e.g. a clock that gains 1ms per 1000ms elapsed is drifting at 1000ppm.
  const driftPpm = Math.round(slopePerMs * 1_000_000 * 100) / 100

  // This logged line IS the point of this spec — the orchestrator reads the
  // drift figures out of it. Do not remove or reword the prefix. Values are
  // rounded in code so any quoted output is byte-identical to this line.
  // eslint-disable-next-line no-console -- deliberate machine-readable report line, see module comment
  console.log(
    'AUDIO_CLOCK_DRIFT ' +
      JSON.stringify({
        startOffsetMs,
        endOffsetMs,
        windowSeconds,
        driftMsPerMinute,
        driftPpm,
        samples: samples.length,
        residualSpreadMs: Math.round(residualSpreadMs * 100) / 100,
      }),
  )

  // The sampling loop must have actually run for close to the intended
  // window at the intended density — otherwise Chrome's hidden-page timer
  // throttling (or a shrunk WINDOW_MS) could silently divide a noise-sized
  // change by a tiny window and report a wild drift figure.
  expect(windowSeconds).toBeGreaterThan(40)
  expect(samples.length).toBeGreaterThan(150)

  // Deliberately LOOSE: this is a hang/pathology detector, not a quality bar.
  // The estimator's own noise floor (sawtooth in the offset quantity itself)
  // is on the order of tens of ms/min over a 45s window, so this bound sits
  // above that noise rather than below it. A healthy result is expected to
  // sit far under this — the real output of this spec is the logged
  // AUDIO_CLOCK_DRIFT figure above (with its residual spread), which is what
  // should inform whether `webaudio.ts` needs periodic re-anchoring at all.
  expect(Math.abs(driftMsPerMinute)).toBeLessThan(150)
})
