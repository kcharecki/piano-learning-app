import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { playGrooveHits, worstDriverDriftMs, type TimedHit } from './drum-pads.ts'

/**
 * `/improve-app` run 2026-08-21-1 — the claim spec for roadmap DR-09, the
 * groove trainer. Committed RED, before the implementation, and it is the
 * proof at §7 that the gap closed rather than that a screen renders.
 *
 * The gap (source 1d, class VOID): the drums side of this app teaches
 * nothing. `DRUMS_NAV_GROUPS` is literally `[]` (`src/app/shell/Shell.tsx`),
 * `/drums/today` says "Drum training is coming soon", and the one drums
 * route beyond it (`/drums/notation-dev`) is a stub with no link to it.
 * Meanwhile `src/core/drums/model/referenceGrooves.ts` already encodes
 * Rockschool Debut's core groove — closed hi-hat on every eighth, kick on 1
 * and 3, snare on 2 and 4 — and is read by nothing but a MusicXML
 * round-trip test.
 *
 * The claim this spec asserts:
 *
 * > After this ships, a learner who is on the drums side of the app with no
 * > e-kit and no drum experience will be able to practise the Rockschool
 * > Debut rock groove at their own tempo and be told which limb was off, and
 * > we will know because the learner sees a "Groove" destination in the
 * > drums nav where there was none, plays the money beat on the three pads,
 * > and the screen then shows one result line per pad naming that pad's own
 * > mean offset in milliseconds, which is still shown as the last attempt
 * > when they come back to the screen.
 *
 * ## The two arms, and why they are shaped this way
 *
 * Every hit instant below is written out as a literal. Nothing is read from
 * `referenceGrooves.ts`, from a store, or from anything else the app also
 * grades against — a grader that agrees with itself cannot pass this.
 *
 * The negative arm plays **the same 24 instants, the same 24 hits, and the
 * same number of hits per pad** as the positive arm. Only *which pad played
 * when* differs: snare and kick trade places. Onset spacing is therefore
 * byte-identical across the arms, so a grader that measures only spacing —
 * or only hit count, or only "did something land near each beat" — returns
 * the same verdict twice and fails here.
 *
 * That shape is deliberate. Run 2026-08-20-1's refutation condition was void
 * precisely because its sabotage also destroyed onset spacing, so evenness
 * collapsed to 0 before pitch was ever consulted and the condition passed
 * against broken code.
 *
 * ## Why a third run, uniformly late
 *
 * A screen that prints a hardcoded "dead on" would satisfy both arms. The
 * third run shifts every hit +55 ms — still inside the stated ±100 ms window,
 * so the verdict must stay clean — and requires the pad lines to say so. A
 * constant passes the arms and fails this.
 */

/**
 * 80 bpm: a quarter is 750 ms, an eighth is 375 ms, a 4/4 bar is 3000 ms.
 * The trainer counts in one bar and then grades two, so bar two is bar one
 * plus 3000. These literals are the whole point — see the header.
 */
const BAR_MS = 3000
const BAR_STARTS = [0, BAR_MS] as const

const HIHAT_IN_BAR = [0, 375, 750, 1125, 1500, 1875, 2250, 2625] as const
const KICK_IN_BAR = [0, 1500] as const
const SNARE_IN_BAR = [750, 2250] as const

function acrossBothBars(inBar: readonly number[]): number[] {
  return BAR_STARTS.flatMap((bar) => inBar.map((ms) => bar + ms))
}

/** The money beat, played correctly. 16 hi-hats, 4 kicks, 4 snares. */
const CORRECT: readonly TimedHit[] = [
  ...acrossBothBars(HIHAT_IN_BAR).map((ms) => ({ pad: 'hihat' as const, ms })),
  ...acrossBothBars(KICK_IN_BAR).map((ms) => ({ pad: 'kick' as const, ms })),
  ...acrossBothBars(SNARE_IN_BAR).map((ms) => ({ pad: 'snare' as const, ms })),
]

/** Identical instants and identical per-pad counts — snare and kick swapped. */
const LIMBS_SWAPPED: readonly TimedHit[] = [
  ...acrossBothBars(HIHAT_IN_BAR).map((ms) => ({ pad: 'hihat' as const, ms })),
  ...acrossBothBars(KICK_IN_BAR).map((ms) => ({ pad: 'snare' as const, ms })),
  ...acrossBothBars(SNARE_IN_BAR).map((ms) => ({ pad: 'kick' as const, ms })),
]

const UNIFORM_LATE_MS = 55
const UNIFORMLY_LATE: readonly TimedHit[] = CORRECT.map((hit) => ({
  pad: hit.pad,
  ms: hit.ms + UNIFORM_LATE_MS,
}))

/**
 * The driver dispatches from inside the page against absolute targets, so
 * this should sit in single-digit milliseconds. It is asserted so that a
 * slow CI host fails on the harness rather than being reported as the
 * learner's timing.
 */
const MAX_DRIVER_DRIFT_MS = 25

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

function result(page: Page) {
  return page.getByRole('region', { name: 'Result' })
}

