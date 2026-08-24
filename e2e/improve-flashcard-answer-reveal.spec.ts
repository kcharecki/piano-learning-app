import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * Claim spec for /improve-app run 2026-08-24-1 (gap G1, class BLIND).
 *
 * The gap: a wrong flashcard answer is told only "Not quite — it comes back
 * for review", and the missed card is replaced by the next one before the
 * learner has been told what the answer was. `FlashcardScreen.tsx` renders
 * exactly two strings, and `GradeResult` (`core/drills/flashcards.ts`) drops
 * the expected answer it compared against. Ear training already reveals its
 * answer (`e2e/eartraining-reveal.spec.ts`); three of the four SRS-backed
 * surfaces do not.
 *
 * This spec is the run's refutation condition, and it is deliberately built so
 * that the obvious cheap fixes fail it:
 *
 * - The expected note name is **derived here, from the seeded card id**
 *   (`staff-to-key-64` → MIDI 64 → E4) and never read out of the app, so a
 *   reveal that agrees with itself cannot pass.
 * - Two arms seed two DIFFERENT single due cards and assert two different
 *   names, each asserting the absence of the other's, so a hardcoded literal
 *   passes at most one arm.
 * - Arm 1 records `data-step` off the staff BEFORE answering and requires the
 *   same value after, so naming the answer once the card has already advanced
 *   (design A in `runs/2026-08-24-1/design.md`, killed) fails.
 * - Arm 3 answers CORRECTLY and requires no reveal, so a screen that always
 *   shows the answer fails.
 * - Arm 4 is the class, not the instance: the same gap on the theory drill,
 *   deep-linked to `build-scale` level 1 (one scale type, one key signature,
 *   so the item is C major on every run) and answered one degree at a time,
 *   so a screen that grades an attempt still IN PROGRESS fails before it ever
 *   reaches the reveal.
 *
 * Seeding writes the SRS store directly and reloads, the pattern
 * `e2e/dashboard-populated.spec.ts` uses. The level-1 `staff-to-key` deck is
 * MIDI 56–64, so eight cards are parked far in the future and exactly one is
 * left due — that is what makes "which card is on screen" deterministic
 * without touching the app's own randomness.
 */

const DB_NAME = 'piano-learning-app'
const SRS_COLLECTION = 'srsCards'
const SRS_KEY = 'srsCards'

/** The level-1 `staff-to-key` deck, as `buildDeck` builds it. */
const LEVEL_1_MIDI = [56, 57, 58, 59, 60, 61, 62, 63, 64] as const

const DAY_MS = 24 * 60 * 60 * 1000

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/**
 * Sharp-spelled note name for a MIDI number — the inverse of `core/theory/pitch.ts`'s
 * default spelling, duplicated deliberately (e2e specs stay free of `@core` imports)
 * so that the name this spec expects is computed from the id it seeded and NOT
 * from anything the app produced.
 */
function nameOf(midi: number): string {
  const letter = NOTE_NAMES[midi % 12]
  if (letter === undefined) throw new Error(`no name for midi ${midi}`)
  return `${letter}${Math.floor(midi / 12) - 1}`
}

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

type SeedCard = {
  readonly id: string
  readonly due: number
  readonly intervalDays: number
  readonly ease: number
  readonly reps: number
  readonly lapses: number
  readonly introducedAt: number
}

/** Every level-1 card seeded, all parked in the future except `dueMidis`. */
function deckWithDue(dueMidis: readonly number[], now: number): Record<string, SeedCard> {
  const cardsById: Record<string, SeedCard> = {}
  for (const midi of LEVEL_1_MIDI) {
    const position = dueMidis.indexOf(midi)
    const isDue = position >= 0
    cardsById[`staff-to-key-${midi}`] = {
      id: `staff-to-key-${midi}`,
      // Earlier in `dueMidis` means more overdue, so the order the cards come
      // up in is the order asked for rather than whatever the queue's tie-break
      // happens to be.
      due: isDue ? now - 60_000 * (dueMidis.length - position) : now + 30 * DAY_MS,
      intervalDays: isDue ? 1 : 30,
      ease: 2.5,
      reps: 1,
      lapses: 0,
      introducedAt: now - 60 * DAY_MS,
    }
  }
  return cardsById
}

