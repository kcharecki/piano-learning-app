import { C_MAJOR_SCALE_RH } from '@core/notation/fixtures.ts'
import { measureRange } from '@core/notation/score.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoopRangeControl } from './LoopRangeControl.tsx'

afterEach(cleanup)

describe('LoopRangeControl', () => {
  it('starts unchecked and covering the whole score', () => {
    render(<LoopRangeControl score={C_MAJOR_SCALE_RH} loop={undefined} onChange={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Loop' })).not.toBeChecked()
    expect(screen.getByLabelText('From measure')).toHaveValue(1)
    expect(screen.getByLabelText('to measure')).toHaveValue(C_MAJOR_SCALE_RH.measures.length)
  })

  it('checking the box turns the current measure range on', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LoopRangeControl score={C_MAJOR_SCALE_RH} loop={undefined} onChange={onChange} />)

    await user.click(screen.getByRole('checkbox', { name: 'Loop' }))

    expect(onChange).toHaveBeenCalledWith(
      measureRange(C_MAJOR_SCALE_RH, 0, C_MAJOR_SCALE_RH.measures.length - 1),
    )
  })

  it('unchecking turns the loop off (undefined), remembering the picked range', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <LoopRangeControl score={C_MAJOR_SCALE_RH} loop={undefined} onChange={onChange} />,
    )
    await user.click(screen.getByRole('checkbox', { name: 'Loop' }))
    const active = onChange.mock.calls[0]?.[0]
    rerender(<LoopRangeControl score={C_MAJOR_SCALE_RH} loop={active} onChange={onChange} />)

    await user.click(screen.getByRole('checkbox', { name: 'Loop' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('changing the measure fields recomputes the range while active', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <LoopRangeControl score={C_MAJOR_SCALE_RH} loop={undefined} onChange={onChange} />,
    )
    await user.click(screen.getByRole('checkbox', { name: 'Loop' }))
    const active = onChange.mock.calls[0]?.[0]
    rerender(<LoopRangeControl score={C_MAJOR_SCALE_RH} loop={active} onChange={onChange} />)

    const endField = screen.getByLabelText('to measure')
    await user.clear(endField)
    await user.type(endField, '1')

    expect(onChange).toHaveBeenLastCalledWith(measureRange(C_MAJOR_SCALE_RH, 0, 0))
  })
})
