import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { techniqueLibrary, techniqueScore } from '../src/core/technique/library.ts'

/**
 * E2E proof for roadmap 5.22. Before this, the Technique screen's fingering
 * was a flat, hand-agnostic string (" Fingering: 1 - 2 - 3 - ... ") below the
 * engraving — `TechniqueScreen.test.tsx` and `musicxmlwriter.test.ts` prove
 * the data path (every note carries `.fingering`, `writeMusicXml` now emits
 * `<technical><fingering>`), but neither can prove OSMD actually DRAWS a
 * glyph above/below the right notehead — OSMD is mocked out at the unit
 * level (no canvas to measure text in happy-dom). This is that proof, read
 * off the real rendered SVG, not the model.
 */

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
  return page
    .getByRole('navigation', { name: /main/i })
    .getByRole('button', { name: label, exact: true })
}

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
type NoteGlyph = { readonly id: string; readonly bbox: Box }
type DigitGlyph = { readonly text: string; readonly bbox: Box }

/** Horizontal centre of a bounding box — what "above/below its own notehead" is measured against. */
const centerX = (b: Box): number => b.x + b.width / 2

/** The digit glyph whose horizontal centre is closest to the given notehead's. */
function nearestDigit(note: Box, digits: readonly DigitGlyph[]): DigitGlyph {
  return digits.reduce((best, d) =>
    Math.abs(centerX(d.bbox) - centerX(note)) < Math.abs(centerX(best.bbox) - centerX(note)) ? d : best,
  )
}

