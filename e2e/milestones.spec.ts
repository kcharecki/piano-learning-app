import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap B.4 (REQ-3.10.3): light gamification, honest and
 * derived from data already stored — no points, no badges for showing up,
 * no streak-loss guilt.
 *
 * `computeMilestones` (`@core/progress/milestones.ts`) is unit- and
 * property-tested in isolation (`milestones.test.ts`), and `useDashboard`'s
 * wiring is covered in `useDashboard.test.ts`/`DashboardScreen.test.tsx` — a
 * jsdom render can prove the plumbing is connected, but not that a REAL
 * IndexedDB write, read back through `persistence.ts`'s actual restore path,
 * changes what a learner sees in the running app. This spec seeds a real
 * `TechniqueAttempt` straight into IndexedDB (the same pattern
 * `e2e/streak-any-activity.spec.ts` and `e2e/dashboard-populated.spec.ts`
 * use for `practiceLog`), then reads the live Milestones panel off the
 * Dashboard before and after — the point being that the achievement CHANGES
 * with the data, not merely that the panel exists.
 *
 * The seeded attempt is a single clean run of the C-major, two-octave,
 * hands-together scale drill at exactly its curriculum target tempo (84
 * bpm) — deliberately chosen to flip TWO milestones at once from real data:
 * "first piece played hands together" (any hands-together drill, clean)
 * goes fully achieved, and "all 12 major scales at target tempo" moves from
 * an honest "0 of 12" to "1 of 12" (still unachieved, but visibly
 * progressed) — proving the progress fraction is really counted, not just
 * the boolean flipped.
 */

const DB_NAME = 'piano-learning-app'

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

type SyntheticTechniqueAttempt = {
  readonly drillId: string
  readonly at: number
  readonly bpm: number
  readonly evenness: number
  readonly accuracy: number
  readonly clean: boolean
}

/** Overwrites the app's techniqueHistory record — this spec wants full control over exactly what was played. */
async function setTechniqueAttempts(
  page: Page,
  attempts: readonly SyntheticTechniqueAttempt[],
): Promise<void> {
  await page.evaluate(
    ({ dbName, newAttempts }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('techniqueHistory', 'readwrite')
          const putReq = tx
            .objectStore('techniqueHistory')
            .put({ attempts: newAttempts }, 'techniqueHistory')
          putReq.onerror = () => reject(putReq.error)
          putReq.onsuccess = () => resolve()
        }
      }),
    { dbName: DB_NAME, newAttempts: attempts },
  )
}

async function openMilestonePanel(page: Page): Promise<void> {
  const details = page.getByTestId('milestone-panel-details')
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open)
  if (!isOpen) await details.locator('summary').click()
}

test('a real clean hands-together technique attempt flips milestones from "0 of 5" to achieved, read live off the Dashboard (roadmap B.4, REQ-3.10.3)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await page.waitForTimeout(200) // let the app create its IndexedDB database and stores

  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  // ---- Before: a fresh profile, honestly zero. -----------------------------
  const milestonesRegion = page.getByRole('region', { name: 'Milestones' })
  await expect(milestonesRegion).toBeVisible()
  await openMilestonePanel(page)

  const summaryCount = page.getByTestId('milestone-summary-count')
  await expect(summaryCount).toHaveText('0 of 5')
  await expect(page.getByTestId('milestone-achieved-empty')).toBeVisible()
  await expect(page.getByTestId('milestone-achieved-first-hands-together')).toHaveCount(0)
  await expect(page.getByTestId('milestone-progress-label-twelve-major-scales')).toHaveText(
    '0 of 12 major scales',
  )

  // ---- Seed a real clean hands-together attempt, straight into IndexedDB. --
  const attempt: SyntheticTechniqueAttempt = {
    drillId: 'scale-c-major-2oct-hands-together',
    at: Date.now() - 60_000,
    bpm: 84, // exactly this drill's curriculum target tempo
    evenness: 1,
    accuracy: 1,
    clean: true,
  }
  await setTechniqueAttempts(page, [attempt])

  await page.reload()
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()
  await openMilestonePanel(page)

  // ---- After: the achievement actually changed. -----------------------------
  await expect(summaryCount).toHaveText('1 of 5', { timeout: 10_000 })
  await expect(page.getByTestId('milestone-achieved-empty')).toHaveCount(0)
  await expect(page.getByTestId('milestone-achieved-first-hands-together')).toBeVisible()
  await expect(
    page.getByTestId('milestone-achieved-detail-first-hands-together'),
  ).toContainText('hands together')
  // The scales milestone counted the same real attempt toward its progress —
  // still unachieved (1 of 12), never rounded up to "achieved" early.
  await expect(page.getByTestId('milestone-progress-label-twelve-major-scales')).toHaveText(
    '1 of 12 major scales',
  )
  await expect(page.getByTestId('milestone-achieved-twelve-major-scales')).toHaveCount(0)

  // Cross-check against what was actually persisted, the same pattern
  // `e2e/dashboard-populated.spec.ts` uses for practiceLog.
  const stored = await page.evaluate(
    (dbName) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db
            .transaction('techniqueHistory', 'readonly')
            .objectStore('techniqueHistory')
            .get('techniqueHistory')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => resolve(req.result as unknown)
        }
      }),
    DB_NAME,
  )
  expect(stored).toMatchObject({ attempts: [{ drillId: 'scale-c-major-2oct-hands-together', clean: true }] })

  expect(errors).toEqual([])
})

test('the Milestones panel is collapsed by default, and stays honest at "0 of 5" through a reload with no technique data (roadmap B.4)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  const details = page.getByTestId('milestone-panel-details')
  await expect(details).toBeVisible()
  expect(await details.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)

  await openMilestonePanel(page)
  await expect(page.getByTestId('milestone-summary-count')).toHaveText('0 of 5')
  await expect(page.getByTestId('milestone-achieved-empty')).toBeVisible()

  expect(errors).toEqual([])
})
