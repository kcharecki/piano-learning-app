import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E smoke suite (roadmap 1.19). Thin on purpose: this only proves the app
 * boots in a real browser and the pieces built in 1.17/1.18 are wired
 * together. All behavioural depth (matching, SRS, generation, timing math)
 * lives in the fast `core`/`ui` vitest suites — see docs/ARCHITECTURE.md.
 */

/** Console/page errors, collected from the moment the page is created. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('the app boots with no console errors and renders the shell', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/')

  await expect(page.getByRole('navigation', { name: /main/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Practice', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('button', { name: 'Sight reading' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Theory' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Progress' })).toBeVisible()

  expect(errors).toEqual([])
})

test('the Practice nav destination actually renders the practice screen — score and transport together', async ({
  page,
}) => {
  // This is the regression test for a real defect: the practice screen was
  // built, unit-tested and committed while nothing in the shell rendered it,
  // so it was unreachable from the running app. Asserting on the score AND
  // the transport controls appearing together, reached the way a user
  // reaches them (through the shell's own nav button, not a direct mount),
  // fails loudly if that screen is ever unwired again.
  await page.goto('/')

  await page.getByRole('button', { name: 'Practice', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()
  await expect(page.getByTestId('score-container').locator('svg')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Transport' })).toBeVisible()
})

test('the bundled sample score loads and OSMD renders real notation', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  // OSMD draws the score as SVG. A real render of this piece produces ~700
  // nested elements (staff lines, noteheads, stems, beams, ...) — happy-dom
  // can't run OSMD at all, so this element count is the actual proof the
  // viewer works, not just that it was asked to. 50 is a real discriminator,
  // not an arbitrary one: checked directly against OSMD, a degenerate render
  // (e.g. a score whose notes were all silently dropped and rendered as
  // rests) produces ~25-35 elements, and a hard failure (malformed input OSMD
  // refuses to load) produces no <svg> at all, which fails the visibility
  // assertion below before the count is even reached.
  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible()
  const renderedElementCount = await container.locator('svg *').count()
  expect(renderedElementCount).toBeGreaterThan(50)
})

test('pressing play advances the position readout, and pause stops it', async ({ page }) => {
  await page.goto('/')

  const transport = page.getByRole('group', { name: 'Transport' })
  const position = transport.getByLabel('Position')

  // The readout already reads "Measure 1, beat 1 of 4" — not the em dash —
  // the instant the transport is built, before Play is ever pressed (mount
  // effects call setDisplay against the stopped transport at tick 0). So the
  // only real proof of a running transport is that the text CHANGES after
  // Play, not that it differs from some assumed idle placeholder.
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  const justAfterPlay = await position.textContent()

  // The bundled sample is 100bpm (600ms/beat). Give it more than a full beat
  // so this can't pass on a dead pump that never advances.
  await expect(async () => {
    expect(await position.textContent()).not.toBe(justAfterPlay)
  }).toPass({ timeout: 5_000 })

  await transport.getByRole('button', { name: 'Pause', exact: true }).click()
  const afterPause = await position.textContent()
  // Wait more than a full beat (600ms) before asserting it froze — anything
  // shorter has a real chance of landing inside the same beat even when
  // pause is a complete no-op, which is exactly how this assertion used to
  // pass against a broken pause roughly half the time.
  await page.waitForTimeout(1_000)
  await expect(position).toHaveText(afterPause ?? '')
})

test('setting a loop range and enabling looping is reflected in the UI', async ({ page }) => {
  await page.goto('/')

  const loopRange = page.getByRole('group', { name: 'Loop range' })
  await loopRange.getByLabel('From measure').fill('2')
  await loopRange.getByLabel('to measure').fill('4')
  const loopToggle = loopRange.getByRole('checkbox', { name: 'Loop' })
  await loopToggle.check()

  await expect(loopRange.getByLabel('From measure')).toHaveValue('2')
  await expect(loopRange.getByLabel('to measure')).toHaveValue('4')
  await expect(loopToggle).toBeChecked()
})

test('looping bars 3-4 does not report the bars before the loop as missed on every wrap (roadmap 1.22)', async ({
  page,
}) => {
  // The proof action for 1.22, and the only place it can be proved end to end:
  // it needs a real running transport (requestAnimationFrame) driving a real
  // matcher. Before `reset(fromTick)`, every wrap rewound the matcher to bar one
  // and the next cursor move closed the windows of ALL of bars 1-2 in a single
  // batch — the missed count jumped by a whole prefix of the score, once per
  // repetition, and the accuracy readout collapsed.
  test.setTimeout(45_000)

  await page.goto('/')

  const loopRange = page.getByRole('group', { name: 'Loop range' })
  await loopRange.getByLabel('From measure').fill('3')
  await loopRange.getByLabel('to measure').fill('4')
  await loopRange.getByRole('checkbox', { name: 'Loop' }).check()

  const transport = page.getByRole('group', { name: 'Transport' })
  const position = transport.getByLabel('Position')
  const missed = page.getByTestId('feedback-missed')

  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  // Sample position and missed together until two wraps have been observed. A
  // wrap is the position going back to measure 3 after reaching measure 4.
  const samplesAfterWrap: number[] = []
  let previousMeasure = 3
  let wraps = 0
  const deadline = Date.now() + 30_000
  while (wraps < 2 && Date.now() < deadline) {
    const text = (await position.textContent()) ?? ''
    const measure = Number(text.match(/Measure (\d+)/)?.[1] ?? '0')
    if (previousMeasure === 4 && measure === 3) {
      wraps += 1
      samplesAfterWrap.push(Number((await missed.textContent()) ?? '0'))
    }
    previousMeasure = measure
    await page.waitForTimeout(100)
  }

  expect(wraps, 'the loop never wrapped — the transport was not running').toBe(2)
  // Bars 1-2 of the bundled sample hold 7 notes, so the old behaviour showed at
  // least 7 the instant a wrap happened. Nothing is being played, so the loop's
  // own notes accrue at one per 600ms beat: within 100ms of the wrap at most one
  // of them can legitimately have closed. 4 sits clear of both.
  for (const value of samplesAfterWrap) expect(value).toBeLessThan(4)
})

test('the app stays usable with no MIDI keyboard connected', async ({ page }) => {
  // Playwright's Chromium has no MIDI device attached, so the app's own
  // "no hardware" fallback is exactly what a real, honest run exercises —
  // there is nothing to grant permission to and nothing to fake.
  const errors = collectErrors(page)

  await page.goto('/')

  await expect(page.getByText(/no midi keyboard connected/i)).toBeVisible()
  await expect(page.getByRole('group', { name: 'Transport' })).toBeVisible()

  expect(errors).toEqual([])
})

test('the Sight reading nav destination renders the real trainer, plays a full exercise, and grades it (roadmap 2.12)', async ({
  page,
}) => {
  // Regression test for the same class of defect `smoke.spec.ts` already
  // guards against for Practice (roadmap-1.18): a screen built and unit
  // tested in isolation but never mounted by the shell is unreachable. This
  // drives the whole discipline for real — preview, play, grade — the way a
  // learner actually would, through the nav button, not a direct mount.
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Sight reading', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Sight reading' })).toBeVisible()
  await expect(page.getByTestId('sight-reading-level')).toHaveText('Level 1')

  await page.getByRole('button', { name: 'Start exercise' }).click()
  await expect(page.getByTestId('preview-countdown')).toBeVisible()

  // The proof action for roadmap 2.20(a). The preview used to be a TEXT list
  // reading "C4 (quarter), D4 (quarter)" — no key signature, no time
  // signature, no bar lines, and the answer handed to the learner in letters.
  // It is now the generated exercise engraved by OSMD, so: a real <svg> with
  // enough elements to be a genuine render (the 50-element discriminator this
  // file establishes above), and no note name anywhere in the preview.
  const preview = page.getByRole('region', { name: 'Preview' })
  await expect(preview.getByTestId('score-container').locator('svg')).toBeVisible()
  expect(await preview.getByTestId('score-container').locator('svg *').count()).toBeGreaterThan(50)
  expect(await preview.innerText()).not.toMatch(/\b[A-G]#?[0-9]\b/)

  await page.getByRole('button', { name: 'Begin now' }).click()
  await expect(page.getByTestId('playing-status')).toBeVisible()

  // A level-1 exercise is always 4 bars of 4/4 at 120bpm (defaultParamsForLevel
  // fixes the shape; only the rng-drawn pitches vary) — exactly 8s, so the run
  // finishes and is graded well inside this test's own timeout.
  await expect(page.getByTestId('sight-reading-accuracy')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Next exercise' })).toBeVisible()

  expect(errors).toEqual([])
})

test('the Flashcards nav destination renders a real, unlabelled staff prompt and grades an on-screen answer (roadmap 2.12)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Flashcards', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()
  const staffNote = page.getByTestId('staff-note')
  await expect(staffNote).toBeVisible()
  // Real, computed notation — not text naming the answer.
  await expect(staffNote).not.toContainText(/[A-G]/)

  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
  const firstKey = keyboard.getByRole('button').first()
  await expect(firstKey).toHaveText('')
  await firstKey.click()

  await expect(page.getByTestId('flashcard-feedback')).toBeVisible()
  await expect(page.getByTestId('flashcard-stats-total')).toHaveText('1')

  expect(errors).toEqual([])
})
