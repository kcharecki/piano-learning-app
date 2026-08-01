import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MetronomeControl } from './MetronomeControl.tsx'

afterEach(cleanup)

describe('MetronomeControl', () => {
  it('toggling the checkbox reports the new enabled state', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <MetronomeControl
        enabled={false}
        onToggle={onToggle}
        subdivision={1}
        onSubdivisionChange={() => {}}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Metronome' }))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('disables the subdivision select while off', () => {
    render(
      <MetronomeControl
        enabled={false}
        onToggle={() => {}}
        subdivision={1}
        onSubdivisionChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('Subdivision')).toBeDisabled()
  })

  it('changing the subdivision reports the chosen value', async () => {
    const user = userEvent.setup()
    const onSubdivisionChange = vi.fn()
    render(
      <MetronomeControl
        enabled
        onToggle={() => {}}
        subdivision={1}
        onSubdivisionChange={onSubdivisionChange}
      />,
    )

    await user.selectOptions(screen.getByLabelText('Subdivision'), '3')
    expect(onSubdivisionChange).toHaveBeenCalledWith(3)
  })
})
