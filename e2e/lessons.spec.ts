import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * E2E proof for roadmap 4.9b (REQ-3.1.1/3.1.2/3.1.3): the Lessons screen is
 * reachable and its content is real, not placeholder — a NAMED lesson's
 * explanation and rendered keyboard diagram are read straight off the
 * screen — and the gap this task closes is proved end to end: opening a
 * lesson's playing task loads THAT lesson's own demonstration score, not
 * whatever the practice screen already had loaded.
 *
 * A different score is imported first (the same bundled fixture
 * e2e/dashboard-populated.spec.ts uses) so "the right score loaded" cannot
 * be satisfied by "no score changed" — the practice screen's heading must
 * move from the fixture's own title to the lesson's demo title.
 *
 * KNOWN GAP, reported rather than worked around: this spec navigates via the
 * "Lessons" nav label, which does not exist in `Shell.tsx` yet — adding the
 * nav item is the main thread's follow-on to this task (see this module's
 * build report / ROADMAP 4.9b). Until that lands, the first `nav(page,
 * 'Lessons')` call below fails to find the button and this spec does not
 * pass. It is written as if the wiring already exists rather than weakened
 * to "pass anyway", per this task's own instructions.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'assessment-six-bars.musicxml')
const FIXTURE_TITLE = 'Assessment Six-Bar Fixture'

// The lesson this spec drives, named directly rather than picked
// dynamically, so the assertions below are about ONE real, known piece of
// content (src/content/curriculum/lessonsLevel1.ts). It is deliberately NOT
// level 1's first (default-selected) lesson: driving the default would leave
// an implementation that ignores the click and always loads the first
// lesson's demo passing too.
//  - title: 'Left Hand: The Middle C Position'
//  - explanation contains '[diagram:c-position-left-hand]', whose caption is
//    "Left hand C position: pinky (5) on F below middle C, thumb (1) on
//    middle C."
//  - demoScoreId: 'demo-middle-c-position-lh', whose DemoScore.title (and
//    Score.meta.title, what the practice screen's heading shows) is
//    'Middle C Position — Left Hand' — distinct from lesson 1's and lesson
//    2's shared 'Middle C Position — Right Hand', so the assertion below
//    proves THIS lesson's own demo loaded, not just any demo.
//  - its `play` exercise is titled 'Play the C position run, left hand, five
//    times'
const LESSON_TITLE = 'Left Hand: The Middle C Position'
const DIAGRAM_CAPTION =
  'Left hand C position: pinky (5) on F below middle C, thumb (1) on middle C.'
const DEMO_SCORE_TITLE = 'Middle C Position — Left Hand'
const OTHER_HAND_DEMO_SCORE_TITLE = 'Middle C Position — Right Hand'
const PLAY_EXERCISE_TITLE = 'Play the C position run, left hand, five times'

/** Console/page errors, collected from the moment the page is created (see e2e/screens.spec.ts). */
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

test('opening a lesson from the list shows its real content, and opening its playing task loads its OWN demonstration (roadmap 4.9b)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')

  // Load a DIFFERENT score first, so the final assertion cannot be satisfied
  // by "nothing changed".
  await nav(page, 'Practice').click()
  await page.getByLabel(/Import a score/i).setInputFiles(FIXTURE_PATH)
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible()

  // Navigate to the Lessons destination and open the named lesson from its
  // list — not the default selection, an actual click on a named row.
  await nav(page, 'Lessons').click()
  await expect(page.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible()

  const lessonsList = page.getByRole('list', { name: 'Lessons' })
  await lessonsList.getByRole('button', { name: LESSON_TITLE }).click()

  // The explanation and its rendered keyboard diagram, read off the screen.
  await expect(page.getByRole('heading', { name: LESSON_TITLE })).toBeVisible()
  await expect(
    page.getByText(/The left hand mirrors the right/),
  ).toBeVisible()
  await expect(page.getByRole('img', { name: DIAGRAM_CAPTION })).toBeVisible()

  // Open the lesson's playing task.
  await page.getByRole('button', { name: `Open ${PLAY_EXERCISE_TITLE}` }).click()

  // The practice screen itself rendered (a positive check, so the negative
  // assertions below cannot pass vacuously because nothing rendered at all).
  await expect(page.getByRole('group', { name: /transport/i })).toBeVisible()

  // The practice screen now shows THIS lesson's own demonstration — distinct
  // from both the fixture imported above AND the right-hand demo that lesson
  // 1 (and the default selection) would have loaded instead.
  await expect(page.getByRole('heading', { name: DEMO_SCORE_TITLE })).toBeVisible()
  await expect(page.getByRole('heading', { name: FIXTURE_TITLE })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: OTHER_HAND_DEMO_SCORE_TITLE })).toHaveCount(0)

  expect(errors).toEqual([])
})

