/**
 * Screen-level composition (roadmap 2.12): the store, the drill hook, the
 * staff prompt and the on-screen keyboard are wired together correctly, and
 * a full answer round-trip (press a key, see it graded, get a new card) works
 * driven the way a user would drive it. Per-hook behaviour is covered by
 * `useFlashcardDrill.test.ts`.
 */
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import {
  buildDeck,
  type IntervalOnStaffCard,
  type KeySignatureCard,
  type NoteNameCard,
  type StaffToKeyCard,
} from '@core/drills/flashcards.ts'
import { seededRng } from '@core/ports/rng.ts'
import { midi } from '@core/shared/units.ts'
import { midiToName } from '@core/theory/pitch.ts'
import { act, render, screen, cleanup, within } from '@testing-library/react'
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
    // Roadmap UI-04b: the "No MIDI keyboard connected" status moved out of
    // this screen entirely, into the shell's topbar input-status chip —
    // proved in `InputCapabilityBanner.test.tsx`, not here.
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<FlashcardScreen connectMidi={neverResolves} rng={seededRng(1)} />)

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

  it('answering through the computer keyboard grades the card, and the mapping is shown (roadmap 5.5)', () => {
    const clock = new FakeClock()
    const midiInput = new FakeMidiInput()
    render(<FlashcardScreen clock={clock} midiInput={midiInput} rng={seededRng(42)} />)

    expect(screen.getByText(/or type it/i)).toBeInTheDocument()

    const codes = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ']
    for (const code of codes) {
      // `act()`: a raw `window.dispatchEvent` is not a React-managed event, so
      // without it the resulting state update has not committed when the
      // DOM is read on the next line.
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
      })
      if (screen.queryByTestId('flashcard-feedback') !== null) break
    }

    expect(screen.getByTestId('flashcard-feedback')).toBeInTheDocument()
  })

  it('changing the level rebuilds the deck', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('1')
    const keysAtLevel1 = within(
      screen.getByRole('group', { name: 'On-screen keyboard' }),
    ).getAllByRole('button').length

    await user.click(screen.getByRole('button', { name: 'Increase level' }))

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('2')
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

// roadmap 3.11 (REQ-3.5.2): `useFlashcardDrill.test.ts` proves the hook can
// drive all four decks; these prove the two new ones are actually reachable
// from the screen a learner drives — the Drill selector, the answer pad, and
// the stats counter all wire together, not just the hook in isolation.
describe('FlashcardScreen — note-name and key-signature drills (roadmap 3.11, REQ-3.5.2)', () => {
  function accidentalSuffix(alter: number): string {
    if (alter === 1) return '♯'
    if (alter === -1) return '♭'
    if (alter === 2) return '\u{1D12A}'
    if (alter === -2) return '\u{1D12B}'
    return ''
  }

  it('selecting Name the note renders the note-name answer pad instead of the keyboard', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Drill'), 'note-name')

    expect(screen.getByRole('group', { name: 'Note name answer' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'On-screen keyboard' })).toBeNull()
    expect(screen.getByRole('img', { name: /staff/i })).toBeInTheDocument()
  })

  it('answering the note-name drill correctly grades it and updates the stats counter', async () => {
    const user = userEvent.setup()
    const rng = scriptedRng([0])
    render(<FlashcardScreen rng={rng} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Drill'), 'note-name')

    // scriptedRng([0]) always picks the deck's first card, deterministically.
    const expected = buildDeck('note-name', 1)[0] as NoteNameCard
    const label = `${expected.answer.letter}${accidentalSuffix(expected.answer.alter)}`

    await user.click(screen.getByRole('button', { name: label }))

    expect(screen.getByTestId('flashcard-feedback')).toHaveTextContent(/correct/i)
    expect(screen.getByTestId('flashcard-stats-total')).toHaveTextContent('1')
  })

  it('selecting Key signature renders the fifths readout and the key-signature answer pad', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Drill'), 'key-signature')

    expect(screen.getByRole('group', { name: 'Key signature answer' })).toBeInTheDocument()
    expect(screen.getByTestId('key-signature-prompt')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'On-screen keyboard' })).toBeNull()
  })

  it('answering the key-signature drill correctly grades it and updates the stats counter', async () => {
    const user = userEvent.setup()
    const rng = scriptedRng([0])
    render(<FlashcardScreen rng={rng} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Drill'), 'key-signature')

    // scriptedRng([0]) always picks the deck's first card, deterministically —
    // level 1's first key-signature card is fifths -1: F major / D minor.
    const expected = buildDeck('key-signature', 1)[0] as KeySignatureCard
    const label =
      `${expected.answer.majorTonic.letter}${accidentalSuffix(expected.answer.majorTonic.alter)} major / ` +
      `${expected.answer.minorTonic.letter}${accidentalSuffix(expected.answer.minorTonic.alter)} minor`

    await user.click(screen.getByRole('button', { name: label }))

    expect(screen.getByTestId('flashcard-feedback')).toHaveTextContent(/correct/i)
    expect(screen.getByTestId('flashcard-stats-total')).toHaveTextContent('1')
  })
})

