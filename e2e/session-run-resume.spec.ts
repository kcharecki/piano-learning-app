import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import type { ActivityKind, PracticeEntry } from '../src/core/progress/log.ts'

/**
 * E2E proof for roadmap 5.44 (make the plan runnable) and 5.45 (the warm-up
 * segment): starts a 15-minute plan on the real "Today" screen, completes
 * two items — the first of which is the warm-up checklist, a real
 * destination, not a label — reloads the page, and asserts the session
 * resumes at item 3 with the first two marked done, their real elapsed time
 * recorded in the `practiceLog` (roadmap 5.14's `PracticeEntry`s), and
 * critically NO duplicate entries created by the reload itself — the
 * StrictMode/remount hazard `useSessionRun.ts`'s module doc names.
 *
 * `useSessionPlan`/`useSessionRun`/`SessionPlanScreen` all have their own
 * component-level suites exercising this same flow against fakes; this is
 * the one browser-driven proof against the real IndexedDB the app actually
 * persists through (the 4.7b pattern this project holds itself to).
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
  return page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: label, exact: true })
}

async function readPracticeEntries(page: Page): Promise<readonly PracticeEntry[]> {
  return page.evaluate(
    (dbName) =>
      new Promise<readonly PracticeEntry[]>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction('practiceLog', 'readonly').objectStore('practiceLog').get('practiceLog')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            const record = req.result as { practiceEntries?: PracticeEntry[] } | undefined
            resolve(record?.practiceEntries ?? [])
          }
        }
      }),
    DB_NAME,
  )
}

type SessionRunRecord = {
  readonly dayKey: string
  readonly doneFlags: readonly boolean[]
  readonly plan: { readonly items: readonly { readonly segment: string }[] }
}

async function readSessionRun(page: Page): Promise<SessionRunRecord | undefined> {
  return page.evaluate(
    (dbName) =>
      new Promise<SessionRunRecord | undefined>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction('settings', 'readonly').objectStore('settings').get('todaySessionRun')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => resolve(req.result as SessionRunRecord | undefined)
        }
      }),
    DB_NAME,
  )
}

test('a 15-minute plan runs: warm-up opens a real checklist, completing items advances, and a reload resumes at item 3 with the first two done (roadmap 5.44/5.45)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)
  const testStart = Date.now()

  await page.goto('/')
  await nav(page, 'Today').click()
  await expect(page.getByRole('heading', { name: /today.?s session/i })).toBeVisible()

  await page.getByRole('button', { name: '15 min', exact: true }).click()
  await page.getByRole('button', { name: 'Start session', exact: true }).click()

  await expect(page.getByTestId('session-run-position')).toContainText('Item 1 of')

  // Item 1 is warm-up (roadmap 5.45) — a real checklist, not a plain "Open"
  // link. It must actually be checked off before it can be completed.
  await expect(page.getByRole('heading', { name: 'Away-from-the-keys warm-up' })).toBeVisible()
  const completeWarmup = page.getByRole('button', { name: 'Complete warm-up', exact: true })
  await expect(completeWarmup).toBeDisabled()
  for (const box of await page.getByRole('checkbox').all()) await box.check()
  await expect(completeWarmup).toBeEnabled()
  // A moment of real elapsed time on the warm-up before completing it, so
  // its logged entry has a genuine positive duration, not a same-millisecond
  // start/stop.
  await page.waitForTimeout(1_100)
  await completeWarmup.click()

  await expect(page.getByTestId('session-run-position')).toContainText('Item 2 of')
  await page.waitForTimeout(1_100)
  await page.getByRole('button', { name: 'Complete item', exact: true }).click()

  await expect(page.getByTestId('session-run-position')).toContainText('Item 3 of')
  await expect(page.getByTestId('session-run-item-0')).toHaveAttribute('data-status', 'done')
  await expect(page.getByTestId('session-run-item-1')).toHaveAttribute('data-status', 'done')
  await expect(page.getByTestId('session-run-item-2')).toHaveAttribute('data-status', 'current')

  // The practiceLog now has exactly two real, positive-duration entries —
  // one of them the warm-up (roadmap 5.45's "completing it writes a warmup
  // row").
  // `useProgressStore.practiceEntries` is stored newest-first (see its own
  // module doc) — sort back to chronological order before asserting which
  // one is the warm-up.
  const beforeReload = (await readPracticeEntries(page))
    .filter((e) => e.startedAt >= testStart)
    .sort((a, b) => a.startedAt - b.startedAt)
  expect(beforeReload).toHaveLength(2)
  for (const entry of beforeReload) {
    expect(entry.endedAt, `${entry.kind} entry had a non-positive duration`).toBeGreaterThan(
      entry.startedAt,
    )
  }
  const kinds = beforeReload.map((e) => e.kind)
  const expectedFirstKind: ActivityKind = 'warmup'
  expect(kinds[0]).toBe(expectedFirstKind)

  const runBeforeReload = await readSessionRun(page)
  expect(runBeforeReload?.doneFlags).toEqual(
    expect.arrayContaining([true, true]),
  )
  expect(runBeforeReload?.doneFlags.slice(0, 2)).toEqual([true, true])

  // --- The reload (roadmap 5.44's own proof text) ---
  await page.reload()
  // A full reload resets `Shell.tsx`'s in-memory nav state to its default
  // destination (not persisted — nav position was never this task's
  // concern) — the run's position, however, IS persisted, so navigating
  // back to Today must show it resumed rather than a fresh planner.
  await nav(page, 'Today').click()

  await expect(page.getByTestId('session-run-position')).toContainText('Item 3 of', {
    timeout: 10_000,
  })
  await expect(page.getByTestId('session-run-item-0')).toHaveAttribute('data-status', 'done')
  await expect(page.getByTestId('session-run-item-1')).toHaveAttribute('data-status', 'done')
  await expect(page.getByTestId('session-run-item-2')).toHaveAttribute('data-status', 'current')

  // The reload must not have minted any phantom entries — the exact
  // StrictMode/remount hazard `useSessionRun.ts` guards against (a
  // near-zero-duration entry stored on every fresh mount).
  const afterReload = (await readPracticeEntries(page)).filter((e) => e.startedAt >= testStart)
  expect(afterReload).toHaveLength(2)
  expect(afterReload.map((e) => e.id).sort()).toEqual(beforeReload.map((e) => e.id).sort())

  expect(errors).toEqual([])
})
