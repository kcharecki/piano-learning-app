import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { installFakeMidi, FAKE_MIDI_DEVICE_NAME } from './fake-midi.ts'
import { openPracticeSetup } from './practice-setup.ts'

/**
 * E2E proof for roadmap B.3 (REQ-3.2.4's optional half) — the falling-note
 * piano roll, driven end to end against a REAL bundled repertoire piece
 * (`src/content/scores/twinkle-twinkle-little-star.musicxml`), never a
 * hand-built fixture. Unit/property tests already prove the geometry module
 * in isolation (`@core/notation/pianoRoll.test.ts`) and the component's
 * rendering/wiring in isolation (`PianoRoll.test.tsx`, `PracticeScreen.test.tsx`);
 * this is the one place that proves the whole chain is actually wired
 * together in the real, running app, with the transport genuinely playing.
 *
 * ## The piece, and why it makes a good proof
 *
 * Twinkle Twinkle is 12 measures at 100bpm/4/4, right-hand melody in plain
 * quarter notes and a left-hand whole-note chord per measure — see the
 * MusicXML source. Measure 1 (0-based measure index 0, tick 0-1919):
 *   beat 1: right C4 (60)   | beat 2: right C4 (60)
 *   beat 3: right G4 (67)   | beat 4: right G4 (67)
 *   left hand throughout: the whole-note chord C3/E3/G3 (48/52/55)
 * That gives two DISTINCT, exactly-known "what's actually sounding right
 * now" answers a few beats apart — beat 2 (60+48+52+55) and beat 4
 * (67+48+52+55) — which is what the "lit lanes match the score" assertions
 * below check against, independently of anything the app itself reports.
 *
 * ## Why position is read by BEAT LABEL, not by polling for a raw tick
 *
 * `usePracticeEngine` never exposes a raw tick to the DOM (by design — see
 * its own module comment); `TransportControls` renders "Measure M, beat B of
 * N" instead. Each melody note here is exactly one beat long, so the beat
 * label alone is enough to know EXACTLY which pitches must be sounding —
 * no reconstruction of the underlying tick is needed for that half of the
 * proof.
 *
 * ## Why "moved by the expected proportion" is a bounded range, not an exact number
 *
 * `expect(...).toPass` (used to wait for a beat label) can resolve at ANY
 * instant inside that beat's ~600ms window, not exactly at its first frame —
 * so the REAL tick delta between two samples taken at "beat 2" and "beat 4"
 * is only known to lie in a range (worst case as small as one beat, as large
 * as three), not a fixed number. The bounds below are exactly that range,
 * with slack for CI jitter — tight enough to fail if the roll were frozen,
 * moving the wrong way, or moving at some wildly wrong scale, without
 * chasing an exact frame boundary.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(
  __dirname,
  '..',
  'src',
  'content',
  'scores',
  'twinkle-twinkle-little-star.musicxml',
)
const FIXTURE_TITLE = 'Twinkle, Twinkle, Little Star'
/** The left-hand chord's root in measure 1 (0-based index 0): `m0.l.0.48` — see `score.ts`'s `noteId`. A whole note, so it stays inside the roll's visible window across both samples below. */
const LEFT_CHORD_ROOT_ID = 'm0.l.0.48'
/** `TICKS_PER_QUARTER` — kept literal (not imported) so this spec exercises the real rendered numbers, not a shared constant that could drift with the source and still agree by construction. */
const TICKS_PER_QUARTER = 480

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
 * UI-09 (2026-08-12 UI audit): file import moved behind a "Change piece…"
 * button that opens a modal `<dialog>` — closes it again once the new
 * score's title is confirmed, so the rest of the screen is interactable.
 */
async function importScore(page: Page, fixturePath: string, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Change piece…' }).click()
  await page.getByLabel(/Import a score/i).setInputFiles(fixturePath)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('dialog', { name: 'Change piece' }).getByRole('button', { name: 'Close' }).click()
}

/**
 * UI-04b: the MIDI status line moved into the shell topbar's input-status
 * chip popover — open it, check the text, then Escape closes it again.
 */
async function expectMidiStatusText(page: Page, pattern: RegExp): Promise<void> {
  const chip = page.getByRole('button', { name: /MIDI connected|No MIDI/ })
  await chip.click()
  await expect(page.getByText(pattern)).toBeVisible()
  await page.keyboard.press('Escape')
}

type RollNoteSample = {
  readonly noteId: string
  readonly midi: number
  readonly hand: string
  readonly x: number
  readonly lit: boolean
}
type RollSnapshot = {
  readonly measure: number
  readonly beat: number
  readonly notes: readonly RollNoteSample[]
}

