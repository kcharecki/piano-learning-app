/**
 * `OnScreenKeyboard` (roadmap 2.12) — one button per semitone in range,
 * unlabelled by design (see the module comment), each firing `onPress` with
 * its own MIDI number.
 */
import { midi } from '@core/shared/units.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OnScreenKeyboard } from './OnScreenKeyboard.tsx'

afterEach(cleanup)

describe('OnScreenKeyboard', () => {
  it('renders one key per semitone in the given range', () => {
    render(<OnScreenKeyboard low={midi(60)} high={midi(64)} onPress={() => {}} />)

    expect(screen.getByRole('group', { name: 'On-screen keyboard' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(5) // 60,61,62,63,64
  })

  it('presses report their own MIDI note, not just "a key was pressed"', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(<OnScreenKeyboard low={midi(60)} high={midi(62)} onPress={onPress} />)

    await user.click(screen.getByRole('button', { name: 'Key 61' }))

    expect(onPress).toHaveBeenCalledOnce()
    expect(onPress).toHaveBeenCalledWith(61)
  })

  it('does not label keys with note names — the drill would be trivial otherwise', () => {
    render(<OnScreenKeyboard low={midi(60)} high={midi(62)} onPress={() => {}} />)

    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent).toBe('')
    }
  })

  it('disables every key when asked', () => {
    render(<OnScreenKeyboard low={midi(60)} high={midi(61)} onPress={() => {}} disabled />)

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })
})
