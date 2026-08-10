/**
 * The customizer's own wiring: each control turns its event into the right
 * `SightReadingCustomization` patch, and "Level's default"/unchecking always
 * removes that field rather than setting it to some other value. Whether the
 * generator actually reads these overrides is `useSightReadingTrainer.test.ts`'s
 * job (roadmap 5.12).
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyFromFifths } from '@core/theory/keys.ts'
import { SightReadingCustomizer } from './SightReadingCustomizer.tsx'
import type { SightReadingCustomization } from './customization.ts'

afterEach(cleanup)

function setup(customization: SightReadingCustomization = {}) {
  const onChange = vi.fn()
  render(<SightReadingCustomizer customization={customization} onChange={onChange} />)
  return { onChange }
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Customize exercise'))
}

describe('SightReadingCustomizer', () => {
  it('is closed by default, so the ordinary Start path is unchanged', () => {
    setup()
    expect(screen.getByText('Customize exercise').closest('details')).not.toHaveAttribute('open')
  })

  it('picking a key mode and tonic emits a real Key at that fifths/mode', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await open(user)

    await user.selectOptions(screen.getByLabelText('Key tonic'), 'G major')
    expect(onChange).toHaveBeenCalledWith({ key: keyFromFifths(1, 'major') })
  })

  it('choosing hands emits the picked value', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await open(user)

    await user.selectOptions(screen.getByLabelText('Hands'), 'Left hand only')
    expect(onChange).toHaveBeenCalledWith({ hands: 'left' })
  })

  it('the hand independence picker only appears once "Both hands" is chosen', async () => {
    const user = userEvent.setup()
    setup({ hands: 'right' })
    await open(user)
    expect(screen.queryByLabelText('Hand independence')).toBeNull()

    cleanup()
    setup({ hands: 'both' })
    await open(user)
    expect(screen.getByLabelText('Hand independence')).toBeInTheDocument()
  })

  it('checking "No accidentals" sets noAccidentals true; unchecking sets it false', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await open(user)

    await user.click(screen.getByRole('checkbox', { name: /no accidentals/i }))
    expect(onChange).toHaveBeenLastCalledWith({ noAccidentals: true })

    cleanup()
    const { onChange: onChange2 } = setup({ noAccidentals: true })
    await open(user)
    await user.click(screen.getByRole('checkbox', { name: /no accidentals/i }))
    expect(onChange2).toHaveBeenLastCalledWith({ noAccidentals: false })
  })

  it('"Reset to level\'s default" clears every field back to an empty customization', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ hands: 'left', noAccidentals: true, rhythm: 'eighths' })
    await open(user)

    await user.click(screen.getByRole('button', { name: "Reset to level's default" }))
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('disabled prop disables every control', async () => {
    const user = userEvent.setup()
    render(<SightReadingCustomizer customization={{}} onChange={vi.fn()} disabled />)
    await open(user)
    for (const el of screen.getAllByRole('combobox')) expect(el).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /no accidentals/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: "Reset to level's default" })).toBeDisabled()
  })
})
