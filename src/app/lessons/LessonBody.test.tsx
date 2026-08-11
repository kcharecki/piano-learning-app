/**
 * `LessonBody`'s own contract (roadmap 4.9b/3.25, REQ-3.1.3/REQ-3.5.2): a
 * paragraph renders as a paragraph, a `[diagram:...]` reference renders the
 * real diagram for its `kind` — `KeyboardDiagram` for `'keyboard'`, the real
 * `ExerciseScore`/`ScoreViewer` pipeline for `'staff'`/`'rhythm'` — with the
 * registry entry's caption as its accessible name, and an unknown diagram id
 * renders a visible marker instead of nothing.
 *
 * OSMD cannot run in this test environment (no canvas to measure text) —
 * `ScoreViewer` is mocked exactly as `ScaleStaff.test.tsx` mocks it (see that
 * file's module doc): this file only proves `LessonBody` HANDS a staff/rhythm
 * diagram's real `Score` to the viewer; that OSMD then draws it is e2e's job.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LESSON_DIAGRAMS } from '@content/curriculum/diagrams.ts'
import { LessonBody } from './LessonBody.tsx'

vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly id: string; readonly meta: { readonly title: string } } }) => (
    <div data-testid="mock-score-viewer" data-score-id={score.id} data-title={score.meta.title} />
  ),
}))

afterEach(cleanup)

describe('LessonBody', () => {
  it('renders a single paragraph as a paragraph, with its full text', () => {
    render(<LessonBody explanation="Sit centred on the bench." />)

    const paragraph = screen.getByText('Sit centred on the bench.')
    expect(paragraph.tagName).toBe('P')
  })

  it('renders two blank-line-separated paragraphs as two separate paragraphs, with no stray empty ones', () => {
    const { container } = render(
      <LessonBody explanation={'First paragraph.\n\nSecond paragraph.'} />,
    )

    expect(screen.getByText('First paragraph.').tagName).toBe('P')
    expect(screen.getByText('Second paragraph.').tagName).toBe('P')
    expect(container.querySelectorAll('.lesson-body-block')).toHaveLength(2)
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  it('renders a [diagram:<id>] reference as the real KeyboardDiagram, captioned as its accessible name', () => {
    const diagram = LESSON_DIAGRAMS[0]
    if (diagram === undefined) throw new Error('expected at least one registered diagram')

    render(<LessonBody explanation={`[diagram:${diagram.id}]`} />)

    const svg = screen.getByRole('img', { name: diagram.caption })
    expect(svg).toBeInTheDocument()
    expect(screen.getByTestId('keyboard-diagram')).toBeInTheDocument()
    expect(screen.getByText(diagram.caption)).toBeInTheDocument()
  })

  it('renders an unknown diagram id as a visible "unknown diagram" marker, not nothing', () => {
    render(<LessonBody explanation="[diagram:does-not-exist]" />)

    const marker = screen.getByTestId('lesson-body-unknown-diagram')
    expect(marker).toHaveTextContent(/unknown diagram/i)
    expect(marker).toHaveTextContent('does-not-exist')
    expect(screen.queryByTestId('keyboard-diagram')).not.toBeInTheDocument()
  })

  it('renders two diagram references on adjacent lines as two separate diagrams', () => {
    const first = LESSON_DIAGRAMS[0]
    const second = LESSON_DIAGRAMS[1]
    if (first === undefined || second === undefined) {
      throw new Error('expected at least two registered diagrams')
    }

    render(<LessonBody explanation={`[diagram:${first.id}]\n[diagram:${second.id}]`} />)

    expect(screen.getByRole('img', { name: first.caption })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: second.caption })).toBeInTheDocument()
  })

  it('renders a line that only resembles a diagram reference as plain text, never dropping it', () => {
    render(<LessonBody explanation="See [diagram:finding-middle-c] below for the picture." />)

    expect(
      screen.getByText('See [diagram:finding-middle-c] below for the picture.'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('keyboard-diagram')).not.toBeInTheDocument()
  })

  it("renders a 'staff' diagram through the real ExerciseScore/ScoreViewer pipeline, captioned as its accessible name", () => {
    const diagram = LESSON_DIAGRAMS.find((d) => d.kind === 'staff')
    if (diagram === undefined) throw new Error('expected at least one registered staff diagram')

    render(<LessonBody explanation={`[diagram:${diagram.id}]`} />)

    const viewer = screen.getByTestId('mock-score-viewer')
    expect(viewer).toHaveAttribute('data-score-id', diagram.score.id)
    expect(screen.getByRole('img', { name: diagram.caption })).toBeInTheDocument()
    expect(screen.getByText(diagram.caption)).toBeInTheDocument()
    expect(screen.queryByTestId('keyboard-diagram')).not.toBeInTheDocument()
  })

  it("renders a 'rhythm' diagram through the same pipeline, with its own CSS hook", () => {
    const diagram = LESSON_DIAGRAMS.find((d) => d.kind === 'rhythm')
    if (diagram === undefined) throw new Error('expected at least one registered rhythm diagram')

    const { container } = render(<LessonBody explanation={`[diagram:${diagram.id}]`} />)

    const viewer = screen.getByTestId('mock-score-viewer')
    expect(viewer).toHaveAttribute('data-score-id', diagram.score.id)
    expect(screen.getByRole('img', { name: diagram.caption })).toBeInTheDocument()
    expect(container.querySelector('.lesson-body-diagram-rhythm')).not.toBeNull()
  })
})
