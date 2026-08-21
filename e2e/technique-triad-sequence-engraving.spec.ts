import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { techniqueDrillById, techniqueScore } from '../src/core/technique/library.ts'
import { TRIAD_SEQUENCE_STEPS } from '../src/core/technique/triadSequence.ts'

/**
 * E2E proof for roadmap T.8, and for T.7's "must assert the ENGRAVING" clause.
 *
 * The broken triad sequence is written as eighth-note triplets. Under OSMD's
 * shipped defaults (`TupletNumberLimitConsecutiveRepetitions`,
 * `TupletNumberMaxConsecutiveRepetitions = 2`,
 * `TupletNumberAlwaysDisableAfterFirstMax`) only the first two groups get a
 * numeral and the remaining six are drawn as plain beamed eighths — so bar 1
 * reads as 5 beats and bar 2 as 6, in a 4/4 score. `applyEngravingRules` in
 * `src/app/score/osmdEngraver.ts` turns both limits off. Measured A/B on this
 * very page while writing this spec: 74 `<path>` elements with the defaults,
 * 80 with them off — the six missing numerals, exactly.
 *
 * A numeral is NOT a `<text>` node. OSMD draws it as a music-font glyph
 * `<path>` that is a direct child of the measure's own `g.vf-measure`, which
 * is what this spec counts. That distinction is why the previous attempt's
 * suite missed the bug: hiding every `<text>` in the SVG left the numerals on
 * screen, so a text-based count proved nothing.
 */

/** Console/page errors, collected from page creation (see e2e/smoke.spec.ts). */
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

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

const centerX = (b: Box): number => b.x + b.width / 2

/** A digit glyph is small; a staff line or barline drawn as a path is not. */
const MAX_GLYPH_PX = 20

/**
 * One rendered system. The score wraps onto two of them, and the second
 * system restarts at a smaller x than the first ends at — so numerals and
 * noteheads may only ever be paired up *within* a system.
 */
type System = {
  readonly noteheads: readonly Box[]
  /** Tuplet numerals: glyph-sized paths parented directly by a measure group. */
  readonly numerals: readonly Box[]
  /** This system's topmost staff line — a numeral must sit above it. */
  readonly staffTopY: number
}

async function readSystems(page: Page): Promise<readonly System[]> {
  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible({ timeout: 15_000 })
  const systems = await container.evaluate((el, maxGlyphPx) => {
    const box = (n: Element) => {
      const b = (n as SVGGraphicsElement).getBBox()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    }
    const byX = (a: { x: number; width: number }, b: { x: number; width: number }) =>
      a.x + a.width / 2 - (b.x + b.width / 2)
    return [...el.querySelectorAll('g.staffline')].map((staffline) => {
      const paths = [...staffline.querySelectorAll('g.vf-measure > path')].map(box)
      const lineYs = paths.filter((b) => b.height === 0).map((b) => b.y)
      return {
        noteheads: [...staffline.querySelectorAll('[data-note-id]')].map(box).sort(byX),
        numerals: paths
          .filter((b) => b.height > 0 && b.width > 0 && b.width < maxGlyphPx)
          .sort(byX),
        staffTopY: lineYs.length === 0 ? 0 : Math.min(...lineYs),
      }
    })
  }, MAX_GLYPH_PX)
  expect(systems.length, 'expected the score to render at least one system').toBeGreaterThan(0)
  return systems
}

async function openDrill(page: Page, id: string): Promise<void> {
  const drill = techniqueDrillById(id)
  if (drill === undefined) throw new Error(`expected drill "${id}" in the library`)
  await page.getByLabel('Drill', { exact: true }).selectOption({ label: drill.title })
}

const BROKEN = 'triad-sequence-c-major-broken-hands-right'
const SOLID = 'triad-sequence-c-major-solid-hands-right'

test('every triplet group of the broken triad sequence is engraved with its numeral (roadmap T.8)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Technique').click()
  await openDrill(page, BROKEN)

  const drill = techniqueDrillById(BROKEN)
  if (drill === undefined) throw new Error('drill vanished between selection and assertion')
  const score = techniqueScore(drill, drill.targetBpm)

  const systems = await readSystems(page)
  const noteheads = systems.flatMap((s) => s.noteheads)
  const numerals = systems.flatMap((s) => s.numerals)

  // All 24 notes are on the page — a numeral count means nothing if the music
  // under it is short.
  expect(noteheads).toHaveLength(score.notes.length)
  expect(noteheads).toHaveLength(3 * TRIAD_SEQUENCE_STEPS)

  // The bar the roadmap sets: one numeral per group, no fewer. Under OSMD's
  // shipped defaults this count is 2.
  expect(numerals, 'one tuplet numeral per triplet group').toHaveLength(TRIAD_SEQUENCE_STEPS)

  // And they are spread over the eight groups rather than clustered at the
  // front: within each system, numeral k sits over group k's middle note.
  // That pairing is what turns "8 numerals" into "8 different groups".
  const SAME_COLUMN_PX = 12
  for (const [system, { noteheads: notes, numerals: marks, staffTopY }] of systems.entries()) {
    expect(notes.length % 3, `system ${system} split a triplet group`).toBe(0)
    expect(marks, `system ${system} numerals`).toHaveLength(notes.length / 3)
    marks.forEach((numeral, group) => {
      const middle = notes[group * 3 + 1]
      if (middle === undefined) throw new Error(`no middle notehead for group ${group}`)
      expect(
        Math.abs(centerX(numeral) - centerX(middle)),
        `system ${system} numeral ${group + 1} is not over its own group`,
      ).toBeLessThanOrEqual(SAME_COLUMN_PX)
      // Above the staff, where a tuplet numeral belongs — not colliding with
      // the notes it describes.
      expect(numeral.y + numeral.height).toBeLessThanOrEqual(staffTopY)
    })
  }

  expect(errors).toEqual([])
})

test('the solid form is engraved with no tuplet numerals at all', async ({ page }) => {
  // The control for the test above: it counts glyph-shaped paths, and this
  // proves that count is a property of the tuplets and not of every drill.
  // The solid sequence is plain quarter notes and must show none.
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Technique').click()
  await openDrill(page, SOLID)

  const systems = await readSystems(page)
  expect(systems.flatMap((s) => s.noteheads)).toHaveLength(3 * TRIAD_SEQUENCE_STEPS)
  expect(systems.flatMap((s) => s.numerals)).toHaveLength(0)
  expect(errors).toEqual([])
})
