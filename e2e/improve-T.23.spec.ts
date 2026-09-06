import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { chordMidi } from '../src/core/theory/chords.ts'
import { chordForRomanNumeral } from '../src/core/theory/harmony.ts'
import { keyFromFifths, keyName } from '../src/core/theory/keys.ts'
import { midiToName } from '../src/core/theory/pitch.ts'
import { midi as asMidi } from '../src/core/shared/units.ts'

/**
 * Claim spec for /improve-app run 2026-09-06-2 (roadmap `T.23`, thread
 * `pac-voice-leading`). Committed RED, before the fix.
 *
 * ## The claim
 *
 * After this ships, a learner on the Cadence topic who plays a perfect
 * authentic cadence the way a teacher writes one — V then a complete
 * root-position tonic triad with the tonic on top — is told they are right,
 * and the answer the drill names when they are wrong is a chord that has its
 * fifth.
 *
 * ## What it was before
 *
 * Driven 2026-09-07 (`runs/2026-09-06-2/drive.md` arm C): prompt
 * `Play a perfect authentic cadence in C major.`, played `G4 B4 D5` then
 * `C4 E4 G4 C5`, answered `Not quite — it was G4 + B4 + D5, C4 + E4 + C5`.
 * Two separate defects, one commit apart in the same file:
 *
 * - `finalChordPitches` (`core/drills/theory.ts`) built the tonic chord by
 *   REPLACING the triad's top note with the root an octave up, deleting the
 *   fifth. So the answer the drill named — and the only one it accepted — was
 *   a tonic chord with no fifth. That is roadmap `T.23`.
 * - `groupsMatch` rejects on `expected.length !== played.length` before it
 *   compares a single pitch, so a four-note realisation of a three-note
 *   expectation loses on note count alone. The drill graded one voicing, not
 *   the cadence.
 *
 * ## Why this condition can fail
 *
 * The definition it grades against, and the one this spec encodes:
 *
 * > "The Perfect Authentic Cadence must meet three requirements: 1. V–I
 * > 2. Both chords in root position 3. Tonic scale degree (1̂) in the highest
 * > voice of the tonic chord" — University of Puget Sound, fetched 2026-09-06.
 *
 * `C4 E4 G4 C5` meets all three; `C4 E4 G4` meets the first two and not the
 * third, which makes it an IMPERFECT authentic cadence. So the spec has two
 * arms and needs BOTH to pass, and they pull in opposite directions:
 *
 * 1. the correct realisation must be accepted, which fails today; and
 * 2. the imperfect one must still be refused, which fails against any fix
 *    that buys arm 1 by loosening the grader into accepting the right pitch
 *    classes in any arrangement.
 *
 * A fix that deletes the soprano requirement passes arm 1 and fails arm 2. A
 * fix that only re-spells the reveal without touching the grader fails arm 1.
 * Neither arm asserts that an element exists or that a screen renders.
 *
 * Level 1 draws exactly one cadence type and exactly one key —
 * `CADENCES_BY_LEVEL[0]` is `[PERFECT_AUTHENTIC]` and `fifthsPoolForLevel(1)`
 * is `[0]` — so the prompt is deterministic without seeding an rng. It is
 * asserted rather than assumed, so a content change that widens level 1 fails
 * this spec loudly instead of quietly grading something else.
 */

const KEY = keyFromFifths(0, 'major')

/** Console/page errors, collected from page creation (see e2e/deck-routing.spec.ts). */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

/** The chord a roman numeral names in `KEY`, as sounding MIDI — the same core
 *  path `makeCadenceItem` uses, never a hardcoded pitch list. */
function chordNotes(numeral: string): readonly number[] {
  const result = chordForRomanNumeral(numeral, KEY)
  if (!result.ok) throw new Error(`'${numeral}' is not diatonic in ${keyName(KEY)}: ${result.error}`)
  return chordMidi(result.value)
}

/** Open the Theory screen's Cadence topic at level 1 and return its prompt. */
async function openCadenceDrill(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('navigation', { name: /main/i }).getByRole('button', { name: 'Theory', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Theory', level: 1 })).toBeVisible()
  await page.getByLabel('Topic').selectOption('build-cadence')
  await expect(page.getByTestId('theory-prompt')).toHaveText(
    `Play a perfect authentic cadence in ${keyName(KEY)}.`,
  )
}

async function play(page: Page, notes: readonly number[]): Promise<void> {
  for (const note of notes) {
    await page.getByRole('button', { name: midiToName(asMidi(note)), exact: true }).click()
  }
}

test('a perfect authentic cadence played the way a teacher writes one is marked correct (T.23)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await openCadenceDrill(page)

  const dominant = chordNotes('V')
  const tonic = chordNotes('I')
  const tonicRoot = Math.min(...tonic)
  // Root position, complete triad, tonic scale degree in the highest voice —
  // all three of the requirements quoted above.
  const tonicWithTonicSoprano = [...tonic, tonicRoot + 12]

  await play(page, dominant)
  await play(page, tonicWithTonicSoprano)

  await expect(page.getByTestId('theory-feedback')).toHaveText('Correct')
  // The other half: only `commitAnswer` can create a card, so this separates a
  // graded attempt from a rendered string.
  await expect(page.getByTestId('theory-stats-total')).toHaveText('1')

  expect(errors).toEqual([])
})

test('an imperfect authentic cadence is still refused, and the answer named has its fifth (T.23)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await openCadenceDrill(page)

  const dominant = chordNotes('V')
  // Root position and complete, but the FIFTH is the highest voice, so this is
  // an imperfect authentic cadence and the drill must not call it perfect.
  const tonicWithFifthSoprano = chordNotes('I')

  await play(page, dominant)
  await play(page, tonicWithFifthSoprano)

  const feedback = page.getByTestId('theory-feedback')
  await expect(feedback).toContainText('Not quite')

  // And the answer it names is a tonic chord that HAS its fifth — the whole of
  // `T.23`. Built from the same core call, so this cannot pass by matching a
  // string this spec invented.
  const tonic = chordNotes('I')
  const named = [...tonic, Math.min(...tonic) + 12].map((n) => midiToName(asMidi(n))).join(' + ')
  await expect(feedback).toContainText(named)

  expect(errors).toEqual([])
})
