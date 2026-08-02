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
