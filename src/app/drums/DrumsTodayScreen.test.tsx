/**
 * `DrumsTodayScreen` (roadmap DR-01, DR-09): thin render/a11y test, per the
 * testing rules. The one behaviour here is the empty state's call to action,
 * which DR-09 added — the screen itself still holds no drums logic.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DrumsTodayScreen } from './DrumsTodayScreen.tsx'

describe('DrumsTodayScreen', () => {
  it('renders a labelled region with the "Drums — start here" heading', () => {
    render(<DrumsTodayScreen onOpenGroove={vi.fn()} />)
    const region = screen.getByRole('region', { name: 'Drums' })
    expect(region).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Drums — start here' })).toBeInTheDocument()
  })

  it('offers the one drill that exists rather than a blank region', async () => {
    const onOpenGroove = vi.fn()
    render(<DrumsTodayScreen onOpenGroove={onOpenGroove} />)
    expect(screen.getByText(/tells you which limb was off/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open the groove trainer' }))
    expect(onOpenGroove).toHaveBeenCalledTimes(1)
  })
})
