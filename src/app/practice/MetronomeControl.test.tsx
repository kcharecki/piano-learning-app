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

  // Roadmap UI-10: a disabled control the current state can never enable is
  // hidden, not greyed — the select does not render at all while off, rather
  // than rendering permanently disabled.
  it('hides the subdivision select while off', () => {
    render(
      <MetronomeControl
        enabled={false}
        onToggle={() => {}}
        subdivision={1}
        onSubdivisionChange={() => {}}
      />,
    )
    expect(screen.queryByLabelText('Subdivision')).not.toBeInTheDocument()
  })

  it('shows an enabled subdivision select once the metronome is on', () => {
    render(
      <MetronomeControl
        enabled
        onToggle={() => {}}
        subdivision={1}
        onSubdivisionChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('Subdivision')).toBeEnabled()
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

  // Kills a mutant that drops `disabled` from either the checkbox or the
  // select's `disabled` expression — REQ-3.3.4: the metronome must go visibly
  // inert during an assessment run, even while enabled (which alone would
  // otherwise leave the subdivision select interactive).
  it('disables both the toggle and the subdivision select when disabled is set, even while enabled', () => {
    render(
      <MetronomeControl
        enabled
        onToggle={() => {}}
        subdivision={1}
        onSubdivisionChange={() => {}}
        disabled
      />,
    )
    expect(screen.getByRole('checkbox', { name: 'Metronome' })).toBeDisabled()
    expect(screen.getByLabelText('Subdivision')).toBeDisabled()
  })

  // Flip side: `disabled` defaults to false — ordinary practice is unaffected.
  it('leaves the toggle enabled when disabled is not set', () => {
    render(
      <MetronomeControl
        enabled
        onToggle={() => {}}
        subdivision={1}
        onSubdivisionChange={() => {}}
      />,
    )
    expect(screen.getByRole('checkbox', { name: 'Metronome' })).toBeEnabled()
  })
})
