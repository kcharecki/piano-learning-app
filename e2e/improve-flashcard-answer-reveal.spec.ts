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

/** Every level-1 card seeded, all parked in the future except `dueMidi`. */
function deckWithOnlyOneDue(dueMidi: number, now: number): Record<string, SeedCard> {
  const cardsById: Record<string, SeedCard> = {}
  for (const midi of LEVEL_1_MIDI) {
    const isDue = midi === dueMidi
    cardsById[`staff-to-key-${midi}`] = {
      id: `staff-to-key-${midi}`,
      due: isDue ? now - 60_000 : now + 30 * DAY_MS,
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

/** Open Flashcards on a profile whose only due level-1 card is `dueMidi`. */
async function openFlashcardsWithOneDue(page: Page, dueMidi: number): Promise<void> {
  await page.goto('/')
  // First visit creates the database; the seed then goes in and a reload
  // restores it, because `persistence.ts` hydrates on mount.
  await seedSrs(page, deckWithOnlyOneDue(dueMidi, Date.now()))
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
  await openFlashcardsWithOneDue(page, 64)

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

  expect(errors).toEqual([])
})

test('arm 2 — a different due card names a different note, so the reveal is not a constant', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await openFlashcardsWithOneDue(page, 60)

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
  await openFlashcardsWithOneDue(page, 64)

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

test('the class, not the instance — the theory drill also names its answer', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Theory').click()
  await expect(page.getByRole('heading', { name: 'Theory', exact: true })).toBeVisible()

  const prompt = page.getByTestId('theory-prompt')
  await expect(prompt).toBeVisible()

  // Answer with a deliberately unmusical single press. Whatever the generated
  // item is, one key is not a scale, a triad or an interval, so this grades
  // wrong for every `TheoryQuizKind`.
  const keyboard = page.getByRole('group', { name: 'On-screen keyboard' })
  await keyboard.getByRole('button', { name: 'C3', exact: true }).click()

  // The feedback must name the expected notes, not just the SRS grade. Today
  // it reads "Not quite — graded again" and this line is why the spec is red.
  await expect(page.getByTestId('theory-feedback')).toContainText(/[A-G](#|b)?\d/)

  expect(errors).toEqual([])
})
