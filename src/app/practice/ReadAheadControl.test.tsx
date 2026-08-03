import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReadAheadControl } from './ReadAheadControl.tsx'

afterEach(cleanup)

describe('ReadAheadControl', () => {
  it('renders unchecked when disabled', () => {
    render(<ReadAheadControl enabled={false} onToggle={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Read ahead' })).not.toBeChecked()
  })

  it('renders checked when enabled', () => {
    render(<ReadAheadControl enabled onToggle={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Read ahead' })).toBeChecked()
  })

  it('calls onToggle with the new checked state on click', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<ReadAheadControl enabled={false} onToggle={onToggle} />)

    await user.click(screen.getByRole('checkbox', { name: 'Read ahead' }))

    expect(onToggle).toHaveBeenCalledWith(true)
  })

  // Kills a mutant that drops `disabled` from the checkbox's `disabled` prop.
  it('disables the checkbox when the disabled prop is set', () => {
    render(<ReadAheadControl enabled={false} onToggle={() => {}} disabled />)
    expect(screen.getByRole('checkbox', { name: 'Read ahead' })).toBeDisabled()
  })

  // Flip side: the disabled prop defaults to false.
  it('leaves the checkbox enabled when the disabled prop is not set', () => {
    render(<ReadAheadControl enabled={false} onToggle={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Read ahead' })).toBeEnabled()
  })
})
