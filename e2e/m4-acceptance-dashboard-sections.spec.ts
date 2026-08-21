import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * roadmap 4.10 (M4 acceptance pass, 2026-08-12b) — the three REQ-3.10.1
 * dashboard sections nothing in the suite had ever driven, plus REQ-3.10.2's
 * exit-criteria list and REQ-2.2's evidence-gated Advance control.
 *
 * WHY THIS SPEC EXISTS. The 2026-08-11 and 2026-08-12 acceptance passes both
 * scored REQ-3.10.1 "Met" for all seven dashboard items, but the evidence they
 * cite covers only four of them: `e2e/dashboard-populated.spec.ts` drives the
 * level, the streak, the weekly minutes and the sight-reading trend. The
 * remaining three — technique tempo trends, theory retention, repertoire
 * status — were passed on a code reading of `useDashboard.ts`, which this
 * project's standard of proof explicitly does not accept. REQ-3.10.2's exit
 * criteria and REQ-2.2's Advance button had no e2e coverage at all: grep the
 * suite for `dashboard-criterion`, `dashboard-advance`, `dashboard-retention`,
 * `dashboard-technique` or `dashboard-repertoire` before this file and there
 * are zero hits.
 *
 * WHAT MAKES IT PROOF RATHER THAN PRESENCE. Every number asserted below is
 * first written into the app's REAL IndexedDB record behind the app's back and
 * then read off the screen after a reload, and test 1 finishes by EDITING a
 * stored value and reloading again — a screen re-deriving a plausible number
 * cannot follow that edit. The seeded technique history also contains one
 * deliberately non-clean attempt at an absurd tempo: it must not appear in the
 * chart, which distinguishes "renders `tempoHistory`" from "renders whatever
 * attempts exist". The seeded card set contains a non-theory card, which must
 * not be counted in the retention totals.
 */

const DB_NAME = 'piano-learning-app'
const DAY_MS = 24 * 60 * 60 * 1_000

/** Console/page errors, collected from page creation (see e2e/export-restore.spec.ts). */
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

/**
 * Write one record straight into the app's real IndexedDB, without going
 * through any store. Never creates the database (`onupgradeneeded` aborts):
 * the app must have booted once already, so the write lands in the same
 * database `persistence.ts` restores from on the next reload.
 */
async function seedStore(page: Page, collection: string, key: string, payload: unknown): Promise<void> {
  const missing = await page.evaluate(
    ({ dbName, storeName, storeKey, value }) =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onupgradeneeded = () => {
          open.transaction?.abort()
        }
        open.onerror = () => reject(open.error as unknown as Error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.close()
            resolve(`the database has no "${storeName}" object store`)
            return
          }
          const tx = db.transaction(storeName, 'readwrite')
          const put = tx.objectStore(storeName).put(value, storeKey)
          put.onerror = () => {
            db.close()
            reject(put.error as unknown as Error)
          }
          tx.oncomplete = () => {
            db.close()
            resolve(null)
          }
        }
      }),
    { dbName: DB_NAME, storeName: collection, storeKey: key, value: payload },
  )
  expect(missing, 'seeding failed').toBeNull()
}

/** Read one record straight back out of the app's real IndexedDB (see `seedStore`). */
async function readStore(page: Page, collection: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, storeName, storeKey }) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onupgradeneeded = () => {
          open.transaction?.abort()
        }
        open.onerror = () => resolve(undefined)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.close()
            resolve(undefined)
            return
          }
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(storeKey)
          request.onerror = () => {
            db.close()
            reject(request.error as unknown as Error)
          }
          request.onsuccess = () => {
            const value = request.result as unknown
            db.close()
            resolve(value)
          }
        }
      }),
    { dbName: DB_NAME, storeName: collection, storeKey: key },
  )
}

/** The drill the seeded technique attempts belong to — a real id from `core/technique/library.ts`. */
const DRILL_ID = 'five-finger-c-major-hands-right'

type SeededAttempt = {
  readonly drillId: string
  readonly at: number
  readonly bpm: number
  readonly evenness: number
  readonly accuracy: number
  readonly clean: boolean
}

type SeededCard = {
  readonly id: string
  readonly due: number
  readonly intervalDays: number
  readonly ease: number
  readonly reps: number
  readonly lapses: number
  readonly introducedAt: number
}

type SeededPiece = {
  readonly id: string
  readonly title: string
  readonly composer: string
  readonly level: number
  readonly status: string
  readonly sessions: readonly { readonly at: number; readonly minutes: number }[]
  readonly bestAccuracy: number
  readonly notes: string
}

