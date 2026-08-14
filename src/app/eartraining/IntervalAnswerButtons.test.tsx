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

// roadmap 5.30: RCM's own staging — m3/M3 at Level 1, P5 at 2, P4 at 3, the
// octave only at 4 — see core/eartraining/intervals.ts's module doc.
describe('IntervalAnswerButtons — vocabulary', () => {
  it('renders exactly the level-1 intervals, and none from a higher level', () => {
    render(<IntervalAnswerButtons level={1} showDirection={false} onAnswer={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Interval answer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'major third' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'minor third' })).toBeInTheDocument()
    // Level 2+ only.
    expect(screen.queryByRole('button', { name: 'perfect fifth' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'perfect fourth' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'perfect octave' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'major second' })).toBeNull()
  })

  it('a higher level draws a wider vocabulary, additively', () => {
    render(<IntervalAnswerButtons level={4} showDirection={false} onAnswer={vi.fn()} />)

    // Level 4 = level 1 (M3, m3) + level 2's P5 + level 3's P4 + level 4's own P8.
    expect(screen.getByRole('button', { name: 'major third' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'minor third' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'perfect fifth' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'perfect fourth' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'perfect octave' })).toBeInTheDocument()
  })
})

describe('IntervalAnswerButtons — harmonic (no direction)', () => {
  it('hides the direction toggle and always answers ascending', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<IntervalAnswerButtons level={1} showDirection={false} onAnswer={onAnswer} />)

    expect(screen.queryByRole('group', { name: 'Direction' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'major third' }))

    expect(onAnswer).toHaveBeenCalledWith(M3, 1)
  })
})

describe('IntervalAnswerButtons — melodic (direction toggle)', () => {
  it('defaults to ascending', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<IntervalAnswerButtons level={4} showDirection onAnswer={onAnswer} />)

    expect(screen.getByRole('group', { name: 'Direction' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'perfect octave' }))

    expect(onAnswer).toHaveBeenCalledWith(P8, 1)
  })

  it('switching to Descending changes the direction every subsequent answer is sent with', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<IntervalAnswerButtons level={2} showDirection onAnswer={onAnswer} />)

    await user.click(screen.getByRole('button', { name: 'Descending' }))
    await user.click(screen.getByRole('button', { name: 'perfect fifth' }))

    expect(onAnswer).toHaveBeenCalledWith(P5, -1)
  })

  it('every interval button still answers with its own interval, not just the first', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(<IntervalAnswerButtons level={1} showDirection onAnswer={onAnswer} />)

    await user.click(screen.getByRole('button', { name: 'minor third' }))

    expect(onAnswer).toHaveBeenCalledWith(m3, 1)
  })
})

// roadmap UI-13 (2026-08-12 UI audit): "answers as the interface" — every
// option is now a large `.card` button, and the one the learner picked
// resolves with the feedback tokens PLUS a glyph, never color alone
// (DESIGN.md rule 8). `answered` is what `EarTrainingScreen` passes back
// once `useEarTraining`'s own grade lands.
describe('IntervalAnswerButtons — answered feedback (roadmap UI-13)', () => {
  it('marks the picked card correct, with a check glyph, when the answer was right', () => {
    render(
      <IntervalAnswerButtons
        level={1}
        showDirection={false}
        onAnswer={vi.fn()}
        answered={{ pickedKey: 'M3', correct: true }}
      />,
    )

    const picked = screen.getByRole('button', { name: /major third/ })
    expect(picked).toHaveAttribute('data-state', 'correct')
    // The glyph is a real, separate cue — not merely a color the button
    // happens to carry (DESIGN.md rule 8: color is never the only signal).
    expect(picked.querySelector('svg')).not.toBeNull()
    // The unpicked option gets no state at all.
    expect(screen.getByRole('button', { name: 'minor third' })).not.toHaveAttribute('data-state')
  })

  it('marks the picked card wrong, with an x glyph, when the answer was incorrect', () => {
    render(
      <IntervalAnswerButtons
        level={1}
        showDirection={false}
        onAnswer={vi.fn()}
        answered={{ pickedKey: 'm3', correct: false }}
      />,
    )

    const picked = screen.getByRole('button', { name: /minor third/ })
    expect(picked).toHaveAttribute('data-state', 'wrong')
    expect(picked.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'major third' })).not.toHaveAttribute('data-state')
  })

  it('locks every card — including the direction toggle — once answered, so a second pick is impossible', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(
      <IntervalAnswerButtons
        level={1}
        showDirection
        onAnswer={onAnswer}
        answered={{ pickedKey: 'M3', correct: true }}
      />,
    )

    expect(screen.getByRole('button', { name: /major third/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /minor third/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ascending' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descending' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /minor third/ }))
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('a melodic pick is matched by its signed key, so a descending answer only marks the descending pick', () => {
    render(
      <IntervalAnswerButtons
        level={1}
        showDirection
        onAnswer={vi.fn()}
        answered={{ pickedKey: '-M3', correct: true }}
      />,
    )

    // The default toggle state is ascending, so the rendered "major third"
    // card's own computed key is 'M3', not '-M3' — it must NOT be marked,
    // proving the match is on the signed key, not just the interval name.
    expect(screen.getByRole('button', { name: /major third/ })).not.toHaveAttribute('data-state')
  })

  it('with no answer yet, no card carries a data-state and every card stays enabled', () => {
    render(<IntervalAnswerButtons level={1} showDirection={false} onAnswer={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'major third' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'major third' })).not.toHaveAttribute('data-state')
    expect(screen.getByRole('button', { name: 'minor third' })).not.toHaveAttribute('data-state')
  })
})
