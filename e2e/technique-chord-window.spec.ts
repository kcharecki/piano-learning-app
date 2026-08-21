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
 * E2E proof for roadmap T.11 — "`MATCHER_DEFAULTS.chordWindowMs` (80ms) is a
 * cliff at both ends".
 *
 * ## The cliff
 *
 * A written chord arrives as separate presses, so something has to decide
 * which presses are one onset before evenness sees them. That decision used to
 * be a flat 80ms, and the roadmap measured what a flat number does on THIS
 * drill: a chord rolled 30ms per note gave 8 onsets, evenness 100%, clean; the
 * same run rolled 45ms per note gave 16 onsets and 0%.
 *
 * 15ms is not the difference between mastery and failure. The learner it was
 * found on has no MIDI keyboard and strikes three notes with one mouse
 * pointer, at roughly 100ms of spread — permanently on the far side of the
 * cliff, and told they were playing unevenly when what they were doing was
 * using a mouse.
 *
 * ## What this spec drives
 *
 * The same drill, twice, on the same page, with nothing different between the
 * two runs except how far each chord is rolled: 30ms per note (60ms of spread)
 * and then 50ms per note (100ms of spread — the mouse-pointer figure). Every
 * chord's FIRST press lands exactly on its written tick in both runs, so the
 * two runs are the same performance played with a wider and a narrower roll,
 * and any difference in the verdict is the window's doing and nothing else.
 *
 * Two things are asserted, and they pull in opposite directions on purpose:
 *
 *  1. **The verdict does not change.** Same evenness, same accuracy, same
 *     clean/not-clean. That is the cliff being gone.
 *  2. **The roll is still reported, and it is reported bigger for the bigger
 *     roll.** That is the widened window not hiding anything — the spread
 *     comes out in words next to the verdict rather than folded into the
 *     evenness figure, where a learner cannot tell it apart from a timing
 *     fault they do not have.
 *
 * The fast end of the cliff (at ♩=300 a triplet gap is 66.7ms, so an 80ms
 * window swallowed notes the score wrote as separate) is not driven here: at
 * 66.7ms spacing the harness's own `LEAD_MS` is 50ms, so the schedule would be
 * measuring the fixture. It is pinned deterministically instead, against this
 * same drill's real score, in `src/core/technique/onsets.test.ts` — plus the
 * property that the window can never reach the next written onset at ANY
 * tempo, which is the general form of that defect.
 */
const DRILL_ID = 'triad-sequence-c-major-solid-hands-right'

const NOTE_HOLD_MS = 250
const NOTES_PER_TRIAD = 3

/** The narrow roll — comfortably inside the old 80ms window, graded perfect. */
const TIGHT_PER_NOTE_MS = 30
/** The learner's own measured roll — one mouse pointer, three notes, ~100ms. */
const LOOSE_PER_NOTE_MS = 50

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

/**
 * The drill's own notes, every chord rolled `perNoteMs` apart, with each
 * chord's first press exactly on its written tick.
 */
function rolledEvents(perNoteMs: number): {
  readonly events: readonly RelativeFakeMidiEvent[]
  readonly chords: number
} {
  const drill = techniqueLibrary(1).find((d) => d.id === DRILL_ID)
  if (drill === undefined) throw new Error(`expected drill "${DRILL_ID}" in the level-1 library`)

  const score = techniqueScore(drill, drill.targetBpm)
  const tempo = makeTempoMap(score.tempos)
  const barTicks = measureDurationTicks(score.measures[0]?.timeSignature ?? DEFAULT_TIME_SIGNATURE)
  const countInMs = tickToMs(tempo, barTicks) as number

  const byTick = new Map<number, number[]>()
  for (const note of score.notes) {
    byTick.set(note.startTick, [...(byTick.get(note.startTick) ?? []), note.midi])
  }

  const events: RelativeFakeMidiEvent[] = []
  for (const [startTick, notes] of [...byTick.entries()].sort((a, b) => a[0] - b[0])) {
    const onsetMs = countInMs + (tickToMs(tempo, startTick) as number)
    notes.forEach((note, i) => {
      const at = onsetMs + i * perNoteMs
      events.push({ type: 'on', note, offsetMs: at })
      events.push({ type: 'off', note, offsetMs: at + NOTE_HOLD_MS })
    })
  }
  return { events, chords: byTick.size }
}

