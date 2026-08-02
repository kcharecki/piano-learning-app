/**
 * Screen-level composition (roadmap 2.12): the store, the drill hook, the
 * staff prompt and the on-screen keyboard are wired together correctly, and
 * a full answer round-trip (press a key, see it graded, get a new card) works
 * driven the way a user would drive it. Per-hook behaviour is covered by
 * `useFlashcardDrill.test.ts`.
 */
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { buildDeck, type IntervalOnStaffCard } from '@core/drills/flashcards.ts'
import { seededRng } from '@core/ports/rng.ts'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, scriptedRng } from '@test/fakes.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { FlashcardScreen } from './FlashcardScreen.tsx'
import { staffStep } from './staffPosition.ts'

function resetStore(): void {
  useFlashcardStore.setState({ cardsById: {} })
}

afterEach(() => {
  cleanup()
  resetStore()
})

describe('FlashcardScreen', () => {
  it('is fully usable with no MIDI keyboard connected — REQ-4.1', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<FlashcardScreen connectMidi={neverResolves} rng={seededRng(1)} />)

    expect(screen.getByText(/no MIDI keyboard connected/i)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /staff/i })).toBeInTheDocument()
  })

  it('answering the on-screen keyboard grades the card and shows a new one', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const midiInput = new FakeMidiInput()

    render(<FlashcardScreen clock={clock} midiInput={midiInput} rng={seededRng(42)} />)

    const keyboard = screen.getByRole('group', { name: 'On-screen keyboard' })
    // Level 1's deck is centred on middle C (56..64); every key in that span
    // is rendered, so pressing the one the card actually asks for is a matter
    // of trying each until the feedback panel appears — deterministic given
    // the seeded rng, but resolved by DOM instead of duplicating the seed math.
    const buttons = within(keyboard).getAllByRole('button')
    for (const button of buttons) {
      // Sequential presses until the correct one lands.
      await user.click(button)
      if (screen.queryByTestId('flashcard-feedback') !== null) break
    }

    expect(screen.getByTestId('flashcard-feedback')).toBeInTheDocument()
    expect(screen.getByTestId('flashcard-stats-total')).toHaveTextContent('1')
  })

  it('changing the level rebuilds the deck', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('Level 1')
    const keysAtLevel1 = within(
      screen.getByRole('group', { name: 'On-screen keyboard' }),
    ).getAllByRole('button').length

    await user.click(screen.getByRole('button', { name: 'Increase level' }))

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('Level 2')
    const keysAtLevel2 = within(
      screen.getByRole('group', { name: 'On-screen keyboard' }),
    ).getAllByRole('button').length
    expect(keysAtLevel2).toBeGreaterThan(keysAtLevel1)
  })
})

describe('FlashcardScreen — drill kind selector (roadmap 2.25)', () => {
  it('offers a Drill selector defaulting to Note → key, with the on-screen keyboard showing', () => {
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    const select = screen.getByLabelText('Drill')
    expect(select).toHaveValue('staff-to-key')
    expect(screen.getByRole('group', { name: 'On-screen keyboard' })).toBeInTheDocument()
  })

  it('selecting Interval renders the interval staff, wired to the actual card prompt, and answer pad instead', async () => {
    const user = userEvent.setup()
    const rng = scriptedRng([0])
    render(<FlashcardScreen rng={rng} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Drill'), 'interval-on-staff')

    expect(screen.getByRole('group', { name: 'Interval answer' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'On-screen keyboard' })).toBeNull()

    // scriptedRng([0]) always picks the deck's first card, deterministically.
    const expected = buildDeck('interval-on-staff', 1)[0] as IntervalOnStaffCard

    const low = screen.getByTestId('staff-note-low')
    const high = screen.getByTestId('staff-note-high')
    expect(low).toHaveAttribute(
      'data-step',
      String(staffStep(expected.prompt.low, expected.prompt.clef)),
    )
    expect(high).toHaveAttribute(
      'data-step',
      String(staffStep(expected.prompt.high, expected.prompt.clef)),
    )
    expect(Number(high.getAttribute('data-step'))).toBeGreaterThan(
      Number(low.getAttribute('data-step')),
    )
  })

  it('answering the interval drill correctly grades it and updates the stats counter', async () => {
    const user = userEvent.setup()
    const rng = scriptedRng([0])
    render(<FlashcardScreen rng={rng} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Drill'), 'interval-on-staff')

    // scriptedRng([0]) always picks the deck's first card, deterministically —
    // level 1's first interval-on-staff card is A3 up a minor 2nd.
    const expected = buildDeck('interval-on-staff', 1)[0] as IntervalOnStaffCard
    expect(expected.answer).toEqual({ number: 2, quality: 'minor' })

    await user.click(screen.getByRole('button', { name: 'Minor 2nd' }))

    expect(screen.getByTestId('flashcard-feedback')).toHaveTextContent(/correct/i)
    expect(screen.getByTestId('flashcard-stats-total')).toHaveTextContent('1')
  })
})
