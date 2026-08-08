import { expect, test, type Page } from '@playwright/test'

/**
 * REGRESSION spec for roadmap 2.32e, and the resolution of roadmap T.2.
 *
 * ## What 2.32e was
 *
 * `src/adapters/audio/webaudio.ts` used to capture
 * `clockOffsetMs = performance.now() - ctx.currentTime * 1000` ONCE at
 * construction and never re-anchor it. `performance.now()` (system monotonic
 * clock) and `AudioContext.currentTime` (audio hardware clock) are driven by
 * different oscillators, so that offset drifts — measured at about
 * -15 ms/min on this machine. A frozen anchor therefore goes stale by ~150 ms
 * after ten minutes of practice. 2.32e replaced it with a time-based
 * exponential-filtered running anchor.
 *
 * ## What this spec measures, and why it changed (T.2)
 *
 * This spec used to sample the RAW clock pair (`performance.now() -
 * ctx.currentTime * 1000`) directly, without touching `webaudio.ts` at all,
 * and assert a bound on its drift rate. That was a measurement of the machine,
 * not of our code, and it had two fatal problems:
 *
 *  - **It could not fail for the reason it existed.** Reverting 2.32e would
 *    not move the number by one microsecond, because the number never went
 *    near the adapter. The old comment admitted as much ("Treat 2.32e as
 *    measured-but-not-fixed until something drives the app's own transport").
 *  - **It failed for reasons that were not defects.** T.2 recorded a run
 *    measuring ~5994 ms/min against the 150 ms/min bound. 5994 ms/min is
 *    ~10%, i.e. ~100_000 ppm. No pair of hardware oscillators disagrees by
 *    10%: a cheap crystal is ±100 ppm and an out-of-spec one is still under
 *    ~1000 ppm. A 10% figure means `ctx.currentTime` was not being advanced by
 *    audio hardware at all — on a machine (or a headless container) with no
 *    output device, Chromium runs a software "null sink" whose render thread
 *    is a timer, and a starved or throttled timer advances that clock at
 *    whatever rate it gets scheduled at. See `classifySink` below.
 *
 * So the assertion now sits on the quantity that actually belongs to us: the
 * adapter's own anchor tracking error, sampled off a REAL
 * `createWebAudioOutput` instance in the page.
 *
 *   now()            = anchor     + ctx.currentTime * 1000
 *   performance.now() = rawOffset + ctx.currentTime * 1000
 *   => now() - performance.now() = anchor - rawOffset
 *
 * `ctx.currentTime` cancels. What is left is purely how well our filter is
 * tracking, with the platform's clock rate divided out — which is exactly why
 * this survives the null-sink artefact that broke the old assertion.
 *
 *  - With 2.32e's filter: `anchor` chases `rawOffset`, so the difference is a
 *    constant (the filter's steady-state ramp lag, ~0.5 ms) plus the
 *    render-quantum sawtooth. Slope ~ 0.
 *  - With the pre-2.32e frozen anchor: `anchor` is constant while `rawOffset`
 *    ramps, so the difference ramps at the full clock-drift rate, ~15 ms/min.
 *
 * `ADAPTER_DRIFT_BUDGET_MS_PER_MIN` sits between those two, so reverting the
 * fix fails this spec — which is the whole point of having it.
 *
 * The raw clock pair is still sampled and still logged (`AUDIO_CLOCK_DRIFT`),
 * because it is a genuinely useful diagnostic and it is what tells a reader
 * whether they are looking at real hardware or a null sink. It is no longer
 * asserted on.
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
 *
 * It also covers the adapter's own filter settling: the anchor starts at the
 * construction-time raw sample, and a first-order filter with a 2000 ms time
 * constant is within 0.7% of its steady state after 5 tau = 10 s. 2 s is
 * comfortably enough here because the thing being settled toward is only
 * ~0.5 ms away, but the warm-up is stated in tau terms so a future change to
 * `OFFSET_TIME_CONSTANT_MS` has an obvious place to look.
 */
const WARMUP_MS = 2_000

/**
 * Bound on the adapter's anchor tracking drift. Chosen to sit above this
 * measurement's own noise and below the defect it exists to catch:
 *
 *  - Noise floor. The residual is the ~17 ms peak-to-peak render-quantum
 *    sawtooth, sd ~ 17/sqrt(12) ~ 4.9 ms. A least-squares slope over n ~ 167
 *    samples spread over ~43 s has sd ~ 4.9 / (sqrt(167) * 43000/sqrt(12))
 *    ~ 3.1e-5 ms/ms, i.e. ~1.8 ms/min. This budget is ~4 sigma above that.
 *  - Defect. A frozen anchor (pre-2.32e) drifts at the raw clock rate,
 *    measured at ~15 ms/min. This budget is half of it.
 */
