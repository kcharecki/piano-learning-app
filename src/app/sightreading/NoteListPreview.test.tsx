/**
 * `NoteListPreview` (roadmap 2.12) renders real generated notes, honestly
 * labelled as not being engraved notation — see the module comment.
 */
import { buildTestScore } from '@core/notation/fixtures.ts'
import { QUARTER } from '@core/shared/units.ts'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NoteListPreview } from './NoteListPreview.tsx'

afterEach(cleanup)

describe('NoteListPreview', () => {
  it('renders every note, grouped by hand and measure', () => {
    const score = buildTestScore([
      { midi: 60, startTick: 0, hand: 'right' },
      { midi: 64, startTick: QUARTER, hand: 'right' },
      { midi: 48, startTick: 0, hand: 'left' },
    ])

    render(<NoteListPreview score={score} />)

    expect(screen.getByRole('heading', { name: 'Right hand' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Left hand' })).toBeInTheDocument()
    expect(screen.getByTestId('measure-right-0')).toHaveTextContent('C4 (quarter), E4 (quarter)')
    expect(screen.getByTestId('measure-left-0')).toHaveTextContent('C3 (quarter)')
  })

  it('does not print a hand line with no notes', () => {
    const score = buildTestScore([{ midi: 60, startTick: 0, hand: 'right' }])

    render(<NoteListPreview score={score} />)

    expect(screen.queryByRole('heading', { name: 'Left hand' })).toBeNull()
  })
})
