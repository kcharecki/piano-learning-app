/**
 * Screen-level composition (roadmap 4.4a): the picker, the hook and the
 * engraved score are wired together, the screen is usable with no MIDI
 * keyboard connected, and driving a full run through the real DOM adds a
 * point to the drill's tempo history (REQ-3.7.3) — the proof that this
 * screen is not just rendering and doing nothing.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeClock, FakeMidiInput, RecordingAudioOutput } from '@test/fakes.ts'
import { millis } from '@core/shared/units.ts'
import { techniqueLibrary, techniqueScore } from '@core/technique/library.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { TechniqueScreen } from './TechniqueScreen.tsx'

// OSMD cannot run in this test environment (no canvas to measure text) — the
// same mock every other screen test that engraves a real Score uses (see
// SightReadingScreen.test.tsx/PracticeScreen.test.tsx). What belongs to this
// file is that the screen HANDS a real Score to the viewer; that OSMD then
// draws it is e2e's job.
vi.mock('@app/score/ScoreViewer.tsx', () => ({
  ScoreViewer: ({ score }: { readonly score: { readonly id: string } }) => (
    <div data-testid="mock-score-viewer" data-score-id={score.id} />
  ),
}))

function manualDriver(): FrameDriver {
  return () => () => {}
}

function resetStore(): void {
  useTechniqueStore.setState({ attempts: [] })
}

afterEach(() => {
  cleanup()
  resetStore()
})

describe('TechniqueScreen', () => {
  it('is fully usable with no MIDI keyboard connected — REQ-4.1', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<TechniqueScreen connectMidi={neverResolves} />)

    expect(screen.getByText(/no MIDI keyboard connected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
  })

  it('surfaces every engraved note\'s recommended fingering to the learner (REQ-3.7.1)', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<TechniqueScreen connectMidi={neverResolves} />)

    const drill = techniqueLibrary(1)[0]
    if (drill === undefined) throw new Error('expected at least one level-1 drill')
    const score = techniqueScore(drill, drill.targetBpm)
    const expectedFingerings = score.notes
      .filter((n) => n.fingering !== undefined)
      .map((n) => n.fingering)

    expect(expectedFingerings.length).toBeGreaterThan(0)
    const fingeringText = screen.getByTestId('technique-fingering').textContent ?? ''
    for (const finger of expectedFingerings) {
      expect(fingeringText).toContain(String(finger))
    }
  })

  it('running a drill end to end adds a point to its tempo history (REQ-3.7.3)', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const midiInput = new FakeMidiInput()
    const audioOutput = new RecordingAudioOutput(clock)

    render(
      <TechniqueScreen
        clock={clock}
        date={clock}
        midiInput={midiInput}
        audioOutput={audioOutput}
        frameDriver={manualDriver()}
      />,
    )

    // The screen's own default selection: level 1's first drill.
    const drill = techniqueLibrary(1)[0]
    if (drill === undefined) throw new Error('expected at least one level-1 drill')

    // Advance past 0 first — production onset timestamps are never 0-based
    // (`performance.now()` values of order 1e5+ ms), and the hook anchors its
    // run at `clock.now()` plus a one-bar count-in.
    clock.advance(5_000)
    await user.click(screen.getByRole('button', { name: 'Start' }))

    const score = techniqueScore(drill, drill.targetBpm)
    const msPerBeat = 60000 / drill.targetBpm
    const countInMs = 4 * msPerBeat
    for (const [i, note] of score.notes.entries()) {
      act(() =>
        midiInput.emit({
          type: 'noteOn',
          note: note.midi,
          velocity: 80,
          time: millis(5_000 + countInMs + i * msPerBeat),
        }),
      )
    }

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(screen.getByTestId('technique-result')).toHaveTextContent('Clean')
    expect(screen.getByTestId('technique-history').children).toHaveLength(1)
    expect(screen.getByTestId('technique-best-bpm')).toHaveTextContent(String(drill.targetBpm))
  })
})
