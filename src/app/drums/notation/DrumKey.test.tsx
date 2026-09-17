/**
 * `DrumKey` (roadmap DR-05 / T.30) tests. The panel rejected the shape-only
 * legend because snare and kick — both a `normal` notehead — drew as
 * byte-identical rows; the fix draws each row as a miniature staff excerpt
 * with the pad's REAL vertical position, so most of these tests prove that
 * position (and the stem direction and marks that go with it), not just the
 * row-building/captioning logic `NoteGlyphs.test.tsx` doesn't already cover.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { at, invariant } from '@core/shared/invariant.ts'
import { engraveGroove } from '@core/drums/engrave/staff.ts'
import { moneyBeatOpenHat } from '@core/drums/model/referenceGrooves.ts'
import type { EngravedNote, NoteMark, StaffLayout } from '@core/drums/engrave/layout.ts'
import type { MappedDrumPad, Notehead } from '@core/drums/model/pad.ts'
import { DrumKey } from './DrumKey.tsx'

afterEach(cleanup)

const LABEL: Readonly<Record<MappedDrumPad, string>> = {
  kick: 'Kick',
  hhPedal: 'Hi-hat pedal',
  tomFloor: 'Floor tom',
  tomMid: 'Mid tom',
  snare: 'Snare',
  snareRim: 'Rim shot',
  crossStick: 'Cross stick',
  tomHigh: 'High tom',
  hhClosed: 'Hi-hat',
  hhOpen: 'Open hi-hat',
  rideBow: 'Ride',
  rideBell: 'Ride bell',
  rideEdge: 'Ride edge',
  crash1: 'Crash',
  crash2: 'Second crash',
  splash: 'Splash',
}

const labelFor = (pad: MappedDrumPad): string => LABEL[pad]
const keyFor = (pad: MappedDrumPad): string | undefined => {
  if (pad === 'hhClosed') return 'J'
  if (pad === 'hhOpen') return 'K'
  return undefined
}

function note({
  id,
  pad,
  y,
  notehead,
  marks = [],
}: {
  readonly id: string
  readonly pad: MappedDrumPad
  readonly y: number
  readonly notehead: Notehead
  readonly marks?: readonly NoteMark[]
}): EngravedNote {
  return {
    id,
    pad,
    tick: 0,
    x: 0,
    y,
    notehead,
    voice: 'hands',
    dynamics: 'normal',
    marks,
    stemToY: y - 3,
    flags: 0,
    markAnchorY: y - 4,
  }
}

function layoutWith(notes: readonly EngravedNote[]): StaffLayout {
  return {
    width: 40,
    height: 13,
    staffLines: [
      { y: 5, fromX: 0, toX: 40 },
      { y: 6, fromX: 0, toX: 40 },
      { y: 7, fromX: 0, toX: 40 },
      { y: 8, fromX: 0, toX: 40 },
      { y: 9, fromX: 0, toX: 40 },
    ],
    barlines: [39],
    timeSignature: { beats: 4, beatType: 4, x: 1.3, y: 5 },
    notes,
    beams: [],
    rests: [],
    counts: [],
    playCount: 1,
    repeatLabel: undefined,
  }
}

/** Finds a pad's row by its rendered label prefix — every `LABEL` entry above is distinct enough for `startsWith`. */
function findRow(rows: readonly HTMLElement[], labelPrefix: string): HTMLElement {
  const row = rows.find((r) => r.textContent?.startsWith(labelPrefix))
  invariant(row !== undefined, `expected a row starting with "${labelPrefix}"`)
  return row
}

function findNote(layout: StaffLayout, pad: MappedDrumPad): EngravedNote {
  const found = layout.notes.find((n) => n.pad === pad)
  invariant(found !== undefined, `expected a ${pad} note in this layout`)
  return found
}

