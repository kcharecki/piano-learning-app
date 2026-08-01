import { bpm } from '@core/shared/units.ts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TempoControl } from './TempoControl.tsx'

afterEach(cleanup)

describe('TempoControl', () => {
  it('shows the percentage and both the written and effective bpm', () => {
    render(
      <TempoControl
        tempoScale={0.5}
        onChange={() => {}}
        writtenBpm={bpm(120)}
        effectiveBpm={bpm(60)}
      />,
    )
    expect(screen.getByRole('slider')).toHaveValue('50')
    expect(screen.getByText(/50%/)).toHaveTextContent('50% — 60 bpm (written 120)')
  })

  it('shows just the percentage when nothing is loaded', () => {
    render(
      <TempoControl
        tempoScale={1}
        onChange={() => {}}
        writtenBpm={undefined}
        effectiveBpm={undefined}
      />,
    )
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('reports the slider range as 30%-200% (REQ-3.2.2)', () => {
    render(
      <TempoControl
        tempoScale={1}
        onChange={() => {}}
        writtenBpm={undefined}
        effectiveBpm={undefined}
      />,
    )
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('min', '30')
    expect(slider).toHaveAttribute('max', '200')
  })

  it('calls onChange with the fractional scale when moved', () => {
    const onChange = vi.fn()
    render(
      <TempoControl
        tempoScale={1}
        onChange={onChange}
        writtenBpm={undefined}
        effectiveBpm={undefined}
      />,
    )
    fireEvent.change(screen.getByRole('slider'), { target: { value: '75' } })
    expect(onChange).toHaveBeenCalledWith(0.75)
  })

  // Kills a mutant that drops `disabled` from the slider's `disabled` prop —
  // REQ-3.3.4: the tempo slider must go visibly inert during an assessment
  // run, not just be ignored.
  it('disables the slider when disabled is set', () => {
    render(
      <TempoControl
        tempoScale={1}
        onChange={() => {}}
        writtenBpm={undefined}
        effectiveBpm={undefined}
        disabled
      />,
    )
    expect(screen.getByRole('slider')).toBeDisabled()
  })

  // Flip side: `disabled` defaults to false — ordinary practice is unaffected.
  it('leaves the slider enabled when disabled is not set', () => {
    render(
      <TempoControl
        tempoScale={1}
        onChange={() => {}}
        writtenBpm={undefined}
        effectiveBpm={undefined}
      />,
    )
    expect(screen.getByRole('slider')).toBeEnabled()
  })
})
