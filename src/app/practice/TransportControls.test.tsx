import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TransportControls } from './TransportControls.tsx'

afterEach(cleanup)

describe('TransportControls', () => {
  it('shows the position readout in bars and beats', () => {
    render(
      <TransportControls
        phase="playing"
        position={{ measureNumber: 3, beat: 2, beatsPerMeasure: 4 }}
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
      />,
    )
    expect(screen.getByLabelText('Position')).toHaveTextContent('Measure 3, beat 2 of 4')
  })

  it('shows a placeholder position when nothing is loaded', () => {
    render(
      <TransportControls
        phase="stopped"
        position={undefined}
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
      />,
    )
    expect(screen.getByLabelText('Position')).toHaveTextContent('—')
  })

  it('play is disabled while playing, enabled while stopped', async () => {
    const user = userEvent.setup()
    const onPlay = vi.fn()
    const { rerender } = render(
      <TransportControls
        phase="stopped"
        position={undefined}
        onPlay={onPlay}
        onPause={() => {}}
        onStop={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(onPlay).toHaveBeenCalledTimes(1)

    rerender(
      <TransportControls
        phase="playing"
        position={undefined}
        onPlay={onPlay}
        onPause={() => {}}
        onStop={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
  })

  it('pause and stop call their handlers and are disabled at the right times', async () => {
    const user = userEvent.setup()
    const onPause = vi.fn()
    const onStop = vi.fn()
    render(
      <TransportControls
        phase="playing"
        position={undefined}
        onPlay={() => {}}
        onPause={onPause}
        onStop={onStop}
      />,
    )
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onPause).toHaveBeenCalledTimes(1)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('shows a waiting indicator only while waiting', () => {
    render(
      <TransportControls
        phase="waiting"
        position={undefined}
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
      />,
    )
    expect(screen.getByText(/waiting for you/i)).toBeInTheDocument()
  })
})
