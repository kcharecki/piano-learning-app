/**
 * `SettingsScreen` (roadmap 5.40's "re-runnable from settings"): the
 * onboarding flow is reachable here regardless of whether it was already
 * completed, and finishing it (from either Finish or Skip) shows a
 * confirmation with a real way back to Today.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './SettingsScreen.tsx'

afterEach(cleanup)

describe('SettingsScreen', () => {
  it('renders the onboarding flow, reachable regardless of prior completion', () => {
    render(<SettingsScreen onGoToToday={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Set up your practice' })).toBeInTheDocument()
  })

  it('finishing shows a confirmation and a working way back to Today', async () => {
    const user = userEvent.setup()
    const onGoToToday = vi.fn()
    render(<SettingsScreen onGoToToday={onGoToToday} />)

    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(screen.getByRole('status')).toHaveTextContent(/setup updated/i)
    await user.click(screen.getByRole('button', { name: 'Back to Today' }))
    expect(onGoToToday).toHaveBeenCalledTimes(1)
  })
})
