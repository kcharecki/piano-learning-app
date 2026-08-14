/**
 * `QualityAnswerButtons` (roadmap 3.10) — one labelled button per option in
 * the vocabulary the caller passes in, humanised for display, answering back
 * with the raw value (never the display text) — the same component serves
 * both the chord-quality and scale/mode drills.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QualityAnswerButtons } from './QualityAnswerButtons.tsx'

afterEach(cleanup)

describe('QualityAnswerButtons — chord qualities', () => {
  it('renders exactly the given vocabulary, humanised, in a named group', () => {
    render(
      <QualityAnswerButtons
        groupLabel="Chord quality answer"
        options={['major', 'minor', 'halfDiminished7'] as const}
        onAnswer={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: 'Chord quality answer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Major' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Half Diminished 7' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Diminished' })).toBeNull()
  })

  it('clicking a button answers with the raw value, not the humanised label', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(
      <QualityAnswerButtons
        groupLabel="Chord quality answer"
        options={['major', 'minor'] as const}
        onAnswer={onAnswer}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Minor' }))

    expect(onAnswer).toHaveBeenCalledWith('minor')
  })
})

describe('QualityAnswerButtons — scale types (the same component, a different vocabulary)', () => {
  it('humanises camelCase scale-type names', () => {
    render(
      <QualityAnswerButtons
        groupLabel="Scale/mode answer"
        options={['naturalMinor', 'dorian'] as const}
        onAnswer={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: 'Scale/mode answer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Natural Minor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dorian' })).toBeInTheDocument()
  })

  it('clicking a button answers with exactly that scale type', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(
      <QualityAnswerButtons
        groupLabel="Scale/mode answer"
        options={['naturalMinor', 'dorian'] as const}
        onAnswer={onAnswer}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Dorian' }))

    expect(onAnswer).toHaveBeenCalledWith('dorian')
  })
})

// roadmap UI-13 (2026-08-12 UI audit): "answers as the interface" — every
// option is now a large `.card` button, and the one the learner picked
// resolves with the feedback tokens PLUS a glyph, never color alone
// (DESIGN.md rule 8). `answered` is what `EarTrainingScreen` passes back
// once `useEarTraining`'s own grade lands.
describe('QualityAnswerButtons — answered feedback (roadmap UI-13)', () => {
  it('marks the picked card correct, with a check glyph, when the answer was right', () => {
    render(
      <QualityAnswerButtons
        groupLabel="Chord quality answer"
        options={['major', 'minor'] as const}
        onAnswer={vi.fn()}
        answered={{ picked: 'major', correct: true }}
      />,
    )

    const picked = screen.getByRole('button', { name: /Major/ })
    expect(picked).toHaveAttribute('data-state', 'correct')
    expect(picked.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Minor' })).not.toHaveAttribute('data-state')
  })

  it('marks the picked card wrong, with an x glyph, when the answer was incorrect', () => {
    render(
      <QualityAnswerButtons
        groupLabel="Chord quality answer"
        options={['major', 'minor'] as const}
        onAnswer={vi.fn()}
        answered={{ picked: 'minor', correct: false }}
      />,
    )

    const picked = screen.getByRole('button', { name: /Minor/ })
    expect(picked).toHaveAttribute('data-state', 'wrong')
    expect(picked.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Major' })).not.toHaveAttribute('data-state')
  })

  it('locks every card once answered, so a second pick is impossible', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(
      <QualityAnswerButtons
        groupLabel="Chord quality answer"
        options={['major', 'minor'] as const}
        onAnswer={onAnswer}
        answered={{ picked: 'major', correct: true }}
      />,
    )

    expect(screen.getByRole('button', { name: /Major/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Minor' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Minor' }))
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('with no answer yet, no card carries a data-state and every card stays enabled', () => {
    render(
      <QualityAnswerButtons
        groupLabel="Chord quality answer"
        options={['major', 'minor'] as const}
        onAnswer={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Major' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Major' })).not.toHaveAttribute('data-state')
    expect(screen.getByRole('button', { name: 'Minor' })).not.toHaveAttribute('data-state')
  })
})
