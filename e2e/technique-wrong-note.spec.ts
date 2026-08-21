import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import {
  installFakeMidi,
  armFakeMidiOnClick,
  waitForArmedFakeMidiSchedule,
  type RelativeFakeMidiEvent,
} from './fake-midi.ts'
import { techniqueLibrary, techniqueScore } from '../src/core/technique/library.ts'
import { measureDurationTicks, type TimeSignature } from '../src/core/notation/score.ts'
import { makeTempoMap, tickToMs } from '../src/core/timing/tempo.ts'

/**
 * E2E proof for roadmap T.12 — "the technique verdict cannot name a wrong
 * note".
 *
 * Before this, the result region held one line: `Evenness 88% — Not yet
 * clean`. The learner's own stated goal that week was knowing WHICH note was
 * wrong, and the app had computed exactly that (`NoteMatcher` produces a
 * `wrongPitch` result carrying both the expected `ScoreNote` and the played
 * MIDI number) and then reduced it to a single accuracy figure it did not
 * even display.
 *
 * ## The run this spec drives
 *
 * The RCM Preparatory A triad sequence, played with every triad turned MINOR
 * — the middle note of each group flattened by a semitone, which is the
 * mistake the roadmap entry was filed about. Every onset lands exactly on its
 * tick: the timing is perfect, so nothing the screen says about wrong notes
 * can have leaked in from the evenness half of the verdict.
 *
 * Eight triads means eight distinct substitutions, so this also drives the
 * cap: `TechniqueScreen`'s `MAX_SHOWN_MISTAKES` spells out three and counts
 * the rest, because a learner who cannot hold three corrections cannot hold
 * eight.
 *
 * The degree names are the point of the assertion, not decoration. `E♭4` on
 * its own does not tell a beginner what they did; "where the 3rd (E4)
 * belongs" does, and getting there needs the DRILL's key — read off the drill
 * in `useTechniqueDrill`, not assumed to be C, which is what
 * `verdict.test.ts` pins with an E-flat major counterexample.
 */
const DRILL_ID = 'triad-sequence-c-major-broken-hands-right'

/** The middle note of a root-position triad, in a score sorted by tick. */
const THIRD_OF_EACH_TRIAD = 1
const NOTES_PER_TRIAD = 3
const NOTE_HOLD_MS = 300

const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }

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

test('a run played with every triad minor is told which note was wrong, and on which degree (roadmap T.12)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')
  await nav(page, 'Technique').click()
  await expect(page.getByRole('heading', { name: /technique/i })).toBeVisible()

  const drill = techniqueLibrary(1).find((d) => d.id === DRILL_ID)
  if (drill === undefined) throw new Error(`expected drill "${DRILL_ID}" in the level-1 library`)
  await page.getByLabel('Drill', { exact: true }).selectOption({ label: drill.title })

  const bpm = drill.targetBpm
  const score = techniqueScore(drill, bpm)
  const ordered = [...score.notes].sort((a, b) => a.startTick - b.startTick)
  const triads = ordered.length / NOTES_PER_TRIAD
  expect(Number.isInteger(triads)).toBe(true)

  const tempo = makeTempoMap(score.tempos)
  const barTicks = measureDurationTicks(score.measures[0]?.timeSignature ?? DEFAULT_TIME_SIGNATURE)
  const countInMs = tickToMs(tempo, barTicks) as number

  // Every pitch comes out of the drill's own score. The only edit is the
  // flattened third — no hardcoded MIDI numbers, and no timing error at all.
  const events: RelativeFakeMidiEvent[] = []
  ordered.forEach((note, k) => {
    const isThird = k % NOTES_PER_TRIAD === THIRD_OF_EACH_TRIAD
    const played = isThird ? note.midi - 1 : note.midi
    const onOffset = countInMs + (tickToMs(tempo, note.startTick) as number)
    events.push({ type: 'on', note: played, offsetMs: onOffset })
    events.push({ type: 'off', note: played, offsetMs: onOffset + NOTE_HOLD_MS })
  })

  await armFakeMidiOnClick(page, 'Start', events)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled()
  await waitForArmedFakeMidiSchedule(page)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  const result = page.getByTestId('technique-result')
  await expect(result).toBeVisible()

  // The correction itself: the note played, the note that belonged there, and
  // the degree of the drill's key it stands on.
  const mistakes = page.getByTestId('technique-mistakes')
  await expect(mistakes).toBeVisible()
  await expect(mistakes.getByRole('listitem')).toHaveText([
    'You played E♭4 where the 3rd (E4) belongs.',
    'You played F♭4 where the 4th (F4) belongs.',
    'You played G♭4 where the 5th (G4) belongs.',
  ])
  // Not the enharmonic. `fromMidi(63)` is D#4, and "you played D♯4 where E4
  // belongs" is a sentence about two unrelated notes.
  await expect(result).not.toContainText('D♯4')

  // Eight triads, three spelled out, the rest counted rather than listed.
  await expect(result).toContainText(`And ${String(triads - 3)} other wrong notes.`)

  // The accuracy figure the screen used to compute and throw away is now on
  // screen beside the evenness — and this run, played perfectly in time, is
  // proof the two halves are independent: the timing is flawless and the
  // verdict is still "not yet clean".
  const resultText = (await result.textContent()) ?? ''
  const notes = /Notes (\d+)%/.exec(resultText)
  if (notes?.[1] === undefined) {
    throw new Error(`expected a Notes percentage in "${resultText}"`)
  }
  // Two of every three notes right: the roots and fifths landed, the thirds
  // did not. A screen that reported 100% here would be reporting the timing.
  expect(Number(notes[1])).toBe(Math.round((100 * (NOTES_PER_TRIAD - 1)) / NOTES_PER_TRIAD))
  expect(resultText).toContain('Not yet clean')

  expect(errors).toEqual([])
})

test('a correct run says nothing about wrong notes (roadmap T.12 control)', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')
  await nav(page, 'Technique').click()

  const drill = techniqueLibrary(1).find((d) => d.id === DRILL_ID)
  if (drill === undefined) throw new Error(`expected drill "${DRILL_ID}" in the level-1 library`)
  await page.getByLabel('Drill', { exact: true }).selectOption({ label: drill.title })

  const score = techniqueScore(drill, drill.targetBpm)
  const ordered = [...score.notes].sort((a, b) => a.startTick - b.startTick)
  const tempo = makeTempoMap(score.tempos)
  const barTicks = measureDurationTicks(score.measures[0]?.timeSignature ?? DEFAULT_TIME_SIGNATURE)
  const countInMs = tickToMs(tempo, barTicks) as number

  const events: RelativeFakeMidiEvent[] = []
  for (const note of ordered) {
    const onOffset = countInMs + (tickToMs(tempo, note.startTick) as number)
    events.push({ type: 'on', note: note.midi, offsetMs: onOffset })
    events.push({ type: 'off', note: note.midi, offsetMs: onOffset + NOTE_HOLD_MS })
  }

  await armFakeMidiOnClick(page, 'Start', events)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled()
  await waitForArmedFakeMidiSchedule(page)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  const result = page.getByTestId('technique-result')
  await expect(result).toBeVisible()
  // The corrections list does not exist at all — a clean run gets a verdict,
  // not an empty "mistakes" heading with nothing under it.
  await expect(page.getByTestId('technique-mistakes')).toHaveCount(0)
  await expect(result).toContainText('Notes 100%')
  await expect(result).not.toContainText('You played')

  expect(errors).toEqual([])
})