const ADAPTER_DRIFT_BUDGET_MS_PER_MIN = 8
/**
 * Bound on the adapter's absolute anchor error. The filter's steady-state lag
 * against a ramp of rate r is r * tau; on real hardware that is
 * 0.00025 ms/ms * 2000 ms = 0.5 ms. On a null sink whose rate error is orders
 * of magnitude larger the lag scales with it, and above
 * `OFFSET_RESNAP_THRESHOLD_MS` (250 ms) the adapter snaps rather than
 * crawling — so 300 ms is the structural ceiling on this quantity regardless
 * of platform, plus sawtooth. Asserting it catches an anchor that has come
 * unstuck entirely (e.g. a resnap threshold that never fires).
 */
const ADAPTER_ERROR_CEILING_MS = 400
/**
 * Above this, the two "clocks" are not two oscillators. Real crystal pairs
 * disagree by tens to hundreds of ppm; 1000 ppm (0.1%) is already beyond any
 * hardware explanation, so anything past it is Chromium's software null sink
 * being scheduled at a rate that is not real time. Used only to classify and
 * report — never to fail — because it says something about the machine the
 * test is on, not about this repository.
 */
const HARDWARE_PLAUSIBLE_PPM = 1000

type ClockState = 'suspended' | 'running' | 'closed'

type RawSample = {
  /** `performance.now()` at the moment this sample was taken. */
  readonly tMs: number
  /** `performance.now() - ctx.currentTime * 1000` — the RAW, unfiltered pair. */
  readonly offsetMs: number
  /**
   * `output.now() - performance.now()` off a real `createWebAudioOutput`,
   * i.e. `anchor - rawOffset`: how far the adapter's filtered anchor is from
   * the truth at this instant. This is the quantity under test.
   */
  readonly adapterErrorMs: number
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
 * genuinely started), then builds a REAL `createWebAudioOutput` over that
 * context and samples both the raw clock pair and the adapter's anchor error
 * every `sampleIntervalMs` for `windowMs` of real wall time.
 *
 * The adapter instance is the app's own module, imported from the dev server
 * by URL (the e2e `webServer` is `npm run dev`, so vite serves and transpiles
 * it). Nothing is exported from production code purely for this test, and no
 * copy of the filter is reimplemented here — a reimplementation could not
 * catch a regression in the original.
 *
 * `output` only ever has `now()` called on it. It builds a master `GainNode`
 * and connects it, but creates no oscillator without a `noteOn`, so this
 * measurement is silent.
 */