describe('DrumKey', () => {
  it('renders one row per distinct pad and no more, even with repeated hits', () => {
    const notes = [
      note({ id: 'a', pad: 'kick', y: 9, notehead: 'normal' }),
      note({ id: 'b', pad: 'kick', y: 9, notehead: 'normal' }),
      note({ id: 'c', pad: 'snare', y: 7, notehead: 'normal' }),
      note({ id: 'd', pad: 'hhClosed', y: 4, notehead: 'x' }),
      note({ id: 'e', pad: 'hhOpen', y: 3, notehead: 'x', marks: ['open'] }),
    ]
    render(<DrumKey layout={layoutWith(notes)} labelFor={labelFor} keyFor={keyFor} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('orders rows top of staff first and never repeats a pad', () => {
    // Mutant killed: a stub that sorted by pad name (or not at all) instead
    // of by staff position would put "Kick" before "Hi-hat".
    const notes = [
      note({ id: 'a', pad: 'kick', y: 9, notehead: 'normal' }),
      note({ id: 'c', pad: 'snare', y: 7, notehead: 'normal' }),
      note({ id: 'd', pad: 'hhClosed', y: 4, notehead: 'x' }),
    ]
    render(<DrumKey layout={layoutWith(notes)} labelFor={labelFor} keyFor={keyFor} />)

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent)
    expect(rows).toEqual([
      expect.stringContaining('Hi-hat'),
      expect.stringContaining('Snare'),
      expect.stringContaining('Kick'),
    ])
  })

  it(
    "draws the snare and kick rows at the exact vertical positions the staff itself drew them — " +
      'the fix for the flipped-key defect the panel rejected (T.30)',
    () => {
      // Mutant killed: a stub that draws every notehead at a fixed cy
      // (the rejected shape-only legend's actual defect) makes the snare and
      // kick rows identical, so this fails the moment position stops being
      // read from the layout.
      const layout = engraveGroove(moneyBeatOpenHat(), {})
      const topLineY = at(layout.staffLines, 0).y
      const snareNote = findNote(layout, 'snare')
      const kickNote = findNote(layout, 'kick')
      // moneyBeatOpenHat's snare and kick sit 1.5 and 3.5 spaces below the
      // top line respectively (the PAS/Weinberg staff positions in pad.ts) —
      // asserted here so a future change to that table would be caught by
      // its own test, not silently reflected here.
      expect(snareNote.y - topLineY).toBeCloseTo(1.5, 5)
      expect(kickNote.y - topLineY).toBeCloseTo(3.5, 5)

      render(<DrumKey layout={layout} labelFor={labelFor} keyFor={keyFor} />)
      const rows = screen.getAllByRole('listitem')
      const snareRow = findRow(rows, 'Snare')
      const kickRow = findRow(rows, 'Kick')

      const snareLineY = Number(snareRow.querySelector('.groove-staff-line')?.getAttribute('y1'))
      const kickLineY = Number(kickRow.querySelector('.groove-staff-line')?.getAttribute('y1'))
      const snareCy = Number(snareRow.querySelector('.groove-notehead-normal')?.getAttribute('cy'))
      const kickCy = Number(kickRow.querySelector('.groove-notehead-normal')?.getAttribute('cy'))

      expect(snareCy - snareLineY).toBeCloseTo(snareNote.y - topLineY, 5)
      expect(kickCy - kickLineY).toBeCloseTo(kickNote.y - topLineY, 5)
      expect(kickCy - kickLineY - (snareCy - snareLineY)).toBeCloseTo(2, 5)
    },
  )

  it('draws the hi-hat row as a cross and the snare row as an ellipse, and puts the open-hat circle above its own notehead', () => {
    // Mutant killed: a stub that always drew `ellipse` (ignoring the pad's
    // `notehead`) would fail the cross assertion; a stub that skipped the
    // open mark, or centred it ON the notehead instead of above it, would
    // fail the remaining two.
    const layout = engraveGroove(moneyBeatOpenHat(), {})
    render(<DrumKey layout={layout} labelFor={labelFor} keyFor={keyFor} />)
    const rows = screen.getAllByRole('listitem')

    const closedRow = findRow(rows, 'Hi-hat')
    const snareRow = findRow(rows, 'Snare')
    const openRow = findRow(rows, 'Open hi-hat')

    expect(snareRow.querySelector('ellipse')).not.toBeNull()
    expect(closedRow.querySelectorAll('.groove-notehead-x line')).toHaveLength(2)
    expect(closedRow.querySelector('.groove-mark-open')).toBeNull()

    const openCircle = openRow.querySelector('.groove-mark-open')
    const openCrossLine = openRow.querySelector('.groove-notehead-x line')
    expect(openCircle).not.toBeNull()
    const circleCy = Number(openCircle?.getAttribute('cy'))
    // The `x` notehead has no single element with its own `cy` — both its
    // diagonal lines share the same centre, so either line's own midpoint is
    // the notehead's vertical centre.
    const noteheadCy = (Number(openCrossLine?.getAttribute('y1')) + Number(openCrossLine?.getAttribute('y2'))) / 2
    expect(circleCy).toBeLessThan(noteheadCy)
  })

  it("draws the kick row's stem down and the snare row's stem up", () => {
    // Mutant killed: a stub that always drew the stem in one fixed direction
    // (or read `voice` backwards) would fail one of these two.
    const layout = engraveGroove(moneyBeatOpenHat(), {})
    render(<DrumKey layout={layout} labelFor={labelFor} keyFor={keyFor} />)
    const rows = screen.getAllByRole('listitem')

    const kickStem = findRow(rows, 'Kick').querySelector('.groove-stem')
    const snareStem = findRow(rows, 'Snare').querySelector('.groove-stem')
    invariant(kickStem !== null && snareStem !== null, 'expected both rows to draw a stem')

    expect(Number(kickStem.getAttribute('y2'))).toBeGreaterThan(Number(kickStem.getAttribute('y1')))
    expect(Number(snareStem.getAttribute('y2'))).toBeLessThan(Number(snareStem.getAttribute('y1')))
  })

  it('gives every row exactly five staff lines', () => {
    // Mutant killed: a stub that dropped the mini staff (or drew a partial
    // one, e.g. only the lines the notehead's own space needs) would fail
    // this on every row, not just one.
    const layout = engraveGroove(moneyBeatOpenHat(), {})
    render(<DrumKey layout={layout} labelFor={labelFor} keyFor={keyFor} />)

    for (const row of screen.getAllByRole('listitem')) {
      expect(row.querySelectorAll('.groove-staff-line')).toHaveLength(5)
    }
  })

  it('shows the pedal caption only when a row carries the open mark', () => {
    const withOpen = layoutWith([note({ id: 'e', pad: 'hhOpen', y: 3, notehead: 'x', marks: ['open'] })])
    const { rerender } = render(<DrumKey layout={withOpen} labelFor={labelFor} keyFor={keyFor} />)
    expect(screen.getByText(/left foot lifts the pedal/)).toBeInTheDocument()

    const withoutOpen = layoutWith([note({ id: 'a', pad: 'kick', y: 9, notehead: 'normal' })])
    rerender(<DrumKey layout={withoutOpen} labelFor={labelFor} keyFor={keyFor} />)
    expect(screen.queryByText(/left foot lifts the pedal/)).not.toBeInTheDocument()
  })

  it('shows no key text for a pad with none bound', () => {
    const notes = [note({ id: 'a', pad: 'kick', y: 9, notehead: 'normal' })]
    render(<DrumKey layout={layoutWith(notes)} labelFor={labelFor} keyFor={keyFor} />)

    expect(screen.getByRole('listitem').textContent).toBe('Kick')
  })

  it('shows the key for a pad that has one bound', () => {
    const notes = [note({ id: 'd', pad: 'hhClosed', y: 4, notehead: 'x' })]
    render(<DrumKey layout={layoutWith(notes)} labelFor={labelFor} keyFor={keyFor} />)

    expect(screen.getByRole('listitem').textContent).toBe('Hi-hat, J')
  })

  it("roots itself at a plain, addressable div and hides its mini staves from the accessibility tree", () => {
    const notes = [note({ id: 'a', pad: 'kick', y: 9, notehead: 'normal' })]
    const { container } = render(<DrumKey layout={layoutWith(notes)} labelFor={labelFor} keyFor={keyFor} />)

    expect(container.querySelector('div.drum-key[data-drum-key]')).not.toBeNull()
    expect(container.querySelector('.drum-key-mini-staff')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('ul.drum-key-list')).not.toBeNull()
  })
})
