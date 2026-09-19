/**
 * `DynamicsLegend` (review round 3, RED 3): on-screen pads carry no velocity,
 * so a mouse learner on a dynamics-notated groove (Ghost-Funk Bar) needs to
 * be told the Shift/Alt keyboard fallback exists at all. Pinned here: it
 * renders for any pad list holding a non-'normal' dynamics class, and renders
 * nothing at all when none do (Money Beat) or the list is empty (every pad
 * muted). The caller (`GrooveTrainerScreen.tsx`) is responsible for narrowing
 * the pad list to exclude muted pads before this component ever sees it.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DynamicsLegend } from './GrooveControls.tsx'

describe('DynamicsLegend', () => {
  it('renders the Shift/Alt hint when some pad has a non-normal dynamics class', () => {
    render(
      <DynamicsLegend
        expectedDynamicsByPad={[
          ['ghost', 'normal'],
          ['normal'],
        ]}
        id="groove-dynamics-legend"
      />,
    )
    expect(screen.getByText('Shift = accent · Alt = ghost')).toBeInTheDocument()
  })

  it('renders nothing when every pad is all-normal', () => {
    const { container } = render(
      <DynamicsLegend expectedDynamicsByPad={[['normal'], ['normal']]} id="groove-dynamics-legend" />,
    )
    expect(screen.queryByText('Shift = accent · Alt = ghost')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an empty pad list', () => {
    const { container } = render(
      <DynamicsLegend expectedDynamicsByPad={[]} id="groove-dynamics-legend" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders with the given id', () => {
    render(<DynamicsLegend expectedDynamicsByPad={[['accent']]} id="my-legend-id" />)
    expect(screen.getByText('Shift = accent · Alt = ghost')).toHaveAttribute('id', 'my-legend-id')
  })
})
