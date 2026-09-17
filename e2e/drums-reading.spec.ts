import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap DR-11 — the rhythm reading trainer at
 * `/drums/reading`. Written against the contract this slice shipped
 * against; if the shell has not wired the route yet, every assertion below
 * fails at the first `goto` and the runner should report that as "unrun
 * (route pending)", not as a broken feature.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/screens.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** Every notehead's x-position, read straight off its stem. */
async function noteXs(page: Page): Promise<number[]> {
  const xs = await page.locator('.groove-note .groove-stem').evaluateAll((lines) =>
    lines.map((line) => Number(line.getAttribute('x1'))),
  )
  return xs
}

/** Every count-row label's x-position, one per beat in the bar. */
async function countXs(page: Page): Promise<number[]> {
  const xs = await page.locator('.groove-count').evaluateAll((labels) =>
    labels.map((label) => Number(label.getAttribute('x'))),
  )
  return xs
}

/**
 * `@serial` (roadmap DR-11 review, Minor b): the tap pad's lit state is
 * driven by a 90 ms `setTimeout` (`ReadingTrainerScreen.tsx`'s `useFlash`),
 * and asserting `data-lit` right after the click races that timer under
 * parallel-run scheduler jitter. `scripts/e2e-gate.mjs` runs `@serial`-tagged
 * specs outside the parallel pass — see `e2e/osmd-teardown.spec.ts` and
 * `e2e/rhythm-live-feedback.spec.ts` for the same reasoning.
 */
test('the rhythm reading trainer draws a level-1 exercise on the beat grid, taps register, and Next exercise redraws (roadmap DR-11) @serial', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/drums/reading')
  await expect(page.getByRole('heading', { name: 'Rhythm reading' })).toBeVisible()

  // A fresh learner starts at level 1 — the level line names it in words too,
  // not just the number, since that is the only place `describeReadingLevel`
  // ever reaches the screen.
  await expect(page.getByRole('status', { name: 'Level' })).toHaveText(/^Level 1 — /)

  const staff = page.getByRole('img')
  await expect(staff).toBeVisible()
  const staffIdBefore = await staff.getAttribute('data-groove-staff')

  // Level 1 is quarters-only (`describeReadingLevel(1)`: "one note or one
  // silence per beat") — every notehead the staff drew must sit exactly on a
  // beat, i.e. share an x with one of the count row's own labels. A note
  // drawn at any subdivision the count row does not label would fail this.
  const notes = await noteXs(page)
  expect(notes.length).toBeGreaterThan(0)
  const counts = await countXs(page)
  expect(counts.length).toBeGreaterThan(0)
  for (const noteX of notes) {
    expect(counts.some((countX) => Math.abs(countX - noteX) < 0.01)).toBe(true)
  }

  // Only one tap target exists — pad identity is not part of this drill.
  const tapPad = page.getByRole('button', { name: 'Tap' })
  await expect(tapPad).toBeVisible()
  await expect(page.getByRole('button', { name: /^(Kick|Snare|Hi-hat|Open hi-hat)$/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('status', { name: 'Run state' })).toHaveText(/^Counting in/)
  await tapPad.click()
  await expect(tapPad).toHaveAttribute('data-lit', 'true')

  // Next exercise is disabled for as long as a run is live (`busy` in
  // `ReadingTrainerScreen.tsx`) — Stop it explicitly rather than letting
  // Playwright sit out the ~9 s the count-in and graded bars would otherwise
  // take to finish on their own.
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('status', { name: 'Run state' })).toHaveText('Ready when you are')

  // Next exercise redraws the staff — a different `grooveId`, proving the
  // control is wired to the generator rather than merely resetting the view.
  await page.getByRole('button', { name: 'Next exercise' }).click()
  const staffIdAfter = await staff.getAttribute('data-groove-staff')
  expect(staffIdAfter).not.toBe(staffIdBefore)

  expect(errors).toEqual([])
})
