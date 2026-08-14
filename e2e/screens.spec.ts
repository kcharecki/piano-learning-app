import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof that the Phase 3 / Phase 4 screens are REACHABLE AND ALIVE
 * (roadmap 3.8, 3.9, 3.10, 4.7, 4.7a). Eleven core modules sat finished,
 * tested and unreachable behind knip ignores until these screens landed, and
 * this project's most expensive defect class is precisely a screen that
 * renders and does nothing — so every assertion here is on an OUTPUT that
 * changed, never on an element merely being present.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function nav(page: Page, label: string) {
  return page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true })
}

test('the Theory destination drives the reference from the circle of fifths (roadmap 3.8/3.9)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Theory').click()

  // `exact` because the Theory destination now also holds the "Theory drills"
  // panel (roadmap 3.3), and a substring match resolves to both headings.
  await expect(page.getByRole('heading', { name: 'Theory', exact: true })).toBeVisible()

  // Roadmap UI-17: the circle and the reference are now on separate tabs
  // (only the active tab is mounted, per TheoryScreen.tsx's module doc — so
  // both can never be on screen at once) but still drive the same
  // root/scaleType state underneath, which is the thing this test actually
  // proves: switching tabs must not reset what the circle picked.
  const tabs = page.getByRole('tablist', { name: 'Theory tools' })
  const reference = page.getByRole('region', { name: /chord.*scale reference/i })

  // C major is the default: its scale has no accidentals. Selecting G major on
  // the circle must change what the reference shows on the OTHER tab —
  // asserting the reference merely exists would pass against a circle wired
  // to nothing.
  await tabs.getByRole('tab', { name: 'Scales & chords' }).click()
  const before = await reference.innerText()

  await tabs.getByRole('tab', { name: 'Circle of fifths' }).click()
  await page.getByRole('button', { name: /^G major/ }).click()

  await tabs.getByRole('tab', { name: 'Scales & chords' }).click()
  await expect(async () => {
    expect(await reference.innerText()).not.toBe(before)
  }).toPass({ timeout: 5_000 })
  // G major's own content: an F# in the scale, and the roman numerals of its
  // diatonic chords.
  await expect(reference).toContainText('F#')
  await expect(reference).toContainText('V')

  expect(errors).toEqual([])
})

test('the looked-up scale is engraved as real staff notation (roadmap 3.14, REQ-3.5.3/3.5.4)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Theory').click()
  // Roadmap UI-17: the reference (and this scale staff) live behind the
  // "Scales & chords" tab now — Drills is the default tab, not this.
  await page.getByRole('tab', { name: 'Scales & chords' }).click()

  // A real OSMD render is well past the 50-element discriminator this suite
  // uses (see round6.spec.ts) — a text list of note names, which is what the
  // reference showed before 3.14, is not.
  const staff = page.locator('.scale-staff')
  await expect(staff.locator('svg')).toBeVisible({ timeout: 15_000 })
  expect(await staff.locator('svg *').count()).toBeGreaterThan(50)

  // The engraving must follow the lookup, not sit frozen on the default. C
  // major has no key signature at all, so VexFlow draws no `vf-keysignature`
  // group; F# major draws one holding six sharp glyphs. Both read off the
  // rendered SVG, not off the requested scale.
  const keySignature = staff.locator('svg .vf-keysignature')
  await expect(keySignature).toHaveCount(0)

  await page.getByLabel('Root', { exact: true }).selectOption({ label: 'F#' })
  await expect(staff).toHaveAttribute('aria-label', /F# major/, { timeout: 10_000 })
  await expect(keySignature).toHaveCount(1, { timeout: 10_000 })
  expect(await keySignature.locator('path').count()).toBeGreaterThanOrEqual(6)

  // Presentation (roadmap 3.14's visual pass): this staff is READ, not played.
  // OSMD builds its playback cursor as an <img> overlay either way; showing it
  // parks a "you are here" highlight on the first note of a score nothing is
  // playing, so on a reference it must stay hidden. The part name ("Piano",
  // the only instrument this app ever engraves) must not be drawn at all.
  await expect(staff.locator('img')).toBeHidden()
  await expect(staff).not.toContainText('Piano')

  expect(errors).toEqual([])
})

