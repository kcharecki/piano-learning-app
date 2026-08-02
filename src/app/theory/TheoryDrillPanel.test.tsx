/**
 * Screen-level composition test (roadmap 3.3): a quiz item is built, answered
 * on the on-screen keyboard or a real MIDI keyboard, graded, and its SRS card
 * scheduled into the shared store — driven the way a learner would drive it,
 * not merely rendered. Per-module behaviour (grading, level gating,
 * determinism) is covered by `core/drills/theory.test.ts`.
 */
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { buildTheoryQuiz } from '@core/drills/theory.ts'
import { act, render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, scriptedRng } from '@test/fakes.ts'
import type { Midi } from '@core/shared/units.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { TheoryDrillPanel } from './TheoryDrillPanel.tsx'

function resetStore(): void {
  useFlashcardStore.setState({ cardsById: {} })
}

afterEach(() => {
  cleanup()
  resetStore()
})

describe('TheoryDrillPanel', () => {
  it('is fully usable with no MIDI keyboard connected — REQ-4.1', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<TheoryDrillPanel connectMidi={neverResolves} rng={scriptedRng([0])} />)

    expect(screen.getByText(/no MIDI keyboard connected/i)).toBeInTheDocument()
    expect(screen.getByTestId('theory-prompt')).toBeInTheDocument()
  })

  it('defaults to the Scale topic at level 1, with a matching prompt', () => {
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    expect(screen.getByLabelText('Topic')).toHaveValue('build-scale')
    expect(screen.getByTestId('theory-level')).toHaveTextContent('Level 1')
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(expected.prompt)
    expect(screen.getByTestId('theory-progress')).toHaveTextContent(`0 / ${expected.answer.length}`)
  })

  it('playing the answer on the on-screen keyboard grades it and moves the SRS stat', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    expect(screen.getByTestId('theory-stats-total')).toHaveTextContent('0')

    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    for (const group of expected.answer) {
      for (const note of group) {
        await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
      }
    }

    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/correct — graded good/i)
    expect(screen.getByTestId('theory-stats-total')).toHaveTextContent('1')
  })

  it('a wrong note grades the attempt incorrect, still scheduling the card', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    const firstNote = expected.answer[0]?.[0] as number
    // One semitone off from the correct first note of the scale.
    const wrongNote = firstNote + 1 <= 127 ? firstNote + 1 : firstNote - 1

    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    await user.click(within(keyboard).getByRole('button', { name: `Key ${wrongNote}` }))

    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/not quite — graded again/i)
    expect(screen.getByTestId('theory-stats-total')).toHaveTextContent('1')
  })

  it('progressively reports matched groups for a multi-note chord before it is settled', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Topic'), 'build-chord')
    const expected = buildTheoryQuiz('build-chord', 1, scriptedRng([0]))
    const chord = expected.answer[0] as readonly number[]
    expect(chord.length).toBeGreaterThanOrEqual(3)

    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    // Press every note but the last one: the chord is not complete yet, so no
    // feedback should appear.
    for (const note of chord.slice(0, -1)) {
      await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
    }
    expect(screen.queryByTestId('theory-feedback')).toBeNull()

    const lastNote = chord.at(-1) as number
    await user.click(within(keyboard).getByRole('button', { name: `Key ${lastNote}` }))

    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/correct — graded good/i)
  })

  it('a physical MIDI keyboard press answers the prompt exactly like the on-screen one', () => {
    const midiInput = new FakeMidiInput()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={midiInput} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    let atMs = 0
    for (const group of expected.answer) {
      for (const note of group) {
        act(() => midiInput.play(note, atMs))
        atMs += 10
      }
    }

    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/correct — graded good/i)
    expect(screen.getByTestId('theory-stats-total')).toHaveTextContent('1')
  })

  it('changing the level rebuilds the item', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    const level1 = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(level1.prompt)

    await user.click(screen.getByRole('button', { name: 'Increase level' }))

    expect(screen.getByTestId('theory-level')).toHaveTextContent('Level 2')
    const level2 = buildTheoryQuiz('build-scale', 2, scriptedRng([0]))
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(level2.prompt)
  })

  it('changing the topic rebuilds the item for the new kind', async () => {
    const user = userEvent.setup()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Topic'), 'build-interval')

    const expected = buildTheoryQuiz('build-interval', 1, scriptedRng([0]))
    expect(screen.getByTestId('theory-prompt')).toHaveTextContent(expected.prompt)
  })

  it('schedules the SRS card against the injected DateSource, not the wall clock', async () => {
    const user = userEvent.setup()
    const NOW = 1_000_000
    const clock = new FakeClock(NOW)
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={new FakeMidiInput()} date={clock} />)

    const expected = buildTheoryQuiz('build-scale', 1, scriptedRng([0]))
    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    for (const group of expected.answer) {
      for (const note of group) {
        await user.click(within(keyboard).getByRole('button', { name: `Key ${note}` }))
      }
    }

    const card = useFlashcardStore.getState().cardsById[expected.id]
    expect(card).toBeDefined()
    // A 'good' grade schedules a positive interval strictly after NOW, measured
    // from the injected DateSource — a card scheduled off the real wall clock
    // would not land relative to this fake epoch.
    expect(card?.due).toBeGreaterThan(NOW)
  })

  it('a full chord fired as one batch of MIDI events (a real chord press) accumulates and grades correct', async () => {
    const user = userEvent.setup()
    const midiInput = new FakeMidiInput()
    render(<TheoryDrillPanel rng={scriptedRng([0])} midiInput={midiInput} />)

    await user.selectOptions(screen.getByLabelText('Topic'), 'build-chord')
    const expected = buildTheoryQuiz('build-chord', 1, scriptedRng([0]))
    const chord = expected.answer[0] as readonly Midi[]
    expect(chord.length).toBeGreaterThanOrEqual(3)

    // All notes delivered inside one act(), like a hand pressing a real chord —
    // React batches these, so a bug re-deriving state from stale render-closure
    // values (rather than a ref) would drop every note but the last.
    act(() => {
      let atMs = 0
      for (const note of chord) {
        midiInput.play(note, atMs)
        atMs += 1
      }
    })

    expect(screen.getByTestId('theory-feedback')).toHaveTextContent(/correct — graded good/i)
  })
})
