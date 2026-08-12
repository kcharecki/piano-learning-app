import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * roadmap 4.10 (M4 acceptance pass, 2026-08-12) — REQ-3.1.4's actual mix, at
 * every preset it names.
 *
 * REQ-3.1.4: "a daily practice session assembled from: warm-up/technique
 * (~20%), sight reading (~20%), current lesson or repertoire (~40%),
 * theory/ear training (~20%), adjustable by the user and scalable to session
 * lengths of 15, 30, or 60 minutes." Note that warm-up and technique are ONE
 * category in the requirement, so this spec sums them.
 *
 * The pre-existing coverage (`e2e/screens.spec.ts`) only asserts that the
 * per-item minutes SUM to the chosen budget. That is a total, not a mix — it
 * passes for any split whatsoever, including 100% of the budget in one
 * segment, so it cannot detect proportion drift. This spec asserts the
 * proportions themselves, at all three presets, which is what the requirement
 * actually states.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

const SEGMENTS = ['warmup', 'technique', 'sight-reading', 'lesson', 'theory-ear'] as const
type Segment = (typeof SEGMENTS)[number]

async function readSegmentMinutes(page: Page): Promise<Record<Segment, number>> {
  const entries = await Promise.all(
    SEGMENTS.map(async (segment) => {
      const text = (await page.getByTestId(`session-plan-segment-${segment}`).textContent()) ?? ''
      return [segment, Number(text.match(/(\d+)\s*min/)?.[1] ?? '0')] as const
    }),
  )
  return Object.fromEntries(entries) as Record<Segment, number>
}

/**
 * REQ-3.1.4's four categories, as the requirement groups them (warm-up and
 * technique are a single "warm-up/technique (~20%)" bucket), with the share
 * the requirement states for each.
 */
const TARGET_SHARE: Readonly<Record<string, number>> = {
  'warm-up/technique': 0.2,
  'sight reading': 0.2,
  'current lesson or repertoire': 0.4,
  'theory/ear training': 0.2,
}

/**
 * How far from the stated share still counts as "~". Whole-minute rounding at
 * the 15-minute preset is inherently coarse (20% of 15 is 3 minutes, so one
 * minute of rounding is already 6.7 points), so this is deliberately generous:
 * anything inside 8 percentage points passes. A miss larger than that is a
 * different mix, not a rounding artefact.
 */
const TOLERANCE = 0.08

function nav(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
}

/**
 * Walks the three presets and returns every category whose share misses the
 * one REQ-3.1.4 states by more than `TOLERANCE`, as readable sentences.
 */
async function mixDeviations(page: Page): Promise<string[]> {
  const lengthGroup = page.getByRole('group', { name: 'Session length' })
  const failures: string[] = []

  for (const budget of [15, 30, 60]) {
    await lengthGroup.getByRole('button', { name: `${budget} min`, exact: true }).click()
    await expect(page.getByTestId('session-plan-total')).toHaveText(`Total: ${budget} minutes`)

    const bySegment = await readSegmentMinutes(page)
    const actual: Readonly<Record<string, number>> = {
      'warm-up/technique': bySegment.warmup + bySegment.technique,
      'sight reading': bySegment['sight-reading'],
      'current lesson or repertoire': bySegment.lesson,
      'theory/ear training': bySegment['theory-ear'],
    }

    const sum = Object.values(actual).reduce((a, b) => a + b, 0)
    expect(sum, `the ${budget}-minute plan does not sum to its budget`).toBe(budget)

    for (const [category, target] of Object.entries(TARGET_SHARE)) {
      const minutes = actual[category] ?? 0
      const share = minutes / budget
      if (Math.abs(share - target) > TOLERANCE) {
        failures.push(
          `${budget} min — "${category}": got ${minutes} min (${(share * 100).toFixed(1)}%), ` +
            `REQ-3.1.4 states ~${(target * 100).toFixed(0)}% (${(target * budget).toFixed(1)} min)`,
        )
      }
    }
  }

  return failures
}

/**
 * The mix on the screen the app opens on, with nothing loaded yet — the
 * fresh-install / cold-profile case (roadmap 4.10). Before the fix,
 * `candidates.ts`'s `lesson` segment was fed ONLY by the currently loaded
 * score, so the whole ~40% "current lesson or repertoire" block was empty
 * here and `planSession` renormalised its share onto the other segments.
 * `lessonCandidates` now falls back to the learner's repertoire library and
 * then the curriculum's first lesson, so this segment holds real minutes
 * even on a brand-new profile.
 */
test('REQ-3.1.4: the planned session holds the stated mix at 15, 30 and 60 minutes (nothing loaded)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()

  const failures = await mixDeviations(page)
  expect(errors).toEqual([])
  expect(failures, `REQ-3.1.4 mix deviations:\n  ${failures.join('\n  ')}`).toEqual([])
})

/**
 * The same check once a score IS loaded, which is the only state in which the
 * lesson segment can be non-empty at all. Separated from the test above so the
 * report can say precisely how much of the deviation is "cold profile" and how
 * much is the flat 5-minute warm-up reservation taking minutes off the top of
 * a budget the four stated categories are supposed to divide between them.
 */
test('REQ-3.1.4: the planned session holds the stated mix at 15, 30 and 60 minutes (score loaded)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const errors = collectErrors(page)

  await page.goto('/')
  // Visiting Practice loads the bundled sample score into `scoreStore`, which
  // is what `lessonCandidates` reads (`src/app/session/candidates.ts:143`).
  await nav(page, 'Practice').click()
  await expect(page.getByRole('group', { name: 'Transport' })).toBeVisible()
  await nav(page, 'Today').click()
  await expect(page.getByRole('heading', { name: "Today's session" })).toBeVisible()
  await expect(page.getByTestId('session-plan-segment-lesson')).not.toHaveText('0 min')

  const failures = await mixDeviations(page)
  expect(errors).toEqual([])
  expect(failures, `REQ-3.1.4 mix deviations:\n  ${failures.join('\n  ')}`).toEqual([])
})
