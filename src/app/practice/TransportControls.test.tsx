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
    expect(screen.getByLabelText('Position')).toHaveTextContent('Measure 3 · beat 2')
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

  // Kills a mutant that drops `disabled` from the Pause/Stop `disabled`
  // expressions entirely — REQ-3.3.4: an assessment run must disable Pause
  // and Stop, not merely wire them to no-op handlers.
  it('disables Pause and Stop when disabled is set, even while playing', () => {
    render(
      <TransportControls
        phase="playing"
        position={undefined}
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
        disabled
      />,
    )
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
  })

  // Flip side: `disabled` defaults to false, so ordinary (non-assessment)
  // play/pause/stop cycles are unaffected by the new prop.
  it('leaves Pause and Stop enabled while playing when disabled is not set', () => {
    render(
      <TransportControls
        phase="playing"
        position={undefined}
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
  })

  // UI-09 (2026-08-12 UI audit): Play is icon+label and the screen's one
  // `.btn-primary`; Pause/Stop are icon-only `.btn-icon`s. All three always
  // mount — a rerender across phases only ever flips `disabled`, so the
  // group's own width never changes (no layout shift toggling Play/Pause).
  it('renders Play as the primary action and Pause/Stop as icon buttons, unconditionally, at every phase', () => {
    const { rerender } = render(
      <TransportControls
        phase="stopped"
        position={undefined}
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('btn-primary')
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveClass('btn-icon')
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveClass('btn-icon')

    rerender(
      <TransportControls
        phase="playing"
        position={undefined}
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
      />,
    )
    // Still all three, same classes — only `disabled` moved.
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('btn-primary')
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveClass('btn-icon')
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveClass('btn-icon')
  })
})
