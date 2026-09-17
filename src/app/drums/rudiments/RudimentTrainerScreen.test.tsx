/**
 * `RudimentTrainerScreen` — thin, per the testing rules: what is asserted
 * here is wiring and accessible names (the library's 40 rows across 4 tiers,
 * Practise switching the trainer, the Ladder status reading back
 * `ladderText`), not grading (`rudimentRun.test.ts`) and not ladder timing
 * (`useRudimentTrainer.test.ts`).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import { FakeClock } from '@test/fakes.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import { RudimentTrainerScreen } from './RudimentTrainerScreen.tsx'

function fakeDrumAudio(clock: FakeClock): DrumAudioOutput {
  return {
    strike: () => {},
    click: () => {},
    allNotesOff: () => {},
    setVolume: () => {},
    now: () => clock.now(),
  }
}

function setup() {
  const clock = new FakeClock()
  const audio = fakeDrumAudio(clock)
  const frameDriver: FrameDriver = () => () => {}
  const user = userEvent.setup()
  render(<RudimentTrainerScreen clock={clock} audio={() => audio} frameDriver={frameDriver} />)
  return { user }
}

beforeEach(() => {
  useDrumsRudimentStore.setState({ records: {} })
})

describe('RudimentTrainerScreen', () => {
  it('opens on the Single Stroke Roll, ready to start', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Rudiments' })).toBeInTheDocument()
    expect(screen.getByText('Single Stroke Roll', { selector: '.rudiment-title' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Ladder' })).toHaveTextContent(/at 60 bpm/)
    expect(screen.getByRole('status', { name: 'Run state' })).toHaveTextContent('Ready when you are')
  })

  it('lists all 40 rudiments across the four Wooton tiers', () => {
    setup()
    for (const tier of [1, 2, 3, 4]) {
      expect(screen.getByRole('region', { name: `Tier ${tier}` })).toBeInTheDocument()
    }
    const practiseButtons = screen.getAllByRole('button', { name: /^Practise /i })
    expect(practiseButtons).toHaveLength(40)
  })

  it('Practise switches the trainer to the chosen rudiment', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Practise Single Paradiddle' }))

    expect(screen.getByText('Single Paradiddle', { selector: '.rudiment-title' })).toBeInTheDocument()
    // Single Paradiddle shares tier 1's 60 bpm start with Single Stroke Roll.
    expect(screen.getByRole('status', { name: 'Ladder' })).toHaveTextContent(/at 60 bpm/)
  })

  it('shows the honesty line only for rudiments with a graded-onset-only articulation', async () => {
    const { user } = setup()
    expect(screen.queryByText(/Graded on onset timing only/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Practise Flam' }))
    expect(screen.getByText(/Graded on onset timing only/)).toBeInTheDocument()
  })

  it('shows the personal record on a library row once the store has one', () => {
    useDrumsRudimentStore.setState({
      records: { 'single-stroke-roll': { bestCleanBpm: 92, lastBpm: 90, at: 1 } },
    })
    setup()
    const row = screen.getByRole('button', { name: 'Practise Single Stroke Roll' })
    expect(within(row).getByText('PR 92 bpm')).toBeInTheDocument()
  })

  it('the Ladder mode toggle exposes a radiogroup with Up selected by default', () => {
    setup()
    const group = screen.getByRole('radiogroup', { name: 'Ladder mode' })
    expect(within(group).getByRole('radio', { name: 'Up' })).toHaveAttribute('aria-checked', 'true')
    expect(within(group).getByRole('radio', { name: 'Up then down' })).toHaveAttribute('aria-checked', 'false')
  })
})
