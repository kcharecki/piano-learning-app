import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Returning to Practice with a large score already loaded (2026-08-15 perf
 * round). Reported from the running app: "navigating to Practice takes 2s".
 *
 * Practice is a destination the learner leaves and comes back to constantly —
 * check the metronome, look a chord up in Lessons, come back — and every
 * return unmounted and rebuilt the whole engraving. Measured on this same
 * Canon in D import (102 measures, 1603 notes, 563KB of MusicXML), a return
 * visit cost 2667ms of main thread, made of FOUR full OSMD engraves at ~550ms
 * each where one was needed, and then not even one after the cache landed:
 *
 * ```
 *                                                    return-to-Practice
 * before                                                   2667ms
 * + autoResize off (OSMD's own post-construction render)    1490ms
 * + StrictMode's orphaned second engrave abandoned           933ms
 * + engraving cache (no parse, no layout, no cursor walk)    107ms
 * ```
 *
 * The budget below sits an order of magnitude under the reported number and
 * several times over the measured one, so it fails on any of the three
 * regressions above without being sensitive to machine speed.
 *
 * The FIRST visit is deliberately not budgeted here: it is dominated by
 * parsing 563KB of MusicXML and laying out 102 measures, which is real work
 * that has to happen once. This spec is about the times after that.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'canon-in-d.mxl')

/** Measured at 107ms on the dev machine; 2667ms before the fixes. */
const RETURN_BUDGET_MS = 800

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

test('returning to Practice with a 102-measure score loaded re-shows it without re-engraving it', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors = collectErrors(page)

  await page.goto('/')
  const nav = page.getByRole('navigation', { name: /main/i })
  await nav.getByRole('button', { name: 'Practice', exact: true }).click()

  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: 'Canon in D' })).toBeVisible({ timeout: 60_000 })
  const scoreSvg = page.locator('[data-testid="score-container"] svg')
  await expect(scoreSvg).toBeVisible({ timeout: 60_000 })
  // How many systems the first engrave produced, so the return visit can be
  // shown to display the SAME complete score rather than an empty or partial
  // one that merely satisfies "an svg is visible".
  const engravedGroups = await scoreSvg.locator('g').count()
  expect(engravedGroups).toBeGreaterThan(0)

  await nav.getByRole('button', { name: 'Metronome', exact: true }).click()
  await expect(page.locator('[data-testid="score-container"]')).toHaveCount(0)

  const start = Date.now()
  await nav.getByRole('button', { name: 'Practice', exact: true }).click()
  await expect(scoreSvg).toBeVisible({ timeout: 60_000 })
  const returnMs = Date.now() - start

  console.warn(JSON.stringify({ returnMs }, null, 2))

  expect(await scoreSvg.locator('g').count()).toBe(engravedGroups)
  expect(returnMs).toBeLessThan(RETURN_BUDGET_MS)

  // The reused engraving must still be playable, not just visible: the
  // transport drives the same cursor the first visit walked.
  await page.getByRole('group', { name: 'Transport' }).getByRole('button', { name: 'Play', exact: true }).click()
  await expect(async () => {
    const text = (await page.getByLabel('Position').textContent()) ?? ''
    expect(text).not.toMatch(/Measure 1\b.*beat 1\b/)
  }).toPass({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByLabel('Position')).toContainText('Measure 1')

  expect(errors).toEqual([])
})
