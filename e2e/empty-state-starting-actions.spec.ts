import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 5.41: every one of the 12 nav destinations
 * (`app/shell/Shell.tsx`'s `NAV_PRIMARY`/`NAV_GROUPS`), visited with a
 * genuinely empty IndexedDB, renders a real, working starting action — not
 * just a message saying "nothing here yet" with no way out of it.
 *
 * The survey this test encodes (see the roadmap entry for the full writeup):
 * all 12 destinations already handled the empty case honestly before this
 * round — the earlier rounds that built Today (4.7a), the dashboard (4.7),
 * Repertoire's disabled-with-a-reason "Add loaded score" button (2.33/4.5),
 * and the flashcard/ear-training/theory SRS panels' own "Nothing recorded
 * yet." (5.31, this same round) got there first. Nothing needed a NEW empty
 * state; what this test adds is the walk-all-12 proof the roadmap item asks
 * for, and a permanent regression guard — this project's most expensive
 * defect class is a screen that renders and does nothing (see
 * `e2e/screens.spec.ts`'s own doc comment), and "the button is disabled/inert
 * on a fresh profile" is exactly the shape that class takes.
 *
 * One test, one pass over the 12 destinations in this order:
 *   Progress, Today, Lessons, Practice, Sight reading, Repertoire, Rhythm,
 *   Technique, Metronome, Flashcards, Ear training, Theory.
 * Progress goes FIRST deliberately: its "Theory retention" section reads the
 * same `flashcardStore` the Theory destination's drill writes to, so Progress
 * must be visited before Theory or its own "still empty" reading would no
 * longer be honestly empty. Every other destination's data is independent
 * (own store, or no persisted store at all), so the rest of the order does
 * not matter — each step's own click is free to add data; only the ONE
 * cross-screen dependency needed a fixed position.
 *
 * Every step asserts a real OUTPUT of the click (a status changing, a button
 * becoming enabled, a message disappearing), never mere presence — the same
 * bar `e2e/screens.spec.ts` and this repo's testing rules hold every other
 * e2e assertion to.
 */

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

/** Deletes every IndexedDB database this origin holds — see
 *  `e2e/default-destination.spec.ts`'s identical helper for why a reload
 *  after this, not just a fresh browser context, is what makes "empty"
 *  trustworthy here. */
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

function onScreenKeyboard(page: Page) {
  return page.getByRole('group', { name: 'On-screen keyboard' })
}

test('every one of the 12 destinations, visited on an empty profile, has a real starting action (roadmap 5.41)', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await wipeIndexedDb(page)
  await page.reload()

  // ---- Progress (first — see module doc on ordering) ----
  await nav(page, 'Progress').click()
  await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible()
  const sheetToggle = page.getByRole('button', { name: 'Show practice sheet' })
  await expect(sheetToggle).toBeEnabled()
  await sheetToggle.click()
  await expect(page.getByTestId('practice-sheet-empty')).toBeVisible()

  // ---- Today ----
  await nav(page, 'Today').click()
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()
  const startSession = page.getByRole('button', { name: 'Start session' })
  await expect(startSession).toBeEnabled()
  await startSession.click()
  await expect(page.getByText(/Item \d+ of \d+/)).toBeVisible()

  // ---- Lessons ----
  await nav(page, 'Lessons').click()
  await expect(page.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible()
  const openExercise = page.getByRole('button', { name: /^Open / }).first()
  await expect(openExercise).toBeEnabled()
  await openExercise.click()
  // A real navigation happened — Lessons is no longer the active destination.
  await expect(nav(page, 'Lessons')).not.toHaveAttribute('aria-current', 'page')

  // ---- Practice ----
  await nav(page, 'Practice').click()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled()
  const pause = page.getByRole('button', { name: 'Pause', exact: true })
  await expect(pause).toBeDisabled()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(pause).toBeEnabled({ timeout: 10_000 })

  // ---- Sight reading ----
  await nav(page, 'Sight reading').click()
  const startExercise = page.getByRole('button', { name: 'Start exercise' })
  await expect(startExercise).toBeEnabled()
  await startExercise.click()
  await expect(page.getByText(/Scan the piece/)).toBeVisible()

  // ---- Repertoire ----
  await nav(page, 'Repertoire').click()
  await expect(page.getByText('No pieces in your library yet — add the score you have loaded above.')).toBeVisible()
  const addFromCatalogue = page.getByRole('button', { name: 'Add', exact: true }).first()
  await expect(addFromCatalogue).toBeEnabled()
  await addFromCatalogue.click()
  await expect(page.getByText('No pieces in your library yet — add the score you have loaded above.')).toHaveCount(0)

  // ---- Rhythm ----
  await nav(page, 'Rhythm').click()
  const rhythmStart = page.getByRole('button', { name: 'Start', exact: true })
  await expect(rhythmStart).toBeEnabled()
  await rhythmStart.click()
  await expect(page.getByTestId('rhythm-tapping-status')).toBeVisible()

  // ---- Technique ----
  // UI-15: Start/Stop is ONE button node that swaps in place
  // (`data-testid="technique-transport-btn"`), not two separate buttons with
  // a disabled Stop before the first run.
  await nav(page, 'Technique').click()
  const techniqueTransport = page.getByTestId('technique-transport-btn')
  await expect(techniqueTransport).toHaveText('Start')
  await expect(techniqueTransport).toBeEnabled()
  await techniqueTransport.click()
  await expect(techniqueTransport).toHaveText('Stop')

  // ---- Metronome ----
  await nav(page, 'Metronome').click()
  const metronomeToggle = page.getByRole('button', { name: 'Start', exact: true })
  await expect(metronomeToggle).toBeEnabled()
  await metronomeToggle.click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()

  // ---- Flashcards ----
  await nav(page, 'Flashcards').click()
  await expect(page.getByTestId('flashcard-stats-total')).toHaveText('0')
  const flashcardKey = onScreenKeyboard(page).getByRole('button').first()
  await expect(flashcardKey).toBeEnabled()
  await flashcardKey.click()
  await expect(page.getByTestId('flashcard-feedback')).toBeVisible()

  // ---- Ear training ----
  await nav(page, 'Ear training').click()
  const earPlay = page.getByRole('button', { name: /^Play/ })
  await expect(earPlay).toBeEnabled()
  await earPlay.click()
  await expect(earPlay).toBeDisabled({ timeout: 10_000 })

  // ---- Theory ----
  await nav(page, 'Theory').click()
  await expect(page.getByTestId('theory-stats-total')).toHaveText('0')
  // "Key signature" is the one topic whose answer is a single note press (a
  // bare tonic) rather than a multi-note scale/chord/cadence: every other
  // topic's grading is octave-insensitive across several presses, so an
  // arbitrary first key can silently match the expected pitch class and
  // advance the item without grading anything yet — not what this step
  // needs to prove. One press against "Key signature" always grades,
  // correct or not.
  await page.locator('#theory-kind-select').selectOption({ label: 'Key signature' })
  const theoryKey = onScreenKeyboard(page).getByRole('button').first()
  await expect(theoryKey).toBeEnabled()
  await theoryKey.click()
  await expect(page.getByTestId('theory-feedback')).toBeVisible()

  expect(errors).toEqual([])
})
