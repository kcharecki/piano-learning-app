import { expect, test, type Page } from '@playwright/test'
import { playGrooveHits, type TimedHit } from './drum-pads.ts'

/**
 * Roadmap DR-15 "coordination trainer" — the screen at `/drums/coordination`.
 *
 * Grading and the step-progress math are proved against a `FakeClock` in
 * `coordinationRun.test.ts` and `useCoordinationTrainer.test.ts`; what only a
 * real browser run can show is the whole page wired together: choosing Kick
 * permutations really lists all 16 drills with only the first unlocked,
 * playing that first drill steady really unlocks the second one on screen,
 * a real tempo-field edit leaves that unlocked progress alone, and choosing
 * Two kicks really lists a fresh 12-drill set through the real (browser) rng.
 *
 * The first kick-permutation drill (easiest — slot 0, syncopation weight 0)
 * is eighth-note hi-hats, snare on beats 2 & 4, and the kick on the downbeat.
 * At 80 bpm — the trainer's default — a bar is 3000 ms; two bars are graded.
 */

/** 80 bpm: an eighth is 375 ms, a quarter 750 ms, a 4/4 bar 3000 ms. */
const BAR_MS = 3000

const HIHAT_IN_BAR = [0, 375, 750, 1125, 1500, 1875, 2250, 2625] as const
const SNARE_IN_BAR = [750, 2250] as const
const KICK_IN_BAR = [0] as const

/** Both graded bars of the first (easiest) kick-permutation drill, played correctly. */
const FIRST_DRILL_CORRECT: readonly TimedHit[] = [
  ...HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms })),
  ...HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms: BAR_MS + ms })),
  ...SNARE_IN_BAR.map((ms) => ({ pad: 'snare' as const, ms })),
  ...SNARE_IN_BAR.map((ms) => ({ pad: 'snare' as const, ms: BAR_MS + ms })),
  ...KICK_IN_BAR.map((ms) => ({ pad: 'kick' as const, ms })),
  ...KICK_IN_BAR.map((ms) => ({ pad: 'kick' as const, ms: BAR_MS + ms })),
]

function result(page: Page) {
  return page.getByRole('region', { name: 'Result' })
}

function steps(page: Page) {
  return page.getByRole('list', { name: 'Steps' }).getByRole('button')
}

// @serial — plays a whole two-bar pass in real time; run alongside another
// timing-sensitive spec it would be racing the same host scheduler for no
// benefit either way (same reasoning as drums-groove-loop.spec.ts).
test('Kick permutations lists all 16 drills, and a steady first pass unlocks the second (roadmap DR-15) @serial', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await page.goto('/drums/coordination')
  await expect(page.getByRole('heading', { level: 1, name: 'Coordination' })).toBeVisible()

  await page.getByRole('radio', { name: 'Kick permutations' }).click()

  const stepButtons = steps(page)
  await expect(stepButtons).toHaveCount(16)
  await expect(stepButtons.nth(0)).toBeEnabled()
  await expect(stepButtons.nth(0)).toHaveAttribute('aria-current', 'step')
  await expect(stepButtons.nth(1)).toBeDisabled()

  await playGrooveHits(page, FIRST_DRILL_CORRECT)

  await expect(result(page).getByText('Steady — next step unlocked')).toBeVisible()
  await expect(stepButtons.nth(1)).toBeEnabled()
  await expect(stepButtons.nth(1)).toHaveAttribute('aria-current', 'step')

  // Roadmap DR-15 follow-up: changing tempo keeps progress. A learner who
  // just unlocked step 2 and slows down to work on it must not be thrown
  // back to step 1 — only mode/groove changes reset the step list.
  const tempoField = page.getByLabel('Tempo')
  await tempoField.fill('60')
  await tempoField.blur()

  await expect(stepButtons.nth(1)).toBeEnabled()
  await expect(stepButtons.nth(1)).toHaveAttribute('aria-current', 'step')

  expect(consoleErrors).toEqual([])
})