async function seedSrs(page: Page, cardsById: Record<string, SeedCard>): Promise<void> {
  await page.evaluate(
    ({ dbName, storeName, storeKey, payload }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(storeName, 'readwrite')
          const put = tx.objectStore(storeName).put({ cardsById: payload }, storeKey)
          put.onerror = () => reject(put.error)
          put.onsuccess = () => resolve()
        }
      }),
    { dbName: DB_NAME, storeName: SRS_COLLECTION, storeKey: SRS_KEY, payload: cardsById },
  )
}

/** Open Flashcards on a profile whose only due level-1 cards are `dueMidis`. */
async function openFlashcardsWithDue(page: Page, dueMidis: readonly number[]): Promise<void> {
  await page.goto('/')
  // First visit creates the database; the seed then goes in and a reload
  // restores it, because `persistence.ts` hydrates on mount.
  await seedSrs(page, deckWithDue(dueMidis, Date.now()))
  await page.reload()
  await nav(page, 'Flashcards').click()
  await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible()
  await expect(page.getByTestId('staff-note')).toBeVisible()
}

/** A key on the on-screen keyboard that is NOT the answer — the learner's mistake. */
function wrongKeyName(dueMidi: number): string {
  return nameOf(dueMidi === LEVEL_1_MIDI[0] ? LEVEL_1_MIDI[1] : LEVEL_1_MIDI[0])
}

test('arm 1 — a wrong answer names that card own correct note, with the card still on the staff', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await openFlashcardsWithDue(page, [64])

  const staff = page.getByTestId('staff-note')
  const stepBefore = await staff.getAttribute('data-step')
  expect(stepBefore).not.toBeNull()

  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
  await keyboard.getByRole('button', { name: wrongKeyName(64), exact: true }).click()

  // The correction names the answer, in learner language (DESIGN.md rule 7).
  await expect(page.getByTestId('flashcard-feedback')).toContainText('E4')

  // ...against the card that caused the error. If the drill advanced first,
  // this is a different card and the step differs.
  await expect(staff).toHaveAttribute('data-step', stepBefore ?? '')

  // The same note, marked on the keyboard the learner just pressed the wrong key on.
  await expect(
    keyboard.getByRole('button', { name: 'E4', exact: true }),
  ).toHaveAttribute('data-highlighted', 'true')

  // The reveal is dismissed deliberately, not by a timer.
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible()

  // The keys stay live under the reveal, because producing the correction at
  // the keys IS the skill this deck trains. Playing it back is ungraded and
  // never advances the card — `Next` remains the only way on.
  const practise = page.getByTestId('flashcard-practise')
  await expect(practise).toHaveText('Now play E4.')
  const idleColor = await practise.evaluate((el) => getComputedStyle(el).color)

  await keyboard.getByRole('button', { name: wrongKeyName(64), exact: true }).click()
  await expect(practise).toHaveText('Not that one — E4 is the marked key.')

  await keyboard.getByRole('button', { name: 'E4', exact: true }).click()
  await expect(practise).toHaveText('That is it — E4.')
  await expect(practise).toHaveAttribute('data-done', 'true')
  // Landing it is worth a color of its own — asserted against the un-landed
  // color rather than a literal, so the tokens stay free to move.
  expect(await practise.evaluate((el) => getComputedStyle(el).color)).not.toBe(idleColor)

  // Three presses under the reveal, and the card is still the missed one, still
  // wrong, still waiting for Next.
  await expect(staff).toHaveAttribute('data-step', stepBefore ?? '')
  await expect(page.getByTestId('flashcard-feedback')).toContainText('Not quite')
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible()

  expect(errors).toEqual([])
})

test('arm 2 — a different due card names a different note, so the reveal is not a constant', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await openFlashcardsWithDue(page, [60])

  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
  await keyboard.getByRole('button', { name: wrongKeyName(60), exact: true }).click()

  const feedback = page.getByTestId('flashcard-feedback')
  await expect(feedback).toContainText('C4')
  // Arm 1's answer must not appear here: a literal, or a reveal naming the
  // note the learner PLAYED rather than the one expected, dies on this line.
  await expect(feedback).not.toContainText('E4')

  await expect(
    keyboard.getByRole('button', { name: 'C4', exact: true }),
  ).toHaveAttribute('data-highlighted', 'true')

  expect(errors).toEqual([])
})

