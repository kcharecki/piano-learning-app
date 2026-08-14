import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildTestScore } from '@test/fixtures.ts'
import { PracticeKeyboard } from './PracticeKeyboard.tsx'

const scoreWith = (midis: readonly number[]) =>
  buildTestScore(
    midis.map((midi, i) => ({ midi, startTick: i * 120 })),
    { measureCount: 4 },
  )

describe('PracticeKeyboard', () => {
  const props = {
    score: scoreWith([60, 64, 67]),
    onPress: vi.fn(),
    onRelease: vi.fn(),
    deviceConnected: false,
    visible: true,
    onVisibleChange: vi.fn(),
    latch: false,
    onLatchChange: vi.fn(),
  }

  it('renders keys when visible', () => {
    render(<PracticeKeyboard {...props} />)
    expect(screen.getByRole('group', { name: 'Play the score' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').length).toBeGreaterThan(20)
  })

  it('renders no keys when hidden, and the toggle still works', async () => {
    const onVisibleChange = vi.fn()
    render(<PracticeKeyboard {...props} visible={false} onVisibleChange={onVisibleChange} />)
    expect(screen.queryByRole('group', { name: 'Play the score' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: /on-screen keyboard/i }))
    expect(onVisibleChange).toHaveBeenCalledWith(true)
  })

  it('says the keyboard is the only input when no device is connected', () => {
    render(<PracticeKeyboard {...props} deviceConnected={false} />)
    expect(screen.getByText(/graded exactly as a MIDI keyboard/i)).toBeInTheDocument()
  })

  it('does not claim there is no device when one is connected', () => {
    render(<PracticeKeyboard {...props} deviceConnected />)
    expect(screen.queryByText(/graded exactly as a MIDI keyboard/i)).not.toBeInTheDocument()
  })

  it('reports press and release as separate edges, so wait mode can hold a note', async () => {
    // `core/practice/waitmode.ts` withdraws a note's credit on note-off, so a
    // key that pressed and released in one event could never advance a bar.
    const onPress = vi.fn()
    const onRelease = vi.fn()
    // One `user` session, so the release below belongs to the press above —
    // the static `userEvent.pointer` helper starts a fresh session per call
    // and would have no pressed button to release.
    const user = userEvent.setup()
    render(<PracticeKeyboard {...props} onPress={onPress} onRelease={onRelease} />)

    const keys = screen.getAllByRole('button')
    const key = keys[0]
    if (key === undefined) throw new Error('expected at least one key')

    await user.pointer({ target: key, keys: '[MouseLeft>]' })
    expect(onPress).toHaveBeenCalledOnce()
    expect(onRelease).not.toHaveBeenCalled()

    await user.pointer({ target: key, keys: '[/MouseLeft]' })
    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('latched keys stay down through a pointer release, so one pointer can build a chord', async () => {
    const onPress = vi.fn()
    const onRelease = vi.fn()
    const user = userEvent.setup()
    render(<PracticeKeyboard {...props} latch onPress={onPress} onRelease={onRelease} />)

    const keys = screen.getAllByRole('button')
    const [first, second] = keys
    if (first === undefined || second === undefined) throw new Error('expected two keys')

    await user.click(first)
    await user.click(second)
    // Both down at once — which is what wait mode requires of a chord.
    expect(onPress).toHaveBeenCalledTimes(2)
    expect(onRelease).not.toHaveBeenCalled()

    // Pressing a latched key again is what releases it.
    await user.click(first)
    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('releases everything still latched when latch is switched off', async () => {
    const onRelease = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<PracticeKeyboard {...props} latch onRelease={onRelease} />)

    const key = screen.getAllByRole('button')[0]
    if (key === undefined) throw new Error('expected a key')
    await user.click(key)
    expect(onRelease).not.toHaveBeenCalled()

    rerender(<PracticeKeyboard {...props} latch={false} onRelease={onRelease} />)

    // Otherwise wait mode would go on crediting a key nothing is holding.
    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('does not latch by default — a key released with the pointer', async () => {
    const onRelease = vi.fn()
    const user = userEvent.setup()
    render(<PracticeKeyboard {...props} onRelease={onRelease} />)

    const key = screen.getAllByRole('button')[0]
    if (key === undefined) throw new Error('expected a key')
    await user.click(key)

    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('plays and releases through the computer keyboard, and shows the mapping (roadmap 5.5)', () => {
    const onPress = vi.fn()
    const onRelease = vi.fn()
    render(<PracticeKeyboard {...props} onPress={onPress} onRelease={onRelease} />)

    expect(screen.getByText(/or type it/i)).toBeInTheDocument()

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }))
    expect(onPress).toHaveBeenCalledOnce()
    expect(onRelease).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', bubbles: true }))
    expect(onRelease).toHaveBeenCalledOnce()
  })

  it('does not answer through the computer keyboard when hidden', () => {
    const onPress = vi.fn()
    render(<PracticeKeyboard {...props} visible={false} onPress={onPress} />)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }))
    expect(onPress).not.toHaveBeenCalled()
  })

  // Roadmap UI-10 (2026-08-12 UI audit): the QWERTY hint collapses to a
  // one-line "Show keys" disclosure — the same pattern FlashcardScreen
  // already uses for the same shared component.
  it('collapses the QWERTY hint behind a one-line "Show keys" disclosure, closed by default', async () => {
    const user = userEvent.setup()
    render(<PracticeKeyboard {...props} />)

    const trigger = screen.getByText('Show keys')
    const disclosure = trigger.closest('details')
    expect(disclosure).not.toBeNull()
    expect(disclosure).not.toHaveAttribute('open')
    // The full mapping text is still in the document (native <details> hides
    // it visually, not structurally) — QwertyHint itself is untouched.
    expect(screen.getByText(/or type it/i)).toBeInTheDocument()

    await user.click(trigger)

    expect(disclosure).toHaveAttribute('open')
  })
})
