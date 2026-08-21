import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { techniqueDrillById } from '../src/core/technique/library.ts'

/**
 * E2E proof for roadmap T.14 — "the Progress 'Technique tempo' card flattens
 * drills with different targets onto one unlabelled line".
 *
 * The state the roadmap's regression-hunter reproduced, seeded directly: one
 * clean run of the SOLID triad sequence at its target of 72, and one clean run
 * of the BROKEN triad sequence at its target of 60, in that order. Both are
 * successes. The old card concatenated every drill's clean attempts into one
 * time-sorted `TrendChart`, so it drew 72 → 60 — a line going down, under the
 * heading "Technique clean tempo over time", with the drill id reachable only
 * through a per-point SVG tooltip and no legend anywhere.
 *
 * Seeded rather than driven because what is under test is how two drills'
 * histories are drawn together, and driving two clean technique runs would
 * spend two minutes proving something `technique-chord-window.spec.ts` already
 * drives. The write goes through the same IndexedDB collection and shape
 * `persistence.ts` writes (`techniqueHistory` / `{ attempts }`), and the page
 * is reloaded so the app's own restore path is what puts it on screen.
 */
const DB_NAME = 'piano-learning-app'
const SOLID_ID = 'triad-sequence-c-major-solid-hands-right'
const BROKEN_ID = 'triad-sequence-c-major-broken-hands-right'
const DAY_MS = 86_400_000

type SeededAttempt = {
  readonly drillId: string
  readonly at: number
  readonly bpm: number
  readonly evenness: number
  readonly accuracy: number
  readonly clean: boolean
}

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

async function seedTechniqueHistory(page: Page, attempts: readonly SeededAttempt[]): Promise<void> {
  await page.evaluate(
    ({ dbName, seeded }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('techniqueHistory', 'readwrite')
          const put = tx.objectStore('techniqueHistory').put({ attempts: seeded }, 'techniqueHistory')
          put.onerror = () => reject(put.error)
          put.onsuccess = () => resolve()
        }
      }),
    { dbName: DB_NAME, seeded: attempts },
  )
}

test('two clean runs of two drills with different targets do not read as slowing down (roadmap T.14)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)

  const solid = techniqueDrillById(SOLID_ID)
  const broken = techniqueDrillById(BROKEN_ID)
  if (solid === undefined || broken === undefined) throw new Error('expected both triad drills')
  // The whole defect depends on the two targets differing; if the library ever
  // levels them, this spec is testing nothing and should say so loudly.
  expect(solid.targetBpm).not.toBe(broken.targetBpm)

  await page.goto('/')
  const now = Date.now()
  await seedTechniqueHistory(page, [
    // The solid drill twice, so it has a trend to draw; the broken drill once,
    // most recently, which is the order that used to end the flattened line on
    // the lower number and make it read as a decline.
    {
      drillId: solid.id,
      at: now - 4 * DAY_MS,
      bpm: solid.targetBpm - 12,
      evenness: 0.93,
      accuracy: 1,
      clean: true,
    },
    {
      drillId: solid.id,
      at: now - 2 * DAY_MS,
      bpm: solid.targetBpm,
      evenness: 0.96,
      accuracy: 1,
      clean: true,
    },
    {
      drillId: broken.id,
      at: now - DAY_MS,
      bpm: broken.targetBpm,
      evenness: 0.96,
      accuracy: 1,
      clean: true,
    },
  ])
  await page.reload()
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  const card = page.getByRole('region', { name: 'Technique tempo trends' })
  await expect(card).toBeVisible()

  // Each drill is drawn on its own, named in visible text — not in a tooltip.
  const solidSeries = page.getByTestId(`dashboard-technique-series-${solid.id}`)
  const brokenSeries = page.getByTestId(`dashboard-technique-series-${broken.id}`)
  await expect(solidSeries).toBeVisible()
  await expect(brokenSeries).toBeVisible()
  await expect(solidSeries.getByRole('heading', { name: solid.title })).toBeVisible()
  await expect(brokenSeries.getByRole('heading', { name: broken.title })).toBeVisible()

  // The chart belongs to its drill by name. The old card had exactly one chart
  // called "Technique clean tempo over time" holding both drills' points; the
  // broken drill's single clean run draws no line at all, because one point is
  // a number, not a trend.
  await expect(
    card.getByRole('img', { name: `${solid.title} — clean tempo over time` }),
  ).toBeVisible()
  await expect(card.getByRole('img')).toHaveCount(1)

  // And each best reads against its OWN target, so 60 is a target met rather
  // than a fall from the other drill's 72.
  await expect(solidSeries).toContainText(
    `Best ${String(solid.targetBpm)} of ${String(solid.targetBpm)} bpm · 2 clean runs`,
  )
  await expect(brokenSeries).toContainText(
    `Best ${String(broken.targetBpm)} of ${String(broken.targetBpm)} bpm · 1 clean run`,
  )

  // The single flattened series is gone entirely.
  await expect(page.getByRole('img', { name: 'Technique clean tempo over time' })).toHaveCount(0)

  expect(errors).toEqual([])
})

test('a technique attempt that was never clean leaves the card teaching, not empty (roadmap T.14)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await seedTechniqueHistory(page, [
    { drillId: SOLID_ID, at: Date.now(), bpm: 72, evenness: 0.3, accuracy: 0.6, clean: false },
  ])
  await page.reload()
  await nav(page, 'Progress').click()

  const card = page.getByRole('region', { name: 'Technique tempo trends' })
  await expect(card).toBeVisible()
  // A chart of an unclean attempt would be a chart of a tempo never reached.
  await expect(card.getByRole('img')).toHaveCount(0)
  await expect(page.getByTestId('dashboard-technique-empty')).toContainText(
    'No clean technique run yet',
  )

  expect(errors).toEqual([])
})
