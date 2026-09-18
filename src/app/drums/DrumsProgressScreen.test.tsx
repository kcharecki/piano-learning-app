/**
 * `DrumsProgressScreen` (roadmap DR-23): thin render/wiring test, per the
 * testing rules — one assertion per panel's populated line and its empty
 * state, seeding the three stores directly the same way
 * `DrumsTodayScreen.test.tsx` does. Aggregation itself (tier math, best
 * steady bpm, weighted limb bias) is proved in
 * `@core/drums/progress`'s own tests; formatting is proved in
 * `progressText.test.ts`. This file only proves the screen reads the right
 * stores and renders each panel/empty-state in the right place.
 */
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DrumsProgressScreen } from './DrumsProgressScreen.tsx'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import { useDrumsReadingStore } from '@app/state/drumsReadingStore.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import { RUDIMENTS } from '@content/drums/rudiments.ts'

afterEach(() => {
  useDrumsHistoryStore.setState({ attempts: [] })
  useDrumsReadingStore.setState({ level: 1, runs: [] })
  useDrumsRudimentStore.setState({ records: {} })
})

describe('DrumsProgressScreen', () => {
  it('renders the "Progress" heading and six labelled panels', () => {
    render(<DrumsProgressScreen />)
    expect(screen.getByRole('heading', { level: 1, name: 'Progress' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Rudiments' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Grooves' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Limb bias' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Trends' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Coverage' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Reading' })).toBeInTheDocument()
  })

  it('shows one tierLine row per rudiment tier, reflecting the rudiment store', () => {
    const firstTier1 = RUDIMENTS.find((r) => r.tier === 1)
    expect(firstTier1).toBeDefined()
    useDrumsRudimentStore.setState({
      records: {
        [firstTier1!.id]: { bestCleanBpm: firstTier1!.bpmBand.target, lastBpm: 90, at: 1 },
      },
    })
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Rudiments' })
    expect(within(panel).getByText(/^Tier 1: 1 of \d+ at target, 1 started$/)).toBeInTheDocument()
  })

  it('shows the groove empty state with no attempts', () => {
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Grooves' })
    expect(within(panel).getByText('No groove runs yet — start one in Groove.')).toBeInTheDocument()
  })

  it('shows a bestLine row per groove, excluding an unsteady attempt from the best', () => {
    useDrumsHistoryStore.setState({
      attempts: [
        { grooveId: 'money-beat', grooveTitle: 'Money Beat', bpm: 120, at: 3, steady: false },
        { grooveId: 'money-beat', grooveTitle: 'Money Beat', bpm: 100, at: 2, steady: true },
        { grooveId: 'money-beat', grooveTitle: 'Money Beat', bpm: 90, at: 1, steady: true },
      ],
    })
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Grooves' })
    expect(
      within(panel).getByText('Money Beat — best steady 100 bpm (3 attempts)'),
    ).toBeInTheDocument()
  })

  it('shows the limb bias empty state with no attempts', () => {
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Limb bias' })
    expect(
      within(panel).getByText('Play a few groove runs to see which limb drifts.'),
    ).toBeInTheDocument()
  })

  it('shows a biasLine row per pad from the most recent attempts', () => {
    useDrumsHistoryStore.setState({
      attempts: [
        {
          grooveId: 'money-beat',
          grooveTitle: 'Money Beat',
          bpm: 100,
          at: 1,
          steady: true,
          pads: [
            { pad: 'kick', expected: 8, matched: 8, meanOffsetMs: 15 },
            { pad: 'snare', expected: 4, matched: 4, meanOffsetMs: -6 },
          ],
        },
      ],
    })
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Limb bias' })
    expect(within(panel).getByText('Kick: 15 ms late (8 hits)')).toBeInTheDocument()
    expect(within(panel).getByText('Snare: 6 ms early (4 hits)')).toBeInTheDocument()
  })

  it('shows the trends empty state with no attempts', () => {
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Trends' })
    expect(
      within(panel).getByText('Play a few runs of one groove to see whether it is tightening.'),
    ).toBeInTheDocument()
  })

  it('shows a trendLine row per groove from the most recent attempts', () => {
    useDrumsHistoryStore.setState({
      attempts: [
        // Newest first: the learner tightened 30 -> 25 -> 20 -> 10 ms.
        {
          grooveId: 'money-beat',
          grooveTitle: 'Money Beat',
          bpm: 100,
          at: 4,
          steady: true,
          pads: [{ pad: 'kick', expected: 8, matched: 8, meanOffsetMs: 10 }],
        },
        {
          grooveId: 'money-beat',
          grooveTitle: 'Money Beat',
          bpm: 100,
          at: 3,
          steady: true,
          pads: [{ pad: 'kick', expected: 8, matched: 8, meanOffsetMs: 20 }],
        },
        {
          grooveId: 'money-beat',
          grooveTitle: 'Money Beat',
          bpm: 100,
          at: 2,
          steady: true,
          pads: [{ pad: 'kick', expected: 8, matched: 8, meanOffsetMs: 25 }],
        },
        {
          grooveId: 'money-beat',
          grooveTitle: 'Money Beat',
          bpm: 100,
          at: 1,
          steady: false,
          pads: [{ pad: 'kick', expected: 8, matched: 8, meanOffsetMs: 30 }],
        },
      ],
    })
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Trends' })
    expect(
      within(panel).getByText('Money Beat — worst limb 30, 25, 20, 10 ms · tightening · steady 3 of 4'),
    ).toBeInTheDocument()
  })

  it('shows the coverage panel with everything unplayed/unstarted when the stores are empty', () => {
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Coverage' })
    expect(
      within(panel).getByLabelText('Groove coverage'),
    ).toHaveTextContent(
      'Grooves: 0 of 3 played, 0 steady. Not yet played: Quarter-Note Rock, Money Beat, Money Beat (Open Hat).',
    )
    expect(within(panel).getByLabelText('Rudiment coverage')).toHaveTextContent(/^Rudiments: 0 of \d+ started\. Next up: /)
  })

  it('shows the coverage panel reflecting played/steady grooves and started rudiments', () => {
    useDrumsHistoryStore.setState({
      attempts: [
        { grooveId: 'money-beat', grooveTitle: 'Money Beat', bpm: 100, at: 2, steady: true },
        { grooveId: 'money-beat', grooveTitle: 'Money Beat', bpm: 90, at: 1, steady: false },
      ],
    })
    useDrumsRudimentStore.setState({
      records: {
        'single-stroke-roll': { bestCleanBpm: 100, lastBpm: 100, at: 1 },
        'multiple-bounce-roll': { bestCleanBpm: 80, lastBpm: 80, at: 1 },
      },
    })
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Coverage' })
    expect(within(panel).getByLabelText('Groove coverage')).toHaveTextContent(
      'Grooves: 1 of 3 played, 1 steady. Not yet played: Quarter-Note Rock, Money Beat (Open Hat).',
    )
    expect(within(panel).getByLabelText('Rudiment coverage')).toHaveTextContent(
      /^Rudiments: 2 of \d+ started\. Next up: /,
    )
    expect(within(panel).getByLabelText('Rudiment coverage')).not.toHaveTextContent(/Single Stroke Roll/)
    expect(within(panel).getByLabelText('Rudiment coverage')).not.toHaveTextContent(/Multiple Bounce Roll/)
  })

  it('shows the reading empty state at level 1 with no runs', () => {
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Reading' })
    expect(within(panel).getByText('Level 1 — no runs yet')).toBeInTheDocument()
  })

  it('shows the reading level and its most recent runs', () => {
    useDrumsReadingStore.setState({
      level: 3,
      runs: [
        // Newest first, as `addRun` stores them: the learner climbed 80 → 90 → 100.
        { level: 3, accuracy: 1 },
        { level: 3, accuracy: 0.9 },
        { level: 3, accuracy: 0.8 },
      ],
    })
    render(<DrumsProgressScreen />)
    const panel = screen.getByRole('region', { name: 'Reading' })
    expect(within(panel).getByText('Level 3 — last runs 80%, 90%, 100%')).toBeInTheDocument()
  })
})
