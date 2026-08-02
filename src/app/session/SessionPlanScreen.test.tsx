/**
 * `SessionPlanScreen`'s own wiring (roadmap 4.7a, REQ-3.1.4): the rendered
 * minutes sum to the chosen budget, the per-segment split matches
 * `DEFAULT_MIX`, clicking an item's "Open" button calls `onOpen` with that
 * item's own `Exercise`, and an unfillable plan renders the error text
 * instead of an empty list. `useSessionPlan` and `candidates.ts` have their
 * own suites — every test here exercises them for real (through the real
 * stores), so the assertions are about what actually renders, not a mock's
 * say-so.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScoreStore } from '@app/state/scoreStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { makeScore } from '@core/notation/score.ts'
import type { Exercise } from '@core/curriculum/types.ts'
import { SessionPlanScreen } from './SessionPlanScreen.tsx'

function resetStores(): void {
  useScoreStore.setState({
    loaded: undefined,
    importError: undefined,
    availableMidiDevices: [],
    selectedMidiDeviceId: null,
    settings: {
      tempoScale: 1,
      activeHands: ['left', 'right'],
      metronomeEnabled: false,
      loop: undefined,
    },
  })
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
}

/** Loads a score so all four segments (including lesson) have a candidate,
 * making the split match DEFAULT_MIX's 20/20/40/20 exactly. */
function loadAScore(): void {
  useScoreStore.getState().loadScore({
    score: makeScore({ id: 'test-score', measures: [{}], notes: [], tempos: [{ tick: 0, bpm: 120 }] }),
    sourceName: 'Test Piece',
    musicXml: undefined,
  })
}

beforeEach(resetStores)
afterEach(() => {
  cleanup()
  resetStores()
})

function segmentMinutes(name: string): number {
  const text = screen.getByTestId(`session-plan-segment-${name}`).textContent ?? ''
  return Number(text.replace(/[^\d.-]/g, ''))
}

function totalMinutes(): number {
  const text = screen.getByTestId('session-plan-total').textContent ?? ''
  return Number(text.replace(/[^\d.-]/g, ''))
}

describe('SessionPlanScreen', () => {
  it('renders minutes summing exactly to the chosen budget, for 15/30/60 — both the segment split and every rendered item', async () => {
    const user = userEvent.setup()
    loadAScore()
    render(<SessionPlanScreen onOpen={() => {}} />)

    for (const minutes of [15, 30, 60]) {
      await user.click(screen.getByRole('button', { name: `${minutes} min` }))
      expect(totalMinutes()).toBe(minutes)
      const segmentSum =
        segmentMinutes('technique') +
        segmentMinutes('sight-reading') +
        segmentMinutes('lesson') +
        segmentMinutes('theory-ear')
      expect(segmentSum).toBe(minutes)

      const items = screen.getByRole('list', { name: 'Session items' })
      const rows = within(items).getAllByRole('listitem')
      const itemMinutesSum = rows.reduce((sum, row) => {
        const match = /(\d+) min/.exec(row.textContent ?? '')
        if (match?.[1] === undefined) throw new Error(`no "N min" found in row: ${row.textContent}`)
        return sum + Number(match[1])
      }, 0)
      expect(itemMinutesSum).toBe(minutes)
      expect(itemMinutesSum).toBe(segmentSum)
    }
  })

  it('splits 30 minutes as REQ-3.1.4\'s 20/20/40/20, now that every segment has candidates', async () => {
    const user = userEvent.setup()
    loadAScore()
    render(<SessionPlanScreen onOpen={() => {}} />)

    await user.click(screen.getByRole('button', { name: '30 min' }))

    // Before roadmap 4.4a the technique segment had no candidates and its 20%
    // was redistributed; the Technique screen means it can be filled, so this
    // is now the requirement's own mix, literally.
    expect(segmentMinutes('technique')).toBe(6)
    expect(segmentMinutes('sight-reading')).toBe(6)
    expect(segmentMinutes('lesson')).toBe(12)
    expect(segmentMinutes('theory-ear')).toBe(6)
  })

  it('calls onOpen with the clicked item\'s own exercise, identified exactly, not just the first row', async () => {
    const user = userEvent.setup()
    loadAScore()
    const onOpen = vi.fn<(exercise: Exercise) => void>()
    render(<SessionPlanScreen onOpen={onOpen} />)

    const items = screen.getByRole('list', { name: 'Session items' })
    const rows = within(items).getAllByRole('listitem')
    const lastRow = rows[rows.length - 1]
    if (lastRow === undefined) throw new Error('expected at least one session item')
    const openButton = within(lastRow).getByRole('button', { name: /^Open / })

    await user.click(openButton)

    expect(onOpen).toHaveBeenCalledTimes(1)
    const openedExercise = onOpen.mock.calls[0]?.[0]
    if (openedExercise === undefined) throw new Error('onOpen was not called with an exercise')
    // The last row is always a 'theory-ear' item (SEGMENT_ORDER puts it
    // last) and the only reachable theory-ear candidate today is the
    // staff-to-key flashcard deck — assert its exact id, not a substring
    // match that any exercise sharing a word in its title would satisfy.
    expect(openedExercise.id).toBe('flashcards-staff-to-key')
  })

  it('with no score loaded, shows a 0-minute lesson row and a hint to load a score', async () => {
    render(<SessionPlanScreen onOpen={() => {}} />)

    expect(segmentMinutes('lesson')).toBe(0)
    expect(screen.getByRole('status')).toHaveTextContent(/load a score/i)
  })

  it('renders the error text instead of an empty list for an unfillable request', async () => {
    // `sight-reading` and `theory-ear` always have a candidate by design
    // (candidates.ts), so "every segment empty" cannot presently be reached
    // through this screen's own UI — see this module's build report. The
    // budget field IS a real, reachable way to make `planSession` fail
    // (REQ-3.1.4's positive-whole-minutes contract), and it renders through
    // the exact same branch (`error !== undefined` -> alert, no list).
    const user = userEvent.setup()
    render(<SessionPlanScreen onOpen={() => {}} />)

    const customMinutes = screen.getByLabelText('Custom minutes')
    await user.clear(customMinutes)
    await user.type(customMinutes, '0')

    // Learner-facing text (friendlyError), not planSession's internal
    // parameter name — that raw message is kept in the alert's `title`.
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/enter a session length/i)
    expect(alert.getAttribute('title')).toMatch(/positive/i)
    expect(screen.queryByRole('list', { name: 'Session items' })).not.toBeInTheDocument()
  })
})