test('REQ-3.10.1: the technique, retention and repertoire sections render the stored data, and follow an edit made behind the app’s back', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  // The three sections start in their honest empty states — asserted first so
  // the populated assertions below cannot be satisfied by a screen that was
  // already showing these numbers before anything was seeded.
  await expect(page.getByTestId('dashboard-technique-empty')).toBeVisible()
  await expect(page.getByTestId('dashboard-retention-total')).toHaveText('0')
  await expect(page.getByTestId('dashboard-repertoire-empty')).toBeVisible()

  const now = Date.now()

  // Three CLEAN attempts at distinct tempos plus one NOT-clean attempt at an
  // absurd tempo. `tempoHistory` filters on `clean`, so 999 appearing in the
  // chart would mean the screen renders raw attempts rather than the core
  // function REQ-3.7.3 specifies.
  const attempts: readonly SeededAttempt[] = [
    { drillId: DRILL_ID, at: now - 1 * DAY_MS, bpm: 63, evenness: 0.93, accuracy: 0.97, clean: true },
    { drillId: DRILL_ID, at: now - 2 * DAY_MS, bpm: 58, evenness: 0.9, accuracy: 0.95, clean: true },
    { drillId: DRILL_ID, at: now - 3 * DAY_MS, bpm: 52, evenness: 0.88, accuracy: 0.94, clean: true },
    { drillId: DRILL_ID, at: now - 4 * DAY_MS, bpm: 999, evenness: 0.2, accuracy: 0.4, clean: false },
  ]
  await seedStore(page, 'techniqueHistory', 'techniqueHistory', { attempts })

  // Theory retention counts only cards whose id starts with `key-signature-`
  // or `interval-on-staff-` (useDashboard.ts). `note-name-c4` is seeded to
  // prove the filter is applied: it would push `total` to 5 and `mastered` to
  // 3 if the screen counted every card.
  const cards: readonly SeededCard[] = [
    // mature (interval >= 21 days) AND due now
    { id: 'key-signature-c', due: now - 1_000, intervalDays: 30, ease: 2.5, reps: 5, lapses: 0, introducedAt: now - 60 * DAY_MS },
    // mature, not due
    { id: 'key-signature-g', due: now + 10 * DAY_MS, intervalDays: 25, ease: 2.4, reps: 4, lapses: 0, introducedAt: now - 50 * DAY_MS },
    // young ("Learning") AND due now
    { id: 'interval-on-staff-m3', due: now - 500, intervalDays: 3, ease: 2.3, reps: 2, lapses: 1, introducedAt: now - 5 * DAY_MS },
    // new (never answered correctly)
    { id: 'interval-on-staff-p5', due: now + DAY_MS, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, introducedAt: now - DAY_MS },
    // NOT a theory card — must be excluded from every count below
    { id: 'note-name-c4', due: now - 2_000, intervalDays: 40, ease: 2.6, reps: 9, lapses: 0, introducedAt: now - 90 * DAY_MS },
  ]
  await seedStore(page, 'srsCards', 'srsCards', {
    cardsById: Object.fromEntries(cards.map((c) => [c.id, c])),
  })

  const ALPHA = 'm4b-audit-alpha'
  const BETA = 'm4b-audit-beta'
  const GAMMA = 'm4b-audit-gamma'
  const pieces: readonly SeededPiece[] = [
    { id: ALPHA, title: 'Audit Piece Alpha', composer: 'Anon.', level: 2, status: 'learning', sessions: [], bestAccuracy: 0, notes: '' },
    // 'maintained' and last practised 40 days ago — past the 21-day interval, so due.
    { id: BETA, title: 'Audit Piece Beta', composer: 'Anon.', level: 3, status: 'maintained', sessions: [{ at: now - 40 * DAY_MS, minutes: 12 }], bestAccuracy: 0.88, notes: '' },
    // 'maintained' but practised 2 days ago — NOT due.
    { id: GAMMA, title: 'Audit Piece Gamma', composer: 'Anon.', level: 4, status: 'maintained', sessions: [{ at: now - 2 * DAY_MS, minutes: 9 }], bestAccuracy: 0.91, notes: '' },
  ]
  await seedStore(page, 'repertoire', 'repertoire', { pieces })

  await page.reload()
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  // (1) Technique tempo trends (REQ-3.10.1, REQ-3.7.3).
  await expect(page.getByTestId('dashboard-technique-empty')).toHaveCount(0, { timeout: 10_000 })
  // One series per drill since `feb0b9c`: the chart lives inside this drill's
  // own row and its points are labelled by the drill's title and run number,
  // not by the raw drill id.
  const techniqueSeries = page.getByTestId(`dashboard-technique-series-${DRILL_ID}`)
  await expect(techniqueSeries).toBeVisible()
  const tempoTitles = await techniqueSeries.locator('circle title').allTextContents()
  expect(tempoTitles.map((t) => t.replace(/^.* run /, 'run '))).toEqual([
    'run 1: 52 bpm',
    'run 2: 58 bpm',
    'run 3: 63 bpm',
  ])

  // (2) Theory retention (REQ-3.10.1). Exact counts, and the non-theory card excluded.
  await expect(page.getByTestId('dashboard-retention-total')).toHaveText('4')
  await expect(page.getByTestId('dashboard-retention-due')).toHaveText('2')
  await expect(page.getByTestId('dashboard-retention-mastered')).toHaveText('2')
  await expect(page.getByTestId('dashboard-retention-learning')).toHaveText('1')
  await expect(page.getByTestId('dashboard-retention-new')).toHaveText('1')

  // (3) Repertoire status (REQ-3.10.1, REQ-3.8.2) and the review-due list (REQ-3.8.4).
  await expect(page.getByTestId(`dashboard-repertoire-piece-${ALPHA}`)).toHaveText('Audit Piece Alpha: learning')
  await expect(page.getByTestId(`dashboard-repertoire-piece-${BETA}`)).toHaveText('Audit Piece Beta: maintained')
  await expect(page.getByTestId(`dashboard-repertoire-piece-${GAMMA}`)).toHaveText('Audit Piece Gamma: maintained')
  await expect(page.getByTestId(`dashboard-repertoire-due-${BETA}`)).toBeVisible()
  await expect(page.getByTestId(`dashboard-repertoire-due-${GAMMA}`)).toHaveCount(0)
  await expect(page.getByTestId(`dashboard-repertoire-due-${ALPHA}`)).toHaveCount(0)

  // (4) The screen FOLLOWS the store, rather than re-deriving something
  // plausible: change Alpha's status and backdate Gamma's only session past
  // the maintenance interval, both straight in IndexedDB, and reload.
  const editedPieces = pieces.map((p) =>
    p.id === ALPHA
      ? { ...p, status: 'performance-ready' }
      : p.id === GAMMA
        ? { ...p, sessions: [{ at: now - 100 * DAY_MS, minutes: 9 }] }
        : p,
  )
  await seedStore(page, 'repertoire', 'repertoire', { pieces: editedPieces })
  await page.reload()
  await nav(page, 'Progress').click()
  await expect(page.getByTestId(`dashboard-repertoire-piece-${ALPHA}`)).toHaveText(
    'Audit Piece Alpha: performance-ready',
    { timeout: 10_000 },
  )
  await expect(page.getByTestId(`dashboard-repertoire-due-${GAMMA}`)).toBeVisible()

  expect(errors).toEqual([])
})

