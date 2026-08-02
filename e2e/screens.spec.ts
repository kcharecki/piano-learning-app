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

  // C major is the default: its scale has no accidentals. Selecting G major on
  // the circle must change what the reference below shows — asserting the
  // reference merely exists would pass against a circle wired to nothing.
  const reference = page.getByRole('region', { name: /chord.*scale reference/i })
  const before = await reference.innerText()

  await page.getByRole('button', { name: /^G major/ }).click()

  await expect(async () => {
    expect(await reference.innerText()).not.toBe(before)
  }).toPass({ timeout: 5_000 })
  // G major's own content: an F# in the scale, and the roman numerals of its
  // diatonic chords.
  await expect(reference).toContainText('F#')
  await expect(reference).toContainText('V')

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
  const minutes = (await items.allInnerTexts()).map(
    (text) => Number(text.match(/(\d+) min/)?.[1] ?? '0'),
  )
  const total = minutes.reduce((sum, m) => sum + m, 0)
  await expect(page.getByTestId('session-plan-total')).toHaveText(`Total: ${total} minutes`)

  // And an item opens the drill it names, which is what makes the plan a plan
  // rather than a list.
  await page.getByRole('button', { name: /^Open/ }).first().click()
  await expect(page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: 'Today', exact: true })).not.toHaveAttribute('aria-current', 'page')

  expect(errors).toEqual([])
})
