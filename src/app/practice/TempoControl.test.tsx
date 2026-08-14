import { bpm } from '@core/shared/units.ts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TempoControl } from './TempoControl.tsx'

afterEach(cleanup)

describe('TempoControl', () => {
  // UI-09: the old readout printed three formats at once ("50% — 60 bpm
  // (written 120)"). Now there are exactly two — the field's own label
  // carries the "% of written" detail, and the output shows one number: the
  // effective bpm a learner would actually hear.
  it('puts the percent-of-written detail in the field label, and the effective bpm alone in the value', () => {
    render(
      <TempoControl
        tempoScale={0.5}
        onChange={() => {}}
        writtenBpm={bpm(120)}
        effectiveBpm={bpm(60)}
      />,
    )
    expect(screen.getByRole('slider')).toHaveValue('50')
    expect(screen.getByText('Tempo — 50% of written 120')).toBeInTheDocument()
    expect(screen.getByText('60 bpm')).toBeInTheDocument()
    // The accessible name still says "Tempo" — WCAG 2.5.3 Label in Name, and
    // context for a screen-reader user tabbing straight to the slider.
    expect(screen.getByLabelText(/^Tempo/)).toBe(screen.getByRole('slider'))
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
    expect(screen.getByLabelText('Tempo')).toBe(screen.getByRole('slider'))
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
