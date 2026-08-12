import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.40: a first-run flow — a few questions
 * (experience, goal, practice minutes), a MIDI/input check, starting track
 * levels set from the answers, and a first session ready to start.
 * Skippable, and re-runnable from Settings.
 *
 * ## Why a banner, not a hard gate — see OnboardingGateway.tsx's module doc
 *
 * `Shell.tsx` shows this as a dismissible callout on Today, not a screen
 * that blocks every other destination: this app's e2e suite is ~60 spec
 * files, nearly all of which `goto('/')` against an empty IndexedDB
 * (Playwright isolates storage per test) and expect Today's own content
 * immediately. A hard gate would have intercepted nearly all of them.
 *
 * The roadmap's own proof text asks for exactly what this drives: complete
 * onboarding, reload, and assert the chosen levels are what the dashboard
 * shows AND that Today's plan is non-empty and matches the chosen minutes —
 * both asserted straight off the real persisted IndexedDB record, not off
 * a UI readout that resets on navigation.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** Deletes every IndexedDB database this origin holds (see e2e/default-destination.spec.ts). */
async function wipeIndexedDb(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise<void>((resolve, reject) => {
            if (db.name === undefined) {
              resolve()
              return
            }
            const req = indexedDB.deleteDatabase(db.name)
            req.onsuccess = () => resolve()
            req.onerror = () => reject(req.error as Error)
            req.onblocked = () => resolve()
          }),
      ),
    )
  })
}

/** Reads the raw `todaySessionRun` record straight out of IndexedDB — the
 *  exact (collection, key) pair `useSessionRun.ts` restores from — rather
 *  than through any UI readout, so this is a direct proof of what got
 *  persisted, not of what one particular render happened to show. */
async function readSessionRunSnapshot(page: Page): Promise<{
  readonly plan: { readonly totalMinutes: number; readonly items: readonly unknown[] }
} | null> {
  return page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('piano-learning-app')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('settings', 'readonly')
        const getReq = tx.objectStore('settings').get('todaySessionRun')
        getReq.onsuccess = () => resolve(getReq.result ?? null)
        getReq.onerror = () => reject(getReq.error)
      }
    })
  })
}

/**
 * Reads the onboarding record straight out of IndexedDB.
 *
 * `useOnboardingGate.markCompleted` sets React state and fires the IndexedDB
 * write WITHOUT awaiting it — deliberately, so a slow or broken store can never
 * block the learner (its own module doc says the worst case is the banner
 * reappearing next boot). A test that clicks "Not now" and reloads immediately
 * is therefore racing that write, and loses it under load: this spec passed
 * solo and failed inside the full `verify:full` suite for exactly that reason.
 * Waiting on the persisted record before reloading is not a workaround — it is
 * the durability claim stated directly, instead of inferred from a reload that
 * happened to be slower than the write.
 */
async function readOnboardingRecord(page: Page): Promise<{ readonly completed: boolean } | null> {
  return page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('piano-learning-app')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('settings', 'readonly')
        const getReq = tx.objectStore('settings').get('onboarding')
        getReq.onsuccess = () => resolve(getReq.result ?? null)
        getReq.onerror = () => reject(getReq.error)
      }
    })
  })
}

test('completing onboarding from an empty IndexedDB sets the chosen levels and starts a first session matching the chosen minutes (roadmap 5.40)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await wipeIndexedDb(page)
  await page.reload()

  const banner = page.getByRole('note', { name: /first-run setup/i })
  await expect(banner).toBeVisible()

  await page.getByRole('button', { name: 'Set up my practice' }).click()
  await expect(page.getByRole('heading', { name: 'Set up your practice' })).toBeVisible()

  // "I've played a bit before" -> level 2 on every track (see OnboardingFlow.tsx's EXPERIENCE_LEVEL).
  await page.getByLabel("I've played a bit before").check()
  await page.getByLabel('Get better at sight-reading').check()
  await page.getByRole('group', { name: 'Practice minutes' }).getByRole('button', { name: '60 min' }).click()

  await page.getByRole('button', { name: 'Finish setup' }).click()

  // The flow (and the banner) both disappear once onboarding is marked done.
  await expect(page.getByRole('heading', { name: 'Set up your practice' })).toBeHidden()
  await expect(banner).toBeHidden()

  await page.reload()

  // Chosen levels are what the dashboard shows after a reload.
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Progress', exact: true })
    .click()
  await expect(page.getByTestId('dashboard-level-playing')).toContainText('level 2')
  await expect(page.getByTestId('dashboard-level-sight-reading')).toContainText('level 2')
  await expect(page.getByTestId('dashboard-level-theory')).toContainText('level 2')

  // Today's plan is non-empty and matches the chosen minutes — read straight
  // off the persisted record (see readSessionRunSnapshot's own doc).
  const snapshot = await readSessionRunSnapshot(page)
  expect(snapshot).not.toBeNull()
  expect(snapshot?.plan.totalMinutes).toBe(60)
  expect(snapshot?.plan.items.length).toBeGreaterThan(0)

  // And it is genuinely what Today shows, not just what got written: a
  // fresh reload lands the learner mid-plan, item one live.
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Today', exact: true })
    .click()
  await expect(page.getByTestId('session-run-position')).toContainText(
    `Item 1 of ${snapshot?.plan.items.length}`,
  )

  expect(errors).toEqual([])
})

test('Skip leaves levels untouched and never shows the banner again; Settings re-runs the flow (roadmap 5.40)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await wipeIndexedDb(page)
  await page.reload()

  const banner = page.getByRole('note', { name: /first-run setup/i })
  await expect(banner).toBeVisible()
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(banner).toBeHidden()

  // Persisted — asserted on the stored record itself, then proven again by a
  // reload not bringing the banner back. See readOnboardingRecord's doc for
  // why the record is waited on rather than the reload being raced.
  await expect(async () => {
    expect(await readOnboardingRecord(page)).toEqual({ completed: true })
  }).toPass({ timeout: 10_000 })
  await page.reload()
  await expect(banner).toBeHidden()
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()

  // Nothing was changed by Skip.
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Progress', exact: true })
    .click()
  await expect(page.getByTestId('dashboard-level-playing')).toContainText('level 1')

  // Re-runnable from Settings regardless of the banner already being gone.
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Settings', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Set up your practice' })).toBeVisible()

  await page.getByLabel('I can already read music comfortably').check()
  await page.getByRole('button', { name: 'Finish setup' }).click()

  await expect(page.getByRole('status').filter({ hasText: /setup updated/i })).toBeVisible()
  await page.getByRole('button', { name: 'Back to Today' }).click()
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()

  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Progress', exact: true })
    .click()
  await expect(page.getByTestId('dashboard-level-playing')).toContainText('level 3')

  expect(errors).toEqual([])
})
