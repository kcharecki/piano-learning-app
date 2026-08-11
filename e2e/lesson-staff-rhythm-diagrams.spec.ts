import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * E2E proof for roadmap 3.25 (REQ-3.5.2): a staff-notation lesson renders a
 * real, OSMD-engraved staff diagram inline — not the keyboard-only picture
 * `LessonBody` was structurally limited to before this task widened
 * `LessonDiagram` to a `kind`-discriminated union. Also covers roadmap 3.24:
 * the new level 4/5 REQ-3.5.1 lessons open in the app, each carrying its own
 * staff diagram and a theory-quiz exercise.
 *
 * `role="img"` + the diagram's own caption as the accessible name is the same
 * pattern `LessonBody.test.tsx` and `ScaleStaff.test.tsx` check at the unit
 * level; this spec additionally asserts a real `<svg>` was engraved inside
 * it — the one thing a component test cannot prove, because `ScoreViewer` is
 * mocked there (OSMD needs a real browser canvas).
 */

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

test('a level-1 staff-notation lesson renders a real, engraved staff diagram inline (roadmap 3.25)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')

  await nav(page, 'Lessons').click()
  await expect(page.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible()

  // Level 1 defaults to selected on load — this lesson (theory track, "The
  // Staff, the Treble Clef and the Bass Clef") was structurally incapable of
  // carrying a diagram before roadmap 3.25 (LessonBody could only render
  // KeyboardDiagram).
  const lessonsList = page.getByRole('list', { name: 'Lessons' })
  await lessonsList.getByRole('button', { name: 'The Staff, the Treble Clef and the Bass Clef' }).click()
  await expect(
    page.getByRole('heading', { name: 'The Staff, the Treble Clef and the Bass Clef' }),
  ).toBeVisible()

  const diagram = page.getByRole('img', {
    name: 'Middle C sits on its own short ledger line between the treble staff above and the bass staff below — one note, shared by both clefs.',
  })
  await expect(diagram).toBeVisible()
  // The real OSMD engraving, not a placeholder: a real <svg> inside the
  // diagram, with at least one drawn note.
  await expect(diagram.locator('svg')).toBeVisible({ timeout: 10_000 })
  expect(await diagram.locator('svg .vf-stavenote').count()).toBeGreaterThan(0)

  // A rhythm diagram, on a different level-1 lesson in the same unit family,
  // proves the 'rhythm' kind renders too, not only 'staff'.
  await lessonsList.getByRole('button', { name: 'Whole, Half and Quarter Notes' }).click()
  await expect(page.getByRole('heading', { name: 'Whole, Half and Quarter Notes' })).toBeVisible()
  const rhythmDiagram = page.getByRole('img', {
    name: 'The same four beats, subdivided three ways: one whole note, two half notes, four quarter notes.',
  })
  await expect(rhythmDiagram).toBeVisible()
  await expect(rhythmDiagram.locator('svg')).toBeVisible({ timeout: 10_000 })

  expect(errors).toEqual([])
})

test('the six new level 4-5 harmony lessons open in the app, each with its own staff diagram and a quiz (roadmap 3.24)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')

  await nav(page, 'Lessons').click()
  await expect(page.getByRole('heading', { name: 'Lessons', exact: true })).toBeVisible()

  const lessonsList = page.getByRole('list', { name: 'Lessons' })

  const level4Topics: readonly { readonly title: string; readonly diagramCaptionStart: string }[] = [
    { title: 'Seventh Chords', diagramCaptionStart: 'The G major triad, then G dominant seventh' },
    {
      title: 'Cadences: Authentic, Half, Plagal and Deceptive',
      diagramCaptionStart: 'A perfect authentic cadence in C major',
    },
    {
      title: 'Common Progressions: I-IV-V-I, ii-V-I and I-vi-IV-V',
      diagramCaptionStart: 'The I-IV-V-I progression in C major',
    },
  ]

  await page.getByRole('button', { name: 'Level 4', exact: true }).click()
  for (const { title, diagramCaptionStart } of level4Topics) {
    await lessonsList.getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()

    const diagram = page.locator('.lesson-body-diagram-staff[role="img"], .lesson-body-diagram-staff [role="img"]')
    await expect(diagram.first()).toBeVisible()
    await expect(diagram.first()).toHaveAccessibleName(new RegExp(`^${diagramCaptionStart}`))
    // Exactly one engraving, not merely a visible one: React reuses the
    // container when switching between two diagrammed lessons, and OSMD's
    // clear() is not synchronous, so a stale engraving left behind by the
    // previous lesson would stack a second <svg> in the same container.
    await expect(diagram.first().locator('svg')).toHaveCount(1, { timeout: 10_000 })
    await expect(diagram.first().locator('svg')).toBeVisible()

    // Every one of these lessons carries a theory-quiz exercise (the six
    // REQ-3.5.1 topics' own quiz — see curriculum.test.ts for the id-level
    // proof of which deck/level each one opens).
    await expect(page.getByRole('button', { name: /^Open Quiz:/ })).toBeVisible()
  }

  await nav(page, 'Lessons').click()
  await page.getByRole('button', { name: 'Level 5', exact: true }).click()
  const level5Topics: readonly string[] = [
    'The Three Minor Scale Forms',
    'Secondary Dominants',
    'Modulation to Closely Related Keys',
  ]
  for (const title of level5Topics) {
    await lessonsList.getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    const diagram = page.locator('.lesson-body-diagram-staff[role="img"], .lesson-body-diagram-staff [role="img"]')
    await expect(diagram.first()).toBeVisible()
    // Exactly one engraving, not merely a visible one: React reuses the
    // container when switching between two diagrammed lessons, and OSMD's
    // clear() is not synchronous, so a stale engraving left behind by the
    // previous lesson would stack a second <svg> in the same container.
    await expect(diagram.first().locator('svg')).toHaveCount(1, { timeout: 10_000 })
    await expect(diagram.first().locator('svg')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Open Quiz:/ })).toBeVisible()
  }

  expect(errors).toEqual([])
})
