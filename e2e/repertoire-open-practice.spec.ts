import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { expandRepertoireLevelGroup } from './repertoire-helpers.ts'

/**
 * E2E proof for roadmap 5.2 (REQ-3.8.2, closing the loop 5.1 opened): the
 * graded catalogue's "Add" button used to be a dead end — a piece joined the
 * library with no way to open, view or play it. `RepertoireScreen` now
 * renders an "Open in Practice" control (only for pieces whose `scoreId`
 * resolves to a bundled file — see `useRepertoire.ts`'s `canOpenInPractice`)
 * that loads the piece into `scoreStore` and navigates to Practice, the same
 * `openDemoScore`/`onOpenDemo` split roadmap 4.9b/5.9b established for a
 * lesson's demonstration.
 *
 * The app opens on Practice with the bundled Twinkle sample already loaded, so
 * that is this spec's "a different score loaded first" — landing on
 * Greensleeves afterwards cannot be satisfied by an implementation that did
 * nothing.
 *
 * Roadmap UI-26: Greensleeves is a level-3 catalogue entry, collapsed by
 * default on a fresh (level 1) profile — see `e2e/repertoire-helpers.ts`'s
 * own doc comment for why every spec that drives a catalogue row expands its
 * group through that one shared helper.
 */

const GREENSLEEVES_TITLE = 'Greensleeves'
/** The pitches sounding at tick 0 of the bundled Greensleeves score — right
 * hand A4 and left hand A2 (see src/content/scores/greensleeves.musicxml). */
const FIRST_BEAT_PITCHES = [69, 45] as const

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
/** Mirrors `core/theory/pitch.ts`'s `midiToName` default (sharp) spelling — e2e specs stay free of `@core` imports by design, so this is a small, deliberate duplicate. */
function noteLabel(note: number): string {
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`
}

const key = (page: Page, note: number) => keyboard(page).getByRole('button', { name: noteLabel(note) })

test('adding a graded piece and opening it in Practice loads and plays that piece (roadmap 5.2)', async ({
  page,
}) => {
  test.setTimeout(45_000)
  const errors = collectErrors(page)

  await page.goto('/practice')

  // The default landing score — proves the piece below is a real switch, not
  // a no-op that happened to already show the right thing.
  await expect(page.getByRole('heading', { name: 'Twinkle, Twinkle, Little Star' })).toBeVisible()

  await navButton(page, 'Repertoire').click()
  await expandRepertoireLevelGroup(page, GREENSLEEVES_TITLE)
  // Roadmap UI-26 gives each level group its own list, so scope to the
  // section rather than to a single (no longer unique) "Graded pieces" list.
  const catalogue = page.getByRole('region', { name: 'Graded library' })
  const greensleevesRow = catalogue.getByRole('listitem').filter({ hasText: GREENSLEEVES_TITLE })
  await greensleevesRow.getByRole('button', { name: 'Add' }).click()

  const library = page.getByRole('list', { name: 'Repertoire pieces' })
  const libraryRow = library.getByRole('listitem').filter({ hasText: GREENSLEEVES_TITLE })
  await expect(libraryRow.getByRole('button', { name: 'Open in Practice' })).toBeVisible()
  await libraryRow.getByRole('button', { name: 'Open in Practice' }).click()

  // Navigated to Practice, and it is the piece that was just opened.
  await expect(page.getByRole('heading', { name: GREENSLEEVES_TITLE })).toBeVisible()
  const score = page.getByTestId('score-container')
  await expect(score.locator('svg')).toBeVisible({ timeout: 15_000 })
  expect(await score.locator('svg *').count()).toBeGreaterThan(50)

  // Not just engraved — playable. Real notes, graded by the real matcher.
  // Roadmap UI-09: the feedback strip moved under the score and does not
  // render at all until playback/input has started, so it only exists (and
  // starts honest at 0) once Play has been clicked.
  const transport = page.getByRole('group', { name: 'Transport' })
  await transport.getByRole('button', { name: 'Play', exact: true }).click()

  const correct = page.getByTestId('feedback-correct')
  const accuracy = page.getByTestId('feedback-accuracy')
  await expect(correct).toHaveText('0')

  for (const pitch of FIRST_BEAT_PITCHES) await key(page, pitch).click()

  await expect(async () => {
    expect(Number(await correct.textContent())).toBeGreaterThan(0)
  }).toPass({ timeout: 10_000 })
  await expect(accuracy).not.toHaveText('0%')

  await transport.getByRole('button', { name: 'Stop', exact: true }).click()
  expect(errors).toEqual([])
})
