/**
 * `RevealPanel` (roadmap 5.29, REQ-3.6.1/3.6.2) — the post-answer reveal.
 * `EarTrainingScreen.test.tsx` proves this is actually wired into the running
 * screen after a real answer; this file proves what the panel itself renders
 * for a hand-built `EarItem` of each kind, directly.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateIntervalItem } from '@core/eartraining/intervals.ts'
import { generateChordQualityItem, generateScaleModeItem } from '@core/eartraining/chords.ts'
import { generateMelodicDictation, generateRhythmicDictation } from '@core/eartraining/dictation.ts'
import { seededRng } from '@core/ports/rng.ts'
import { midiToName } from '@core/theory/pitch.ts'
import { RevealPanel } from './RevealPanel.tsx'

// OSMD cannot run in this test environment — see ScaleStaff.test.tsx's own
// note on why every screen test that engraves a real Score stubs this.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly id: string } }) => (
    <div data-testid="mock-score-viewer" data-score-id={score.id} />
  ),
}))

afterEach(cleanup)

describe('RevealPanel — interval kinds', () => {
  it('names the answer with its real sounding pitches, not just the interval name', () => {
    // Level 1, seed 0: pool[0] = M3, ascending, low = range.low (48 = C3).
    const item = generateIntervalItem(1, { harmonic: false }, seededRng(0))
    expect(item.answerKey).toBe('M3')
    const [low, high] = item.prompt.notes
    expect(low).toBeDefined()
    expect(high).toBeDefined()
    if (low === undefined || high === undefined) return

    render(<RevealPanel kind="interval-melodic" item={item} />)

    const naming = screen.getByTestId('reveal-answer-naming')
    // Not just "major third" — the ACTUAL pitches this draw sounded.
    expect(naming).toHaveTextContent('major third')
    expect(naming).toHaveTextContent(midiToName(low.midi))
    expect(naming).toHaveTextContent(midiToName(high.midi))
  })

  it('renders the answer engraved on a staff', () => {
    const item = generateIntervalItem(1, { harmonic: true }, seededRng(0))

    render(<RevealPanel kind="interval-harmonic" item={item} />)

    expect(screen.getByRole('img', { name: "The answer's pitches, on staff" })).toBeInTheDocument()
    const viewer = screen.getByTestId('mock-score-viewer')
    expect(viewer).toHaveAttribute('data-score-id', item.prompt.id)
  })

  it('renders the answer on a keyboard diagram, both pitch classes highlighted', () => {
    const item = generateIntervalItem(1, { harmonic: true }, seededRng(0))
    const [low, high] = item.prompt.notes
    if (low === undefined || high === undefined) throw new Error('expected two notes')

    render(<RevealPanel kind="interval-harmonic" item={item} />)

    const diagram = screen.getByTestId('keyboard-diagram')
    expect(diagram).toBeInTheDocument()
    expect(screen.getByTestId(`keyboard-key-${low.midi}`)).toHaveAttribute('data-highlighted', 'true')
    expect(screen.getByTestId(`keyboard-key-${high.midi}`)).toHaveAttribute('data-highlighted', 'true')
  })

  it('offers a reference-interval control that calls onPlayReference, and names a reference tune', async () => {
    const user = userEvent.setup()
    const item = generateIntervalItem(1, { harmonic: false }, seededRng(0)) // M3
    const onPlayReference = vi.fn()

    render(<RevealPanel kind="interval-melodic" item={item} onPlayReference={onPlayReference} />)

    const referenceSection = screen.getByTestId('reveal-reference-tune')
    expect(referenceSection).toHaveTextContent(/when the saints/i)
    await user.click(screen.getByRole('button', { name: 'Play reference interval' }))
    expect(onPlayReference).toHaveBeenCalledTimes(1)
  })

  it('renders no reference-interval control when onPlayReference is not supplied', () => {
    const item = generateIntervalItem(1, { harmonic: false }, seededRng(0))

    render(<RevealPanel kind="interval-melodic" item={item} />)

    expect(screen.queryByTestId('reveal-reference-tune')).toBeNull()
  })

  it('a melodic answer states its direction; a harmonic one does not', () => {
    const melodic = generateIntervalItem(1, { harmonic: false }, seededRng(0))
    const { unmount } = render(<RevealPanel kind="interval-melodic" item={melodic} />)
    expect(screen.getByTestId('reveal-answer-naming')).toHaveTextContent('ascending')
    unmount()

    const harmonic = generateIntervalItem(1, { harmonic: true }, seededRng(0))
    render(<RevealPanel kind="interval-harmonic" item={harmonic} />)
    expect(screen.getByTestId('reveal-answer-naming')).not.toHaveTextContent('ascending')
  })
})

describe('RevealPanel — chord/scale kinds', () => {
  it('names the humanized quality plus the actual chord tones', () => {
    const item = generateChordQualityItem(1, {}, seededRng(0))

    render(<RevealPanel kind="chord-quality" item={item} />)

    const naming = screen.getByTestId('reveal-answer-naming')
    for (const note of item.prompt.notes) {
      expect(naming).toHaveTextContent(midiToName(note.midi))
    }
  })

  it('does not render a reference-interval control for a chord item', () => {
    const item = generateChordQualityItem(1, {}, seededRng(0))

    render(<RevealPanel kind="chord-quality" item={item} onPlayReference={vi.fn()} />)

    expect(screen.queryByTestId('reveal-reference-tune')).toBeNull()
  })

  it('names the scale and its notes', () => {
    const item = generateScaleModeItem(1, {}, seededRng(0))

    render(<RevealPanel kind="scale-mode" item={item} />)

    const naming = screen.getByTestId('reveal-answer-naming')
    const first = item.prompt.notes[0]
    expect(first).toBeDefined()
    if (first !== undefined) expect(naming).toHaveTextContent(midiToName(first.midi))
  })
})

describe('RevealPanel — dictation kinds', () => {
  it('lists the melodic phrase\'s pitches in heard order', () => {
    const item = generateMelodicDictation(1, {}, seededRng(0))

    render(<RevealPanel kind="melodic-dictation" item={item} />)

    const naming = screen.getByTestId('reveal-answer-naming')
    const sorted = [...item.prompt.notes].sort((a, b) => a.startTick - b.startTick)
    for (const note of sorted) expect(naming).toHaveTextContent(midiToName(note.midi))
  })

  it('a rhythmic phrase names the onset count, not pitches (pitch never mattered)', () => {
    const item = generateRhythmicDictation(1, {}, seededRng(0))

    render(<RevealPanel kind="rhythmic-dictation" item={item} />)

    const naming = screen.getByTestId('reveal-answer-naming')
    expect(naming).toHaveTextContent(`${item.prompt.notes.length}`)
    expect(naming).toHaveTextContent(/timing/i)
  })
})
