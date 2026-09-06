/**
 * `GrooveStaff` (roadmap DR-05) renders a `StaffLayout` it is handed —
 * nothing here calls `engraveGroove`/`describeGroove` (neither exists yet;
 * both are being built alongside this component), so every layout below is
 * a hand-built literal. These tests only check that the renderer turns a
 * given layout into the right SVG shapes; the geometry itself is
 * `staff.ts`'s contract, proven by its own tests.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EngravedBeam, EngravedNote, NoteMark, StaffLayout } from '@core/drums/engrave/layout.ts'
import { MARK_RESERVE } from '@core/drums/engrave/layout.ts'
import type { MappedDrumPad, Notehead, Voice } from '@core/drums/model/pad.ts'
import { GrooveStaff } from './GrooveStaff.tsx'

afterEach(cleanup)

const STAFF_LINES = [
  { y: 5, fromX: 0, toX: 40 },
  { y: 6, fromX: 0, toX: 40 },
  { y: 7, fromX: 0, toX: 40 },
  { y: 8, fromX: 0, toX: 40 },
  { y: 9, fromX: 0, toX: 40 },
]

function baseLayout(overrides: Partial<StaffLayout> = {}): StaffLayout {
  return {
    width: 40,
    height: 13,
    staffLines: STAFF_LINES,
    barlines: [3, 39],
    notes: [],
    beams: [],
    counts: [
      { text: '1', x: 4, y: 11.5 },
      { text: 'e', x: 7, y: 11.5 },
    ],
    ...overrides,
  }
}

function makeNote({
  id,
  pad = 'snare',
  x,
  y = 7,
  notehead,
  voice = 'hands',
  marks = [],
  stemToY,
  flags = 0,
}: {
  readonly id: string
  readonly pad?: MappedDrumPad
  readonly x: number
  readonly y?: number
  readonly notehead: Notehead
  readonly voice?: Voice
  readonly marks?: readonly NoteMark[]
  readonly stemToY?: number
  readonly flags?: number
}): EngravedNote {
  return {
    id,
    pad,
    tick: 0,
    x,
    y,
    notehead,
    voice,
    dynamics: 'normal',
    marks,
    stemToY: stemToY ?? y - 3,
    flags,
  }
}

describe('GrooveStaff', () => {
  it("exposes the figure as an img with the given label and the groove's id", () => {
    render(<GrooveStaff layout={baseLayout()} label="Four on the floor" grooveId="four-on-the-floor" />)

    const svg = screen.getByRole('img', { name: 'Four on the floor' })
    expect(svg).toHaveAttribute('data-groove-staff', 'four-on-the-floor')
  })

  it('renders exactly one element for every note id, with none duplicated', () => {
    const notes = [
      makeNote({ id: '0.kick.0', pad: 'kick', x: 4, y: 9, notehead: 'normal' }),
      makeNote({ id: '0.snare.240', pad: 'snare', x: 7, y: 7, notehead: 'normal' }),
      makeNote({ id: '0.hhClosed.0', pad: 'hhClosed', x: 4, y: 4, notehead: 'x' }),
    ]
    const { container } = render(
      <GrooveStaff layout={baseLayout({ notes })} label="test groove" grooveId="g1" />,
    )

    for (const note of notes) {
      expect(container.querySelectorAll(`[data-note-id="${note.id}"]`)).toHaveLength(1)
    }
  })

  it('carries the pad on each note group alongside its id', () => {
    const notes = [makeNote({ id: '0.kick.0', pad: 'kick', x: 4, y: 9, notehead: 'normal' })]
    const { container } = render(
      <GrooveStaff layout={baseLayout({ notes })} label="test groove" grooveId="g1" />,
    )

    expect(container.querySelector('[data-note-id="0.kick.0"]')).toHaveAttribute('data-pad', 'kick')
  })

  it('renders an x notehead and a normal notehead as different element kinds', () => {
    const notes = [
      makeNote({ id: 'n-normal', x: 4, y: 7, notehead: 'normal' }),
      makeNote({ id: 'n-x', x: 8, y: 4, notehead: 'x' }),
    ]
    const { container } = render(
      <GrooveStaff layout={baseLayout({ notes })} label="test groove" grooveId="g1" />,
    )

    const normalGroup = container.querySelector('[data-note-id="n-normal"]')
    const xGroup = container.querySelector('[data-note-id="n-x"]')
    expect(normalGroup?.querySelector('ellipse')).not.toBeNull()
    expect(xGroup?.querySelector('ellipse')).toBeNull()
    expect(xGroup?.querySelectorAll('.groove-notehead-x line')).toHaveLength(2)
  })

  it('renders the open mark only on the note that carries it', () => {
    const notes = [
      makeNote({ id: 'n-open', x: 4, y: 7, notehead: 'normal', marks: ['open'] }),
      makeNote({ id: 'n-plain', x: 8, y: 7, notehead: 'normal' }),
    ]
    const { container } = render(
      <GrooveStaff layout={baseLayout({ notes })} label="test groove" grooveId="g1" />,
    )

    expect(container.querySelector('[data-note-id="n-open"] .groove-mark-open')).not.toBeNull()
    expect(container.querySelector('[data-note-id="n-plain"] .groove-mark-open')).toBeNull()
  })

  it('draws one beam rect for count 1 and two for count 2', () => {
    const oneBeam: EngravedBeam = { voice: 'hands', noteIds: ['a', 'b'], fromX: 4, toX: 7, y: 2, count: 1 }
    const { container: withOne } = render(
      <GrooveStaff layout={baseLayout({ beams: [oneBeam] })} label="test groove" grooveId="g1" />,
    )
    expect(withOne.querySelectorAll('.groove-beam')).toHaveLength(1)

    const twoBeam: EngravedBeam = { voice: 'hands', noteIds: ['a', 'b'], fromX: 4, toX: 7, y: 2, count: 2 }
    const { container: withTwo } = render(
      <GrooveStaff layout={baseLayout({ beams: [twoBeam] })} label="test groove" grooveId="g2" />,
    )
    expect(withTwo.querySelectorAll('.groove-beam')).toHaveLength(2)
  })

  it('marks the count row aria-hidden', () => {
    const { container } = render(<GrooveStaff layout={baseLayout()} label="test groove" grooveId="g1" />)

    expect(container.querySelector('.groove-count-row')).toHaveAttribute('aria-hidden', 'true')
  })

  it('draws one flag path per flag, on the notehead side of the stem tip, and none for a beamed note', () => {
    // An unbeamed eighth with no flag IS a quarter note, so this is the
    // renderer's half of the same guarantee `staff.ts` proves for `flags`.
    const { container } = render(
      <GrooveStaff
        layout={baseLayout({
          notes: [
            makeNote({ id: 'n-eighth', x: 6, y: 4, notehead: 'x', stemToY: 0.5, flags: 1 }),
            makeNote({ id: 'n-sixteenth', x: 10, y: 4, notehead: 'x', stemToY: 0.5, flags: 2 }),
            makeNote({ id: 'n-beamed', x: 14, y: 4, notehead: 'x', stemToY: 0.5, flags: 0 }),
            makeNote({ id: 'n-foot', pad: 'kick', voice: 'feet', x: 18, y: 9, notehead: 'normal', stemToY: 12.5, flags: 1 }),
          ],
        })}
        label="test groove"
        grooveId="g1"
      />,
    )

    expect(container.querySelectorAll('[data-note-id="n-eighth"] .groove-flag')).toHaveLength(1)
    expect(container.querySelectorAll('[data-note-id="n-sixteenth"] .groove-flag')).toHaveLength(2)
    expect(container.querySelectorAll('[data-note-id="n-beamed"] .groove-flag')).toHaveLength(0)

    // A hands flag curves DOWN from the tip towards the head; a feet flag
    // curves up. Getting this backwards would put the flag off the canvas.
    const handsFlag = container.querySelector('[data-note-id="n-eighth"] .groove-flag')
    const footFlag = container.querySelector('[data-note-id="n-foot"] .groove-flag')
    const endY = (el: Element | null) => Number((el?.getAttribute('d') ?? '').trim().split(/\s+/).at(-1))
    expect(endY(handsFlag)).toBeGreaterThan(0.5)
    expect(endY(footFlag)).toBeLessThan(12.5)
  })

  it('keeps a full mark stack inside the headroom core reserved for it (MARK_RESERVE)', () => {
    // The contract that lets `staff.ts` size the box without importing this
    // file's glyph dimensions: whatever this component stacks above a
    // notehead must fit in `MARK_RESERVE`. If a mark ever grows past it, the
    // engraver will place a staff too high and the mark will be clipped —
    // so this test is the other half of `layout.ts`'s `MARK_RESERVE` doc.
    const noteY = 7
    const { container } = render(
      <GrooveStaff
        layout={baseLayout({
          notes: [
            makeNote({ id: 'n-both', x: 10, y: noteY, notehead: 'x', marks: ['open', 'accent'] }),
          ],
        })}
        label="test groove"
        grooveId="g1"
      />,
    )

    const circle = container.querySelector('.groove-mark-open')
    const accent = container.querySelector('.groove-mark-accent')
    expect(circle).not.toBeNull()
    expect(accent).not.toBeNull()

    const circleTop = Number(circle?.getAttribute('cy')) - Number(circle?.getAttribute('r'))
    const accentYs = (accent?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => Number(pair.split(',')[1]))
    expect(accentYs.length).toBeGreaterThan(0)
    for (const value of [circleTop, ...accentYs]) expect(Number.isFinite(value)).toBe(true)

    const highest = Math.min(circleTop, ...accentYs)
    expect(highest).toBeGreaterThanOrEqual(noteY - MARK_RESERVE)
  })

  it("sets the viewBox from the layout's own width and height", () => {
    render(<GrooveStaff layout={baseLayout({ width: 51, height: 13 })} label="test groove" grooveId="g1" />)

    expect(screen.getByRole('img')).toHaveAttribute('viewBox', '0 0 51 13')
  })

  it('renders the staff lines and does not throw for an empty layout with no notes', () => {
    const empty = baseLayout({ notes: [], beams: [], counts: [] })

    expect(() =>
      render(<GrooveStaff layout={empty} label="Empty groove" grooveId="empty" />),
    ).not.toThrow()

    const svg = screen.getByRole('img', { name: 'Empty groove' })
    expect(svg.querySelectorAll('.groove-staff-line')).toHaveLength(5)
  })
})
