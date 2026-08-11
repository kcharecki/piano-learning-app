import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * roadmap 4.10 (M4 acceptance pass) — REQ-3.8.2 says a repertoire piece
 * "SHALL... store practice history... and best assessment result." This
 * drives the real, only user-facing path to that: add a graded piece, open
 * it in Practice (as `e2e/repertoire-open-practice.spec.ts` already proves
 * works), actually play it, then go back to Repertoire and check whether
 * that practice moved the piece off "never practised".
 *
 * It does not. `src/core/repertoire/repertoire.ts`'s `recordSession` (and
 * the `bestAccuracy` it maintains) is called from nowhere in `src/app` except
 * test files — grep confirms zero references in `src/app/practice/**`, and
 * `RepertoireScreen`'s "days since last practice" column reads straight off
 * `RepertoirePiece.sessions`, which nothing production ever appends to.
 * `e2e/repertoire.spec.ts`'s own doc comment already says as much ("There is
 * no UI that records a repertoire practice session yet... that is the
 * `usePracticeLog.stop()` wiring roadmap 2.33 leaves for later") — this spec
 * turns that comment into a driven, dated assertion instead of leaving it as
 * prose only a reader of the source would find.
 *
 * Marked `test.fail()`: this is EXPECTED to fail today (that failure is the
 * acceptance pass's evidence that REQ-3.8.2's practice-history and
 * best-assessment-result clauses are not met by the shipped app — see the
 * M4 report). `test.fail()` makes that an intentional, documented red rather
 * than a silent break future runs would mistake for a real regression to
 * chase; the moment `usePracticeLog.stop()` is wired to `recordSession` and
 * this test starts PASSING, Playwright reports that as a failure of its own
 * ("expected to fail, but passed") — which is exactly the signal the gap has
 * closed and this spec (and its `test.fail()`) should be deleted.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

function navButton(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
}

const keyboard = (page: Page) => page.getByRole('group', { name: 'Play the score' })
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteLabel(note: number): string {
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`
}
const key = (page: Page, note: number) => keyboard(page).getByRole('button', { name: noteLabel(note) })

test('REQ-3.8.2: playing a repertoire piece through the real Practice screen updates its practice history (expected to fail — see M4 report)', async ({
  page,
}) => {
  test.fail()
  test.setTimeout(30_000)
  const errors = collectErrors(page)
  const GREENSLEEVES_TITLE = 'Greensleeves'
  const FIRST_BEAT_PITCHES = [69, 45] as const

  await page.goto('/')
  await navButton(page, 'Repertoire').click()
  const catalogue = page.getByRole('list', { name: 'Graded pieces' })
  const greensleevesRow = catalogue.getByRole('listitem').filter({ hasText: GREENSLEEVES_TITLE })
  await greensleevesRow.getByRole('button', { name: 'Add' }).click()

  const library = page.getByRole('list', { name: 'Repertoire pieces' })
  const libraryRow = library.getByRole('listitem').filter({ hasText: GREENSLEEVES_TITLE })
  await expect(libraryRow.getByText('never practised')).toBeVisible()
  await libraryRow.getByRole('button', { name: 'Open in Practice' }).click()

  await expect(page.getByRole('heading', { name: GREENSLEEVES_TITLE })).toBeVisible()
  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()
  for (const pitch of FIRST_BEAT_PITCHES) await key(page, pitch).click()
  await page.waitForTimeout(1_500)
  await transport.getByRole('button', { name: 'Stop', exact: true }).click()

  await navButton(page, 'Repertoire').click()
  // This is the claim REQ-3.8.2 makes: a real practice session should move
  // the piece off "never practised". It currently does not — the row still
  // reads "never practised" because nothing calls `recordSession`.
  await expect(library.getByRole('listitem').filter({ hasText: GREENSLEEVES_TITLE }).getByText('never practised')).not.toBeVisible()

  expect(errors).toEqual([])
})
