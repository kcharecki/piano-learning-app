import { C_MAJOR_SCALE_RH } from '@test/fixtures.ts'
import { at } from '@core/shared/invariant.ts'
import type { WaitState } from '@core/practice/waitmode.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WaitModeControl } from './WaitModeControl.tsx'

afterEach(cleanup)

const NOTE_C4 = at(C_MAJOR_SCALE_RH.notes, 0) // midi 60
const NOTE_D4 = at(C_MAJOR_SCALE_RH.notes, 1) // midi 62

describe('WaitModeControl', () => {
  it('toggling reports the new enabled state', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<WaitModeControl enabled={false} onToggle={onToggle} wait={undefined} />)

    await user.click(screen.getByRole('checkbox', { name: 'Wait for me' }))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('shows nothing extra when not waiting', () => {
    render(<WaitModeControl enabled onToggle={() => {}} wait={undefined} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('lists the pending note names while waiting', () => {
    const wait: WaitState = {
      waiting: true,
      requiredNotes: [NOTE_C4, NOTE_D4],
      satisfiedNotes: [],
    }
    render(<WaitModeControl enabled onToggle={() => {}} wait={wait} />)
    expect(screen.getByRole('status')).toHaveTextContent(/waiting for/i)
    expect(screen.getByRole('status')).toHaveTextContent('C4')
    expect(screen.getByRole('status')).toHaveTextContent('D4')
  })

  it('drops a note from the list once it is satisfied', () => {
    const wait: WaitState = {
      waiting: true,
      requiredNotes: [NOTE_C4, NOTE_D4],
      satisfiedNotes: [NOTE_C4.midi],
    }
    render(<WaitModeControl enabled onToggle={() => {}} wait={wait} />)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for: D4')
  })

  it('shows nothing while disabled even if a wait state carries over', () => {
    const wait: WaitState = { waiting: true, requiredNotes: [NOTE_C4], satisfiedNotes: [] }
    render(<WaitModeControl enabled={false} onToggle={() => {}} wait={wait} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  // Kills a mutant that drops `disabled` from the checkbox's `disabled` prop —
  // REQ-3.3.4: wait mode must go visibly inert during an assessment run. Note
  // this `disabled` prop is distinct from the `enabled` prop above (which
  // toggles wait mode itself, not the control's interactivity).
  it('disables the checkbox when the disabled prop is set', () => {
    render(<WaitModeControl enabled={false} onToggle={() => {}} wait={undefined} disabled />)
    expect(screen.getByRole('checkbox', { name: 'Wait for me' })).toBeDisabled()
  })

  // Flip side: the disabled prop defaults to false — ordinary practice is unaffected.
  it('leaves the checkbox enabled when the disabled prop is not set', () => {
    render(<WaitModeControl enabled={false} onToggle={() => {}} wait={undefined} />)
    expect(screen.getByRole('checkbox', { name: 'Wait for me' })).toBeEnabled()
  })
})
