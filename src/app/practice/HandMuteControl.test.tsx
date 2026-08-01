import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HandMuteControl } from './HandMuteControl.tsx'

afterEach(cleanup)

describe('HandMuteControl', () => {
  it('marks the option matching the current active hands as checked', () => {
    render(<HandMuteControl activeHands={['right']} onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Right hand only' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Left hand only' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('radio', { name: 'Both hands' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('clicking an option reports exactly those hands', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<HandMuteControl activeHands={['left', 'right']} onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: 'Left hand only' }))

    expect(onChange).toHaveBeenCalledWith(['left'])
  })

  it('"Both hands" reports both', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<HandMuteControl activeHands={['left']} onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: 'Both hands' }))

    expect(onChange).toHaveBeenCalledWith(['left', 'right'])
  })

  // Kills a mutant that drops `disabled` from each option button — REQ-3.3.4:
  // hand-mute must go visibly inert during an assessment run.
  it('disables every option when disabled is set', () => {
    render(<HandMuteControl activeHands={['left', 'right']} onChange={() => {}} disabled />)
    expect(screen.getByRole('radio', { name: 'Left hand only' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Right hand only' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Both hands' })).toBeDisabled()
  })

  // Flip side: `disabled` defaults to false — ordinary practice is unaffected.
  it('leaves every option enabled when disabled is not set', () => {
    render(<HandMuteControl activeHands={['left', 'right']} onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Left hand only' })).toBeEnabled()
  })
})