/** One atomic in-page read of the position readout and every roll rectangle's own attributes — avoids racing real playback across two separate Playwright round-trips (same technique as e2e/read-ahead.spec.ts's `readSnapshot`). */
async function readRollSnapshot(page: Page): Promise<RollSnapshot> {
  return page.evaluate(() => {
    const posText = document.querySelector('[aria-label="Position"]')?.textContent ?? ''
    // UI-09: the readout dropped its "of N" beats-per-measure suffix and
    // switched its separator from a comma to a middle dot ("Measure N ·
    // beat N").
    const match = /Measure (\d+) . beat (\d+)/.exec(posText)
    const measure = match?.[1] === undefined ? 0 : Number(match[1])
    const beat = match?.[2] === undefined ? 0 : Number(match[2])
    const notes = Array.from(document.querySelectorAll('[data-testid="piano-roll-note"]')).map(
      (el) => ({
        noteId: el.getAttribute('data-note-id') ?? '',
        midi: Number(el.getAttribute('data-midi')),
        hand: el.getAttribute('data-hand') ?? '',
        x: Number(el.getAttribute('x')),
        lit: el.getAttribute('data-lit') === 'true',
      }),
    )
    return { measure, beat, notes }
  })
}

/**
 * Polls (via the same atomic snapshot) until the position reads exactly
 * `measure`/`beat`, returning the snapshot that satisfied it.
 *
 * Waiting for an EXACT beat is only safe while a beat lasts much longer than
 * one poll: a beat that comes and goes between two polls is never seen again,
 * and the wait then burns its whole timeout with the transport already past it.
 * That is a real failure this spec hit — green solo, red inside the full
 * `verify:full` suite, where every worker is competing for the same CPU. The
 * caller therefore drops the tempo to the slider's 30% floor before Play; do
 * not raise it back without also making this wait tolerate an overshoot.
 */
async function waitForPosition(page: Page, measure: number, beat: number): Promise<RollSnapshot> {
  let last: RollSnapshot | undefined
  await expect(async () => {
    const snapshot = await readRollSnapshot(page)
    last = snapshot
    expect(snapshot.measure).toBe(measure)
    expect(snapshot.beat).toBe(beat)
  }).toPass({ timeout: 25_000 })
  if (last === undefined) throw new Error('unreachable — toPass only resolves after a read')
  return last
}

