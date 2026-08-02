/**
 * `AnnotationPanel` (roadmap 4.8, REQ-3.2.6). Drives the real UI controls and
 * asserts the OUTPUT changed — the live `role="status"` text and the
 * rendered measure-note list — never merely that a control is present.
 */
import { makeScore, type Score } from '@core/notation/score.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { useAnnotationStore } from '@app/state/annotationStore.ts'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { AnnotationPanel } from './AnnotationPanel.tsx'

function resetStores(): void {
  useScoreStore.setState({ loaded: undefined })
  useAnnotationStore.setState({ byScoreId: {} })
}

function loadAScore(): Score {
  const score = makeScore({
    id: 'score-1',
    measures: [{}, {}],
    notes: [{ midi: 60, startTick: 0, durationTicks: 240, hand: 'right' }],
  })
  useScoreStore.getState().loadScore({ score, sourceName: 'test.musicxml', musicXml: undefined })
  return score
}

afterEach(() => {
  cleanup()
  resetStores()
})

describe('AnnotationPanel', () => {
  it('every control is disabled with no note selected, except the measure note controls', () => {
    loadAScore()
    render(<AnnotationPanel measureIndex={0} />)

    expect(screen.getByLabelText('Finger (1–5)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Set fingering' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear fingering' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Highlight note' })).toBeDisabled()
    expect(screen.getByLabelText(/note for measure/i)).toBeEnabled()
  })

  it('setting a fingering updates the live status, the store, and clearing it reverts', async () => {
    const score = loadAScore()
    const noteId = score.notes[0]?.id
    if (noteId === undefined) throw new Error('fixture has no notes')
    const user = userEvent.setup()
    render(<AnnotationPanel selectedNoteId={noteId} measureIndex={0} />)

    expect(screen.getByTestId('annotation-current-finger')).toHaveTextContent('No fingering set')

    await user.type(screen.getByLabelText('Finger (1–5)'), '3')
    await user.click(screen.getByRole('button', { name: 'Set fingering' }))

    expect(screen.getByTestId('annotation-current-finger')).toHaveTextContent('Finger 3')
    expect(useAnnotationStore.getState().byScoreId['score-1']?.items).toContainEqual({
      kind: 'fingering',
      noteId,
      finger: 3,
    })

    await user.click(screen.getByRole('button', { name: 'Clear fingering' }))

    expect(screen.getByTestId('annotation-current-finger')).toHaveTextContent('No fingering set')
  })

  it('rejects an out-of-range fingering and reports why', async () => {
    const score = loadAScore()
    const noteId = score.notes[0]?.id
    if (noteId === undefined) throw new Error('fixture has no notes')
    const user = userEvent.setup()
    render(<AnnotationPanel selectedNoteId={noteId} measureIndex={0} />)

    await user.type(screen.getByLabelText('Finger (1–5)'), '9')
    await user.click(screen.getByRole('button', { name: 'Set fingering' }))

    expect(screen.getByTestId('annotation-current-finger')).toHaveTextContent('No fingering set')
    expect(screen.getByTestId('annotation-finger-error')).toHaveTextContent(/1–5/)
  })

  it('toggling the highlight button sets then removes a highlight, reflected in the status', async () => {
    const score = loadAScore()
    const noteId = score.notes[0]?.id
    if (noteId === undefined) throw new Error('fixture has no notes')
    const user = userEvent.setup()
    render(<AnnotationPanel selectedNoteId={noteId} measureIndex={0} />)

    expect(screen.getByTestId('annotation-current-highlight')).toHaveTextContent('No highlight')

    await user.click(screen.getByRole('button', { name: 'Highlight note' }))
    expect(screen.getByTestId('annotation-current-highlight')).toHaveTextContent(/Highlighted/)
    expect(screen.getByRole('button', { name: 'Remove highlight' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove highlight' }))
    expect(screen.getByTestId('annotation-current-highlight')).toHaveTextContent('No highlight')
  })

  it('writing a measure note makes it appear in the rendered list, and notes accumulate', async () => {
    loadAScore()
    const user = userEvent.setup()
    render(<AnnotationPanel measureIndex={2} />)

    expect(screen.getByLabelText(/note for measure/i)).toHaveAccessibleName('Note for measure 3')

    await user.type(screen.getByLabelText(/note for measure/i), 'watch the pedal')
    await user.click(screen.getByRole('button', { name: 'Add note' }))

    const list = screen.getByTestId('annotation-measure-notes')
    expect(list).toHaveTextContent('watch the pedal')

    await user.type(screen.getByLabelText(/note for measure/i), 'slow down here')
    await user.click(screen.getByRole('button', { name: 'Add note' }))

    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(['watch the pedalRemove', 'slow down hereRemove'])
  })

  it('removing a measure note takes it out of the rendered list', async () => {
    loadAScore()
    const user = userEvent.setup()
    render(<AnnotationPanel measureIndex={0} />)

    await user.type(screen.getByLabelText(/note for measure/i), 'watch the pedal')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    expect(screen.getByTestId('annotation-measure-notes')).toHaveTextContent('watch the pedal')

    await user.click(screen.getByRole('button', { name: 'Remove note: watch the pedal' }))

    expect(screen.getByTestId('annotation-measure-notes')).not.toHaveTextContent('watch the pedal')
  })

  it('the Add note button stays disabled for blank input', async () => {
    loadAScore()
    const user = userEvent.setup()
    render(<AnnotationPanel measureIndex={0} />)

    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()

    await user.type(screen.getByLabelText(/note for measure/i), '   ')

    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()
  })
})
