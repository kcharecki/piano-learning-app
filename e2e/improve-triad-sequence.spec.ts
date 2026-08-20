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
 * `/improve-app` run 2026-08-20-1 — the claim spec for the `triad-sequence`
 * gap. Committed RED, before the implementation, and it is the proof at §7
 * that the gap closed rather than that the screen still renders.
 *
 * The gap (source 1d, class VOID): the RCM Piano Syllabus 2022 requires, at
 * Preparatory A, a sequence of triads on every degree of the scale — broken
 * and solid, hands separately, one octave ascending. Nothing in this app
 * teaches it. `techniqueLibrary(1)` offers six five-finger patterns and
 * nothing else; the only chord drill in the whole library
 * (`chord-inversions-*`) is gated to level 3 and teaches *inversions*, which
 * are not Preparatory material.
 *
 * The claim this spec asserts:
 *
 * > After this ships, a learner who is at level 1 and has never played a
 * > chord in this app will be able to practise the RCM Preparatory A triad
 * > sequence in C major — the eight root-position diatonic triads, broken
 * > and solid, one octave ascending, hands separately — and get a
 * > clean-at-tempo verdict on it, and we will know because the level-1
 * > Technique picker offers the triad-sequence drills, and a correct run
 * > writes a clean `TechniqueAttempt` for
 * > `triad-sequence-c-major-broken-hands-right` into the `techniqueHistory`
 * > IndexedDB store, which the "Best clean tempo" readout and the Progress
 * > "Technique tempo" card then show.
 *
 * ## Why this asserts the notes, not just that a drill appeared
 *
 * A drill registered at level 1 under the right title, playing a C major
 * scale, would satisfy every screen assertion below and teach none of the
 * skill. So the pitches are asserted first, against the sequence read off
 * the rendered syllabus page: C-E-G, D-F-A, E-G-B, F-A-C, G-B-D, A-C-E,
 * B-D-F, C-E-G, all root position, all ascending, no descent. Those are
 * *this* drill's notes, not a general property of the feature — the
 * generalisation to another key is the run's held-out goal and is
 * deliberately not named here.
 *
 * ## Why the run is deliberately imperfect
 *
 * As in `e2e/technique-drill.spec.ts`: every onset is nudged by an
 * alternating +/-`JITTER_MS`, so the evenness readout lands strictly inside
 * (0%, 100%) and a screen rendering a hardcoded 100% fails an assertion a
 * genuinely-computed one passes. Played dead flat, this drill scores exactly
 * 100% — measured, not assumed, so the jitter below is the only thing keeping
 * the assertion honest.
 *
 * The arithmetic, which is NOT `1 - 2*JITTER/gap`. At 60bpm an eighth is
 * 500ms and this drill has 24 onsets, so 23 gaps alternating (500 - 2J) and
 * (500 + 2J) — twelve short, eleven long. `evennessOf` divides by the
 * **median** gap, and the median of twelve shorts and eleven longs is the
 * SHORT one, not 500. So the worst gap sits 4J above a (500 - 2J) median:
 *
 *     evenness = 1 - (4J / (500 - 2J)) / 0.5 = 1 - 8J / (500 - 2J)
 *
 * J=8 gives 1 - 64/484 = 0.868, i.e. the 87% the assertions below band. (The
 * first draft of this spec used J=15 and predicted 88% from the wrong
 * formula; the app returned 74%, which this formula predicts exactly — the
 * spec's arithmetic was wrong, the app's evenness was right.) J=8 keeps the
 * run inside `MATCHER_DEFAULTS.toleranceMs` (150ms, so accuracy stays 1) and
 * above `CLEAN_EVENNESS_THRESHOLD` (0.8, so the run is clean and earns its
 * tempo-history point).
 */

const DB_NAME = 'piano-learning-app'
const DRILL_ID = 'triad-sequence-c-major-broken-hands-right'
const DRILL_TITLE = 'C major triad sequence, broken, right hand'
const SOLID_DRILL_TITLE = 'C major triad sequence, solid, right hand'

/**
 * The eight root-position diatonic triads of C major, ascending one octave,
 * broken — read off the engraved Preparatory A page of the RCM Piano
 * Syllabus 2022 (p. 121), note by note, and written here as MIDI numbers.
 */
const EXPECTED_MIDI: readonly number[] = [
  60,
  64,
  67, // C4 E4 G4
  62,
  65,
  69, // D4 F4 A4
  64,
  67,
  71, // E4 G4 B4
  65,
  69,
  72, // F4 A4 C5
  67,
  71,
  74, // G4 B4 D5
  69,
  72,
  76, // A4 C5 E5
  71,
  74,
  77, // B4 D5 F5
  72,
  76,
  79, // C5 E5 G5
]

const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatType: 4 }
const JITTER_MS = 8
const NOTE_HOLD_MS = 300

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

/** One key of one store of the app's real IndexedDB — as `e2e/technique-drill.spec.ts`. */
async function readStored(page: Page, collection: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, storeName, storeKey }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.close()
            reject(new Error(`object store "${storeName}" does not exist in database "${dbName}"`))
            return
          }
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(storeKey)
          request.onerror = () => {
            db.close()
            reject(request.error)
          }
          request.onsuccess = () => {
            db.close()
            resolve(request.result as unknown)
          }
        }
      }),
    { dbName: DB_NAME, storeName: collection, storeKey: key },
  )
}