test('the Ear training destination plays a prompt and grades an answer (roadmap 3.10)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Ear training').click()

  await expect(page.getByRole('heading', { name: 'Ear Training' })).toBeVisible()

  await page.getByRole('button', { name: /^Play/ }).click()

  // The answer pad is the drill's own vocabulary, and answering must produce a
  // graded result naming the right answer — not just any text.
  const pad = page.getByRole('group', { name: /answer/i })
  await pad.getByRole('button').first().click()

  const result = page.getByRole('status').filter({ hasText: /correct|it was/i })
  await expect(result.first()).toBeVisible({ timeout: 10_000 })

  expect(errors).toEqual([])
})

test('dictation states its tempo and count-in, and grades a played-back answer (roadmap 3.23, REQ-3.6.1)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Ear training').click()

  await page.locator('#eartraining-drill-select').selectOption({ label: 'Melodic dictation' })
  await page.getByRole('button', { name: /^Play/ }).click()

  // The tempo reference REQ-3.6.1 asks for, on screen rather than implied: the
  // learner is told the pulse they are answering against, and that a count-in
  // sounds first. Before roadmap 3.23 the phrase arrived cold and the answer
  // was graded against a fixed absolute tolerance.
  await expect(page.getByTestId('dictation-tempo')).toHaveText(/Tempo: \d+ bpm/)
  // Roadmap UI-13: there is no `role="region"` named "Answer" any more — the
  // count-in/tempo reference lives in the stage's own caption paragraph
  // (`.eartraining-stage-caption`, `DRILL_META['melodic-dictation'].caption`
  // in EarTrainingScreen.tsx).
  await expect(page.locator('.eartraining-stage-caption')).toContainText('count-in')

  // Answering must reach the grader. The generated phrase is unknown to this
  // spec, so what is asserted is that a submitted answer is GRADED — a verdict
  // plus the note-by-note breakdown — not that it is right. Whether a correct
  // answer played at a different tempo still grades correct is asserted where
  // the tempo fit lives, over 900 generated cases, in dictation.test.ts.
  const pad = page.getByRole('group', { name: /keyboard/i })
  await pad.getByRole('button').first().click()
  await expect(page.getByText(/1 notes? recorded/)).toBeVisible()

  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByTestId('eartraining-feedback')).toBeVisible({ timeout: 10_000 })

  expect(errors).toEqual([])
})

test('the Progress dashboard shows honest zeros before any practice (roadmap 4.7)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Progress').click()

  // `exact` because the dashboard now also holds "Export & restore progress"
  // (roadmap 4.6a).
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()
  // REQ-3.10.1's six sections must all be present and populated with real
  // numbers — a blank panel or a fabricated placeholder is the failure mode.
  for (const section of [/level/i, /streak/i, /sight.read/i, /technique/i, /retention|theory/i, /repertoire/i]) {
    await expect(page.getByRole('region', { name: section }).first()).toBeVisible()
  }
  expect(errors).toEqual([])
})

test("Today's session plans to the exact budget and its items navigate (roadmap 4.7a)", async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Today').click()

  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()

  // REQ-3.1.4: the minutes shown must sum to exactly the chosen budget. Read
  // them off the screen and add them up — the arithmetic is the requirement.
  const items = page.getByRole('list', { name: 'Session items' }).getByRole('listitem')
  expect(await items.count()).toBeGreaterThan(0)
  // Roadmap UI-08: the duration badge's text is upper-cased by CSS
  // (`text-transform`), which `innerText` reflects but `textContent` does
  // not — match case-insensitively rather than depending on that styling.
  const minutes = (await items.allInnerTexts()).map(
    (text) => Number(text.match(/(\d+)\s*min/i)?.[1] ?? '0'),
  )
  const total = minutes.reduce((sum, m) => sum + m, 0)
  // `session-plan-total`'s text changed from "Total: N minutes" to "N minutes
  // planned" in the UI-08 redesign (see SessionPlanScreen.tsx's `pluralize`).
  await expect(page.getByTestId('session-plan-total')).toHaveText(`${total} minutes planned`)

  // And an item opens the drill it names, which is what makes the plan a plan
  // rather than a list.
  await page.getByRole('button', { name: /^Open/ }).first().click()
  await expect(page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: 'Today', exact: true })).not.toHaveAttribute('aria-current', 'page')

  expect(errors).toEqual([])
})