test('falling-note piano roll tracks the real transport position, lighting exactly the pitches the score holds there and scrolling notes past a fixed now-line as playback advances (roadmap B.3)', async ({
  page,
}) => {
  // Two 25s position waits have to fit inside this, with the import and the
  // engrave before them.
  test.setTimeout(75_000)
  const errors = collectErrors(page)

  // Must be installed before the first navigation — the app requests MIDI
  // access on mount.
  await installFakeMidi(page)
  await page.goto('/')

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  await importScore(page, FIXTURE_PATH, FIXTURE_TITLE)
  await expectMidiStatusText(page, new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`))

  // Settle point (see e2e/read-ahead.spec.ts and e2e/note-colour.spec.ts):
  // only the newly-imported 12-measure piece clamps "to measure" to 12 — the
  // reliable proof the async ScoreViewer load for THIS score has finished.
  await openPracticeSetup(page)
  const loopRange = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRange.getByLabel('to measure')).toHaveValue('12')
  await page.waitForTimeout(300)

  // ---- off by default (roadmap B.3's design constraint) ----
  await expect(page.getByTestId('piano-roll')).toHaveCount(0)

  // The Piano roll checkbox lives inside the "Practice setup" disclosure,
  // which defaults CLOSED (roadmap UI-24) — `openPracticeSetup` above is the
  // expand step that makes it reachable.
  const pianoRollGroup = page.getByRole('group', { name: 'Piano roll' })
  await expect(pianoRollGroup.getByRole('checkbox')).toBeVisible()
  await pianoRollGroup.getByRole('checkbox').check()

  await expect(page.getByTestId('piano-roll')).toBeVisible()
  await expect(page.getByRole('img', { name: /piano roll/i })).toBeVisible()
  // Both stay visible together — the roll is a bridge TO the notation, not a
  // replacement for it (design constraint).
  await expect(page.locator('[data-testid="score-container"] svg')).toBeVisible()

  // ---- transport STOPPED state: the roll renders at rest without playing ----
  const atRestBeforePlay = await readRollSnapshot(page)
  expect(atRestBeforePlay.notes.length).toBeGreaterThan(0)

  // Slow the transport to the tempo slider's 30% floor before playing. At the
  // written tempo a beat is short enough that a poll can step straight over the
  // exact beat `waitForPosition` is waiting for, which is how this spec passed
  // solo and failed inside the full suite. Slower beats do not weaken a single
  // assertion below — the lit pitches and the scroll direction are properties of
  // the score and the geometry, not of the tempo.
  // UI-09: the slider's label now carries "% of written" detail ("Tempo —
  // X% of written Y") — the em dash disambiguates it from the unrelated
  // "Tempo ramp" checkbox's label (roadmap 2.27).
  await page.getByLabel(/^Tempo —/).fill('30')

  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  const atBeat2 = await waitForPosition(page, 1, 2)
  const atBeat4 = await waitForPosition(page, 1, 4)

  // ---- current-position highlight: lit lanes match what the score actually holds ----
  const litMidis = (snapshot: RollSnapshot): number[] =>
    snapshot.notes
      .filter((n) => n.lit)
      .map((n) => n.midi)
      .sort((a, b) => a - b)
  // Beat 2: right hand's second C4, plus the left-hand C3/E3/G3 chord (still
  // sounding under its own whole note).
  expect(litMidis(atBeat2)).toEqual([48, 52, 55, 60])
  // Beat 4: right hand has moved on to its second G4; the SAME left-hand
  // chord is still sounding (it does not change until measure 2).
  expect(litMidis(atBeat4)).toEqual([48, 52, 55, 67])

  // ---- hand colouring: right vs left are wired to distinct pitches/classes ----
  const rightAtBeat2 = atBeat2.notes.find((n) => n.midi === 60)
  const leftAtBeat2 = atBeat2.notes.find((n) => n.midi === 48)
  expect(rightAtBeat2?.hand).toBe('right')
  expect(leftAtBeat2?.hand).toBe('left')

  // ---- geometry actually moves, in the expected direction, by a bounded, expected amount ----
  const chordRootAt2 = atBeat2.notes.find((n) => n.noteId === LEFT_CHORD_ROOT_ID)
  const chordRootAt4 = atBeat4.notes.find((n) => n.noteId === LEFT_CHORD_ROOT_ID)
  expect(chordRootAt2, 'the left-chord root must still be inside the visible window at beat 2').toBeDefined()
  expect(chordRootAt4, 'the left-chord root must still be inside the visible window at beat 4').toBeDefined()
  const xAt2 = (chordRootAt2 as RollNoteSample).x
  const xAt4 = (chordRootAt4 as RollNoteSample).x
  // The roll scrolls right-to-left as time advances (a FIXED note's x
  // decreases) — see the module comment for why the exact delta is a bounded
  // range rather than a fixed number: `toPass` can land anywhere inside
  // beat 2's/beat 4's own ~600ms window, so the true elapsed tick delta
  // between the two samples is anywhere from one beat (481 ticks) to three
  // (1439 ticks). The bounds below are exactly that range with slack for CI
  // jitter — they still fail on "frozen", "wrong direction", or "wrong
  // scale", which is the actual regression this guards.
  const observedDelta = xAt2 - xAt4
  // Printed so a run says WHAT was actually sampled, not merely that the
  // bounds held (see e2e/perf-large-score.spec.ts's own `console.warn` for
  // the same reasoning — eslint's `no-console` allows `warn`/`error` only).
  console.warn(
    JSON.stringify({ litAtBeat2: litMidis(atBeat2), litAtBeat4: litMidis(atBeat4), xAt2, xAt4, observedDelta }),
  )
  expect(observedDelta).toBeGreaterThan(TICKS_PER_QUARTER * 0.75)
  expect(observedDelta).toBeLessThan(TICKS_PER_QUARTER * 3.25)

  // ---- transport STOPPED again: the roll survives Stop without erroring ----
  await transport.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByLabel('Position')).toContainText('Measure 1')
  await expect(page.getByTestId('piano-roll')).toBeVisible()

  // ---- toggling off removes the roll, leaving the notation untouched ----
  await pianoRollGroup.getByRole('checkbox').uncheck()
  await expect(page.getByTestId('piano-roll')).toHaveCount(0)
  await expect(page.locator('[data-testid="score-container"] svg')).toBeVisible()

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// Perf: the roll ON against the same 102-measure/1603-note score
// `e2e/perf-large-score.spec.ts` budgets against.
//
// `e2e/perf-large-score.spec.ts` itself is out of this task's file scope
// (see the roadmap-B.3 report) and its default drive never turns the roll
// on — it is off by default, and that spec has no reason to touch a control
// this task added. Rather than silently accept "budgets never actually
// measured with the roll ON", this reproduces its exact methodology
// (same fixture, same longtask/frame-gap sampling, same shape of budget)
// with the ONE difference this task needs verified: the roll switched on
// before Play. Budgets are loosened slightly from the original (see each
// one's comment) to account for the roll's own per-frame repaint, while
// still catching "the roll made this janky" as a real failure.
// ---------------------------------------------------------------------------

const __perfFixturesDir = path.join(__dirname, 'fixtures')
const CANON_FIXTURE_PATH = path.join(__perfFixturesDir, 'canon-in-d.mxl')
const CANON_TITLE = 'Canon in D'
const PERF_SAMPLE_MS = 6000

declare global {
  interface Window {
    __perf?: { longTasks: number[]; frameGaps: number[] }
  }
}

async function startPerfSampling(page: Page): Promise<void> {
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

function perfPercentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[index] ?? 0
}

test('the roll stays within a perf budget against a 102-measure, 1603-note score, switched ON (roadmap B.3, filling e2e/perf-large-score.spec.ts\'s "roll ON" gap out-of-scope to edit)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Practice', exact: true })
    .click()

  // UI-09: import lives behind the "Change piece…" dialog now — a large
  // score can take a while to parse and engrave, so the heading wait keeps
  // its own generous timeout before the dialog is closed again.
  await page.getByRole('button', { name: 'Change piece…' }).click()
  await page.getByLabel(/Import a score/i).setInputFiles(CANON_FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: CANON_TITLE })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('dialog', { name: 'Change piece' }).getByRole('button', { name: 'Close' }).click()
  await openPracticeSetup(page)
  const loopRange = page.getByRole('group', { name: 'Loop range' })
  await expect(loopRange.getByLabel('to measure')).toHaveAttribute('max', '102', { timeout: 60_000 })
  await expect(page.locator('[data-testid="score-container"] svg')).toBeVisible()

  // Switched ON BEFORE Play — this is the one thing this test exists to add.
  const pianoRollGroup = page.getByRole('group', { name: 'Piano roll' })
  await pianoRollGroup.getByRole('checkbox').check()
  await expect(page.getByTestId('piano-roll')).toBeVisible()

  await startPerfSampling(page)

  const transport = page.getByRole('group', { name: 'Transport' })
  const playStart = Date.now()
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(async () => {
    const text = (await page.getByLabel('Position').textContent()) ?? ''
    expect(text).not.toMatch(/Measure 1\b.*beat 1\b/)
  }).toPass({ timeout: 20_000 })
  const playLatencyMs = Date.now() - playStart

  await page.waitForTimeout(PERF_SAMPLE_MS)
  const sample = await page.evaluate(() => ({
    longTasks: window.__perf?.longTasks ?? [],
    frameGaps: window.__perf?.frameGaps ?? [],
  }))

  const stopStart = Date.now()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByLabel('Position')).toContainText('Measure 1')
  const stopLatencyMs = Date.now() - stopStart

  const worstLongTask = Math.max(0, ...sample.longTasks)
  const worstFrameGap = Math.max(0, ...sample.frameGaps)
  const p95FrameGap = perfPercentile(sample.frameGaps, 95)

  console.warn(
    JSON.stringify(
      {
        rollOn: true,
        playLatencyMs,
        stopLatencyMs,
        frames: sample.frameGaps.length,
        p95FrameGap: Math.round(p95FrameGap),
        worstFrameGap: Math.round(worstFrameGap),
        longTasks: sample.longTasks.length,
        worstLongTask: Math.round(worstLongTask),
      },
      null,
      2,
    ),
  )

  // Budgets — see e2e/perf-large-score.spec.ts's own module comment for the
  // roll-OFF numbers these are compared against (p95 18ms, worst 50ms, 0 long
  // tasks, 423 frames, stop 101ms, measured on the same machine). Loosened
  // here, not tightened to match: the roll adds a real, small per-frame SVG
  // repaint on top of everything that spec already measures, and the budget
  // should catch "the roll made this janky", not "the roll costs anything at
  // all".
  expect(p95FrameGap).toBeLessThan(60)
  expect(worstFrameGap).toBeLessThan(300)
  expect(worstLongTask).toBeLessThan(300)
  expect(stopLatencyMs).toBeLessThan(2000)
  expect(sample.frameGaps.length).toBeGreaterThan(150)
  expect(playLatencyMs).toBeLessThan(3000)

  expect(errors).toEqual([])
})