async function measureClockDrift(
  page: Page,
  windowMs: number,
  sampleIntervalMs: number,
): Promise<DriftMeasurement> {
  return page.evaluate<DriftMeasurement, { windowMs: number; sampleIntervalMs: number }>(
    async ({ windowMs, sampleIntervalMs }) => {
      const { createWebAudioOutput } = (await import('/src/adapters/audio/webaudio.ts')) as {
        createWebAudioOutput: (ctx: AudioContext) => { now: () => number }
      }

      const ctx = new AudioContext()
      await ctx.resume()
      const stateAfterResume = ctx.state
      const samples: { tMs: number; offsetMs: number; adapterErrorMs: number }[] = []
      let startupPinMs = 0

      if (stateAfterResume === 'running') {
        const pinStart = performance.now()
        while (ctx.currentTime === 0) {
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        startupPinMs = performance.now() - pinStart

        const output = createWebAudioOutput(ctx)

        const start = performance.now()
        while (performance.now() - start < windowMs) {
          const tMs = performance.now()
          const offsetMs = tMs - ctx.currentTime * 1000
          // Bracket the `now()` call and use the midpoint of the two
          // `performance.now()` reads around it, so the few microseconds the
          // call itself takes do not land in the error term as a bias.
          const before = performance.now()
          const adapterNowMs = output.now()
          const after = performance.now()
          const adapterErrorMs = adapterNowMs - (before + after) / 2
          samples.push({ tMs, offsetMs, adapterErrorMs })
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
 * Ordinary least-squares fit of `value(sample)` against `tMs`: returns the
 * slope (units of value per ms of elapsed time) and the max-min spread of the
 * fit residuals, so a caller can compare the slope's implied drift against
 * the noise it was extracted from.
 */
function fitDrift(
  samples: readonly RawSample[],
  value: (sample: RawSample) => number,
): { slopePerMs: number; residualSpreadMs: number } {
  const n = samples.length
  let sumT = 0
  let sumO = 0
  for (const s of samples) {
    sumT += s.tMs
    sumO += value(s)
  }
  const meanT = sumT / n
  const meanO = sumO / n

  let covariance = 0
  let variance = 0
  for (const s of samples) {
    const dt = s.tMs - meanT
    covariance += dt * (value(s) - meanO)
    variance += dt * dt
  }
  const slopePerMs = variance === 0 ? 0 : covariance / variance
  const intercept = meanO - slopePerMs * meanT

  let residualMin = Number.POSITIVE_INFINITY
  let residualMax = Number.NEGATIVE_INFINITY
  for (const s of samples) {
    const fitted = intercept + slopePerMs * s.tMs
    const residual = value(s) - fitted
    residualMin = Math.min(residualMin, residual)
    residualMax = Math.max(residualMax, residual)
  }

  return { slopePerMs, residualSpreadMs: residualMax - residualMin }
}

/**
 * What kind of thing produced `ctx.currentTime` on this machine. See
 * `HARDWARE_PLAUSIBLE_PPM`: this is reported, never asserted, and it is the
 * answer to T.2's "what does the number mean on a machine with no audio
 * device" — on such a machine expect `'software-null-sink'` and a raw drift
 * figure in the thousands of ms/min, while the adapter figure below stays
 * small because the filter tracks whatever rate it is given.
 */
function classifySink(rawDriftPpm: number): 'hardware-plausible' | 'software-null-sink' {
  return Math.abs(rawDriftPpm) <= HARDWARE_PLAUSIBLE_PPM ? 'hardware-plausible' : 'software-null-sink'
}

const perMinute = (slopePerMs: number): number => Math.round(slopePerMs * 60_000 * 100) / 100
const round2 = (value: number): number => Math.round(value * 100) / 100

test('the audio adapter holds its Clock anchor over a sustained session (roadmap 2.32e, T.2)', async ({
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
  // seconds of real sampling, and against the adapter's filter still moving
  // off its construction-time seed.
  const samples = rawSamples.filter((s) => s.tMs - first.tMs >= WARMUP_MS)
  expect(samples.length, 'nothing survived the warm-up discard').toBeGreaterThan(0)

  const firstSample = samples[0]
  const lastSample = samples[samples.length - 1]
  if (firstSample === undefined || lastSample === undefined) {
    throw new Error('unreachable: samples.length was just asserted > 0')
  }
  const windowSeconds = (lastSample.tMs - firstSample.tMs) / 1000

  const raw = fitDrift(samples, (s) => s.offsetMs)
  const adapter = fitDrift(samples, (s) => s.adapterErrorMs)
  // ppm: the drift, as a fraction of elapsed time, in parts per million —
  // e.g. a clock that gains 1ms per 1000ms elapsed is drifting at 1000ppm.
  const rawDriftPpm = round2(raw.slopePerMs * 1_000_000)
  const adapterDriftMsPerMinute = perMinute(adapter.slopePerMs)
  const worstAdapterErrorMs = Math.max(...samples.map((s) => Math.abs(s.adapterErrorMs)))

  // These logged lines ARE a deliverable of this spec — a reader diagnosing a
  // timing complaint reads the drift figures out of them. Do not remove or
  // reword the prefixes. Values are rounded in code so any quoted output is
  // byte-identical to these lines.
  /* eslint-disable no-console -- deliberate machine-readable report lines, see module comment */
  console.log(
    'AUDIO_CLOCK_DRIFT ' +
      JSON.stringify({
        sink: classifySink(rawDriftPpm),
        startOffsetMs: firstSample.offsetMs,
        endOffsetMs: lastSample.offsetMs,
        windowSeconds,
        driftMsPerMinute: perMinute(raw.slopePerMs),
        driftPpm: rawDriftPpm,
        samples: samples.length,
        residualSpreadMs: round2(raw.residualSpreadMs),
      }),
  )
  console.log(
    'AUDIO_ADAPTER_ANCHOR ' +
      JSON.stringify({
        driftMsPerMinute: adapterDriftMsPerMinute,
        budgetMsPerMinute: ADAPTER_DRIFT_BUDGET_MS_PER_MIN,
        worstAbsErrorMs: round2(worstAdapterErrorMs),
        residualSpreadMs: round2(adapter.residualSpreadMs),
      }),
  )
  /* eslint-enable no-console */

  // The sampling loop must have actually run for close to the intended
  // window at the intended density — otherwise Chrome's hidden-page timer
  // throttling (or a shrunk WINDOW_MS) could silently divide a noise-sized
  // change by a tiny window and report a wild drift figure.
  expect(windowSeconds).toBeGreaterThan(40)
  expect(samples.length).toBeGreaterThan(150)

  // THE assertion. Not the raw clock pair (that is the machine's business,
  // logged above and deliberately unasserted after T.2) but the adapter's
  // own anchor: it must still be tracking, at a rate a frozen anchor could
  // not achieve.
  expect(
    Math.abs(adapterDriftMsPerMinute),
    `the filtered offset anchor is not tracking — a frozen anchor drifts at the raw clock rate ` +
      `(${String(perMinute(raw.slopePerMs))} ms/min here); see roadmap 2.32e`,
  ).toBeLessThan(ADAPTER_DRIFT_BUDGET_MS_PER_MIN)
  expect(worstAdapterErrorMs).toBeLessThan(ADAPTER_ERROR_CEILING_MS)
})