test('the C major two-octave drill engraves fingering above the right hand and below the left, per note (roadmap 5.22, REQ-3.7.1)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Technique').click()

  // Level 3 is the first level with a two-octave scale, hands together
  // (levels 1/2 are five-finger patterns and one-octave single-hand scales).
  await page.getByRole('button', { name: 'Increase level' }).click()
  await page.getByRole('button', { name: 'Increase level' }).click()
  // Canonical stepper shape (docs/ui-overhaul-brief.md): the word "Level"
  // lives outside the group as its accessible name, the bare numeral lives
  // in the value cell inside it — proving both, not just the number.
  const levelStepper = page.getByRole('group', { name: 'Level' })
  await expect(levelStepper).toBeVisible()
  await expect(levelStepper.getByTestId('technique-level')).toHaveText('3')

  const DRILL_ID = 'scale-c-major-2oct-hands-together'
  const drill = techniqueLibrary(3).find((d) => d.id === DRILL_ID)
  if (drill === undefined) throw new Error(`expected drill "${DRILL_ID}" in the level-3 library`)
  // Picked explicitly by title, robust to the library's ordering (the same
  // pattern e2e/technique-drill.spec.ts uses), not relied on as the default.
  await page.getByLabel('Drill', { exact: true }).selectOption({ label: drill.title })

  // The old interleaved readout is gone — REQ-3.7.1 is met by the engraving now.
  await expect(page.getByTestId('technique-fingering')).toHaveCount(0)

  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible({ timeout: 15_000 })

  const score = techniqueScore(drill, drill.targetBpm)
  const expectedRhFingers = score.notes
    .filter((n) => n.hand === 'right')
    .slice(0, 8)
    .map((n) => n.fingering)
  // Sanity on the fixture itself, not the engraving — this is what
  // `library.ts`'s multi-octave derivation is supposed to produce (proof
  // action's own worked example).
  expect(expectedRhFingers).toEqual([1, 2, 3, 1, 2, 3, 4, 1])

  const geometry = await container.evaluate((el) => {
    const svg = el.querySelector('svg')
    if (svg === null) return null
    const box = (n: Element) => {
      const b = (n as SVGGraphicsElement).getBBox()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    }
    const noteEls = [...svg.querySelectorAll('[data-note-id]')]
    const rhFirst8 = noteEls
      .filter((n) => /^m\d+\.r\./.test(n.getAttribute('data-note-id') ?? ''))
      .slice(0, 8)
      .map((n) => ({ id: n.getAttribute('data-note-id') ?? '', bbox: box(n) }))
    const lhFirst3 = noteEls
      .filter((n) => /^m\d+\.l\./.test(n.getAttribute('data-note-id') ?? ''))
      .slice(0, 3)
      .map((n) => ({ id: n.getAttribute('data-note-id') ?? '', bbox: box(n) }))
    // Fingering glyphs are the only bare single-digit `<text>` nodes OSMD
    // draws for this drill — measure numbers ("7") are excluded by the tight
    // x-proximity match below, not by this filter.
    const digits = [...svg.querySelectorAll('text')]
      .filter((t) => /^\d$/.test((t.textContent ?? '').trim()))
      .map((t) => ({ text: (t.textContent ?? '').trim(), bbox: box(t) }))
    return { rhFirst8, lhFirst3, digits }
  })
  if (geometry === null) throw new Error('no svg found under score-container')
  const { rhFirst8, lhFirst3, digits } = geometry as {
    rhFirst8: readonly NoteGlyph[]
    lhFirst3: readonly NoteGlyph[]
    digits: readonly DigitGlyph[]
  }
  expect(rhFirst8).toHaveLength(8)
  expect(lhFirst3).toHaveLength(3)

  // A hands-together drill plays both hands on the SAME beat, so a downbeat's
  // RH and LH noteheads can share an x-centre exactly — nearest-by-x alone
  // would then match a LH note to the RH glyph sitting directly above it.
  // Split the digit pool by height first (RH glyphs sit in a band above the
  // staff system, LH glyphs in a band below it, with a real gap between —
  // see the module comment's probe), then match nearest-by-x WITHIN a hand's
  // own pool only.
  const avgY = (notes: readonly NoteGlyph[]): number =>
    notes.reduce((sum, n) => sum + n.bbox.y, 0) / notes.length
  const midY = (avgY(rhFirst8) + avgY(lhFirst3)) / 2
  const rhDigits = digits.filter((d) => d.bbox.y < midY)
  const lhDigits = digits.filter((d) => d.bbox.y >= midY)

  // Right hand: the finger drawn nearest each notehead reads 1 2 3 1 2 3 4 1
  // (matching `expectedRhFingers` above), is horizontally centred on that
  // SAME notehead (within a few px — VexFlow trims each glyph's own advance
  // width asymmetrically, so exact-pixel equality is not the contract), and
  // sits ABOVE it (a smaller SVG y is higher on the page).
  const CENTER_TOLERANCE_PX = 4
  rhFirst8.forEach((note, i) => {
    const glyph = nearestDigit(note.bbox, rhDigits)
    expect(glyph.text, `RH note ${i} (${note.id})`).toBe(String(expectedRhFingers[i]))
    expect(
      Math.abs(centerX(glyph.bbox) - centerX(note.bbox)),
      `RH note ${i} (${note.id}) fingering not centred on its own notehead`,
    ).toBeLessThan(CENTER_TOLERANCE_PX)
    expect(
      glyph.bbox.y + glyph.bbox.height,
      `RH note ${i} (${note.id}) fingering not above its own notehead`,
    ).toBeLessThan(note.bbox.y)
  })

  // Left hand: same per-note alignment, but BELOW the notehead.
  lhFirst3.forEach((note, i) => {
    const glyph = nearestDigit(note.bbox, lhDigits)
    expect(
      Math.abs(centerX(glyph.bbox) - centerX(note.bbox)),
      `LH note ${i} (${note.id}) fingering not centred on its own notehead`,
    ).toBeLessThan(CENTER_TOLERANCE_PX)
    expect(
      glyph.bbox.y,
      `LH note ${i} (${note.id}) fingering not below its own notehead`,
    ).toBeGreaterThan(note.bbox.y + note.bbox.height)
  })

  expect(errors).toEqual([])
})
