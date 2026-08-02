/**
 * `IntervalAnswerButtons` (roadmap 3.10) — one labelled button per interval
 * `intervalsForLevel(level)` can draw, plus an ascending/descending toggle
 * that only appears when the caller says direction is meaningful.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IntervalAnswerButtons } from './IntervalAnswerButtons.tsx'

afterEach(cleanup)

const P5 = { number: 5, quality: 'perfect', semitones: 7 }
const P8 = { number: 8, quality: 'perfect', semitones: 12 }
const M3 = { number: 3, quality: 'major', semitones: 4 }
const m3 = { number: 3, quality: 'minor', semitones: 3 }

describe('IntervalAnswerButtons — vocabulary', () => {
  it('renders exactly the level-1 intervals, and none from a higher level', () => {
    render(<IntervalAnswerButtons level={1} showDirection={false} onAnswer={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Interval answer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'perfect fifth' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'perfect octave' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'major third' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'minor third' })).toBeInTheDocument()
    // Level 2+ only.
    expect(screen.queryByRole('button', { name: 'major second' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'perfect fourth' })).toBeNull()
  })

  it('a higher level draws a wider vocabulary', () => {
    render(<IntervalAnswerButtons level={2} showDirection={false} onAnswer={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'major second' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'perfect fourth' })).toBeInTheDocument()
  })
})

describe('IntervalAnswerButtons — harmonic (no direction)', () => {
  it('hides the direction toggle and always answers ascending', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<IntervalAnswerButtons level={1} showDirection={false} onAnswer={onAnswer} />)

    expect(screen.queryByRole('group', { name: 'Direction' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'perfect fifth' }))

    expect(onAnswer).toHaveBeenCalledWith(P5, 1)
  })
})

describe('IntervalAnswerButtons — melodic (direction toggle)', () => {
  it('defaults to ascending', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<IntervalAnswerButtons level={1} showDirection onAnswer={onAnswer} />)

    expect(screen.getByRole('group', { name: 'Direction' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'perfect octave' }))

    expect(onAnswer).toHaveBeenCalledWith(P8, 1)
  })

  it('switching to Descending changes the direction every subsequent answer is sent with', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<IntervalAnswerButtons level={1} showDirection onAnswer={onAnswer} />)

    await user.click(screen.getByRole('button', { name: 'Descending' }))
    await user.click(screen.getByRole('button', { name: 'major third' }))

    expect(onAnswer).toHaveBeenCalledWith(M3, -1)
  })

  it('every interval button still answers with its own interval, not just the first', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<IntervalAnswerButtons level={1} showDirection onAnswer={onAnswer} />)

    await user.click(screen.getByRole('button', { name: 'minor third' }))

    expect(onAnswer).toHaveBeenCalledWith(m3, 1)
  })
})
