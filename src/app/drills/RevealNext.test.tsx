/**
 * The shared reveal row (improve-app run 2026-08-24-1). Behaviour lives in the
 * two drills' own suites; this covers what only this component decides —
 * the accessible shape, and where focus goes when it appears.
 */
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RevealNext } from './RevealNext.tsx'

afterEach(cleanup)

describe('RevealNext', () => {
  it('takes focus itself, so a keyboard user is not stranded on the inert answer input', () => {
    render(<RevealNext onNext={() => {}} />)

    const row = screen.getByRole('group', { name: 'Answer result' })
    expect(row).toHaveFocus()
    // Focused programmatically, but never a Tab stop of its own afterwards.
    expect(row).toHaveAttribute('tabindex', '-1')
  })

  it('offers exactly one control, and calls back when it is pressed', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<RevealNext onNext={onNext} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
