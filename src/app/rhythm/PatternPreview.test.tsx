/**
 * `PatternPreview` (roadmap 2.13): pure presentation, grouped by bar with a
 * readable duration name and a rest marker. No ports, no state — this only
 * asserts the formatting/grouping is wired to what it renders.
 */
import type { RhythmPattern } from '@core/generator/rhythm.ts'
import { ticks } from '@core/shared/units.ts'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PatternPreview } from './PatternPreview.tsx'

afterEach(cleanup)

const PATTERN: RhythmPattern = {
  timeSignature: { beats: 4, beatType: 4 },
  bars: 2,
  onsets: [
    { tick: ticks(0), durationTicks: ticks(960), isRest: false },
    { tick: ticks(960), durationTicks: ticks(960), isRest: true },
    { tick: ticks(1920), durationTicks: ticks(1920), isRest: false },
  ],
}

describe('PatternPreview', () => {
  it('groups onsets by bar and labels rests', () => {
    render(<PatternPreview pattern={PATTERN} />)

    expect(screen.getByTestId('pattern-bar-0')).toHaveTextContent('Bar 1')
    expect(screen.getByTestId('pattern-bar-0')).toHaveTextContent('half')
    expect(screen.getByTestId('pattern-bar-0')).toHaveTextContent('half rest')
    expect(screen.getByTestId('pattern-bar-1')).toHaveTextContent('Bar 2')
    expect(screen.getByTestId('pattern-bar-1')).toHaveTextContent('whole')
  })

  // Kills the mutant where one DOM element is rendered per BAR (with onsets
  // joined into a single string) instead of one per ONSET: that mutant would
  // still pass the two tests above (both only check bar text content), but
  // would fail to produce 3 separately-addressable `pattern-onset` elements,
  // and would fail to mark the rest as `data-rest="true"` independently of
  // its neighboring real onsets.
  it('renders one addressable element per onset, with the rest flag set per onset', () => {
    render(<PatternPreview pattern={PATTERN} />)

    const onsets = screen.getAllByTestId('pattern-onset')
    expect(onsets).toHaveLength(3)
    expect(onsets.map((el) => el.getAttribute('data-rest'))).toEqual(['false', 'true', 'false'])
    expect(onsets[0]).toHaveTextContent('half')
    expect(onsets[1]).toHaveTextContent('half rest')
    expect(onsets[2]).toHaveTextContent('whole')
  })

  it('renders one entry per bar, even an empty one', () => {
    const allRests: RhythmPattern = {
      timeSignature: { beats: 4, beatType: 4 },
      bars: 3,
      onsets: [],
    }
    render(<PatternPreview pattern={allRests} />)

    expect(screen.getByTestId('pattern-bar-0')).toBeInTheDocument()
    expect(screen.getByTestId('pattern-bar-1')).toBeInTheDocument()
    expect(screen.getByTestId('pattern-bar-2')).toBeInTheDocument()
  })
})
