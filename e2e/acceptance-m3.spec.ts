import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import {
  installFakeMidi,
  armFakeMidiOnClick,
  waitForArmedFakeMidiSchedule,
  FAKE_MIDI_DEVICE_NAME,
  type RelativeFakeMidiEvent,
} from './fake-midi.ts'
import { emptyEarSession, recordEarAttempt, type EarAttempt } from '../src/core/eartraining/session.ts'
import { generateIntervalItem } from '../src/core/eartraining/intervals.ts'
import { generateMelodicDictation, generateRhythmicDictation } from '../src/core/eartraining/dictation.ts'
import type { EarItem } from '../src/core/eartraining/item.ts'
import { seededRng } from '../src/core/ports/rng.ts'
import { intervalLongName, parseInterval } from '../src/core/theory/intervals.ts'
import { makeTempoMap, tickToMs } from '../src/core/timing/tempo.ts'

/**
 * E2E acceptance proof for the M3 audit's three defects — each of them
 * invisible to a green unit suite because each one is a WIRING gap, not a
 * logic bug: the pure core functions were already correct and tested, but
 * nothing in the app actually reached them (or reached them the way the
 * screen promised).
 *
 * ## Determinism strategy (defects 1 and 2)
 *
 * Ear-training item generation is seeded from `Date.now()`
 * (`useEarTraining.ts`: `useState(() => options.rng ?? seededRng(Date.now()))`),
 * and the Shell mounts `<EarTrainingScreen />` with no injected seam — so an
 * e2e spec cannot pass a fake `Rng` in the way a component test can. Rather
 * than read the generated item back out of the running app (racy: the only
 * channel available from outside is IndexedDB, and `EarItem.id` is content-
 * derived, so two draws can coincidentally collide on the same id, making
 * "did a new item appear" undecidable from outside), this spec freezes
 * `Date.now()` in the page (`page.addInitScript`, same technique
 * `e2e/fake-midi.ts` uses to install the fake MIDI port) and replays the
 * *exact same* pure functions (`generateIntervalItem`, `generateMelodicDictation`,
 * `generateRhythmicDictation`, `recordEarAttempt` — all real `src/core` code,
 * not reimplemented) in this Node process with the same frozen seed. That
 * predicts precisely what the browser will generate, so the answers this spec
 * drives are known correct by construction rather than guessed — zero
 * flakiness, and the assertions are still on the real, running app's own
 * output (feedback text, accuracy readouts, the persisted level).
 */

const FROZEN_NOW = 1_700_000_000_000

/** Console/page errors, collected from the moment the page is created (see e2e/round6.spec.ts). */
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

/** Freeze the page's `Date.now()` so `seededRng(Date.now())` is reproducible. Must run before `page.goto`. */
async function freezeDateNow(page: Page, frozen: number): Promise<void> {
  await page.addInitScript((ts: number) => {
    Date.now = () => ts
  }, frozen)
}

/**
 * Read one key out of one object store of the app's real IndexedDB database
 * — copied verbatim from e2e/progress-persistence.spec.ts's own (unexported)
 * `readStored` helper.
 */
async function readStored(page: Page, collection: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ dbName, storeName, storeKey }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains(storeName)) {
            resolve(undefined)
            return
          }
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(storeKey)
          request.onerror = () => reject(request.error)
          request.onsuccess = () => resolve(request.result as unknown)
        }
      }),
    { dbName: 'piano-learning-app', storeName: collection, storeKey: key },
  )
}

// ---------------------------------------------------------------------------
// defect 1 — REQ-3.6.3: adapted ear-training level used to reset on reload
// ---------------------------------------------------------------------------

/**
 * Replays exactly what `useEarTraining`'s hook will do for five straight
 * correct `interval-melodic` answers, starting from a fresh session (level 1,
 * no cards) with `rng` seeded from `FROZEN_NOW` — the same seed the browser's
 * `seededRng(Date.now())` will use once `Date.now()` is frozen. Returns the
 * button (accessible name) to click each round and the level the real
 * `adaptEarLevel`/`recordEarAttempt` code predicts afterwards, so the test can
 * assert against its own prediction rather than a hand-picked constant.
 */
function computeIntervalPromotionPlan(): { readonly buttonNames: readonly string[]; readonly levelAfter: number } {
  let session = emptyEarSession()
  const rng = seededRng(FROZEN_NOW)
  const kind = 'interval-melodic' as const
  const buttonNames: string[] = []

  for (let i = 0; i < 5; i++) {
    const item = generateIntervalItem(session.levels[kind], { harmonic: false }, rng)
    const unsigned = item.answerKey.startsWith('-') ? item.answerKey.slice(1) : item.answerKey
    const parsed = parseInterval(unsigned)
    if (!parsed.ok) {
      throw new Error(`computeIntervalPromotionPlan: answerKey "${item.answerKey}" did not parse`)
    }
    buttonNames.push(intervalLongName(parsed.value))

    const attempt: EarAttempt = {
      itemId: item.id,
      kind: item.kind,
      accuracy: 1,
      at: FROZEN_NOW,
      level: item.level,
    }
    session = recordEarAttempt(session, attempt, FROZEN_NOW, rng)
  }

  return { buttonNames, levelAfter: session.levels[kind] }
}

