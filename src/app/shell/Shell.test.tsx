/**
 * Shell navigation (roadmap 1.17, 2.12, REQ-4.6): five destinations —
 * Practice, Sight reading and Flashcards are real screens; Theory and
 * Progress are still honest placeholders. `ScoreScreen` pulls in the
 * OSMD-backed viewer, so it is mocked here — this file only asserts on
 * navigation wiring. Sight reading and Flashcards are cheap enough to render
 * for real (no OSMD, no audio/MIDI access started until a user acts), so
 * this is also the regression test for roadmap 1.18's own lesson: a screen
 * built and tested in isolation but never mounted by the shell is
 * unreachable. See `e2e/smoke.spec.ts` for the real-browser proof.
 */
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/score/ScoreScreen.tsx', () => ({
  ScoreScreen: () => <div data-testid="mock-score-screen" />,
}))

// The Theory destination reaches a SECOND OSMD mount that `ScoreScreen`'s mock
// does not cover: `TheoryScreen` -> `ChordScaleReference` -> `ScaleStaff`
// (roadmap 3.14) -> `ExerciseScore` -> `ScoreViewer`. happy-dom has no canvas,
// so OSMD's text measurer throws — and because `autoResize: true` makes OSMD
// re-render on a timer it owns, that throw lands OUTSIDE the `load()` promise
// `ScoreViewer` catches, as an unhandled exception that fails the whole run
// while every test still passes. Same mock as ChordScaleReference.test.tsx /
// ScaleStaff.test.tsx / TechniqueScreen.test.tsx; the real engraving is proved
// in a browser by e2e, not here.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly meta: { readonly title: string } } }) => (
    <div data-testid="mock-score-viewer" data-title={score.meta.title} />
  ),
}))

const { Shell } = await import('./Shell.tsx')

function resetStores(): void {
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
  useFlashcardStore.setState({ cardsById: {} })
}

afterEach(() => {
  cleanup()
  resetStores()
})

describe('Shell', () => {
  it('shows Practice as the active, live screen by default', () => {
    render(<Shell />)
    expect(screen.getByRole('button', { name: 'Practice' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()
  })

  it('reaches the real sight-reading trainer through its nav item', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Sight reading' }))

    expect(screen.getByRole('button', { name: 'Sight reading' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('heading', { name: 'Sight reading' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start exercise' })).toBeInTheDocument()
  })

  it('reaches the real flashcard drill through its nav item', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Flashcards' }))

    expect(screen.getByRole('button', { name: 'Flashcards' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('heading', { name: 'Flashcards' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /staff/i })).toBeInTheDocument()
  })

  // Every destination is now a real screen — there are no placeholders left
  // (roadmap 3.8/3.9/3.10, 4.7, 4.7a). Each case asserts on something only
  // that screen renders, so a nav item pointing at the wrong component fails
  // here rather than in a browser.
  it.each([
    ['Theory', 'Theory'],
    ['Progress', 'Progress'],
    ['Ear training', 'Ear Training'],
    ['Metronome', 'Metronome'],
    ['Today', "Today's session"],
  ])('reaches the real %s screen through its nav item', async (label, heading) => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: label }))

    expect(screen.queryByTestId('mock-score-screen')).toBeNull()
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })

  // Roadmap 3.11. The curriculum names all four decks, but `openedDeckOf`
  // matched only two and returned `undefined` for the rest — and `undefined`
  // falls back to the default staff-to-key deck rather than failing, so seven
  // lessons silently opened the note-naming drill their titles disowned. This
  // drives the real path (Lessons -> lesson -> Open) and asserts on the deck
  // and level the learner actually lands on, which is the only thing a silent
  // fallback cannot fake.
  it('opens a lesson quiz on the deck and level that lesson named', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Lessons' }))
    await user.click(screen.getByRole('button', { name: 'Level 3' }))
    await user.click(screen.getByRole('button', { name: 'The Circle of Fifths' }))
    await user.click(
      screen.getByRole('button', { name: 'Open Quiz: the circle of fifths and key signatures' }),
    )

    expect(screen.getByLabelText('Drill')).toHaveValue('key-signature')
    // Level 1 holds only fifths -1..+1, so a circle-of-fifths quiz that opened
    // at the default level would drill three signatures out of fifteen.
    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('Level 7')
  })

  it('switches back to Practice', async () => {
    const user = userEvent.setup()
    render(<Shell />)

    await user.click(screen.getByRole('button', { name: 'Theory' }))
    await user.click(screen.getByRole('button', { name: 'Practice' }))

    expect(screen.getByTestId('mock-score-screen')).toBeInTheDocument()
  })
})
