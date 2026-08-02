/**
 * `AccentEditor` (roadmap 2.28, REQ-3.9.1): one toggle per beat, "accents on
 * 1 and 4 of 7/8" expressible by clicking, and the metre-change resize rule
 * — preserve what overlaps by index, default the rest from `defaultAccents`.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccentPattern } from '@core/timing/metronome.ts'
import { AccentEditor, resizeAccents } from './AccentEditor.tsx'

afterEach(cleanup)

describe('AccentEditor', () => {
  it('renders one toggle per beat of the current metre, reflecting the given pattern', () => {
    const accents: AccentPattern = [true, false, false, true, false, true, false]
    render(
      <AccentEditor timeSignature={{ beats: 7, beatType: 8 }} accents={accents} onChange={vi.fn()} />,
    )

    const group = screen.getByRole('group', { name: 'Accent pattern' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons).toHaveLength(7)
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'true',
      'false',
      'true',
      'false',
    ])
  })

  it('clicking a beat toggles only that beat and reports the changed pattern', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const accents: AccentPattern = [true, false, false, false]
    render(
      <AccentEditor timeSignature={{ beats: 4, beatType: 4 }} accents={accents} onChange={onChange} />,
    )

    await user.click(screen.getByRole('button', { name: /^Beat 4/ }))

    expect(onChange).toHaveBeenCalledWith([true, false, false, true])
    // The caller's own prop did not mutate — this is a controlled component.
    expect(accents).toEqual([true, false, false, false])
  })

  it('un-accenting a beat reports it back to the caller too', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AccentEditor
        timeSignature={{ beats: 4, beatType: 4 }}
        accents={[true, false, false, false]}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^Beat 1/ }))

    expect(onChange).toHaveBeenCalledWith([false, false, false, false])
  })

  it('a metre change reports the resized pattern: overlap kept, new beats defaulted', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <AccentEditor
        timeSignature={{ beats: 4, beatType: 4 }}
        accents={[true, false, false, false]}
        onChange={onChange}
      />,
    )
    expect(onChange).not.toHaveBeenCalled()

    rerender(
      <AccentEditor
        timeSignature={{ beats: 6, beatType: 8 }}
        accents={[true, false, false, false]}
        onChange={onChange}
      />,
    )

    // defaultAccents(6/8) is [T,F,F,T,F,F] (compound, groups of 3+3), but index
    // 3 is explicitly false in the incoming pattern and that overlap survives —
    // only indices 4 and 5, which did not exist before, take the default.
    expect(onChange).toHaveBeenCalledWith([true, false, false, false, false, false])
  })

  it('resizeAccents: pure helper matches the component behaviour', () => {
    expect(resizeAccents([true, false, false, false], { beats: 6, beatType: 8 })).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ])
    // Shrinking just truncates to the overlapping indices.
    expect(resizeAccents([true, false, false, true, false, false], { beats: 3, beatType: 4 })).toEqual([
      true,
      false,
      false,
    ])
  })

  it('disables every toggle when disabled', () => {
    render(
      <AccentEditor
        timeSignature={{ beats: 3, beatType: 4 }}
        accents={[true, false, false]}
        onChange={vi.fn()}
        disabled
      />,
    )

    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })
})
