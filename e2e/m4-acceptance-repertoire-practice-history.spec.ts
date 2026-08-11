import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * roadmap 4.10 (M4 acceptance pass) — REQ-3.8.2 says a repertoire piece
 * "SHALL... store practice history... and best assessment result." This
 * drives the real, only user-facing path to that: add a graded piece, open
 * it in Practice (as `e2e/repertoire-open-practice.spec.ts` already proves
 * works), actually play it, then go back to Repertoire and check whether
 * that practice moved the piece off "never practised".
 *
 * It now does. `src/app/practice/usePracticeLog.ts`'s `stop()` (and its
 * unmount safety net) now call `useRepertoireStore.getState().recordSession`
 * when the finished entry is a `'repertoire'`-kind session whose `itemId`
 * (the loaded score's id) matches a library piece's `scoreId` and the
 * session ran at least a second — see that file's module comment for the
 * full wiring and why the duration floor exists. This spec was previously
 * marked `test.fail()` to document the gap (see the M4 acceptance report,
 * `docs/m4-acceptance-2026-08-11.md`, Defect 1); now that the wiring lands,
 * it asserts the real behaviour.
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

test('REQ-3.8.2: playing a repertoire piece through the real Practice screen updates its practice history', async ({
  page,
}) => {
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
  // the piece off "never practised" — `usePracticeLog.stop()` now calls
  // `recordSession` for it (see that file's module comment).
  await expect(library.getByRole('listitem').filter({ hasText: GREENSLEEVES_TITLE }).getByText('never practised')).not.toBeVisible()

  expect(errors).toEqual([])
})
