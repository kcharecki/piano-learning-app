import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { LEVEL_2_LESSONS } from '../src/content/curriculum/lessonsLevel2.ts'
import { buildChord, chordMidi, type ChordQuality } from '../src/core/theory/chords.ts'
import { LETTERS, midiToName, spell, type Letter } from '../src/core/theory/pitch.ts'
import { midi as asMidi } from '../src/core/shared/units.ts'

/**
 * E2E proof for roadmap 3.12 (REQ-3.5.2). Four authored lesson quizzes
 * promise a chord/cadence topic that no flashcard deck can test — they used
 * to be retargeted at the note-naming flashcard deck because that was all
 * `Shell.tsx`'s `destinationFor` could open for a `theory-quiz` exercise.
 * `Shell.tsx` now sends a `theory-quiz` whose `params.drillKind` names a
 * `TheoryQuizKind` (via `openedTheoryDrillOf`) to the Theory destination
 * instead, and `TheoryDrillPanel`/`TheoryScreen` take `initialKind`/
 * `initialDrillKind` (+ level) props that seed the panel's topic.
 *
 * `e2e/deck-routing.spec.ts` is the model this follows, including its own
 * doc comment's distinction: picking the topic BY HAND from the panel's
 * "Topic" dropdown would prove the drill works, not that the routing does —
 * so this spec never touches that dropdown. It drives the real path a
 * learner takes (Lessons -> a lesson's own "Open" control on its quiz
 * exercise), and checks both that the Topic select's value is right AND
 * that the rendered prompt is actually that topic's prompt — a select value
 * alone can be satisfied by a screen that renders the wrong drill
 * underneath (see deck-routing.spec.ts's "killer assertions").
 *
 * `l2-c-major-triad-ex1` (lessonsLevel2.ts, lesson `l2-c-major-triad`, level
 * 2, track 'theory') is one of the four retargeted exercises: its
 * `drillKind` is `'build-chord'` at `drillLevel` 1, where `buildTheoryQuiz`
 * draws only a major or minor triad in root position
 * (`CHORD_QUALITIES_BY_LEVEL[0]` / `CHORD_INVERSIONS_BY_LEVEL[0]` in
 * `core/drills/theory.ts`) with a natural-letter root
 * (`ROOTS_BY_LEVEL[0]`) — so the rendered prompt always has the shape
 * "Play a <letter> major|minor chord, root position." with no accidental.
 * The notes to answer with are derived from THAT prompt at runtime via the
 * same `buildChord`/`chordMidi` core functions the app itself uses, never
 * from a hardcoded pitch list that happens to match today's rng draw.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/deck-routing.spec.ts). */
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

const LESSON_ID = 'l2-c-major-triad'
const EXERCISE_ID = 'l2-c-major-triad-ex1'
/** `lessonsLevel2.ts`'s lessons are wired into curriculum level 2 by
 *  `curriculum.ts`'s `buildUnits(2, LEVEL_2_UNIT_SPECS, LEVEL_2_LESSONS)`. */
const LESSON_LEVEL = 2

/** The exact shape `makeChordItem` writes for a root-position major/minor
 *  triad with a natural-letter root — see the module doc above. */
const CHORD_PROMPT_PATTERN = /^Play a ([A-G]) (major|minor) chord, root position\.$/

function letterFromChar(ch: string): Letter {
  const found = LETTERS.find((l) => l === ch)
  if (found === undefined) throw new Error(`"${ch}" is not a natural note letter`)
  return found
}

function chordQualityFromWord(word: string): ChordQuality {
  if (word === 'major' || word === 'minor') return word
  throw new Error(`"${word}" is not the major/minor quality a level-1 build-chord item draws`)
}

/** Parses the rendered prompt and rebuilds the exact chord it names, using
 *  the SAME core functions `core/drills/theory.ts`'s `makeChordItem` does —
 *  never a hardcoded pitch list. */
function chordNotesForPrompt(prompt: string): readonly number[] {
  const match = CHORD_PROMPT_PATTERN.exec(prompt)
  if (match === null) {
    throw new Error(
      `prompt "${prompt}" is not the shape a level-1 build-chord item produces — ` +
        'the routing may have opened the wrong topic',
    )
  }
  const [, letterText, qualityText] = match
  if (letterText === undefined || qualityText === undefined) {
    throw new Error(`could not read letter/quality out of prompt "${prompt}"`)
  }
  const root = spell(letterFromChar(letterText), 0, 4)
  const chord = buildChord(root, chordQualityFromWord(qualityText), 0)
  return chordMidi(chord)
}

