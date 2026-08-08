import { midi as asMidi } from '@core/shared/units.ts'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useQwertyNoteInput, type UseQwertyNoteInputOptions } from './useQwertyNoteInput.ts'

afterEach(cleanup)

function press(code: string, opts: Partial<KeyboardEventInit> = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...opts }))
}
function release(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
}

function setup(overrides: Partial<UseQwertyNoteInputOptions> = {}) {
  const props: UseQwertyNoteInputOptions = {
    enabled: true,
    low: asMidi(48),
    high: asMidi(84),
    baseNote: asMidi(60),
    onPress: vi.fn(),
    ...overrides,
  }
  const view = renderHook((p: UseQwertyNoteInputOptions) => useQwertyNoteInput(p), {
    initialProps: props,
  })
  return { onPress: props.onPress, onRelease: props.onRelease, ...view }
}

describe('useQwertyNoteInput', () => {
  it('presses the mapped note on keydown', () => {
    const { onPress } = setup()
    act(() => press('KeyA'))
    expect(onPress).toHaveBeenCalledExactlyOnceWith(60)
  })

  it('ignores autorepeat — a held key must not press twice', () => {
    const { onPress } = setup()
    act(() => press('KeyA'))
    act(() => press('KeyA', { repeat: true }))
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('ignores a second keydown for the same code before its keyup (no synthetic repeat flag)', () => {
    const { onPress } = setup()
    act(() => press('KeyA'))
    act(() => press('KeyA'))
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('releases on keyup when onRelease is given, and can press again after', () => {
    const { onPress, onRelease } = setup({ onRelease: vi.fn() })
    act(() => press('KeyA'))
    act(() => release('KeyA'))
    expect(onRelease).toHaveBeenCalledExactlyOnceWith(60)
    act(() => press('KeyA'))
    expect(onPress).toHaveBeenCalledTimes(2)
  })

  it('never calls onRelease when the caller passed none (click semantics)', () => {
    const { onPress } = setup()
    act(() => press('KeyA'))
    act(() => release('KeyA'))
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('ignores a key outside the configured range', () => {
    const { onPress } = setup({ low: asMidi(60), high: asMidi(60) })
    act(() => press('KeyS')) // 62, above high
    expect(onPress).not.toHaveBeenCalled()
  })

  it('ignores an unmapped key', () => {
    const { onPress } = setup()
    act(() => press('KeyZ'))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('ignores keydown while a text field has focus', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const { onPress } = setup()
    // Dispatched ON the input (not window) so it bubbles up with the input as
    // `event.target` — matching what a real keystroke in a focused field does.
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }))
    })
    expect(onPress).not.toHaveBeenCalled()
    input.remove()
  })

  it('attaches no listeners at all when disabled', () => {
    const { onPress } = setup({ enabled: false })
    act(() => press('KeyA'))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('releases every held note on window blur, so alt-tab cannot strand one', () => {
    const onRelease = vi.fn()
    const { onPress } = setup({ onRelease })
    act(() => press('KeyA'))
    act(() => press('KeyS'))
    act(() => window.dispatchEvent(new Event('blur')))
    expect(onRelease).toHaveBeenCalledWith(60)
    expect(onRelease).toHaveBeenCalledWith(62)
    expect(onPress).toHaveBeenCalledTimes(2)
  })

  it('releases every held note when disabled turns off mid-hold, not leaving it stuck', () => {
    const onRelease = vi.fn()
    const { rerender } = setup({ onRelease })
    act(() => press('KeyA'))
    rerender({
      enabled: false,
      low: asMidi(48),
      high: asMidi(84),
      baseNote: asMidi(60),
      onPress: vi.fn(),
      onRelease,
    })
    expect(onRelease).toHaveBeenCalledExactlyOnceWith(60)
  })

  it('uses the latest range/baseNote/callbacks without re-subscribing (no dropped keyup)', () => {
    const onReleaseA = vi.fn()
    const { rerender } = setup({ onRelease: onReleaseA })
    act(() => press('KeyA'))
    const onReleaseB = vi.fn()
    rerender({
      enabled: true,
      low: asMidi(48),
      high: asMidi(84),
      baseNote: asMidi(72), // base changes mid-hold — the held note must still release as 60
      onPress: vi.fn(),
      onRelease: onReleaseB,
    })
    act(() => release('KeyA'))
    expect(onReleaseB).toHaveBeenCalledExactlyOnceWith(60)
    expect(onReleaseA).not.toHaveBeenCalled()
  })
})
