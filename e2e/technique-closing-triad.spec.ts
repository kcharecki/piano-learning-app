import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { techniqueLibrary, techniqueScore } from '../src/core/technique/library.ts'

/**
 * E2E proof for roadmap T.13. `fiveFingerRun` returned nine single notes and
 * stopped, so the pentascale row of RCM Preparatory A p.9 — "tonic to
 * dominant, ascending and descending (ending with solid/blocked root-position
 * triad)" — was engraved without the chord it names, and a Preparatory A
 * learner met their first chord in whichever drill came next.
 *
 * The model side (three notes at one startTick, root position, 1-3-5 / 5-3-1,
 * a dotted half filling the third bar) is asserted in
 * `src/core/technique/library.test.ts`. What only a browser can prove is that
 * OSMD DRAWS it as a chord: three noteheads stacked on one x, each with its
 * own fingering digit above. That distinction is not academic here — roadmap
 * T.8 is an open defect where a schema-correct MusicXML feature renders
 * wrongly, so "the model is right" is explicitly not accepted as proof that
 * the learner sees it.
 */

/** Console/page errors, collected from the moment the page is created (see e2e/smoke.spec.ts). */
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
type Glyph = { readonly text: string; readonly bbox: Box }

const centerX = (b: Box): number => b.x + b.width / 2

test('the five-finger drill engraves its closing blocked triad as a real chord, fingered (roadmap T.13)', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await nav(page, 'Technique').click()

  const DRILL_ID = 'five-finger-c-major-hands-right'
  const drill = techniqueLibrary(1).find((d) => d.id === DRILL_ID)
  if (drill === undefined) throw new Error(`expected drill "${DRILL_ID}" in the level-1 library`)
  await page.getByLabel('Drill', { exact: true }).selectOption({ label: drill.title })

  // The model this run is judged against, derived not restated.
  const score = techniqueScore(drill, drill.targetBpm)
  const lastTick = Math.max(...score.notes.map((n) => n.startTick))
  const expectedChord = [...score.notes.filter((n) => n.startTick === lastTick)].sort(
    (a, b) => b.midi - a.midi,
  )
  expect(expectedChord).toHaveLength(3)
  // Highest first, so this reads in the order the glyphs are stacked on the
  // page: G finger 5, E finger 3, C finger 1.
  expect(expectedChord.map((n) => n.fingering)).toEqual([5, 3, 1])

  const container = page.getByTestId('score-container')
  await expect(container.locator('svg')).toBeVisible({ timeout: 15_000 })

  const geometry = await container.evaluate((el) => {
    const svg = el.querySelector('svg')
    if (svg === null) return null
    const box = (n: Element) => {
      const b = (n as SVGGraphicsElement).getBBox()
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    }
    const notes = [...svg.querySelectorAll('[data-note-id]')].map((n) => ({
      text: n.getAttribute('data-note-id') ?? '',
      bbox: box(n),
    }))
    const digits = [...svg.querySelectorAll('text')]
      .filter((t) => /^\d$/.test((t.textContent ?? '').trim()))
      .map((t) => ({ text: (t.textContent ?? '').trim(), bbox: box(t) }))
    return { notes, digits }
  })
  if (geometry === null) throw new Error('no svg found under score-container')
  const { notes, digits } = geometry as { notes: readonly Glyph[]; digits: readonly Glyph[] }

  // Ten onsets are engraved: nine single notes plus one three-note chord.
  expect(notes).toHaveLength(score.notes.length)

  // The three rightmost noteheads are the chord. Grouping by x rather than by
  // taking the last three in document order is what makes this an assertion
  // about the DRAWING: three notes emitted as a sequence would spread across
  // three x positions and fail here even though the note count matched.
  const byX = [...notes].sort((a, b) => centerX(b.bbox) - centerX(a.bbox))
  const chord = byX.slice(0, 3)
  const rightmost = chord[0]
  const previous = byX[3]
  if (rightmost === undefined || previous === undefined) {
    throw new Error(`expected at least 4 noteheads, got ${notes.length}`)
  }
  const chordX = centerX(rightmost.bbox)
  const SAME_COLUMN_PX = 6
  for (const note of chord) {
    expect(
      Math.abs(centerX(note.bbox) - chordX),
      `notehead ${note.text} is not in the chord's column`,
    ).toBeLessThanOrEqual(SAME_COLUMN_PX)
  }
  // The fourth-from-right notehead is the run's last single note, and must
  // NOT share that column — otherwise "three in a column" would be satisfied
  // by an engraving that stacked everything.
  expect(Math.abs(centerX(previous.bbox) - chordX)).toBeGreaterThan(SAME_COLUMN_PX)

  // Stacked, not overlaid: three distinct heights, high pitch highest.
  const ys = [...chord].map((n) => n.bbox.y).sort((a, b) => a - b)
  const [top, middle, bottom] = ys
  if (top === undefined || middle === undefined || bottom === undefined) {
    throw new Error('expected three chord noteheads')
  }
  expect(new Set(ys.map((y) => Math.round(y))).size).toBe(3)
  expect(top).toBeLessThan(middle)
  expect(middle).toBeLessThan(bottom)

  // Each chord tone carries its own fingering digit, above the staff, in the
  // chord's own column — 5 over 3 over 1 for the right hand.
  const chordDigits = digits
    .filter((d) => Math.abs(centerX(d.bbox) - chordX) <= SAME_COLUMN_PX + 4)
    .sort((a, b) => a.bbox.y - b.bbox.y)
  expect(chordDigits.map((d) => d.text)).toEqual(['5', '3', '1'])
  const chordTop = Math.min(...chord.map((n) => n.bbox.y))
  for (const digit of chordDigits) {
    expect(digit.bbox.y, `fingering ${digit.text} should sit above the chord`).toBeLessThan(chordTop)
  }

  expect(errors).toEqual([])
})
