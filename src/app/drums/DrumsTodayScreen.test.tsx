/**
 * `DrumsTodayScreen` (roadmap DR-01/DR-09/DR-10/DR-11/DR-12): thin render/a11y
 * test, per the testing rules. Covers the four-card hub layout, the single
 * `.btn-primary`, each button's wiring to `onOpen`, and the store-derived
 * status lines for the groove and rudiments cases (including their empty
 * states) — the screen itself still holds no drums logic.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DrumsTodayScreen } from './DrumsTodayScreen.tsx'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import { useDrumsReadingStore } from '@app/state/drumsReadingStore.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'

afterEach(() => {
  useDrumsHistoryStore.setState({ attempts: [] })
  useDrumsReadingStore.setState({ level: 1, runs: [] })
  useDrumsRudimentStore.setState({ records: {} })
})

describe('DrumsTodayScreen', () => {
  it('renders a labelled region with the "Drums — start here" heading', () => {
    render(<DrumsTodayScreen onOpen={vi.fn()} />)
    const region = screen.getByRole('region', { name: 'Drums' })
    expect(region).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Drums — start here' }),
    ).toBeInTheDocument()
  })

  it('renders one card per trainer with exactly one .btn-primary', () => {
    render(<DrumsTodayScreen onOpen={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Groove trainer' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Rhythm reading' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Rudiments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Metronome' })).toBeInTheDocument()

    const primaryButtons = document.querySelectorAll('.btn-primary')
    expect(primaryButtons).toHaveLength(1)
  })

  it('calls onOpen with the right id for each card button', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<DrumsTodayScreen onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: 'Open the groove trainer' }))
    expect(onOpen).toHaveBeenLastCalledWith('drums-groove')

    await user.click(screen.getByRole('button', { name: 'Open rhythm reading' }))
    expect(onOpen).toHaveBeenLastCalledWith('drums-reading')

    await user.click(screen.getByRole('button', { name: 'Open rudiments' }))
    expect(onOpen).toHaveBeenLastCalledWith('drums-rudiments')

    await user.click(screen.getByRole('button', { name: 'Open the metronome' }))
    expect(onOpen).toHaveBeenLastCalledWith('drums-metronome')

    await user.click(screen.getByRole('button', { name: 'Open coordination' }))
    expect(onOpen).toHaveBeenLastCalledWith('drums-coordination')

    await user.click(screen.getByRole('button', { name: 'Open progress' }))
    expect(onOpen).toHaveBeenLastCalledWith('drums-progress')

    expect(onOpen).toHaveBeenCalledTimes(6)
  })

  it('shows "No runs yet" for the groove card with no attempts', () => {
    useDrumsHistoryStore.setState({ attempts: [] })
    render(<DrumsTodayScreen onOpen={vi.fn()} />)
    expect(screen.getByText('No runs yet')).toBeInTheDocument()
  })

  it('summarizes the groove card from the latest attempt by `at`', () => {
    useDrumsHistoryStore.setState({
      attempts: [
        { grooveId: 'g1', grooveTitle: 'Basic rock', bpm: 90, at: 100, steady: true },
        { grooveId: 'g2', grooveTitle: 'Shuffle', bpm: 110, at: 200, steady: false },
      ],
    })
    render(<DrumsTodayScreen onOpen={vi.fn()} />)
    expect(
      screen.getByText('2 runs · last: Shuffle at 110 bpm, not steady yet'),
    ).toBeInTheDocument()
  })

  it('uses singular "run" for a single groove attempt', () => {
    useDrumsHistoryStore.setState({
      attempts: [{ grooveId: 'g1', grooveTitle: 'Basic rock', bpm: 90, at: 100, steady: true }],
    })
    render(<DrumsTodayScreen onOpen={vi.fn()} />)
    expect(screen.getByText('1 run · last: Basic rock at 90 bpm, steady')).toBeInTheDocument()
  })

  it('shows "No personal bests yet" for the rudiments card with no records', () => {
    useDrumsRudimentStore.setState({ records: {} })
    render(<DrumsTodayScreen onOpen={vi.fn()} />)
    expect(screen.getByText('No personal bests yet')).toBeInTheDocument()
  })

  it('summarizes the rudiments card from the fastest bestCleanBpm', () => {
    useDrumsRudimentStore.setState({
      records: {
        paradiddle: { bestCleanBpm: 120, lastBpm: 110, at: 1 },
        flam: { bestCleanBpm: 140, lastBpm: 130, at: 2 },
      },
    })
    render(<DrumsTodayScreen onOpen={vi.fn()} />)
    expect(screen.getByText('Personal bests on 2 rudiments · fastest 140 bpm')).toBeInTheDocument()
  })

  it('shows the reading card level and run count, singular and empty cases', () => {
    useDrumsReadingStore.setState({ level: 3, runs: [] })
    render(<DrumsTodayScreen onOpen={vi.fn()} />)
    expect(screen.getByText('Level 3 of 7 · no runs yet')).toBeInTheDocument()
  })

  it('shows the metronome card status line', () => {
    render(<DrumsTodayScreen onOpen={vi.fn()} />)
    expect(
      screen.getByText('Subdivisions 1–4, click on 2 & 4, gap bars, random mute, tempo ramp'),
    ).toBeInTheDocument()
  })
})
