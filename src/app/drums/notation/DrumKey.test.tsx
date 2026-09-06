/**
 * `DrumKey` (roadmap DR-05) — thin render tests. Geometry (which mark, which
 * notehead) comes from `NoteGlyphs.tsx`, proven by its own tests; this file
 * only proves the row-building and captioning logic, plus the accessibility
 * contract the panel's review demanded: a screen reader hears the pad name
 * and its key, never "image".
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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

  it('gives the open-hat row the circle glyph and the closed-hat row none', () => {
    const notes = [
      note({ id: 'd', pad: 'hhClosed', y: 4, notehead: 'x' }),
      note({ id: 'e', pad: 'hhOpen', y: 3, notehead: 'x', marks: ['open'] }),
    ]
    render(<DrumKey layout={layoutWith(notes)} labelFor={labelFor} keyFor={keyFor} />)

    const rows = screen.getAllByRole('listitem')
    const openRow = rows.find((row) => row.textContent?.includes('Open hi-hat'))
    const closedRow = rows.find((row) => row.textContent?.startsWith('Hi-hat'))
    expect(openRow?.querySelector('.groove-mark-open')).not.toBeNull()
    expect(closedRow?.querySelector('.groove-mark-open')).toBeNull()
  })

  it('shows the pedal caption only when a row carries the open mark', () => {
    const withOpen = layoutWith([note({ id: 'e', pad: 'hhOpen', y: 3, notehead: 'x', marks: ['open'] })])
    const { rerender } = render(<DrumKey layout={withOpen} labelFor={labelFor} keyFor={keyFor} />)
    expect(screen.getByText(/left foot lifts the pedal/)).toBeInTheDocument()

    const withoutOpen = layoutWith([note({ id: 'a', pad: 'kick', y: 9, notehead: 'normal' })])
    rerender(<DrumKey layout={withoutOpen} labelFor={labelFor} keyFor={keyFor} />)
    expect(screen.queryByText(/left foot lifts the pedal/)).not.toBeInTheDocument()
  })

  it('orders rows top of staff first', () => {
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

  it('roots itself at a plain, addressable div and hides its glyphs from the accessibility tree', () => {
    const notes = [note({ id: 'a', pad: 'kick', y: 9, notehead: 'normal' })]
    const { container } = render(<DrumKey layout={layoutWith(notes)} labelFor={labelFor} keyFor={keyFor} />)

    expect(container.querySelector('div.drum-key[data-drum-key]')).not.toBeNull()
    expect(container.querySelector('.drum-key-glyph')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('ul.drum-key-list')).not.toBeNull()
  })
})