// @serial — see the note on the spec above; this one plays no notes but
// still drives the same real dev server and app clock.
test('Two kicks lists 12 fresh drills, only the first unlocked (roadmap DR-15) @serial', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await page.goto('/drums/coordination')
  await expect(page.getByRole('heading', { level: 1, name: 'Coordination' })).toBeVisible()

  await page.getByRole('radio', { name: 'Two kicks' }).click()

  const stepButtons = steps(page)
  await expect(stepButtons).toHaveCount(12)
  await expect(stepButtons.nth(0)).toBeEnabled()
  await expect(stepButtons.nth(0)).toHaveAttribute('aria-current', 'step')
  await expect(stepButtons.nth(1)).toBeDisabled()

  const labels = await stepButtons.allTextContents()
  expect(labels).toHaveLength(12)
  for (const label of labels) expect(label).toMatch(/^Kick on \S+ and \S+$/)
  expect(new Set(labels).size).toBe(12)

  expect(consoleErrors).toEqual([])
})

// @serial — see the note on the spec above; this one plays no notes but
// still drives the same real dev server and app clock.
test('Hi-hat foot lists the three build steps for the default groove, only the first unlocked, with the ride and the pedal on screen (roadmap DR-15) @serial', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await page.goto('/drums/coordination')
  await expect(page.getByRole('heading', { level: 1, name: 'Coordination' })).toBeVisible()

  await page.getByRole('radio', { name: 'Hi-hat foot' }).click()

  // The groove picker still applies here — the drill is built from the
  // chosen groove, same as Layer build.
  await expect(page.getByRole('combobox', { name: 'Groove' })).toBeVisible()

  const stepButtons = steps(page)
  await expect(stepButtons).toHaveCount(3)
  const labels = await stepButtons.allTextContents()
  expect(labels).toEqual([
    'Quarter-Note Rock — ride and foot on 2 and 4',
    'Quarter-Note Rock — add the kick',
    'Quarter-Note Rock — add the snare',
  ])
  await expect(stepButtons.nth(0)).toBeEnabled()
  await expect(stepButtons.nth(0)).toHaveAttribute('aria-current', 'step')
  await expect(stepButtons.nth(1)).toBeDisabled()
  await expect(stepButtons.nth(2)).toBeDisabled()

  // Step 1 is ride-and-pedal only: both pads must be on screen, the pedal
  // reachable by its bound key (roadmap DR-15's `GROOVE_PAD_KEY.hhPedal`).
  await expect(page.getByRole('button', { name: 'Ride', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hi-hat pedal', exact: true })).toBeVisible()
  await expect(page.getByText('Hi-hat pedal, D')).toBeVisible()

  expect(consoleErrors).toEqual([])
})

/** Money Beat's own eighth-note hi-hat grid, and its kick/snare, at 80 bpm (3000 ms/bar). */
const MB_HIHAT_IN_BAR = [0, 375, 750, 1125, 1500, 1875, 2250, 2625] as const
const MB_KICK_IN_BAR = [0, 1500] as const
const MB_SNARE_IN_BAR = [750, 2250] as const

/**
 * Both graded bars of Money Beat's opening-drill step 1, with every hi-hat
 * instant — including the one the drill wants opened, the & of beat 4 —
 * struck on the CLOSED pad. This is deliberately the wrong articulation: the
 * point of the test below is that the grader calls that out by name rather
 * than just failing silently.
 */
const STEP1_ALL_HATS_CLOSED: readonly TimedHit[] = [
  ...MB_HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms })),
  ...MB_HIHAT_IN_BAR.map((ms) => ({ pad: 'hihat' as const, ms: BAR_MS + ms })),
  ...MB_KICK_IN_BAR.map((ms) => ({ pad: 'kick' as const, ms })),
  ...MB_KICK_IN_BAR.map((ms) => ({ pad: 'kick' as const, ms: BAR_MS + ms })),
  ...MB_SNARE_IN_BAR.map((ms) => ({ pad: 'snare' as const, ms })),
  ...MB_SNARE_IN_BAR.map((ms) => ({ pad: 'snare' as const, ms: BAR_MS + ms })),
]