/**
 * REQ-3.1.4's last clause — "adjustable by the user" — had no driven proof
 * anywhere in the suite before this test. `e2e/m4-acceptance-session-mix.spec.ts`
 * proves the DEFAULT proportions at the three presets; `e2e/screens.spec.ts`
 * proves the total. Neither ever touches the "Adjust mix" controls, so a set of
 * inputs wired to nothing would have passed both.
 */
test('REQ-3.1.4: the session mix is adjustable by the learner, and the plan follows the adjustment', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()
  await page
    .getByRole('radiogroup', { name: 'Session length' })
    .getByRole('radio', { name: '60 min', exact: true })
    .click()
  // `session-plan-total`'s text changed from "Total: N minutes" to "N minutes
  // planned" in the UI-08 redesign (see SessionPlanScreen.tsx's `pluralize`).
  await expect(page.getByTestId('session-plan-total')).toHaveText('60 minutes planned')

  // The "Minutes by segment" `<dl>` (`data-testid="session-plan-segment-*"`)
  // was deleted; the same numbers now live on each item card's duration badge
  // (`.session-plan-item-duration`), summed per segment because a segment can
  // hold more than one card.
  async function segmentMinutes(segment: string): Promise<number> {
    const badges = await page
      .locator(`li[data-segment="${segment}"] .session-plan-item-duration`)
      .allTextContents()
    return badges.reduce((sum, text) => sum + Number(text.match(/(\d+)/)?.[1] ?? '0'), 0)
  }

  // The stated defaults at a 60-minute budget: 40% and 20%.
  await expect.poll(() => segmentMinutes('lesson')).toBe(24)
  await expect.poll(() => segmentMinutes('theory-ear')).toBe(12)

  await page.getByText('Adjust mix', { exact: true }).click()
  const mix = page.getByRole('group', { name: 'Session mix' })
  await expect(mix).toBeVisible()

  // Drop theory/ear to nothing and give the lesson segment the larger share.
  await mix.getByLabel('Theory / ear training share').fill('0')
  await mix.getByLabel('Lesson / repertoire share').fill('0.6')

  await expect.poll(() => segmentMinutes('theory-ear')).toBe(0)
  await expect
    .poll(
      () => segmentMinutes('lesson'),
      { message: 'raising the lesson share did not give the lesson segment more minutes' },
    )
    .toBeGreaterThan(24)
  // The budget is still the budget — the adjustment redistributes, never inflates.
  await expect(page.getByTestId('session-plan-total')).toHaveText('60 minutes planned')

  // "Reset mix" is a sibling of the "Session mix" group in the markup (the
  // `<details>` wraps summary + group + button as three siblings), not a
  // descendant of it — scope to the page instead of `mix`.
  await page.getByRole('button', { name: 'Reset mix' }).click()
  await expect.poll(() => segmentMinutes('lesson')).toBe(24)
  await expect.poll(() => segmentMinutes('theory-ear')).toBe(12)

  expect(errors).toEqual([])
})

