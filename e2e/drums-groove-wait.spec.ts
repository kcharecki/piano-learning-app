import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap DR-09 "wait mode" — no clock, no click track, no
 * grading; the run advances only when the learner has struck every pad
 * written on the current instant. The state machine itself is proven against
 * `fast-check` in `wait.test.ts`, and the wiring (switch, disabled controls,
 * status text, required-pad ring) is proven with fake timers in
 * `GrooveTrainerScreen.test.tsx`; what only a real browser run can show is
 * that clicking the actual pads in the actual screen — no timing driver
 * needed, since wait mode has no clock to be paced against — walks the run
 * from the first step to Done exactly the way a learner clicking along
 * would experience it.
 *
 * Quarter-Note Rock at 80 bpm (the default groove — no navigation needed)
 * has 8 unison steps: hi-hat on every quarter, paired with the kick on
 * beats 1 and 3 and the snare on beats 2 and 4. The trainer's own display
 * order (`padOrderIndex`) names the kick/snare before "Hi-hat", not after —
 * verified directly against `waitSteps`/`sortPadsForDisplay` in
 * `wait.test.ts` and `waitText.test.ts` rather than assumed here.
 */

function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

function runState(page: Page) {
  return page.getByRole('status', { name: 'Run state' })
}

async function openGrooveTrainer(page: Page): Promise<void> {
  await page.goto('/drums/today')
  await mainNav(page).getByRole('button', { name: 'Groove', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Groove trainer' })).toBeVisible()
  await expect(page.getByText('Quarter-Note Rock', { exact: true })).toBeVisible()
}

/** Same console-clean capture as `drums-groove-mute.spec.ts`. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/**
 * Every step of Quarter-Note Rock at 80 bpm pairs the hi-hat with the kick
 * (odd steps) or the snare (even steps) — see the file header. Clicking both
 * accessible-named pad buttons for a step, in either order, always satisfies
 * it.
 */
function padsForStep(stepIndex: number): readonly [string, string] {
  return stepIndex % 2 === 0 ? ['Kick', 'Hi-hat'] : ['Snare', 'Hi-hat']
}

test('Wait mode walks the run one unison step at a time, in the order the pads are actually struck (roadmap DR-09 "wait mode")', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await openGrooveTrainer(page)

  const waitSwitch = page.getByRole('switch', { name: 'Wait' })
  await waitSwitch.click()
  await expect(waitSwitch).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: 'Loop' })).toBeDisabled()

  await page.getByRole('button', { name: 'Start' }).click()
  await expect(runState(page)).toHaveText('Waiting for Kick + Hi-hat — bar 1, beat 1 (step 1 of 8)')

  // A stroke on a pad the current step does not need is inert: it does not
  // advance, and it does not change what the run is still waiting for.
  await page.getByRole('button', { name: 'Snare' }).click()
  await expect(runState(page)).toHaveText('Waiting for Kick + Hi-hat — bar 1, beat 1 (step 1 of 8)')

  // Striking one of the two required pads narrows the text to what's left.
  await page.getByRole('button', { name: 'Hi-hat' }).click()
  await expect(runState(page)).toHaveText('Waiting for Kick — bar 1, beat 1 (step 1 of 8)')

  await page.getByRole('button', { name: 'Kick' }).click()
  await expect(runState(page)).toHaveText('Waiting for Snare + Hi-hat — bar 1, beat 2 (step 2 of 8)')

  // Drive the remaining 6 steps to completion — bounded loop; every click is
  // followed by the status line it must produce, so a lost stroke fails
  // here, on the exact click, not at the end.
  for (let index = 1; index < 8; index += 1) {
    const [a, b] = padsForStep(index)
    const where = `bar ${Math.floor(index / 4) + 1}, beat ${(index % 4) + 1} (step ${index + 1} of 8)`
    await expect(runState(page)).toHaveText(`Waiting for ${a} + ${b} — ${where}`)
    await page.getByRole('button', { name: a }).click()
    await expect(runState(page)).toHaveText(`Waiting for ${b} — ${where}`)
    await page.getByRole('button', { name: b }).click()
  }

  await expect(runState(page)).toHaveText(
    'Done — every stroke landed. Start again or switch Wait off for a graded run.',
  )
  await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled()

  expect(errors).toEqual([])
})
