/**
 * `DrumsTodayScreen` (roadmap DR-01): thin render/a11y test, per the testing
 * rules — this is a static placeholder with no behaviour to wire.
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

  it('tells the learner drum training is coming, not a blank region', () => {
    render(<DrumsTodayScreen />)
    expect(screen.getByText(/drum training is coming soon/i)).toBeInTheDocument()
  })
})
