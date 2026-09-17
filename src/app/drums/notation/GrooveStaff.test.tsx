/**
 * `GrooveStaff` (roadmap DR-05) renders a `StaffLayout` it is handed —
 * nothing here calls `engraveGroove`/`describeGroove`, so every layout below
 * is a hand-built literal. These tests only check that the renderer turns a
 * given layout into the right SVG shapes; the geometry itself is
 * `staff.ts`'s contract, proven by its own tests.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { invariant } from '@core/shared/invariant.ts'
import type { EngravedBeam, EngravedNote, NoteMark, StaffLayout } from '@core/drums/engrave/layout.ts'
import { MARK_ANCHOR_GAP, MARK_RESERVE, REPEAT_BARLINE_RESERVE, SLOT_WIDTH } from '@core/drums/engrave/layout.ts'
import type { MappedDrumPad, Notehead, Voice } from '@core/drums/model/pad.ts'
import { GHOST_BULGE, GHOST_GAP_X, GrooveStaff } from './GrooveStaff.tsx'

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
    barlines: [39],
    timeSignature: { beats: 4, beatType: 4, x: 1.3, y: 5 },
    notes: [],
    beams: [],
    rests: [],
    counts: [
      { text: '1', x: 4, y: 11.5 },
      { text: 'e', x: 7, y: 11.5 },
    ],
    playCount: 1,
    repeatLabel: undefined,
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
  markAnchorY,
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
  readonly markAnchorY?: number
}): EngravedNote {
  const resolvedStemToY = stemToY ?? y - 3
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
    stemToY: resolvedStemToY,
    flags,
    markAnchorY: markAnchorY ?? resolvedStemToY - MARK_ANCHOR_GAP,
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

  it("keeps every mark's bounding box clear of the note's own stem", () => {
    // The panel's most-cited defect: the open-hi-hat circle used to be
    // centred ON the stem, which is the notation for a HALF-open hi-hat, a
    // different articulation. `markAnchorY` is core's answer — the renderer
    // must stack marks off it, not off the notehead — so this proves the
    // stacked mark never reaches back down as far as the stem tip.
    const stemToY = 2
    const markAnchorY = stemToY - MARK_ANCHOR_GAP
    const { container } = render(
      <GrooveStaff
        layout={baseLayout({
          notes: [
            makeNote({
              id: 'n-open-beamed',
              x: 6,
              y: 7,
              notehead: 'x',
              voice: 'hands',
              marks: ['open'],
              stemToY,
              markAnchorY,
            }),
          ],
        })}
        label="test groove"
        grooveId="g1"
      />,
    )

    const circle = container.querySelector('[data-note-id="n-open-beamed"] .groove-mark-open')
    const cy = Number(circle?.getAttribute('cy'))
    const r = Number(circle?.getAttribute('r'))
    expect(Number.isFinite(cy) && Number.isFinite(r)).toBe(true)
    expect(cy + r).toBeLessThan(stemToY)
  })

  it('draws one beam rect per segment, offsetting a level-2 segment by its own y', () => {
    const oneLevel: EngravedBeam = {
      voice: 'hands',
      noteIds: ['a', 'b'],
      fromX: 4,
      toX: 7,
      y: 2,
      segments: [{ level: 1, fromX: 4, toX: 7 }],
    }
    const { container: withOne } = render(
      <GrooveStaff layout={baseLayout({ beams: [oneLevel] })} label="test groove" grooveId="g1" />,
    )
    expect(withOne.querySelectorAll('.groove-beam')).toHaveLength(1)

    const twoLevels: EngravedBeam = {
      voice: 'hands',
      noteIds: ['a', 'b'],
      fromX: 4,
      toX: 7,
      y: 2,
      // A partial secondary beam is deliberate (`EngravedBeamSegment`'s own
      // doc comment) — half the width of the primary segment, not the full span.
      segments: [
        { level: 1, fromX: 4, toX: 7 },
        { level: 2, fromX: 4, toX: 5.5 },
      ],
    }
    const { container: withTwo } = render(
      <GrooveStaff layout={baseLayout({ beams: [twoLevels] })} label="test groove" grooveId="g2" />,
    )
    const rects = withTwo.querySelectorAll('.groove-beam')
    expect(rects).toHaveLength(2)
    const widths = Array.from(rects).map((r) => Number(r.getAttribute('width'))).sort((a, b) => a - b)
    expect(widths).toEqual([1.5, 3])
    const ys = Array.from(rects).map((r) => Number(r.getAttribute('y')))
    expect(new Set(ys).size).toBe(2)
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
    // file's glyph dimensions: whatever this component stacks above
    // `markAnchorY` must fit in `MARK_RESERVE`. If a mark ever grows past it,
    // the engraver will place a staff too high and the mark will be clipped —
    // so this test is the other half of `layout.ts`'s `MARK_RESERVE` doc.
    const markAnchorY = 3
    const { container } = render(
      <GrooveStaff
        layout={baseLayout({
          notes: [
            makeNote({ id: 'n-both', x: 10, y: 7, notehead: 'x', marks: ['open', 'accent'], markAnchorY }),
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
    expect(highest).toBeGreaterThanOrEqual(markAnchorY - MARK_RESERVE)
  })

  it('keeps two ghost notes one grid slot apart from merging into one bracket', () => {
    // The panel found `GHOST_GAP_X + GHOST_BULGE` summing to more than half
    // a slot, so two ghost parentheses one `SLOT_WIDTH` apart overlapped and
    // rendered as one tangled glyph. This holds the constants to the
    // inequality that prevents that, rather than trusting the numbers not to
    // drift apart again silently.
    expect(2 * (GHOST_GAP_X + GHOST_BULGE)).toBeLessThanOrEqual(SLOT_WIDTH)
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

  describe('time signature', () => {
    it('draws both digits as an aria-hidden group', () => {
      const { container } = render(
        <GrooveStaff
          layout={baseLayout({ timeSignature: { beats: 3, beatType: 4, x: 3.5, y: 5 } })}
          label="test groove"
          grooveId="g1"
        />,
      )
      const group = container.querySelector('.groove-time-signature')
      expect(group).toHaveAttribute('aria-hidden', 'true')
      const texts = Array.from(group?.querySelectorAll('text') ?? []).map((t) => t.textContent)
      expect(texts).toEqual(['3', '4'])
    })
  })

  describe('rests', () => {
    it('draws one aria-hidden rest glyph per entry', () => {
      const { container } = render(
        <GrooveStaff
          layout={baseLayout({ rests: [{ voice: 'feet', x: 10, y: 7, beats: 1 }] })}
          label="test groove"
          grooveId="g1"
        />,
      )
      const group = container.querySelector('.groove-rests')
      expect(group).toHaveAttribute('aria-hidden', 'true')
      expect(group?.querySelectorAll('.groove-rest-quarter')).toHaveLength(1)
    })
  })

  describe('repeat barline', () => {
    it('draws a plain single barline when playCount is 1', () => {
      const { container } = render(
        <GrooveStaff layout={baseLayout({ barlines: [39], playCount: 1 })} label="test groove" grooveId="g1" />,
      )
      expect(container.querySelectorAll('.groove-barline')).toHaveLength(1)
      expect(container.querySelector('.groove-repeat-barline')).toBeNull()
    })

    it('draws a thick+thin repeat barline with two dots when playCount is more than 1', () => {
      const { container } = render(
        <GrooveStaff layout={baseLayout({ barlines: [39], playCount: 2 })} label="test groove" grooveId="g1" />,
      )
      const repeat = container.querySelector('.groove-repeat-barline')
      expect(repeat).toHaveAttribute('aria-hidden', 'true')
      expect(repeat?.querySelector('.groove-repeat-barline-thick')).not.toBeNull()
      expect(repeat?.querySelector('.groove-repeat-barline-thin')).not.toBeNull()
      expect(repeat?.querySelectorAll('.groove-repeat-dot')).toHaveLength(2)
      expect(container.querySelectorAll('.groove-barline')).toHaveLength(0)
    })

    it('keeps the whole apparatus inside the width the layout reserved for it', () => {
      // The dots reach back into the bar, and core widens the tail by exactly
      // `REPEAT_BARLINE_RESERVE` to make room. Spend more than that and the
      // dots land on the last slot's notehead — on Quarter-Note Rock one was
      // drawn straight onto the beat-4 snare, which reads as a dotted note.
      const barlineX = 39
      const { container } = render(
        <GrooveStaff layout={baseLayout({ barlines: [barlineX], playCount: 2 })} label="test groove" grooveId="g1" />,
      )
      const repeat = container.querySelector('.groove-repeat-barline')
      invariant(repeat !== null, 'expected a repeat barline')

      const leftEdges = [
        ...[...repeat.querySelectorAll('line')].map((l) => Number(l.getAttribute('x1'))),
        ...[...repeat.querySelectorAll('rect')].map((r) => Number(r.getAttribute('x'))),
        ...[...repeat.querySelectorAll('circle')].map(
          (c) => Number(c.getAttribute('cx')) - Number(c.getAttribute('r')),
        ),
      ]
      expect(leftEdges.length).toBeGreaterThan(0)
      expect(Math.min(...leftEdges)).toBeGreaterThanOrEqual(barlineX - REPEAT_BARLINE_RESERVE)
    })

    it('draws the repeat label right-anchored when present', () => {
      const { container } = render(
        <GrooveStaff
          layout={baseLayout({ barlines: [39], playCount: 2, repeatLabel: { text: '×2', x: 39, y: 4 } })}
          label="test groove"
          grooveId="g1"
        />,
      )
      const label = container.querySelector('.groove-repeat-label')
      expect(label).toHaveAttribute('text-anchor', 'end')
      expect(label?.textContent).toBe('×2')
    })

    it('renders no repeat label when the layout has none', () => {
      const { container } = render(
        <GrooveStaff layout={baseLayout({ barlines: [39], playCount: 1 })} label="test groove" grooveId="g1" />,
      )
      expect(container.querySelector('.groove-repeat-label')).toBeNull()
    })
  })
})