test('opening "The C Major Triad" lesson\'s quiz opens the build-chord theory drill, not the note-naming flashcard deck, and a played triad grades (roadmap 3.12)', async ({
  page,
}) => {
  const errors = collectErrors(page)

  const lesson = LEVEL_2_LESSONS.find((l) => l.id === LESSON_ID)
  if (lesson === undefined) throw new Error(`expected lesson "${LESSON_ID}" in lessonsLevel2.ts`)
  const exercise = lesson.exercises.find((e) => e.id === EXERCISE_ID)
  if (exercise === undefined) {
    throw new Error(`expected exercise "${EXERCISE_ID}" on lesson "${LESSON_ID}"`)
  }
  const drillKind = exercise.params?.['drillKind']
  if (drillKind !== 'build-chord') {
    throw new Error(`expected exercise "${EXERCISE_ID}" to name drillKind 'build-chord', got ${String(drillKind)}`)
  }

  await page.goto('/')

  // The real path a learner takes: Lessons, not the "Today" plan or the
  // Theory screen's own picker.
  await nav(page, 'Lessons').click()
  await expect(page.getByRole('heading', { name: 'Lessons', level: 2 })).toBeVisible()

  await page
    .getByRole('group', { name: 'Level' })
    .getByRole('button', { name: `Level ${LESSON_LEVEL}`, exact: true })
    .click()
  await page.getByTestId(`lessons-track-${lesson.track}`).click()

  await page.getByRole('button', { name: lesson.title, exact: true }).click()
  await expect(page.getByRole('heading', { name: lesson.title, level: 3 })).toBeVisible()

  // Read the exercise's own "Open" control off the screen — the exercise
  // title comes from the content module, not restated by hand here.
  const exerciseItem = page
    .getByRole('list', { name: 'Exercises' })
    .getByRole('listitem')
    .filter({ hasText: exercise.title })
  await expect(
    exerciseItem,
    `the lesson must show exactly one exercise titled "${exercise.title}" for this test to open it`,
  ).toHaveCount(1)

  const openButton = exerciseItem.getByRole('button', { name: /^Open/ })
  const ariaLabel = await openButton.getAttribute('aria-label')
  // Confirms the control we are about to click really is this exercise's
  // own "Open" button, not some other item that merely mentions its title.
  expect(ariaLabel).toBe(`Open ${exercise.title}`)

  // The learner never touches the Theory screen's "Topic" picker before this
  // click — the whole point is that the lesson's own exercise routes there
  // on its own.
  await openButton.click()

  // Landed on Theory, not Flashcards.
  await expect(page.getByRole('heading', { name: 'Theory', level: 1 })).toBeVisible()
  await expect(nav(page, 'Theory')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Flashcards' })).toHaveCount(0)

  // THE KILLER ASSERTIONS. A Shell reverted to routing every theory-quiz
  // exercise at 'flashcards' would never show this Topic select at all; a
  // Shell that opened Theory but dropped `initialKind` would seed the
  // panel's own default topic ('build-scale'), not 'build-chord' — the
  // select's value alone could still be right while the wrong drill renders
  // underneath, which is why the prompt shape is checked too.
  await expect(page.getByLabel('Topic')).toHaveValue(drillKind)

  const prompt = await page.getByTestId('theory-prompt').textContent()
  if (prompt === null) throw new Error('theory prompt did not render')
  const notes = chordNotesForPrompt(prompt)

  // Answer it through the real on-screen keyboard, using the notes derived
  // from the prompt actually shown — never a hardcoded pitch list.
  for (const note of notes) {
    await page.getByRole('button', { name: midiToName(asMidi(note)), exact: true }).click()
  }

  // The roadmap's proof action: a chord played on the keyboard grades.
  // `commitAnswer` immediately resets `playedGroups` to serve the next item
  // (progress reverts to "0 / <n> played" for THAT item in the same commit),
  // so the feedback message — which `commitAnswer` does not clear — is the
  // assertion that actually proves this attempt graded, not the progress
  // counter.
  await expect(page.getByTestId('theory-feedback')).toHaveText('Correct — graded good')

  expect(errors).toEqual([])
})
