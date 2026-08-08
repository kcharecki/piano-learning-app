import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { InputCapabilityBanner } from './InputCapabilityBanner.tsx'

afterEach(cleanup)

describe('InputCapabilityBanner', () => {
  it('names the limitation when Web MIDI is unsupported', () => {
    render(<InputCapabilityBanner supported={false} />)
    expect(screen.getByRole('status')).toHaveTextContent(/no web midi/i)
  })

  it('renders nothing when Web MIDI is supported', () => {
    render(<InputCapabilityBanner supported={true} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('dismisses and stays dismissed for the rest of the session', async () => {
    const user = userEvent.setup()
    render(<InputCapabilityBanner supported={false} />)

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('status')).toBeNull()
  })
})