type StoredAttempt = { readonly drillId?: string; readonly bpm?: number; readonly clean?: boolean }

async function readTechniqueAttempts(page: Page): Promise<readonly StoredAttempt[]> {
  const stored = (await readStored(page, 'techniqueHistory', 'techniqueHistory')) as
    { readonly attempts?: readonly StoredAttempt[] } | readonly StoredAttempt[] | undefined
  if (Array.isArray(stored)) return stored
  if (stored !== undefined && 'attempts' in stored) return stored.attempts ?? []
  return []
}

test('a level-1 learner can practise the RCM Preparatory A triad sequence and get a clean-at-tempo verdict (improve-app 2026-08-20-1)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)

  await installFakeMidi(page)
  await page.goto('/')
  await nav(page, 'Technique').click()
  await expect(page.getByRole('heading', { name: /technique/i })).toBeVisible()

  // Level 1 — the state the claim names. Not stepped up: the whole point is
  // that a learner who has never played a chord here finds this drill at the
  // level they are already on.
  const levelStepper = page.getByRole('group', { name: 'Level' })
  await expect(levelStepper.getByTestId('technique-level')).toHaveText('1')

  // The picker offers the sequence, in both forms the syllabus requires.
  const picker = page.getByLabel('Drill', { exact: true })
  const offered = await picker.locator('option').allTextContents()
  expect(offered).toContain(DRILL_TITLE)
  expect(offered).toContain(SOLID_DRILL_TITLE)

  const drill = techniqueLibrary(1).find((d) => d.id === DRILL_ID)
  if (drill === undefined) throw new Error(`expected drill "${DRILL_ID}" in the level-1 library`)

  // The notes, before anything is played: the eight root-position triads of
  // the syllabus page, ascending, right hand, and nothing else.
  const bpm = drill.targetBpm
  const score = techniqueScore(drill, bpm)
  const ordered = [...score.notes].sort((a, b) => a.startTick - b.startTick)
  expect(ordered.map((n) => n.midi)).toEqual(EXPECTED_MIDI)
  expect(ordered.every((n) => n.hand === 'right')).toBe(true)
  // Broken, not blocked: 24 separate onsets, never three notes on one tick.
  expect(new Set(ordered.map((n) => n.startTick)).size).toBe(EXPECTED_MIDI.length)

  await picker.selectOption({ label: drill.title })

  const tempo = makeTempoMap(score.tempos)
  const barTicks = measureDurationTicks(score.measures[0]?.timeSignature ?? DEFAULT_TIME_SIGNATURE)
  const countInMs = tickToMs(tempo, barTicks) as number

  // Every pitch played comes out of the drill's own score — never hardcoded.
  const events: RelativeFakeMidiEvent[] = []
  ordered.forEach((note, k) => {
    const baseMs = tickToMs(tempo, note.startTick) as number
    const onOffset = countInMs + baseMs + (k % 2 === 0 ? JITTER_MS : -JITTER_MS)
    events.push({ type: 'on', note: note.midi, offsetMs: onOffset })
    events.push({ type: 'off', note: note.midi, offsetMs: onOffset + NOTE_HOLD_MS })
  })

  const attemptsBefore = await readTechniqueAttempts(page)

  await armFakeMidiOnClick(page, 'Start', events)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled()
  await waitForArmedFakeMidiSchedule(page)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()

  const result = page.getByTestId('technique-result')
  await expect(result).toBeVisible()
  const resultText = (await result.textContent()) ?? ''
  const match = /Evenness (\d+)%/.exec(resultText)
  if (match?.[1] === undefined) {
    throw new Error(`could not parse an evenness percentage out of "${resultText}"`)
  }
  const evennessPercent = Number(match[1])
  // The band the JITTER_MS arithmetic predicts (86.8% -> "87%") — a hardcoded
  // 100% fails this, and so does a run the matcher judged inaccurate.
  expect(evennessPercent).toBeGreaterThan(84)
  expect(evennessPercent).toBeLessThan(91)
  expect(resultText).toContain(`Clean at ${bpm}bpm`)

  await expect(page.getByTestId('technique-best-bpm')).toHaveText(`Best clean tempo: ${bpm}bpm`)

  // The persisted half of the claim: a clean attempt, under this drill's id,
  // read back out of the IndexedDB the app really writes to.
  const attemptsAfter = await readTechniqueAttempts(page)
  expect(attemptsAfter.length, 'the triad-sequence attempt was not persisted').toBe(
    attemptsBefore.length + 1,
  )
  const mine = attemptsAfter.filter((a) => a.drillId === DRILL_ID)
  expect(mine.length).toBe(1)
  expect(mine[0]?.clean, 'the persisted attempt was not clean').toBe(true)
  expect(mine[0]?.bpm).toBe(bpm)

  // And the Progress card the claim names stops being empty.
  await nav(page, 'Progress').click()
  await expect(page.getByTestId('dashboard-technique-empty')).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Technique clean tempo over time' })).toBeVisible()

  expect(errors).toEqual([])
})