test('ear-training adapted difficulty survives a reload instead of resetting to level 1 (roadmap REQ-3.6.3)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  const plan = computeIntervalPromotionPlan()
  // Sanity check on the prediction itself: five unanimous correct answers is
  // exactly `adaptEarLevel`'s promotion rule (window 5, all correct). If this
  // ever fails it means the promotion rule changed, not that the app broke.
  expect(plan.levelAfter, 'the five-answer plan this test drives must itself promote the level').toBe(2)

  await freezeDateNow(page, FROZEN_NOW)
  await page.goto('/')
  await nav(page, 'Ear training').click()

  // Roadmap UI-13: this testid holds only the number now — the "Level" label
  // moved outside into its own `.field` label (same change as flashcard-level).
  await expect(page.getByTestId('eartraining-level')).toHaveText('1')

  // Roadmap UI-13: the "Playback" role="group" wrapper is gone (the stage is
  // the grouping now) and the button reads "Play item" the first round, then
  // "Next" every round after.
  const answers = page.getByRole('group', { name: 'Interval answer' })

  for (const buttonName of plan.buttonNames) {
    await page.getByRole('button', { name: /^(Play item|Next)$/, exact: true }).click()
    await answers.getByRole('button', { name: buttonName, exact: true }).click()
    await expect(page.getByTestId('eartraining-feedback')).toHaveText('Correct')
  }

  // The promotion itself, on screen, before any reload.
  await expect(page.getByTestId('eartraining-level')).toHaveText('2')

  // Gate the reload on the raised level actually being in IndexedDB, not just
  // in the on-screen zustand state — same race as round6.spec's annotation
  // check and progress-persistence.spec's assessment check: the store update
  // is synchronous, the IndexedDB write goes through persistence.ts's async
  // write queue, and reloading before it lands would destroy it unwritten.
  await expect(async () => {
    const stored = (await readStored(page, 'settings', 'earTraining')) as
      | { readonly session?: { readonly levels?: Readonly<Record<string, number>> } }
      | undefined
    expect(stored?.session?.levels?.['interval-melodic']).toBe(2)
  }).toPass({ timeout: 10_000 })

  await page.reload()
  await nav(page, 'Ear training').click()

  // THE KILLER ASSERTION. Before the fix, `useEarTrainingStore` was never
  // wired into `persistence.ts`, so this reload would land back on
  // `emptyEarSession()` and read level 1 here.
  await expect(page.getByTestId('eartraining-level')).toHaveText('2')

  expect(errors).toEqual([])
})

// ---------------------------------------------------------------------------
// defect 2 — REQ-3.6.1/3.6.2: dictation played but could not be answered
// ---------------------------------------------------------------------------

type DictationPlan = {
  readonly item: EarItem
  readonly events: readonly RelativeFakeMidiEvent[]
}

/** How long after the "Play" click the first note-back press fires — see the module comment. */
const COUNT_IN_MS = 600

/**
 * Replays the exact generation the browser will do for the FIRST item drawn
 * in a fresh session (no prior draws, so no card can be due — `nextDueItemId`
 * is always null the first time — meaning `generateItemForKind` is exactly
 * `generate<X>Dictation(1, {}, rng)` with `rng` freshly seeded), and builds a
 * press-back schedule from the prompt's own notes: every note played at the
 * exact relative offset (converted through the prompt's own tempo map) the
 * prompt itself uses, so the answer is note-perfect and rhythm-perfect by
 * construction, not by luck.
 */
function computeDictationPlan(kind: 'melodic-dictation' | 'rhythmic-dictation'): DictationPlan {
  const rng = seededRng(FROZEN_NOW)
  const item =
    kind === 'melodic-dictation' ? generateMelodicDictation(1, {}, rng) : generateRhythmicDictation(1, {}, rng)

  const tempo = makeTempoMap(item.prompt.tempos)
  const notes = item.prompt.notes
  const firstNote = notes[0]
  if (firstNote === undefined) {
    throw new Error(`computeDictationPlan: generated ${kind} item has no notes`)
  }
  const baseMs = tickToMs(tempo, firstNote.startTick) as number

  const events: RelativeFakeMidiEvent[] = notes.map((n) => ({
    type: 'on',
    note: n.midi,
    offsetMs: COUNT_IN_MS + ((tickToMs(tempo, n.startTick) as number) - baseMs),
  }))

  return { item, events }
}