test('REQ-2.2/REQ-3.10.2: the exit-criteria list and the Advance control are driven by measurable evidence, not by time or a click', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()

  // Level 1's only sight-reading exit criterion: "Sight-read level 1 material
  // ... at 80% accuracy or better" (content/curriculum/curriculum.ts).
  const criterion = page.getByTestId('dashboard-criterion-sight-reading-0')
  const criterionStatus = page.getByTestId('dashboard-criterion-status-sight-reading-0')
  const advance = page.getByTestId('dashboard-advance-sight-reading')

  await expect(criterion).toContainText('Sight-read level 1 material')
  await expect(criterionStatus).toHaveText('Not met')
  // Nothing read yet, so the accuracy half of the check is at 0.
  await expect(criterion).toContainText('(0%)')
  await expect(advance).toHaveCount(0)
  await expect(page.getByTestId('dashboard-advance-disabled-reason-sight-reading')).toHaveCount(0)
  await expect(page.getByTestId('dashboard-level-sight-reading')).toContainText('level 1')

  // Supply the evidence — three real-shaped sight-reading reads at 92% — and
  // nothing else. No clock is advanced, no level is set by hand.
  const now = Date.now()
  await seedStore(page, 'sightReadingHistory', 'sightReadingHistory', {
    level: 1,
    history: [
      { pieceId: 'm4b-audit-read-1', readAt: now - 3 * DAY_MS, accuracy: 0.92, level: 1 },
      { pieceId: 'm4b-audit-read-2', readAt: now - 2 * DAY_MS, accuracy: 0.93, level: 1 },
      { pieceId: 'm4b-audit-read-3', readAt: now - DAY_MS, accuracy: 0.91, level: 1 },
    ],
  })

  await page.reload()
  await nav(page, 'Progress').click()
  await expect(criterionStatus).toHaveText('Met', { timeout: 10_000 })
  await expect(criterion).toContainText('(100%)')
  await expect(advance).toBeEnabled()
  await expect(page.getByTestId('dashboard-advance-disabled-reason-sight-reading')).toHaveCount(0)

  // Advancing moves the track and does NOT mark it overridden — REQ-2.2's
  // "measurable checks" advancement is a different thing from REQ-2.3's
  // manual placement, and the screen has to keep them distinguishable.
  await advance.click()
  const level = page.getByTestId('dashboard-level-sight-reading')
  await expect(level).toContainText('level 2')
  await expect(level).not.toContainText('(overridden)')

  // The advancement has to REACH storage, not just the zustand store — REQ-2.1
  // ("the app maintains a level per track") is worthless if it resets on the
  // next boot. Polled rather than asserted once, so a slow write queue reads
  // as slow rather than as broken.
  await expect
    .poll(
      async () => {
        const stored = (await readStore(page, 'settings', 'levelState')) as
          | { readonly levelState?: { readonly levels?: Record<string, number> } }
          | undefined
        return stored?.levelState?.levels?.['sight-reading'] ?? 0
      },
      { message: 'the advanced level never reached the persisted levelState record', timeout: 10_000 },
    )
    .toBe(2)

  await page.reload()
  await nav(page, 'Progress').click()
  await expect(level).toContainText('level 2', { timeout: 10_000 })
  await expect(level).not.toContainText('(overridden)')

  expect(errors).toEqual([])
})
