import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.57: the M5 review drove a single session where the
 * Progress screen read "Sight-reading: level 4 (overridden)" while the Sight
 * reading screen read "Level 1" — two different numbers (the curriculum
 * TRACK level, `useLevelStore`/`levelState`, versus the sight-reading
 * trainer's own ADAPTIVE level, `useSightReadingStore`) sharing the bare word
 * "level" with nothing on screen saying they were different things.
 *
 * This spec seeds the two stores directly in IndexedDB to DIFFERENT values —
 * the exact situation the review hit — then reads both screens and asserts
 * each number is named distinctly and says, in its own words, what moves it.
 * Asserting a label merely exists proves nothing (the old bare "Level 4" text
 * "exists" too); the assertions below require the NEW distinguishing text.
 */

const DB_NAME = 'piano-learning-app'

/** Console/page errors, collected from the moment the page is created (see e2e/round6.spec.ts). */
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

/** Writes one key of one IndexedDB object store directly (see e2e/dashboard-populated.spec.ts). */
async function writeStored(
  page: Page,
  collection: string,
  key: string,
  value: unknown,
): Promise<void> {
  await page.evaluate(
    ({ dbName, storeName, storeKey, storeValue }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(storeName, 'readwrite')
          const putReq = tx.objectStore(storeName).put(storeValue, storeKey)
          putReq.onerror = () => reject(putReq.error)
          putReq.onsuccess = () => resolve()
        }
      }),
    { dbName: DB_NAME, storeName: collection, storeKey: key, storeValue: value },
  )
}

/** Seeds the curriculum track level (`useLevelStore`, COLLECTIONS.settings/'levelState'). */
async function seedTrackLevel(
  page: Page,
  sightReadingLevel: number,
  overridden: boolean,
): Promise<void> {
  await writeStored(page, 'settings', 'levelState', {
    levelState: {
      levels: { playing: 1, 'sight-reading': sightReadingLevel, theory: 1 },
      overridden: { playing: false, 'sight-reading': overridden, theory: false },
    },
  })
}

/** Seeds the sight-reading trainer's own adaptive level (`useSightReadingStore`). */
async function seedAdaptiveLevel(page: Page, level: number): Promise<void> {
  await writeStored(page, 'sightReadingHistory', 'sightReadingHistory', { level, history: [] })
}

test.describe('level naming (roadmap 5.57)', () => {
  test('the Progress and Sight reading screens name the track level and the trainer level distinctly when they disagree', async ({
    page,
  }) => {
    const errors = collectErrors(page)

    // Boot once so the app creates its IndexedDB database (the default
    // landing destination is Today, roadmap 5.39, not Progress), then seed
    // the two stores to DIFFERENT values — the review's own repro: track
    // level 4, placed by hand; adaptive trainer level still 1.
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: /main/i })).toBeVisible()
    await seedTrackLevel(page, 4, true)
    await seedAdaptiveLevel(page, 1)

    await page.reload()
    await nav(page, 'Progress').click()
    await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

    // The curriculum track row: named "(curriculum track)", shows level 4,
    // overridden, and a note saying what moves it and that it differs from
    // the trainer level below.
    const trackRow = page.getByTestId('dashboard-level-sight-reading')
    await expect(trackRow).toContainText('(curriculum track)', { timeout: 10_000 })
    await expect(trackRow).toContainText('level 4')
    await expect(trackRow).toContainText('(overridden)')
    const trackNote = page.getByTestId('dashboard-level-sight-reading-note')
    await expect(trackNote).toContainText(/exit criteria|hand/i)
    await expect(trackNote).toContainText(/adaptive level/i)

    // The trainer-level panel: named "trainer level", shows 1 (NOT 4 — the
    // two numbers must stay independent), and states what it charts.
    const trainerRow = page.getByTestId('dashboard-sightreading-level')
    await expect(trainerRow).toHaveText('Sight-reading trainer level: 1')
    const trainerNote = page.getByTestId('dashboard-sightreading-level-note')
    await expect(trainerNote).toContainText(/accuracy per run/i)
    await expect(trainerNote).toContainText(/curriculum track level/i)

    // The two numbers actually disagree on screen — the defect this fixes.
    await expect(trackRow).toContainText('level 4')
    await expect(trainerRow).toContainText('1')

    // Now the Sight reading screen: only the trainer number is shown there,
    // but it must be named distinctly and say it is separate from the track
    // level on Progress — a learner reading only this screen must still be
    // able to tell these are two different things.
    await nav(page, 'Sight reading').click()
    await expect(page.getByRole('heading', { name: 'Sight reading' })).toBeVisible()
    const trainerLevelOnSightReading = page.getByTestId('sight-reading-level')
    await expect(trainerLevelOnSightReading).toHaveText('Sight-reading trainer level: 1')
    const sightReadingNote = page.getByTestId('sight-reading-level-note')
    await expect(sightReadingNote).toContainText(/curriculum track level on Progress/i)
    await expect(sightReadingNote).toContainText(/recent run accuracy/i)

    expect(errors).toEqual([])
  })

  test('states handled: the two levels equal, and a fresh profile where neither has moved', async ({
    page,
  }) => {
    const errors = collectErrors(page)

    // Fresh profile first — nothing seeded, both numbers at their initial
    // value (1). Even with nothing to disagree about yet, each screen must
    // still name its own number distinctly, not fall back to a bare "Level".
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: /main/i })).toBeVisible()
    await nav(page, 'Progress').click()
    await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

    await expect(page.getByTestId('dashboard-level-sight-reading')).toContainText(
      '(curriculum track)',
    )
    await expect(page.getByTestId('dashboard-level-sight-reading')).toContainText('level 1')
    await expect(page.getByTestId('dashboard-sightreading-level')).toHaveText(
      'Sight-reading trainer level: 1',
    )

    // Now seed the two stores to the SAME value (3, not overridden) — the
    // labels must still name which number is which even when they happen to
    // agree, since the numbers can drift apart again on the very next run.
    await seedTrackLevel(page, 3, false)
    await seedAdaptiveLevel(page, 3)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

    const trackRow = page.getByTestId('dashboard-level-sight-reading')
    await expect(trackRow).toContainText('level 3', { timeout: 10_000 })
    await expect(trackRow).not.toContainText('(overridden)')
    await expect(page.getByTestId('dashboard-sightreading-level')).toHaveText(
      'Sight-reading trainer level: 3',
    )

    await nav(page, 'Sight reading').click()
    await expect(page.getByTestId('sight-reading-level')).toHaveText(
      'Sight-reading trainer level: 3',
    )

    expect(errors).toEqual([])
  })
})