async function runDictationCase(
  page: Page,
  kind: 'melodic-dictation' | 'rhythmic-dictation',
): Promise<void> {
  const errors = collectErrors(page)
  const plan = computeDictationPlan(kind)

  await installFakeMidi(page)
  await freezeDateNow(page, FROZEN_NOW)
  await page.goto('/')
  await nav(page, 'Ear training').click()

  // Roadmap UI-04b: the MIDI status line no longer renders in any screen's
  // own content flow — it lives in the topbar chip's popover, opened here
  // before asserting on its detail text.
  await page.getByRole('button', { name: /MIDI connected|No MIDI/ }).click()
  await expect(
    page.getByText(new RegExp(`MIDI keyboard connected: ${FAKE_MIDI_DEVICE_NAME}`)),
  ).toBeVisible()

  await page.getByLabel('Drill', { exact: true }).selectOption(kind)

  // Roadmap UI-13 rebuilt this screen around its answers: the "Playback"
  // role="group" wrapper is gone (the stage is the grouping now), and the
  // button reads "Play item" — one .btn-primary, per DESIGN.md rule 1, where
  // there used to be a Play/Next pair plus Replay at equal weight.
  const playButton = page.getByRole('button', { name: 'Play item', exact: true })

  // Armed on the same synchronous click turn as the play button (see
  // e2e/technique-drill.spec.ts's identical pattern for its own transport).
  await armFakeMidiOnClick(page, 'Play item', plan.events)
  await playButton.click()
  await waitForArmedFakeMidiSchedule(page)

  await expect(page.getByTestId('dictation-note-count')).toHaveText(`${plan.events.length} notes recorded`)

  await page.getByRole('group', { name: 'Dictation controls' }).getByRole('button', { name: 'Submit' }).click()

  // THE KILLER ASSERTIONS. Before the fix, this screen dead-ended on "not yet
  // implemented" — there was no Submit path at all, so none of this could
  // ever render. A note-perfect answer must grade as correct, with both
  // accuracy readouts real (computed from the alignment, not stubbed) rather
  // than absent or hardcoded.
  await expect(page.getByTestId('eartraining-feedback')).toHaveText('Correct')
  await expect(page.getByTestId('dictation-pitch-accuracy')).toHaveText('100%')
  await expect(page.getByTestId('dictation-rhythm-accuracy')).toHaveText('100%')

  // Every note graded 'correct' individually, not just the two headline
  // percentages — belt and braces against a grader that averages to 100% by
  // cancellation rather than by every note actually matching.
  const resultItems = page.getByRole('list', { name: 'Dictation result' }).getByRole('listitem')
  await expect(resultItems).toHaveCount(plan.item.prompt.notes.length)
  for (const text of await resultItems.allInnerTexts()) {
    expect(text).toContain('correct')
  }

  expect(errors).toEqual([])
}

test('melodic dictation can be played back and is graded note by note (roadmap REQ-3.6.1)', async ({ page }) => {
  test.setTimeout(60_000)
  await runDictationCase(page, 'melodic-dictation')
})

test('rhythmic dictation can be tapped back and is graded on timing (roadmap REQ-3.6.1/REQ-3.6.2)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await runDictationCase(page, 'rhythmic-dictation')
})

// ---------------------------------------------------------------------------
// defect 3 — REQ-3.5.2: every lesson quiz opened the note-naming deck
// ---------------------------------------------------------------------------

test('opening "The Circle of Fifths" lesson quiz lands on the key-signature deck at level 7, and that deck can be answered (roadmap REQ-3.5.2)', async ({
  page,
}) => {
  test.setTimeout(30_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await nav(page, 'Lessons').click()
  await page.getByRole('button', { name: 'Level 3', exact: true }).click()
  await page.getByRole('button', { name: 'The Circle of Fifths', exact: true }).click()
  await page
    .getByRole('button', { name: 'Open Quiz: the circle of fifths and key signatures' })
    .click()

  // THE KILLER ASSERTIONS. Before the fix, `openedDeckOf`'s two-way match
  // (`'staff-to-key'`/`'interval-on-staff'` only) fell through to `undefined`
  // for `'key-signature'`, and a silent `undefined` fallback opened the
  // default `'staff-to-key'` deck at level 1 regardless of what this button
  // promised.
  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()
  await expect(page.getByLabel('Drill', { exact: true })).toHaveValue('key-signature')
  // Level 1 holds only fifths -1..+1, so a circle-of-fifths quiz that opened
  // at the default level would drill three signatures out of fifteen.
  // Roadmap UI-12: this testid holds only the number now — the "Level" label
  // moved outside the `.stepper` group into its own `.field` label.
  await expect(page.getByTestId('flashcard-level')).toHaveText('7')

  // Proves the deck is usable, not merely selected: a real key-signature
  // prompt is showing, and answering it produces a real graded result.
  // (The pill's copy changed under UI-12 from "Correct/Not quite — graded
  // <n>" to "Correct" / "Not quite — it comes back for review"; either one
  // proves a real grade landed, which a pill that never left its unrendered,
  // pre-answer state could not.)
  await expect(page.getByTestId('key-signature-prompt')).not.toHaveText('')
  await page.getByRole('group', { name: 'Key signature answer' }).getByRole('button').first().click()
  await expect(page.getByTestId('flashcard-feedback')).toHaveText(/^(Correct|Not quite — it comes back for review)$/)

  expect(errors).toEqual([])
})
