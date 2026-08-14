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
import { midiToName } from '@core/theory/pitch.ts'
import { techniqueLibrary, techniqueScore } from '@core/technique/library.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTechniqueStore } from '@app/state/techniqueStore.ts'
import { POSTURE_PROMPT_RUNNING_MS } from './posturePromptSchedule.ts'
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
    // Roadmap UI-04b: the "No MIDI keyboard connected" status moved out of
    // this screen entirely, into the shell's topbar input-status chip —
    // proved in `InputCapabilityBanner.test.tsx`, not here.
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<TechniqueScreen connectMidi={neverResolves} />)

    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    // roadmap 5.5a: with no device, the on-screen fallback is on by default —
    // before this fix Technique had no `OnScreenKeyboard` at all.
    expect(screen.getByRole('group', { name: 'Play the score' })).toBeInTheDocument()
  })

  it('running a drill entirely through the on-screen keyboard adds a point to its tempo history (roadmap 5.5a)', async () => {
    const user = userEvent.setup()
    const clock = new FakeClock()
    const audioOutput = new RecordingAudioOutput(clock)
    const neverResolves = (): Promise<never> => new Promise(() => {})

    render(
      <TechniqueScreen
        clock={clock}
        date={clock}
        connectMidi={neverResolves}
        audioOutput={audioOutput}
        frameDriver={manualDriver()}
      />,
    )

    const drill = techniqueLibrary(1)[0]
    if (drill === undefined) throw new Error('expected at least one level-1 drill')

    clock.advance(5_000)
    await user.click(screen.getByRole('button', { name: 'Start' }))

    const score = techniqueScore(drill, drill.targetBpm)
    const msPerBeat = 60000 / drill.targetBpm
    clock.advance(4 * msPerBeat)
    for (const note of score.notes) {
      const key = screen.getByRole('button', { name: midiToName(note.midi) })
      await user.pointer({ target: key, keys: '[MouseLeft>]' })
      await user.pointer({ target: key, keys: '[/MouseLeft]' })
      clock.advance(msPerBeat)
    }

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(screen.getByTestId('technique-result')).toHaveTextContent('Clean')
    expect(screen.getByTestId('technique-history').children).toHaveLength(1)
  })

  it('hands the engraving a fingering-carrying score and drops the old interleaved string (roadmap 5.22, REQ-3.7.1)', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<TechniqueScreen connectMidi={neverResolves} />)

    const drill = techniqueLibrary(1)[0]
    if (drill === undefined) throw new Error('expected at least one level-1 drill')
    const score = techniqueScore(drill, drill.targetBpm)
    expect(score.notes.some((n) => n.fingering !== undefined)).toBe(true)

    // OSMD is mocked out in this environment (see the module comment above) —
    // proving it receives the same, fingering-carrying score is this test's
    // job; `musicxmlwriter.test.ts` proves `<fingering>` reaches the XML, and
    // e2e proves OSMD actually draws it above/below the notehead.
    expect(screen.getByTestId('mock-score-viewer')).toHaveAttribute('data-score-id', score.id)
    expect(screen.queryByTestId('technique-fingering')).not.toBeInTheDocument()
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

  it('always states what MIDI cannot see, whether or not a run has ever happened (REQ-5.23)', () => {
    const neverResolves = (): Promise<never> => new Promise(() => {})
    render(<TechniqueScreen connectMidi={neverResolves} />)

    const statement = screen.getByTestId('technique-safety-statement')
    // Names the specific blind spots, not a vague disclaimer — each is
    // independently assertable so this can't be satisfied by a generic
    // "consult a teacher" sentence.
    for (const term of [
      'wrist',
      'forearm',
      'finger curl',
      'which finger',
      'shoulder tension',
      'bench height',
    ]) {
      expect(statement).toHaveTextContent(new RegExp(term, 'i'))
    }
    // Not behind a disclosure: it renders with no click/toggle needed.
    expect(screen.queryByRole('button', { name: /what.*miss|learn more|show/i })).not.toBeInTheDocument()
  })

  it('has no posture prompt at the start of a session, then shows one once the schedule (driven by the injected Clock) says a check is due, and clears on acknowledgement (REQ-5.23)', async () => {
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

    expect(screen.queryByTestId('technique-posture-prompt')).not.toBeInTheDocument()

    // Cross the running-time threshold without ever playing a note — the
    // schedule fires purely from FakeClock advances, never real wall time.
    await user.click(screen.getByRole('button', { name: 'Start' }))
    act(() => clock.advance(POSTURE_PROMPT_RUNNING_MS))
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(screen.getByTestId('technique-posture-prompt')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'I checked' }))
    expect(screen.queryByTestId('technique-posture-prompt')).not.toBeInTheDocument()
  })
})
