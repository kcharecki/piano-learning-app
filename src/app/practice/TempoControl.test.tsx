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
})
