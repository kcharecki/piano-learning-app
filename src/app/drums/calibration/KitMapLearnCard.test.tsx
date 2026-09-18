/**
 * `KitMapLearnCard` (roadmap DR-02): the wizard shell. `learn.ts`'s own
 * tests prove the state machine; this file proves the wiring — a captured
 * note-on advances and lists the pad, Finish stays disabled until every
 * required step is captured and then hands `onSave` a map with every
 * captured note, and the idle button honours `connected`.
 */
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LEARN_STEPS } from '@core/drums/kitmap/learn.ts'
import type { KitMap } from '@core/drums/kitmap/kitMap.ts'
import type { DrumMidiInputState } from '@app/drums/input/useDrumMidiInput.ts'
import { KitMapLearnCard } from './KitMapLearnCard.tsx'

function noteOn(note: number, seq: number): DrumMidiInputState['lastNoteOn'] {
  return { note, velocity: 96, seq }
}

function progressLine(): string {
  return screen.getByRole('status', { name: 'Learn kit progress' }).textContent ?? ''
}

function captureItems() {
  return within(screen.getByRole('list', { name: 'Captured pads' })).getAllByRole('listitem')
}

describe('KitMapLearnCard', () => {
  it('disables "Learn kit" when not connected, with the connect note', () => {
    render(<KitMapLearnCard lastNoteOn={undefined} connected={false} onSave={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Learn kit' })).toBeDisabled()
    expect(screen.getByText('Connect your e-kit to learn it.')).toBeInTheDocument()
  })

  it('enables "Learn kit" once connected, with no connect note', () => {
    render(<KitMapLearnCard lastNoteOn={undefined} connected={true} onSave={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Learn kit' })).toBeEnabled()
    expect(screen.queryByText('Connect your e-kit to learn it.')).not.toBeInTheDocument()
  })

  it('starting the wizard shows the first prompt, 0 captured, and a disabled Skip (kick is required)', async () => {
    const user = userEvent.setup()
    render(<KitMapLearnCard lastNoteOn={undefined} connected={true} onSave={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Learn kit' }))

    expect(screen.getByRole('heading', { name: 'Hit your kick drum' })).toBeInTheDocument()
    expect(progressLine()).toBe(`Captured 0 of ${LEARN_STEPS.length}`)
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
  })

  it('a captured note-on advances the prompt and lists "Kick — note 36"', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<KitMapLearnCard lastNoteOn={undefined} connected={true} onSave={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Learn kit' }))

    act(() => {
      rerender(<KitMapLearnCard lastNoteOn={noteOn(36, 0)} connected={true} onSave={vi.fn()} />)
    })

    expect(progressLine()).toBe(`Captured 1 of ${LEARN_STEPS.length}`)
    expect(screen.getByRole('heading', { name: 'Hit your snare (centre)' })).toBeInTheDocument()
    const items = captureItems()
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Kick — note 36')
  })

  it('a repeated note-on number produces a conflict line naming the owning pad, without capturing', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<KitMapLearnCard lastNoteOn={undefined} connected={true} onSave={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Learn kit' }))

    act(() => {
      rerender(<KitMapLearnCard lastNoteOn={noteOn(36, 0)} connected={true} onSave={vi.fn()} />) // kick <- 36
    })
    act(() => {
      rerender(<KitMapLearnCard lastNoteOn={noteOn(38, 1)} connected={true} onSave={vi.fn()} />) // snare <- 38
    })
    act(() => {
      rerender(<KitMapLearnCard lastNoteOn={noteOn(36, 2)} connected={true} onSave={vi.fn()} />) // hi-hat tries 36
    })

    expect(screen.getByRole('alert', { name: 'Learn kit conflict' })).toHaveTextContent(
      'Note 36 is already your kick — hit a different pad',
    )
    expect(progressLine()).toBe(`Captured 2 of ${LEARN_STEPS.length}`)
  })

  it('Undo removes the previous capture and steps back', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<KitMapLearnCard lastNoteOn={undefined} connected={true} onSave={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Learn kit' }))
    act(() => {
      rerender(<KitMapLearnCard lastNoteOn={noteOn(36, 0)} connected={true} onSave={vi.fn()} />)
    })
    expect(progressLine()).toBe(`Captured 1 of ${LEARN_STEPS.length}`)

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(progressLine()).toBe(`Captured 0 of ${LEARN_STEPS.length}`)
    expect(screen.getByRole('heading', { name: 'Hit your kick drum' })).toBeInTheDocument()
  })

  it('Cancel discards the wizard and returns to idle', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<KitMapLearnCard lastNoteOn={undefined} connected={true} onSave={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Learn kit' }))
    act(() => {
      rerender(<KitMapLearnCard lastNoteOn={noteOn(36, 0)} connected={true} onSave={vi.fn()} />)
    })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Learn kit' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Learn kit progress' })).not.toBeInTheDocument()
  })

  it('Finish stays disabled until every required step is captured, then saves and returns to idle as "Learn kit again"', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn<(map: KitMap) => void>()
    const requiredNotes = [36, 38, 42, 44, 50, 47, 41, 49, 51] // kick..rideBow, 9 required steps
    const { rerender } = render(<KitMapLearnCard lastNoteOn={undefined} connected={true} onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: 'Learn kit' }))

    requiredNotes.forEach((note, i) => {
      act(() => {
        rerender(<KitMapLearnCard lastNoteOn={noteOn(note, i)} connected={true} onSave={onSave} />)
      })
    })

    expect(progressLine()).toBe(`Captured 9 of ${LEARN_STEPS.length}`)
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled() // now on an optional step

    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const [map] = onSave.mock.calls[0] as [KitMap]
    expect(Object.keys(map.notes)).toHaveLength(9)
    expect(map.notes[36]).toEqual({ kind: 'pad', pad: 'kick' })
    expect(map.notes[42]).toEqual({ kind: 'hiHat' })

    expect(screen.getByRole('button', { name: 'Learn kit again' })).toBeInTheDocument()
  })

  it('skipping every optional step reaches "press Finish to save" with Skip disabled', async () => {
    const user = userEvent.setup()
    const requiredNotes = [36, 38, 42, 44, 50, 47, 41, 49, 51]
    const { rerender } = render(<KitMapLearnCard lastNoteOn={undefined} connected={true} onSave={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Learn kit' }))

    requiredNotes.forEach((note, i) => {
      act(() => {
        rerender(<KitMapLearnCard lastNoteOn={noteOn(note, i)} connected={true} onSave={vi.fn()} />)
      })
    })

    const optionalCount = LEARN_STEPS.length - requiredNotes.length
    for (let i = 0; i < optionalCount; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Skip' }))
    }

    expect(screen.getByRole('heading', { name: 'All set — press Finish to save your map' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled()
  })
})
