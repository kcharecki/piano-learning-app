import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { techniqueLibrary } from '../src/core/technique/library.ts'
import { MIN_LEVEL } from '../src/core/curriculum/types.ts'

/**
 * E2E proof for roadmap 2.34 (REQ-3.1.4/REQ-3.7.1). Until just now,
 * `src/app/shell/Shell.tsx` rendered `<TechniqueScreen />` with no props, so a
 * planned session's chosen technique drill (`Exercise.params.drillId`, built
 * by `src/app/session/candidates.ts`) was silently dropped — opening a
 * planned technique item always landed on the level's FIRST drill
 * (`useTechniqueDrill`'s `firstIdOf` fallback) regardless of which one the
 * plan actually named. Shell now resolves `params.drillId` through
 * `techniqueDrillById` and passes `initialDrillId`/`initialLevel` down.
 *
 * This spec drives the real "Today" plan, opens a technique item that is NOT
 * the level's first drill, and checks the Technique screen actually opened on
 * THAT drill — not merely "some drill". See the KILLER ASSERTION below for
 * exactly which mutant this catches.
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

function nav(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
}

test("opening a non-first planned technique item opens THAT drill, not the level's first one (roadmap 2.34)", async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Today').click()
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()

  // 60 minutes so the technique segment (20% of the budget by default) gets
  // at least 12 minutes — comfortably more than two 5-minute drills — instead
  // of risking a smaller default budget collapsing the segment to one item,
  // which would leave no non-first technique item to open at all.
  await page
    .getByRole('radiogroup', { name: 'Session length' })
    .getByRole('radio', { name: '60 min', exact: true })
    .click()

  const items = page.getByRole('list', { name: 'Session items' }).getByRole('listitem')
  // Segment label rendered for a technique item is exactly "Technique" (see
  // SEGMENT_LABELS in SessionPlanScreen.tsx) — no other segment's label
  // contains that text.
  const techniqueItems = items.filter({ hasText: 'Technique' })
  const techniqueItemCount = await techniqueItems.count()
  expect(
    techniqueItemCount,
    'the plan must contain at least two technique items for this test to open a non-first one',
  ).toBeGreaterThanOrEqual(2)

  // Deliberately the SECOND technique item, never the first — opening the
  // first would still pass even if Shell dropped the wiring entirely, since
  // `useTechniqueDrill` falls back to the level's first drill by default.
  const secondTechniqueItem = techniqueItems.nth(1)
  const openButton = secondTechniqueItem.getByRole('button')
  const ariaLabel = await openButton.getAttribute('aria-label')
  const match = ariaLabel === null ? null : /^Open (.+)$/.exec(ariaLabel)
  if (match?.[1] === undefined) {
    throw new Error(`could not read a planned drill title out of Open button aria-label "${ariaLabel}"`)
  }
  const plannedTitle = match[1]

  // Resolve the on-screen title back to the drill the app's own technique
  // library knows about — candidates.ts always draws technique candidates
  // from `techniqueLibrary(techniqueLevel)`, and `useSessionPlan` never
  // passes a `techniqueLevel`, so the candidates (and this title) come from
  // `MIN_LEVEL`'s library.
  const levelDrills = techniqueLibrary(MIN_LEVEL)
  expect(levelDrills.length, "MIN_LEVEL's technique library must offer more than one drill").toBeGreaterThan(1)
  const plannedDrill = levelDrills.find((d) => d.title === plannedTitle)
  if (plannedDrill === undefined) {
    throw new Error(
      `plan named technique drill "${plannedTitle}", which is not in techniqueLibrary(${MIN_LEVEL})`,
    )
  }
  const expectedIndex = levelDrills.findIndex((d) => d.id === plannedDrill.id)
  expect(
    expectedIndex,
    'the chosen (second) technique item must not be the library\'s first drill, or the killer assertion below proves nothing',
  ).not.toBe(0)

  await openButton.click()

  // The Technique screen opened, and the nav reflects it.
  await expect(page.getByRole('heading', { name: 'Technique', exact: true })).toBeVisible()
  await expect(nav(page, 'Technique')).toHaveAttribute('aria-current', 'page')

  // `initialLevel` is the second half of the wiring: a Shell that passed only
  // `initialDrillId` without the matching level would open a library that
  // does not contain that id, and `useTechniqueDrill`'s own "id absent from
  // this level's list" effect would silently fall back to that OTHER level's
  // first drill instead.
  await expect(page.getByTestId('technique-level')).toHaveText(`Level ${plannedDrill.level}`)

  const select = page.locator('#technique-drill-select')
  const optionLocators = select.locator('option')
  const optionValues = await optionLocators.evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value),
  )
  const optionLabels = await optionLocators.allTextContents()
  expect(optionValues.length, 'expected more than one option in the drill picker').toBeGreaterThan(1)

  const selectedIndex = optionValues.indexOf(plannedDrill.id)
  expect(selectedIndex, `expected drill "${plannedDrill.id}" among the picker's options`).toBeGreaterThanOrEqual(0)

  // THE KILLER ASSERTION. Reverting Shell.tsx's technique case to plain
  // `<TechniqueScreen />` drops `initialDrillId`/`initialLevel`, so
  // `useTechniqueDrill` seeds `drillId` from `firstIdOf(drills)` — always
  // index 0 of the level's library, regardless of which drill the plan
  // named. We deliberately opened the plan's SECOND technique item
  // (`expectedIndex !== 0`, asserted above), so a correctly-wired Shell must
  // select option index >= 1; the reverted Shell would instead always select
  // index 0, failing this assertion.
  expect(
    selectedIndex,
    `expected the picker to open on the planned drill "${plannedTitle}" (library index ${expectedIndex}), not fall back to the level's first drill (index 0)`,
  ).not.toBe(0)
  expect(selectedIndex).toBe(expectedIndex)

  // The on-screen plan title resolved back to the selected option's own label.
  expect(optionLabels[selectedIndex]?.trim()).toBe(plannedTitle)
  await expect(select).toHaveValue(plannedDrill.id)

  expect(errors).toEqual([])
})
