import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { playGrooveHits, worstDriverDriftMs, type TimedHit } from './drum-pads.ts'

/**
 * `/improve-app` run 2026-08-21-1 — the **held-out goal**, written into
 * `runs/2026-08-21-1/design.md` before the build and never shed:
 *
 * > the same screen grades `moneyBeatOpenHat()` at 70 bpm.
 *
 * It is held out because everything the slice was built and reviewed against
 * is the money beat at 80 bpm. This groove puts an **open** hi-hat on the "and"
 * of 4 — a different pad (`hhOpen`) at a tick where the money beat has a closed
 * one, so the trainer has to show four rows and grade four limbs — and 70 bpm
 * is a tempo nothing in the slice hardcodes. Passing here is what separates a
 * capability from a fixture.
 *
 * Every instant below is a literal, computed from the tempo by hand, exactly
 * as in the claim spec. Nothing is read from `referenceGrooves.ts` or from any
 * store the app also grades against.
 *
 * 70 bpm: a quarter is 60000/70 = 857.142857 ms and an eighth is 428.571429 ms,
 * so one 4/4 bar is 3428.571429 ms. The trainer counts in one bar and grades
 * two, so bar two is bar one plus one bar.
 */

const EIGHTH_MS = 60_000 / 70 / 2
const BAR_MS = EIGHTH_MS * 8
const BAR_STARTS = [0, BAR_MS] as const

/** Closed hat on 1 & 2 & 3 & 4 — but NOT on the last "and", which is open. */
const CLOSED_HAT_IN_BAR = [0, 1, 2, 3, 4, 5, 6].map((eighth) => eighth * EIGHTH_MS)
const OPEN_HAT_IN_BAR = [7 * EIGHTH_MS]
const KICK_IN_BAR = [0, 4 * EIGHTH_MS]
const SNARE_IN_BAR = [2 * EIGHTH_MS, 6 * EIGHTH_MS]

function acrossBothBars(inBar: readonly number[]): number[] {
  return BAR_STARTS.flatMap((bar) => inBar.map((ms) => bar + ms))
}

const CORRECT: readonly TimedHit[] = [
  ...acrossBothBars(CLOSED_HAT_IN_BAR).map((ms) => ({ pad: 'hihat' as const, ms })),
  ...acrossBothBars(OPEN_HAT_IN_BAR).map((ms) => ({ pad: 'openhat' as const, ms })),
  ...acrossBothBars(KICK_IN_BAR).map((ms) => ({ pad: 'kick' as const, ms })),
  ...acrossBothBars(SNARE_IN_BAR).map((ms) => ({ pad: 'snare' as const, ms })),
]

/**
 * The generalisation trap. Same instants, same per-pad counts — but the two
 * open-hat strokes are played on the closed hat and two closed-hat strokes are
 * played open. A trainer that treats the hi-hat as one limb passes this; one
 * that grades `hhOpen` as its own pad, which is what the claim says it does,
 * must fail it.
 */
const HAT_CONFUSED: readonly TimedHit[] = [
  ...acrossBothBars(CLOSED_HAT_IN_BAR.slice(0, 5)).map((ms) => ({ pad: 'hihat' as const, ms })),
  ...acrossBothBars(CLOSED_HAT_IN_BAR.slice(5)).map((ms) => ({ pad: 'openhat' as const, ms })),
  ...acrossBothBars(OPEN_HAT_IN_BAR).map((ms) => ({ pad: 'hihat' as const, ms })),
  ...acrossBothBars(KICK_IN_BAR).map((ms) => ({ pad: 'kick' as const, ms })),
  ...acrossBothBars(SNARE_IN_BAR).map((ms) => ({ pad: 'snare' as const, ms })),
]

const MAX_DRIVER_DRIFT_MS = 25

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function result(page: Page) {
  return page.getByRole('region', { name: 'Result' })
}

/**
 * Reached the way a learner reaches it, from the drums nav and through the
 * picker — no URL, no injected state, no `initialGrooveId`. "Unaided" is the
 * point of a held-out goal.
 */
async function openTheOpenHatGrooveAt70(page: Page): Promise<void> {
  await page.goto('/drums/today')
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Groove', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()

  // Two steps along the easiest-first picker: Quarter-Note Rock -> Money Beat
  // -> Money Beat (Open Hat).
  await page.getByRole('button', { name: 'Next groove' }).click()
  await page.getByRole('button', { name: 'Next groove' }).click()
  await expect(page.getByText('Money Beat (Open Hat)', { exact: true })).toBeVisible()

  const tempo = page.getByRole('spinbutton', { name: /tempo/i })
  await tempo.fill('70')
  await tempo.press('Enter')
  await expect(page.getByText(/at 70 bpm/)).toBeVisible()
}

test('held-out goal: the trainer grades Money Beat (Open Hat) at 70 bpm, open hat on its own row', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await openTheOpenHatGrooveAt70(page)

  // Four pads, because this groove uses four. The open hat is not a mode of
  // the closed one.
  for (const pad of ['Hi-hat', 'Open hi-hat', 'Snare', 'Kick']) {
    await expect(page.getByRole('button', { name: pad, exact: true })).toBeVisible()
  }

  const dispatched = await playGrooveHits(page, CORRECT)
  expect(dispatched).toHaveLength(24)
  expect(worstDriverDriftMs(dispatched)).toBeLessThan(MAX_DRIVER_DRIFT_MS)

  await expect(result(page)).toBeVisible()
  await expect(result(page).getByText('Steady run')).toBeVisible()
  await expect(result(page).getByText(/^Hi-hat — 14 of 14, /)).toBeVisible()
  await expect(result(page).getByText(/^Open hi-hat — 2 of 2, /)).toBeVisible()
  await expect(result(page).getByText(/^Snare — 4 of 4, /)).toBeVisible()
  await expect(result(page).getByText(/^Kick — 4 of 4, /)).toBeVisible()
  await expect(result(page).getByText(/missed/)).toHaveCount(0)
  await expect(result(page).getByText(/extra/)).toHaveCount(0)

  expect(errors).toEqual([])
})

test('held-out goal, generalisation trap: hats played open where they should be closed is not steady, and both hat rows say so', async ({
  page,
}) => {
  const errors = collectErrors(page)

  // Same instants and same total count as the correct run — only which hat
  // sounded when differs.
  expect(HAT_CONFUSED).toHaveLength(CORRECT.length)
  expect(HAT_CONFUSED.map((h) => h.ms).sort((a, b) => a - b)).toEqual(
    CORRECT.map((h) => h.ms).sort((a, b) => a - b),
  )

  await openTheOpenHatGrooveAt70(page)

  const dispatched = await playGrooveHits(page, HAT_CONFUSED)
  expect(worstDriverDriftMs(dispatched)).toBeLessThan(MAX_DRIVER_DRIFT_MS)

  await expect(result(page)).toBeVisible()
  await expect(result(page).getByText('Steady run')).toHaveCount(0)
  await expect(result(page).getByText('Not there yet')).toBeVisible()

  // Both hat rows are named, because both were wrong in different ways.
  await expect(result(page).getByText(/^Hi-hat — .*missed/)).toBeVisible()
  await expect(result(page).getByText(/^Open hi-hat — .*extra/)).toBeVisible()

  // The limbs that played correctly are not blamed for it.
  await expect(result(page).getByText(/^Snare — 4 of 4, /)).toBeVisible()
  await expect(result(page).getByText(/^Kick — 4 of 4, /)).toBeVisible()

  expect(errors).toEqual([])
})
