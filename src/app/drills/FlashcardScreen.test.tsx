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
} from '@core/drills/flashcards.ts'
import { seededRng } from '@core/ports/rng.ts'
import { act, render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput, scriptedRng } from '@test/fakes.ts'
import { afterEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { FlashcardScreen } from './FlashcardScreen.tsx'
import { staffStep } from './staffPosition.ts'

function manualDriver(): { driver: FrameDriver; pump: () => void } {
  let callback: (() => void) | undefined
  const driver: FrameDriver = (cb) => {
    callback = cb
    return () => {
      callback = undefined
    }
  }
  return { driver, pump: () => callback?.() }
}

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

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('Level 3')
  })

  it('clamps an initialLevel above the max down to MAX_DRILL_LEVEL', () => {
    render(
      <FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} initialLevel={99} />,
    )

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('Level 7')
  })

  it('clamps an initialLevel below the min up to MIN_DRILL_LEVEL', () => {
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} initialLevel={0} />)

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('Level 1')
  })

  it('still defaults to Level 1 when initialLevel is omitted', () => {
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} />)

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('Level 1')
  })

  it('the learner can still change level after initialLevel seeds it', async () => {
    const user = userEvent.setup()
    render(<FlashcardScreen rng={seededRng(1)} midiInput={new FakeMidiInput()} initialLevel={3} />)

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('Level 3')

    await user.click(screen.getByRole('button', { name: 'Increase level' }))

    expect(screen.getByTestId('flashcard-level')).toHaveTextContent('Level 4')
  })
})

describe('FlashcardScreen — standalone metronome (roadmap 2.28a, REQ-3.9.1)', () => {
  it('renders a Metronome group whose Start button schedules clicks and advances the beat readout, and Stop stops it', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audioOutput = new RecordingAudioOutput(clock)
    const manual = manualDriver()

    render(
      <FlashcardScreen
        clock={clock}
        midiInput={new FakeMidiInput()}
        rng={seededRng(1)}
        audioOutput={audioOutput}
        frameDriver={manual.driver}
      />,
    )

    const group = screen.getByRole('group', { name: 'Metronome' })
    expect(within(group).getByTestId('flashcard-metronome-beat')).toHaveTextContent('—')
    expect(within(group).getByLabelText('Tempo (BPM)')).toBeInTheDocument()

    await user.click(within(group).getByRole('button', { name: 'Start' }))
    // Default 100 BPM = 600ms/beat: at 700ms, exactly one beat has elapsed —
    // `beat` is 0-based in core, so the readout's 1-based beat 2 pins both the
    // scheduling and the +1 display conversion (a dropped `+ 1` would read
    // "beat 1" here).
    act(() => {
      clock.advance(700)
      manual.pump()
    })

    expect(audioOutput.clicks.length).toBeGreaterThan(0)
    expect(within(group).getByTestId('flashcard-metronome-beat')).not.toHaveTextContent('—')
    expect(within(group).getByTestId('flashcard-metronome-beat')).toHaveTextContent('beat 2')

    const clicksBeforeStop = audioOutput.clicks.length
    await user.click(within(group).getByRole('button', { name: 'Stop' }))
    expect(within(group).getByRole('button', { name: 'Start' })).toBeInTheDocument()
    act(() => {
      clock.advance(700)
      manual.pump()
    })

    expect(audioOutput.clicks.length).toBe(clicksBeforeStop)
  })

  it('the Tempo field is wired to the metronome — changing it changes click spacing (roadmap 2.28a)', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audioOutput = new RecordingAudioOutput(clock)
    const manual = manualDriver()

    render(
      <FlashcardScreen
        clock={clock}
        midiInput={new FakeMidiInput()}
        rng={seededRng(1)}
        audioOutput={audioOutput}
        frameDriver={manual.driver}
      />,
    )

    const group = screen.getByRole('group', { name: 'Metronome' })
    const tempoInput = within(group).getByLabelText('Tempo (BPM)')
    await user.clear(tempoInput)
    await user.type(tempoInput, '240')
    await user.tab()
    expect(tempoInput).toHaveValue(240)

    await user.click(within(group).getByRole('button', { name: 'Start' }))
    // 240 BPM = 250ms/beat: over 1000ms that is 4 clicks, versus 1-2 at the
    // 100 BPM default — a no-op onChange (clicks.length stays at whatever the
    // default tempo would produce) fails this.
    act(() => {
      clock.advance(1000)
      manual.pump()
    })

    expect(audioOutput.clicks.length).toBeGreaterThanOrEqual(4)
  })
})