/** One driven run; returns the verdict exactly as it reads on screen. */
async function drive(
  page: Page,
  perNoteMs: number,
): Promise<{ readonly text: string; readonly roll: string | null; readonly chords: number }> {
  const { events, chords } = rolledEvents(perNoteMs)
  await armFakeMidiOnClick(page, 'Start', events)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled()
  await waitForArmedFakeMidiSchedule(page)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  const result = page.getByTestId('technique-result')
  await expect(result).toBeVisible()
  const score = page.getByTestId('technique-result').locator('.technique-result-score')
  await expect(score).toBeVisible()

  const rollLine = page.getByTestId('technique-roll')
  const roll = (await rollLine.count()) === 0 ? null : ((await rollLine.textContent()) ?? '')
  return { text: (await score.textContent()) ?? '', roll, chords }
}

/** `Evenness 96% · Notes 100% — ...` -> `96`. */
function percentAfter(label: string, text: string): number {
  const found = new RegExp(`${label} (\\d+)%`).exec(text)
  if (found?.[1] === undefined) throw new Error(`expected "${label} N%" in "${text}"`)
  return Number(found[1])
}

test('a chord rolled 30ms per note and the same chord rolled 50ms get the same verdict (roadmap T.11)', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')
  await nav(page, 'Technique').click()
  await expect(page.getByRole('heading', { name: /technique/i })).toBeVisible()

  const drill = techniqueLibrary(1).find((d) => d.id === DRILL_ID)
  if (drill === undefined) throw new Error(`expected drill "${DRILL_ID}" in the level-1 library`)
  await page.getByLabel('Drill', { exact: true }).selectOption({ label: drill.title })

  const tight = await drive(page, TIGHT_PER_NOTE_MS)
  const loose = await drive(page, LOOSE_PER_NOTE_MS)

  // Attached to the report so the two verdicts can be read side by side, which
  // is the form the roadmap entry asked this proof to take. Annotations rather
  // than `console.log` because the lint gate allows no bare console statements —
  // and these belong to the run's record, not to its stdout.
  const verdict = (perNoteMs: number, run: { text: string; roll: string | null }): string =>
    `rolled ${String(perNoteMs)}ms/note: ${run.text} | ${run.roll ?? 'no roll reported'}`
  test
    .info()
    .annotations.push(
      { type: 'T.11 verdict', description: verdict(TIGHT_PER_NOTE_MS, tight) },
      { type: 'T.11 verdict', description: verdict(LOOSE_PER_NOTE_MS, loose) },
    )

  // 1. The cliff is gone. Under the flat 80ms the wider roll scored 0% and lost
  //    its "clean"; the two runs now agree on every figure the screen shows.
  expect(percentAfter('Evenness', loose.text)).toBe(percentAfter('Evenness', tight.text))
  expect(percentAfter('Notes', loose.text)).toBe(percentAfter('Notes', tight.text))
  expect(percentAfter('Notes', loose.text)).toBe(100)
  expect(percentAfter('Evenness', loose.text)).toBeGreaterThanOrEqual(95)
  expect(loose.text).toContain(`Clean at ${String(drill.targetBpm)}bpm`)
  expect(tight.text).toContain(`Clean at ${String(drill.targetBpm)}bpm`)

  // 2. Nothing was hidden to get there. Both rolls are named, the wider one is
  //    named as wider, and the spread is the one that was actually played:
  //    three notes `perNoteMs` apart is `2 * perNoteMs` of spread.
  expect(tight.roll).not.toBeNull()
  expect(loose.roll).not.toBeNull()
  const spreadOf = (roll: string): number => {
    const found = /up to (\d+)ms/.exec(roll)
    if (found?.[1] === undefined) throw new Error(`expected a spread in "${roll}"`)
    return Number(found[1])
  }
  expect(spreadOf(tight.roll ?? '')).toBeCloseTo((NOTES_PER_TRIAD - 1) * TIGHT_PER_NOTE_MS, -1)
  expect(spreadOf(loose.roll ?? '')).toBeCloseTo((NOTES_PER_TRIAD - 1) * LOOSE_PER_NOTE_MS, -1)
  expect(spreadOf(loose.roll ?? '')).toBeGreaterThan(spreadOf(tight.roll ?? ''))
  expect(loose.roll).toContain(`${String(loose.chords)} chords were rolled`)

  expect(errors).toEqual([])
})

test('a chord struck together is not accused of being rolled (roadmap T.11 control)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')
  await nav(page, 'Technique').click()

  const drill = techniqueLibrary(1).find((d) => d.id === DRILL_ID)
  if (drill === undefined) throw new Error(`expected drill "${DRILL_ID}" in the level-1 library`)
  await page.getByLabel('Drill', { exact: true }).selectOption({ label: drill.title })

  const together = await drive(page, 0)
  // A line printed after every run is a line nobody reads: the roll line is
  // absent entirely, not "0ms".
  expect(together.roll).toBeNull()
  expect(percentAfter('Notes', together.text)).toBe(100)

  expect(errors).toEqual([])
})
