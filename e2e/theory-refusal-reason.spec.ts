import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { chordMidi, chordTones, type Chord } from '../src/core/theory/chords.ts'
import { chordForRomanNumeral } from '../src/core/theory/harmony.ts'
import { keyFromFifths, keyName } from '../src/core/theory/keys.ts'
import { letterAlterDisplayName, midiToName, toMidi, type SpelledPitch } from '../src/core/theory/pitch.ts'
import { scaleNotes } from '../src/core/theory/scales.ts'
import { midi as asMidi } from '../src/core/shared/units.ts'

/**
 * Roadmap `T.19` and `T.39`: a refusal on the theory drill has to say what
 * went wrong, not only what the right answer was.
 *
 * Both were filed against the same line of copy. `Not quite — it was C4, D4,
 * E4, F4, G4, A4, B4, C5` is what a learner reads whether they missed one note
 * of eight or all eight, so it cannot tell them which one to fix (`T.19`); and
 * for a cadence it is worse than uninformative, because the drill polices a
 * convention its prompt never states. `Play a perfect authentic cadence in C
 * major` gives three requirements — V–I, both root position, tonic on top —
 * and `G4 B4 B5` meets all three and is still refused, for doubling the
 * leading tone (`T.39`).
 *
 * Level 1 is deterministic in both topics without seeding an rng:
 * `fifthsPoolForLevel(1)` is `[0]` and `SCALE_TYPES_BY_LEVEL[0]` is
 * `['major']`, so the scale is C major and the cadence is a perfect authentic
 * one in C major. Both prompts are ASSERTED, not assumed, so a content change
 * that widens level 1 fails here loudly instead of quietly grading something
 * else.
 *
 * Neither arm asserts that an element exists or that a screen renders, and
 * neither reads its expectation out of what the app printed: the position the
 * first arm demands is counted from the presses the test itself made, and the
 * note names the second demands come from `core/theory`.
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

/** The chord a roman numeral names in `KEY` — the same core call the drill makes. */
function chordFor(numeral: string): Chord {
  const result = chordForRomanNumeral(numeral, KEY)
  if (!result.ok) throw new Error(`'${numeral}' is not diatonic in ${keyName(KEY)}: ${result.error}`)
  return result.value
}

/** The chord a roman numeral names, as sounding MIDI. */
function chordNotes(numeral: string): readonly number[] {
  return chordMidi(chordFor(numeral))
}

/** A chord's third — the note the leading-tone rule is about, on `V`. */
function thirdOf(numeral: string): SpelledPitch {
  const third = chordTones(chordFor(numeral))[1]
  if (third === undefined) throw new Error(`'${numeral}' has no third`)
  return third
}

async function openTheory(page: Page, topic: string): Promise<void> {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: 'Theory', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Theory', level: 1 })).toBeVisible()
  await page.getByLabel('Topic').selectOption(topic)
}

async function press(page: Page, note: number): Promise<void> {
  await page.getByRole('button', { name: midiToName(asMidi(note)), exact: true }).click()
}

async function playChord(page: Page, notes: readonly number[]): Promise<void> {
  for (const note of notes) await press(page, note)
  await page.getByTestId('theory-submit-chord').click()
}

test('a scale missed part-way names the position that broke, counted from the presses made (T.19)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await openTheory(page, 'build-scale')
  await expect(page.getByTestId('theory-prompt')).toHaveText(`Play ${keyName(KEY)}, ascending.`)

  const scale = scaleNotes(KEY.tonic, 'major', 1).map((p) => toMidi(p) as number)
  // Two degrees right, then the third one a semitone sharp. The position this
  // spec then demands is the length of the run it played, not a number read
  // back off the screen.
  const correctPrefix = scale.slice(0, 2)
  const missedIndex = correctPrefix.length
  const wanted = scale[missedIndex]
  if (wanted === undefined) throw new Error('the scale is shorter than this arm assumes')

  for (const note of correctPrefix) await press(page, note)
  await press(page, wanted + 1)

  const reason = page.getByTestId('theory-feedback-reason')
  await expect(reason).toContainText(`Note ${missedIndex + 1}:`)
  // And it names the note that belonged there, and the one played instead —
  // both built here from core, never matched against the verdict line.
  await expect(reason).toContainText(midiToName(asMidi(wanted)))
  await expect(reason).toContainText(midiToName(asMidi(wanted + 1)))

  // The half that `expected` cannot carry: the verdict line is the same
  // sentence for a miss anywhere in the scale, so the reason is the only thing
  // that separates this attempt from one that got nothing right.
  await expect(page.getByTestId('theory-feedback')).toContainText(
    scale.map((n) => midiToName(asMidi(n))).join(', '),
  )

  expect(errors).toEqual([])
})

test('a cadence refused for doubling the leading tone says so, and the correction it names is accepted (T.39)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await openTheory(page, 'build-cadence')
  await expect(page.getByTestId('theory-prompt')).toHaveText(
    `Play a perfect authentic cadence in ${keyName(KEY)}.`,
  )

  const dominant = chordNotes('V')
  const root = Math.min(...dominant)
  const third = thirdOf('V')
  const thirdMidi = toMidi(third) as number

  // Root, third, and the third again an octave up: a V chord in root position
  // with the tonic-on-top rule not yet in play. Every requirement the prompt
  // states is met, and the drill refuses it.
  await playChord(page, [root, thirdMidi, thirdMidi + 12])

  const reason = page.getByTestId('theory-feedback-reason')
  await expect(reason).toContainText('First chord:')
  await expect(reason).toContainText('leading tone')
  // Named by note, because "the leading tone" alone leaves a learner hunting
  // for which of the three they played it was.
  await expect(reason).toContainText(letterAlterDisplayName(third.letter, third.alter))

  // Now act on that sentence and nothing else: sound the leading tone once.
  // This is the whole claim — the refusal is actionable, so the next attempt
  // is a correction rather than a guess.
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByTestId('theory-prompt')).toHaveText(
    `Play a perfect authentic cadence in ${keyName(KEY)}.`,
  )

  const tonic = chordNotes('I')
  await playChord(page, dominant)
  await playChord(page, [...tonic, Math.min(...tonic) + 12])

  await expect(page.getByTestId('theory-feedback')).toHaveText('Correct')
  await expect(page.getByTestId('theory-feedback-reason')).toHaveCount(0)

  expect(errors).toEqual([])
})