/** Reach the trainer the way a learner does: from the drums nav, not by URL. */
async function openGrooveTrainer(page: Page): Promise<void> {
  await page.goto('/drums/today')
  await expect(page.getByRole('heading', { name: 'Drums — start here' })).toBeVisible()
  await mainNav(page).getByRole('button', { name: 'Groove', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/drums/groove')
}

test('the drums nav offers a Groove destination that teaches the Debut rock groove on three pads (roadmap DR-09)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await openGrooveTrainer(page)

  // The groove itself is named, and it is the money beat — not a generic
  // "practice" screen that happens to have pads on it.
  await expect(page.getByText('Money Beat')).toBeVisible()

  // Three pads, one per limb the groove uses, each reachable by its own name.
  for (const pad of ['Hi-hat', 'Snare', 'Kick']) {
    await expect(page.getByRole('button', { name: pad, exact: true })).toBeVisible()
  }

  // The persona has no e-kit: the keyboard fallback is part of the feature,
  // so the screen has to say what the keys are.
  const keyHint = page.getByText(/F.*J.*[Ss]pace/)
  await expect(keyHint).toBeVisible()

  // The tolerance is a teaching decision, not an implementation detail, so
  // it is on screen rather than buried in the grader.
  await expect(page.getByText(/within 100\s?ms/i)).toBeVisible()

  // The learner's own tempo is theirs to set, and 80 is the persona's goal.
  const tempo = page.getByRole('spinbutton', { name: /tempo/i })
  await expect(tempo).toHaveValue('80')

  expect(errors).toEqual([])
})

test('refutation condition, positive arm: the money beat played correctly at 80 bpm grades clean per pad and persists (roadmap DR-09)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await openGrooveTrainer(page)
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()

  const dispatched = await playGrooveHits(page, CORRECT)
  expect(dispatched).toHaveLength(24)
  expect(worstDriverDriftMs(dispatched)).toBeLessThan(MAX_DRIVER_DRIFT_MS)

  await expect(result(page)).toBeVisible()
  await expect(result(page).getByText('Clean run')).toBeVisible()

  // One line per pad, each naming that pad's own count and its own offset.
  await expect(result(page).getByText(/^Hi-hat — 16 of 16, /)).toBeVisible()
  await expect(result(page).getByText(/^Snare — 4 of 4, /)).toBeVisible()
  await expect(result(page).getByText(/^Kick — 4 of 4, /)).toBeVisible()

  // Nothing was missed and nothing was spurious.
  await expect(result(page).getByText(/missed/)).toHaveCount(0)
  await expect(result(page).getByText(/extra/)).toHaveCount(0)

  // The offsets are the app's own measurement of a run driven within
  // MAX_DRIVER_DRIFT_MS of the beat, so they have to be small.
  for (const pad of ['Hi-hat', 'Snare', 'Kick']) {
    const line = await result(page).getByText(new RegExp(`^${pad} — `)).innerText()
    const offset = /(\d+) ms/.exec(line)
    const reported = offset?.[1] === undefined ? 0 : Number(offset[1])
    expect(reported, `${pad} reported "${line}"`).toBeLessThanOrEqual(60)
  }

  // The attempt outlives the page: this is the run's metric
  // (`PersistedDrumsHistory.attempts`) coming back from storage, read the
  // only way a learner can read it.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()
  await expect(page.getByText(/Last run: Money Beat at 80 bpm/)).toBeVisible()

  expect(errors).toEqual([])
})

test('refutation condition, negative arm: the same 24 instants with snare and kick swapped is not clean, and the snare is named (roadmap DR-09)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  // Same instants, same hit count, same count per pad as the positive arm.
  expect(LIMBS_SWAPPED).toHaveLength(CORRECT.length)
  expect(LIMBS_SWAPPED.map((h) => h.ms).sort((a, b) => a - b)).toEqual(
    CORRECT.map((h) => h.ms).sort((a, b) => a - b),
  )
  const countByPad = (hits: readonly TimedHit[]) =>
    hits.reduce<Record<string, number>>((acc, h) => ({ ...acc, [h.pad]: (acc[h.pad] ?? 0) + 1 }), {})
  expect(countByPad(LIMBS_SWAPPED)).toEqual(countByPad(CORRECT))

  await openGrooveTrainer(page)

  const dispatched = await playGrooveHits(page, LIMBS_SWAPPED)
  expect(worstDriverDriftMs(dispatched)).toBeLessThan(MAX_DRIVER_DRIFT_MS)

  await expect(result(page)).toBeVisible()
  await expect(result(page).getByText('Clean run')).toHaveCount(0)
  await expect(result(page).getByText('Not clean yet')).toBeVisible()

  // The verdict has to name the limb, not just fail. A learner who is told
  // "not clean" and nothing else is exactly the BLIND class this pick exists
  // to close.
  await expect(result(page).getByText(/^Snare — 0 of 4, .*missed/)).toBeVisible()
  await expect(result(page).getByText(/^Kick — 0 of 4, .*missed/)).toBeVisible()

  // And the hi-hat, which played correctly in both arms, is still clean —
  // so the failure is attributed to the limbs that actually failed.
  await expect(result(page).getByText(/^Hi-hat — 16 of 16, /)).toBeVisible()

  expect(errors).toEqual([])
})

test('a run that is uniformly 55 ms late is still clean, and every pad line says late (roadmap DR-09)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await openGrooveTrainer(page)

  const dispatched = await playGrooveHits(page, UNIFORMLY_LATE)
  expect(worstDriverDriftMs(dispatched)).toBeLessThan(MAX_DRIVER_DRIFT_MS)

  await expect(result(page)).toBeVisible()
  // 55 ms is inside the stated +/-100 ms window, so the run is clean...
  await expect(result(page).getByText('Clean run')).toBeVisible()
  await expect(result(page).getByText(/^Hi-hat — 16 of 16, /)).toBeVisible()

  // ...and the offsets are measured, not printed. A screen showing a
  // constant fails here even though it passed both arms above.
  for (const pad of ['Hi-hat', 'Snare', 'Kick']) {
    const line = await result(page).getByText(new RegExp(`^${pad} — `)).innerText()
    expect(line, `${pad} reported "${line}"`).toMatch(/\d+ ms late/)
    const reported = Number(/(\d+) ms/.exec(line)?.[1] ?? 0)
    expect(reported, `${pad} reported "${line}"`).toBeGreaterThanOrEqual(25)
  }

  expect(errors).toEqual([])
})