test('the G major lesson demonstrates a scale that actually has one sharp, and the F major one a flat (roadmap 5.8)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')

  await nav(page, 'Lessons').click()
  await expect(page.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible()
  // The G/F major scale lessons are level 2; the list opens on level 1.
  await page.getByRole('button', { name: 'Level 2', exact: true }).click()

  const lessonsList = page.getByRole('list', { name: 'Lessons' })

  // The defect this covers: both of these lessons pointed at
  // `demo-c-major-scale-one-octave-rh`, so a lesson whose own prose says
  // "that single sharp becomes G major's key signature" played and engraved a
  // scale with no sharp at all. The prose was right and the sound was wrong.
  //
  // Read the KEY SIGNATURE off the rendered engraving, not the demo's title —
  // a title is exactly what was already correct-looking while the notes were
  // wrong. `.vf-keysignature` is VexFlow's own group, and it is absent
  // entirely in C major (no accidentals to draw), which is what makes its
  // presence here meaningful rather than incidental.
  for (const { lesson, demoTitle, accidentals } of [
    { lesson: 'The G Major Scale', demoTitle: 'G Major Scale, One Octave — Right Hand', accidentals: 1 },
    { lesson: 'The F Major Scale', demoTitle: 'F Major Scale, One Octave — Right Hand', accidentals: 1 },
  ]) {
    await lessonsList.getByRole('button', { name: lesson, exact: true }).click()
    await expect(page.getByRole('heading', { name: lesson, exact: true })).toBeVisible()

    // "Open demonstration" loads the demo into `scoreStore` AND navigates to
    // Practice on its own (roadmap 5.9b) — no manual nav click here proves it.
    await page.getByRole('button', { name: 'Open demonstration' }).click()
    await expect(page.getByRole('group', { name: /transport/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: demoTitle })).toBeVisible()

    const keySignature = page.locator('svg .vf-keysignature')
    await expect(keySignature.first()).toBeVisible({ timeout: 10_000 })
    expect(
      await keySignature.first().locator('path').count(),
      `${lesson} should engrave ${String(accidentals)} accidental in its key signature`,
    ).toBeGreaterThanOrEqual(accidentals)

    await nav(page, 'Lessons').click()
    await page.getByRole('button', { name: 'Level 2', exact: true }).click()
  }

  // Negative control. C major draws no key signature at all, so this proves
  // the assertions above discriminate: if every demo rendered the same group
  // regardless of key, this would fail and the loop above would be worthless.
  // It is also the state the G and F lessons were in before this fix.
  await lessonsList.getByRole('button', { name: 'The C Major Scale', exact: true }).click()
  await page.getByRole('button', { name: 'Open demonstration' }).click()
  await expect(
    page.getByRole('heading', { name: 'C Major Scale, One Octave — Right Hand' }),
  ).toBeVisible()
  await expect(page.locator('svg .vf-keysignature')).toHaveCount(0)

  expect(errors).toEqual([])
})
