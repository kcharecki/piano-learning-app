/**
 * `DictationAnswerPad` (roadmap 3.11, REQ-3.6.1/REQ-3.6.2): a keyboard
 * (`OnScreenKeyboard`, reused unmodified) plus Clear/Submit and a note count.
 * This component only forwards; the actual answer-recording and grading live
 * in `useEarTraining.ts` and are proven there.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { midi as asMidi, ticks as asTicks, type Midi } from '@core/shared/units.ts'
import { midiToName } from '@core/theory/pitch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictationAnswerPad, type DictationAnswerPadProps } from './DictationAnswerPad.tsx'

afterEach(cleanup)

const LOW = asMidi(60)
const HIGH = asMidi(64)

function setup(overrides: Partial<DictationAnswerPadProps> = {}) {
  const onPress = vi.fn()
  const onClear = vi.fn()
  const onSubmit = vi.fn()
  const props: DictationAnswerPadProps = {
    notes: [],
    onPress,
    onClear,
    onSubmit,
    low: LOW,
    high: HIGH,
    ...overrides,
  }
  render(<DictationAnswerPad {...props} />)
  return { onPress, onClear, onSubmit }
}

describe('DictationAnswerPad', () => {
  it('renders the on-screen keyboard across exactly the given range', () => {
    setup()

    for (let n = LOW; n <= HIGH; n++) {
      expect(screen.getByRole('button', { name: midiToName(n) })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: midiToName(asMidi(HIGH + 1)) })).toBeNull()
  })

  // Pinpoints a mutant that wires the keyboard's onPress to onSubmit/onClear
  // instead of onPress, or drops the argument — pressing a specific key must
  // report that exact Midi note, not just "something happened".
  it('pressing a key on the keyboard calls onPress with that exact note, not onClear or onSubmit', async () => {
    const user = userEvent.setup()
    const { onPress, onClear, onSubmit } = setup()

    await user.click(screen.getByRole('button', { name: midiToName(asMidi(62)) }))

    expect(onPress).toHaveBeenCalledWith(62 as Midi)
    expect(onClear).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows how many notes have been recorded so far', () => {
    setup({
      notes: [
        { midi: asMidi(60), startTick: asTicks(0) },
        { midi: asMidi(62), startTick: asTicks(480) },
      ],
    })

    expect(screen.getByTestId('dictation-note-count')).toHaveTextContent('2 notes recorded')
  })

  it('uses singular phrasing for exactly one recorded note', () => {
    setup({ notes: [{ midi: asMidi(60), startTick: asTicks(0) }] })

    expect(screen.getByTestId('dictation-note-count')).toHaveTextContent('1 note recorded')
  })

  it('Clear and Submit are disabled with nothing recorded', () => {
    setup({ notes: [] })

    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  it('Clear and Submit are enabled once a note has been recorded', () => {
    setup({ notes: [{ midi: asMidi(60), startTick: asTicks(0) }] })

    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
  })

  it('typing a mapped computer-keyboard key calls onPress with that note, and shows the mapping (roadmap 5.5)', () => {
    const { onPress } = setup()

    expect(screen.getByText(/or type it/i)).toBeInTheDocument()

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }))
    expect(onPress).toHaveBeenCalledWith(60 as Midi)
  })

  it('Clear and Submit call their own handler, not each other, once notes exist', async () => {
    const user = userEvent.setup()
    const { onClear, onSubmit } = setup({
      notes: [{ midi: asMidi(60), startTick: asTicks(0) }],
    })

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