// @serial — see the note on the spec above; this one plays a whole two-bar
// pass in real time, same as the Kick permutations spec.
test('Hi-hat openings: the default groove has no eighth-note "&", Money Beat lists its three steps, and playing every hat closed names the articulation slip (roadmap DR-15) @serial', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await page.goto('/drums/coordination')
  await expect(page.getByRole('heading', { level: 1, name: 'Coordination' })).toBeVisible()

  await page.getByRole('radio', { name: 'Hi-hat openings' }).click()

  // Default groove is Quarter-Note Rock — hats on the quarters only, none of
  // them on an "&" — so there is nothing to drill and the screen says so.
  await expect(page.getByRole('status', { name: 'Drill steps' })).toHaveText(
    'No hi-hat on an "&" in this groove — pick an eighth-note groove.',
  )

  await page.getByRole('combobox', { name: 'Groove' }).selectOption({ label: 'Money Beat' })

  const stepButtons = steps(page)
  await expect(stepButtons).toHaveCount(3)
  const labels = await stepButtons.allTextContents()
  expect(labels).toEqual([
    'Money Beat — open on the & of 4',
    'Money Beat — open on the & of 2 and 4',
    'Money Beat — open on every &',
  ])
  await expect(stepButtons.nth(0)).toBeEnabled()
  await expect(stepButtons.nth(0)).toHaveAttribute('aria-current', 'step')
  await expect(stepButtons.nth(1)).toBeDisabled()
  await expect(stepButtons.nth(2)).toBeDisabled()

  await playGrooveHits(page, STEP1_ALL_HATS_CLOSED)

  await expect(result(page).getByText(/played closed instead of open/)).toBeVisible()
  await expect(result(page).getByText('Not steady yet — try again')).toBeVisible()
  await expect(stepButtons.nth(1)).toBeDisabled()

  expect(consoleErrors).toEqual([])
})

/**
 * Jazz ride (roadmap DR-15 "jazz ride introduction"): the only mode whose
 * content is swung (`swingPercent: 67`), which only matters because
 * `practice/plan.ts` now turns that into swung `expectedMs` — proved against
 * a `FakeClock` in `plan.test.ts`, but what only a real browser run can show
 * is that the WHOLE app plays what the plan says: the pads really schedule
 * from `expectedMs`, so hitting the ride pattern's own swung instants (not
 * the straight ones a naive reading of "1, 2, 2&, 3, 4, 4&" would suggest)
 * really grades steady, in real time, end to end.
 *
 * `drum-pads.ts`'s `playGrooveHits` only knows the hi-hat/open-hat/snare/kick
 * pads `GrooveTrainerScreen`'s own drills use — Jazz ride's step 1 ("ride
 * alone") is the ride pad alone, which is out of scope for this change
 * (`drum-pads.ts` is not among the files this change owns), so this spec
 * drives it directly with the same real-dispatch-timing discipline
 * `playGrooveHits` uses (see that file's own module comment for why a
 * Playwright-side `locator.click()` per hit does not work here), rather than
 * widen that shared helper's pad vocabulary for one drill.
 */