test('arm 3 — a correct answer reveals nothing and moves on', async ({ page }) => {
  const errors = collectErrors(page)
  // Two cards due, not one: answering correctly must leave the drill with a
  // card still on screen, or "no reveal" would be indistinguishable from the
  // empty-deck state, which shows no pill, no Next and no highlight either.
  await openFlashcardsWithDue(page, [64, 60])

  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
  await keyboard.getByRole('button', { name: 'E4', exact: true }).click()

  await expect(page.getByTestId('flashcard-feedback')).toContainText('Correct')
  // No reveal, no Next: a screen that always shows the answer passes arms 1
  // and 2 and fails here.
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0)
  await expect(
    keyboard.locator('[data-highlighted="true"]'),
  ).toHaveCount(0)

  expect(errors).toEqual([])
})

test('the class, not the instance — the theory drill also names its answer, and only once the attempt settles', async ({
  page,
}) => {
  const errors = collectErrors(page)
  // A deep link, not the nav: `/theory/<kind>/<level>` pins the topic and the
  // level, and level 1 `build-scale` admits exactly one scale type (major) and
  // exactly one key signature (no accidentals), so the item is C major on every
  // run. That is what lets this arm press a note it KNOWS is right and a note it
  // KNOWS is wrong, instead of the old single unmusical press, which was right
  // whenever the drawn tonic happened to be C and therefore proved nothing.
  await page.goto('/theory/build-scale/1')
  const prompt = page.getByTestId('theory-prompt')
  await expect(prompt).toHaveText('Play C major, ascending.')
  await expect(page.getByTestId('theory-progress')).toContainText('0 / 8')

  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
  const feedback = page.getByTestId('theory-feedback')

  // Degree 1, correct. An attempt in progress is NOT a verdict: a screen that
  // grades every press printed "Not quite" over a right note, and — once the
  // result carried the expected answer — leaked the whole scale after one key.
  await keyboard.getByRole('button', { name: 'C4', exact: true }).click()
  await expect(page.getByTestId('theory-progress')).toContainText('1 / 8')
  await expect(feedback).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0)

  // Degree 2, wrong (C again, where D belongs). Now the attempt is settled, so
  // now there is a verdict — and it names every note the prompt asked for.
  await keyboard.getByRole('button', { name: 'C4', exact: true }).click()
  await expect(feedback).toContainText('C4, D4, E4, F4, G4, A4, B4, C5')

  // Held on the prompt that was missed, exited by hand, exactly like the
  // flashcard reveal in arm 1.
  await expect(prompt).toHaveText('Play C major, ascending.')
  const next = page.getByRole('button', { name: 'Next', exact: true })
  await expect(next).toBeVisible()

  // The keys stay live under the reveal so the answer can be PLAYED, not only
  // read — ungraded, and it never advances the prompt.
  const echo = page.getByTestId('theory-echo')
  await expect(echo).toContainText('Now play it: 0 of 8')
  await keyboard.getByRole('button', { name: 'C4', exact: true }).click()
  await expect(echo).toContainText('Now play it: 1 of 8')

  // The echo is a real reader of what was pressed, not a press counter: E is in
  // this scale but not this step, so it is refused, said so, and the count holds.
  await keyboard.getByRole('button', { name: 'E4', exact: true }).click()
  await expect(echo).toContainText('Not that one — still 1 of 8')

  // ...and the note it IS waiting for counts in any octave, exactly as the
  // grader scores it (panel r2). D5, not D4.
  await keyboard.getByRole('button', { name: 'D5', exact: true }).click()
  await expect(echo).toContainText('Now play it: 2 of 8')
  await expect(prompt).toHaveText('Play C major, ascending.')
  await expect(next).toBeVisible()

  await next.click()
  await expect(page.getByTestId('theory-echo')).toHaveCount(0)
  await expect(page.getByTestId('theory-feedback')).toHaveCount(0)

  expect(errors).toEqual([])
})