describe('FlashcardScreen — initialKind prop (roadmap 4.9c, REQ-3.5.2, REQ-3.1.4)', () => {
  it('opens the interval deck first when initialKind is interval-on-staff', () => {
    render(
      <FlashcardScreen
        rng={seededRng(1)}
        midiInput={new FakeMidiInput()}
        initialKind="interval-on-staff"
      />,
    )

    expect(screen.getByLabelText('Drill')).toHaveValue('interval-on-staff')
    expect(screen.getByRole('group', { name: 'Interval answer' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'On-screen keyboard' })).toBeNull()
  })

  it('still defaults to Note → key when initialKind is omitted', () => {
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    expect(screen.getByLabelText('Drill')).toHaveValue('staff-to-key')
    expect(screen.getByRole('group', { name: 'On-screen keyboard' })).toBeInTheDocument()
  })

  it('the learner can still switch decks after initialKind seeds the initial value', async () => {
    const user = userEvent.setup()
    render(
      <FlashcardScreen
        rng={seededRng(1)}
        midiInput={new FakeMidiInput()}
        initialKind="interval-on-staff"
      />,
    )

    expect(screen.getByRole('group', { name: 'Interval answer' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Drill'), 'staff-to-key')

    expect(screen.getByLabelText('Drill')).toHaveValue('staff-to-key')
    expect(screen.getByRole('group', { name: 'On-screen keyboard' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Interval answer' })).toBeNull()
  })
})

describe('FlashcardScreen — initialLevel prop (finding 1, roadmap 3.11/4.9c, REQ-3.5.2)', () => {
  it('opens at the given initialLevel', () => {
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} initialLevel={3} />)

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('3')
  })

  it('clamps an initialLevel above the max down to MAX_DRILL_LEVEL', () => {
    render(
      <FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} initialLevel={99} />,
    )

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('7')
  })

  it('clamps an initialLevel below the min up to MIN_DRILL_LEVEL', () => {
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} initialLevel={0} />)

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('1')
  })

  it('still defaults to Level 1 when initialLevel is omitted', () => {
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('1')
  })

  it('the learner can still change level after initialLevel seeds it', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} initialLevel={3} />)

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('3')

    await user.click(screen.getByRole('button', { name: 'Increase level' }))

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('4')
  })
})