async function playRideHits(page: Page, msTimes: readonly number[], startName = 'Start'): Promise<void> {
  await page.evaluate(
    async ({ msTimes, startName }) => {
      const button = (name: string): HTMLButtonElement => {
        const el = document.querySelector(`button[aria-label="${name}"]`)
        if (!(el instanceof HTMLButtonElement)) {
          throw new Error(`drums-coordination: no button with accessible name "${name}" on this screen`)
        }
        return el
      }
      const runStateText = (): string =>
        document.querySelector('[role="status"][aria-label="Run state"]')?.textContent ?? ''

      // Same origin-detection discipline as `playGrooveHits`: armed BEFORE
      // Start, off a MutationObserver on the run-state live region, so the
      // graded window's open instant is not missed between the click and the
      // observer being attached.
      const graded: Promise<number> = new Promise((resolve, reject) => {
        const settle = (): boolean => {
          if (!runStateText().startsWith('Playing')) return false
          observer.disconnect()
          clearTimeout(bail)
          resolve(performance.now())
          return true
        }
        const observer = new MutationObserver(settle)
        const bail = setTimeout(() => {
          observer.disconnect()
          reject(new Error(`drums-coordination: graded window never opened; run state was "${runStateText()}"`))
        }, 30_000)
        observer.observe(document.body, { childList: true, characterData: true, subtree: true })
        settle()
      })

      button(startName).click()
      const origin = await graded

      const pending = [...msTimes]
        .sort((a, b) => a - b)
        .map(
          (ms) =>
            new Promise<void>((resolve) => {
              const fire = (): void => {
                button('Ride').dispatchEvent(
                  new PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                    pointerId: 1,
                    pointerType: 'mouse',
                    isPrimary: true,
                  }),
                )
                resolve()
              }
              const delay = origin + ms - performance.now()
              if (delay <= 0) fire()
              else setTimeout(fire, delay)
            }),
        )

      await Promise.all(pending)
      await new Promise((resolve) => setTimeout(resolve, 250))
    },
    { msTimes: [...msTimes], startName },
  )
}

/**
 * Jazz ride step 1's ride pattern (1, 2, 2&, 3, 4, 4&), SWUNG at 67% eighth,
 * at the trainer's default 80 bpm (msPerTick = 1.5625). The nominal ticks are
 * 0, 480, 720, 960, 1440, 1680; `swungTick`'s rule (proved in `swing.test.ts`
 * against `grid.ts`'s own `subdivisionCellTick`) only moves the "&"s (the
 * second cell of each swing pair): 720 -> 802, 1680 -> 1762 ticks — NOT the
 * 800/1760 a naive 2:1 triplet-swing approximation would suggest. Beats
 * (0, 480, 960, 1440) are pair starts and stay put.
 */
const JAZZ_RIDE_SWUNG_TICKS = [0, 480, 802, 960, 1440, 1762] as const
const JAZZ_MS_PER_TICK = 1.5625
const JAZZ_RIDE_IN_BAR = JAZZ_RIDE_SWUNG_TICKS.map((t) => t * JAZZ_MS_PER_TICK)

// @serial — plays a whole two-bar pass in real time; see the note on the specs above.
test('Jazz ride lists its six fixed steps, hides the groove picker, and a swung ride pass grades steady (roadmap DR-15) @serial', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await page.goto('/drums/coordination')
  await expect(page.getByRole('heading', { level: 1, name: 'Coordination' })).toBeVisible()

  await page.getByRole('radio', { name: 'Jazz ride' }).click()
  await expect(page.getByRole('radio', { name: 'Jazz ride' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('combobox', { name: 'Groove' })).not.toBeVisible()

  const stepButtons = steps(page)
  await expect(stepButtons).toHaveCount(6)
  const labels = await stepButtons.allTextContents()
  expect(labels).toEqual([
    'Jazz ride — ride alone',
    'Jazz ride — ride and hi-hat foot',
    'Jazz ride — comp on the & of 2',
    'Jazz ride — comp on 4',
    'Jazz ride — comp on the & of 1 and the & of 3',
    'Jazz ride — comp on 2 and the & of 4',
  ])
  await expect(stepButtons.nth(0)).toBeEnabled()
  await expect(stepButtons.nth(0)).toHaveAttribute('aria-current', 'step')
  await expect(stepButtons.nth(1)).toBeDisabled()

  // Both graded bars of step 1 ("ride alone"), hit at the SWUNG instants.
  const msTimes = [...JAZZ_RIDE_IN_BAR, ...JAZZ_RIDE_IN_BAR.map((ms) => ms + BAR_MS)]
  await playRideHits(page, msTimes)

  await expect(result(page).getByText('Steady — next step unlocked')).toBeVisible()
  await expect(stepButtons.nth(1)).toBeEnabled()
  await expect(stepButtons.nth(1)).toHaveAttribute('aria-current', 'step')

  expect(consoleErrors).toEqual([])
})
