/**
 * `DrumsTodayScreen` (roadmap DR-01, superseded by DR-09): thin render/a11y
 * test, per the testing rules — a static screen with one link to the groove
 * trainer and no other behaviour to wire.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DrumsTodayScreen } from './DrumsTodayScreen.tsx'

describe('DrumsTodayScreen', () => {
  it('renders a labelled region with the "Drums — start here" heading', () => {
    render(<DrumsTodayScreen />)
    const region = screen.getByRole('region', { name: 'Drums' })
    expect(region).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Drums — start here' })).toBeInTheDocument()
  })

  it('offers a way into the groove trainer', () => {
    render(<DrumsTodayScreen />)
    const link = screen.getByRole('link', { name: /groove/i })
    expect(link).toHaveAttribute('href', '/drums/groove')
  })

  // Regression: a green, unmodified suite once certified "drum training is
  // coming soon" long after a real drum trainer shipped — this pins the
  // phrase's absence so that failure mode cannot silently come back.
  it('never says drum training is "coming soon"', () => {
    render(<DrumsTodayScreen />)
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
  })
})