// roadmap UI-12 (2026-08-12 UI audit): the standalone metronome fieldset is
// deleted outright — a metronome has its own screen
// (`@app/metronome/MetronomeScreen.tsx`), and this drill grades single
// answers with no tempo involved.
describe('FlashcardScreen — no metronome (roadmap UI-12)', () => {
  it('never renders a Metronome group, Start/Stop button, or Tempo field', () => {
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    expect(screen.queryByRole('group', { name: 'Metronome' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByLabelText('Tempo (BPM)')).toBeNull()
    expect(screen.queryByTestId('flashcard-metronome-beat')).toBeNull()
    expect(screen.queryByText(/metronome/i)).toBeNull()
  })
})

describe('FlashcardScreen — header holds the drill config (roadmap UI-12)', () => {
  it('renders the Drill select and the Level stepper inside the page header actions, with the level label outside the stepper group', () => {
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    const select = screen.getByLabelText('Drill')
    expect(select.closest('.page-header')).not.toBeNull()

    const stepper = screen.getByRole('group', { name: 'Level' })
    expect(stepper.closest('.page-header')).not.toBeNull()
    expect(stepper).toHaveClass('stepper')
    // The label is a SIBLING of `.stepper`, not a child between its buttons —
    // the exact defect `.stepper` exists to fix (primitives.css's file header).
    expect(stepper.querySelector('label')).toBeNull()
    expect(within(stepper).getByTestId('flashcard-level')).toHaveTextContent('1')
  })

  it('names the open deck in the subtitle, in learner language', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    expect(screen.getByText('Find the note on your keyboard')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Drill'), 'interval-on-staff')

    expect(screen.getByText('Name the interval on the staff')).toBeInTheDocument()
  })
})

describe('FlashcardScreen — graded-answer pill reserves its own height (roadmap UI-12)', () => {
  it('mounts the feedback status node before any card is answered, so its space is reserved from the first paint', () => {
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    // Present immediately — not conditionally mounted only once a grade
    // exists — which is what makes the stage's layout stable when the first
    // answer lands; a `null`-until-graded element (the old behaviour) would
    // insert a brand-new box into the flow at that moment instead.
    const feedback = screen.getByTestId('flashcard-feedback')
    expect(feedback).toBeInTheDocument()
    expect(feedback).toHaveAttribute('data-visible', 'false')
    expect(feedback).toHaveTextContent('')
  })

  it('answering flips data-visible without unmounting the same node, and shows a glyph + color cue', async () => {
    const user = userEvent.setup()
    const rng = scriptedRng([0])
    render(<FlashcardScreen rng={rng} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Drill'), 'interval-on-staff')
    const feedbackBefore = screen.getByTestId('flashcard-feedback')
    expect(feedbackBefore).toHaveAttribute('data-visible', 'false')

    await user.click(screen.getByRole('button', { name: 'Minor 2nd' }))

    const feedbackAfter = screen.getByTestId('flashcard-feedback')
    // Same DOM node, not a re-mount — the reserved-height box just gained content.
    expect(feedbackAfter).toBe(feedbackBefore)
    expect(feedbackAfter).toHaveAttribute('data-visible', 'true')
    expect(feedbackAfter).toHaveClass('is-ok')
    expect(feedbackAfter).toHaveTextContent(/correct/i)
    expect(feedbackAfter.querySelector('svg')).not.toBeNull()
  })

  it('a wrong answer shows the error class and NAMES the answer, not just red text', async () => {
    const user = userEvent.setup()
    const rng = scriptedRng([0])
    render(<FlashcardScreen rng={rng} midiInput={new FakeMidiInput()} />)

    await user.selectOptions(screen.getByLabelText('Drill'), 'interval-on-staff')
    // level 1's first interval-on-staff card is a minor 2nd (see the
    // "answering the interval drill correctly" test above) — anything else
    // is wrong.
    await user.click(screen.getByRole('button', { name: 'Major 3rd' }))

    const feedback = screen.getByTestId('flashcard-feedback')
    expect(feedback).toHaveClass('is-error')
    // Naming it is the whole point: "wrong" alone teaches nothing.
    expect(feedback).toHaveTextContent(/not quite/i)
    expect(feedback).toHaveTextContent(/minor 2nd/i)
    expect(feedback).not.toHaveTextContent(/major 3rd/i)
  })
})

describe('FlashcardScreen — the reveal holds the card (improve-app run 2026-08-24-1)', () => {
  // scriptedRng([0]) always draws the deck's first card, so the test knows the
  // answer without reading it back off the screen it is checking.
  const FIRST = buildDeck('staff-to-key', 1)[0] as StaffToKeyCard
  const answerKey = midiToName(FIRST.answer.midi)
  const wrongKey = midiToName(midi(FIRST.answer.midi + (FIRST.answer.midi === 56 ? 1 : -1)))

  it('a miss offers Next, marks the answer on the keyboard, and freezes the answer pad', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)
    const staffBefore = screen.getByTestId('staff-note').getAttribute('data-step')

    await user.click(screen.getByRole('button', { name: wrongKey }))

    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: answerKey })).toHaveAttribute(
      'data-highlighted',
      'true',
    )
    // Same card, still on screen: the correction lands on what caused it.
    expect(screen.getByTestId('staff-note')).toHaveAttribute('data-step', staffBefore)
    // The pad is inert, so the marked key cannot be clicked back for credit.
    expect(screen.getByRole('button', { name: answerKey })).toBeDisabled()
  })

  it('Next clears the mark and the feedback, and serves the next card', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    await user.click(screen.getByRole('button', { name: wrongKey }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0)
    expect(screen.getByTestId('flashcard-feedback')).toHaveAttribute('data-visible', 'false')
    expect(screen.getByRole('button', { name: answerKey })).toBeEnabled()
  })

  it('a correct answer never reveals — it advances, as it always did', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={scriptedRng([0])} midiInput={new FakeMidiInput()} />)

    await user.click(screen.getByRole('button', { name: answerKey }))

    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0)
    expect(screen.getByTestId('flashcard-feedback')).toHaveTextContent(/correct/i)
  })
})

describe('FlashcardScreen — QWERTY hint collapses behind a disclosure (roadmap UI-12)', () => {
  it('shows a one-line "Show keys" trigger, and opening it reveals the full key map', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    const trigger = screen.getByText('Show keys')
    const disclosure = trigger.closest('details')
    expect(disclosure).not.toBeNull()
    expect(disclosure).not.toHaveAttribute('open')
    // The full mapping text is still in the document (native <details> hides
    // it visually, not structurally) — proves QwertyHint itself is untouched.
    expect(screen.getByText(/or type it/i)).toBeInTheDocument()

    await user.click(trigger)

    expect(disclosure).toHaveAttribute('open')
  })
})
