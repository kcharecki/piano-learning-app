/**
 * `RecordPanel` (roadmap 2.14, REQ-3.9.2): thin per house style (render, wire,
 * roles) — the actual MIDI recording/replay behaviour is `useRecorder`'s,
 * already covered in `useRecorder.test.ts`. The audio half (roadmap B.5) is
 * `useAudioRecording`'s, covered in the same file — this only checks that
 * `RecordPanel` wires its buttons to it in the right order and renders the
 * states `useAudioRecording` reports (checkbox, error, summary row, delete).
 * Every test here that mounts `RecordPanel` picks up `useAudioRecording`'s
 * REAL default `openStore` (`createIdbStore`) — there is no IndexedDB in this
 * project's `ui` (happy-dom) test environment, so that open always fails and
 * is swallowed (see `useAudioRecording`'s module comment); `audio.store`
 * simply never resolves, which is exactly the "no IndexedDB" case and is
 * itself a useful thing to exercise without special-casing it away.
 */
import type { AudioPlayback, AudioRecorder } from '@adapters/audio/audioRecorder.ts'
import { putRecordingAudio } from '@adapters/store/idb.ts'
import type { Recording } from '@core/practice/recorder.ts'
import { err, ok, type Result } from '@core/shared/result.ts'
import { midi, millis } from '@core/shared/units.ts'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryStore } from '@test/fakes.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordPanel, type RecordPanelProps } from './RecordPanel.tsx'

afterEach(cleanup)

class FakeAudioRecorder implements AudioRecorder {
  mimeType = 'audio/webm'
  state: 'inactive' | 'recording' = 'inactive'
  start(): void {
    this.state = 'recording'
  }
  stop(): Promise<Blob> {
    this.state = 'inactive'
    return Promise.resolve(new Blob(['x'], { type: this.mimeType }))
  }
  dispose(): void {}
}

class FakeAudioPlayback implements AudioPlayback {
  playCalls: number[] = []
  play(fromSeconds = 0): void {
    this.playCalls.push(fromSeconds)
  }
  stop(): void {}
  dispose(): void {}
}

const RECORDING: Recording = {
  id: 'rec-1',
  recordedAt: Date.UTC(2026, 0, 1, 12, 0, 0),
  durationMs: 2500,
  events: [
    { type: 'noteOn', note: midi(60), velocity: 80, time: millis(0) },
    { type: 'noteOff', note: midi(60), time: millis(400) },
  ],
}

function makeProps(overrides: Partial<RecordPanelProps> = {}): RecordPanelProps {
  return {
    phase: 'idle',
    recording: undefined,
    canRecord: true,
    onStartRecording: vi.fn(),
    onStopRecording: vi.fn(),
    onStartReplay: vi.fn(),
    onStopReplay: vi.fn(),
    ...overrides,
  }
}

describe('RecordPanel', () => {
  // Roadmap UI-10 (2026-08-12 UI audit): the four-button row (Record, Stop
  // recording, Replay, Stop replay) collapsed to two toggles — Record/Stop
  // share one button, Replay/Stop replay share another, which is absent
  // entirely (not disabled) with no take to replay yet.
  it('is a landmark exposing a Record toggle, enabled while idle and connected, with no Replay toggle yet', () => {
    render(<RecordPanel {...makeProps()} />)

    const group = screen.getByRole('group', { name: 'Record and replay' })
    expect(within(group).getByRole('button', { name: 'Record' })).toBeEnabled()
    expect(within(group).queryByRole('button', { name: /replay/i })).not.toBeInTheDocument()
  })

  it('disables Record when no MIDI keyboard is connected', () => {
    render(<RecordPanel {...makeProps({ canRecord: false })} />)

    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled()
  })

  it('clicking Record calls onStartRecording', async () => {
    const user = userEvent.setup()
    const onStartRecording = vi.fn()
    render(<RecordPanel {...makeProps({ onStartRecording })} />)

    await user.click(screen.getByRole('button', { name: 'Record' }))

    expect(onStartRecording).toHaveBeenCalledTimes(1)
  })

  it('while recording: the toggle reads Stop recording and is enabled, no Replay toggle is offered, and a status announces it', async () => {
    const user = userEvent.setup()
    const onStopRecording = vi.fn()
    render(<RecordPanel {...makeProps({ phase: 'recording', recording: RECORDING, onStopRecording })} />)

    // Even with a prior take on hand, replaying while a NEW one is being
    // captured is impossible — the toggle is absent, not disabled.
    expect(screen.queryByRole('button', { name: /replay/i })).not.toBeInTheDocument()
    const stopButton = screen.getByRole('button', { name: 'Stop recording' })
    expect(stopButton).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(/recording/i)

    await user.click(stopButton)
    expect(onStopRecording).toHaveBeenCalledTimes(1)
  })

  it('the Replay toggle is absent with no take yet, and appears once one exists', () => {
    const { rerender } = render(<RecordPanel {...makeProps({ recording: undefined })} />)
    expect(screen.queryByRole('button', { name: 'Replay' })).not.toBeInTheDocument()

    rerender(<RecordPanel {...makeProps({ recording: RECORDING })} />)
    expect(screen.getByRole('button', { name: 'Replay' })).toBeEnabled()
  })

  it('clicking Replay calls onStartReplay', async () => {
    const user = userEvent.setup()
    const onStartReplay = vi.fn()
    render(<RecordPanel {...makeProps({ recording: RECORDING, onStartReplay })} />)

    await user.click(screen.getByRole('button', { name: 'Replay' }))

    expect(onStartReplay).toHaveBeenCalledTimes(1)
  })

  it('while replaying: the toggle reads Stop replay and is enabled, Record is disabled, and a status announces it', async () => {
    const user = userEvent.setup()
    const onStopReplay = vi.fn()
    render(<RecordPanel {...makeProps({ phase: 'replaying', recording: RECORDING, onStopReplay })} />)

    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled()
    const stopButton = screen.getByRole('button', { name: 'Stop replay' })
    expect(stopButton).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(/replaying/i)

    await user.click(stopButton)
    expect(onStopReplay).toHaveBeenCalledTimes(1)
  })

  // Acceptance criterion 4 (roadmap UI-10): the Record toggle drives the
  // whole record -> stop -> replay -> stop replay cycle end to end. This is a
  // presentational component driven entirely by `phase`/`recording` props, so
  // the test re-renders with the next real-world state after each click —
  // exactly what `useRecorder` would hand it in the running app.
  it('drives record -> stop -> replay -> stop replay end to end through the same two toggles', async () => {
    const user = userEvent.setup()
    const onStartRecording = vi.fn()
    const onStopRecording = vi.fn()
    const onStartReplay = vi.fn()
    const onStopReplay = vi.fn()
    const { rerender } = render(
      <RecordPanel
        {...makeProps({ onStartRecording, onStopRecording, onStartReplay, onStopReplay })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Record' }))
    expect(onStartRecording).toHaveBeenCalledTimes(1)
    rerender(
      <RecordPanel
        {...makeProps({
          phase: 'recording',
          onStartRecording,
          onStopRecording,
          onStartReplay,
          onStopReplay,
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(onStopRecording).toHaveBeenCalledTimes(1)
    rerender(
      <RecordPanel
        {...makeProps({
          phase: 'idle',
          recording: RECORDING,
          onStartRecording,
          onStopRecording,
          onStartReplay,
          onStopReplay,
        })}
      />,
    )

    const replayButton = screen.getByRole('button', { name: 'Replay' })
    await user.click(replayButton)
    expect(onStartReplay).toHaveBeenCalledTimes(1)
    rerender(
      <RecordPanel
        {...makeProps({
          phase: 'replaying',
          recording: RECORDING,
          onStartRecording,
          onStopRecording,
          onStartReplay,
          onStopReplay,
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Stop replay' }))
    expect(onStopReplay).toHaveBeenCalledTimes(1)
  })

  it('summarises the last recording once one exists', () => {
    render(<RecordPanel {...makeProps({ recording: RECORDING })} />)

    expect(screen.getByTestId('record-duration')).toHaveTextContent('2.5s')
    expect(screen.getByTestId('record-event-count')).toHaveTextContent('2')
    expect(screen.getByTestId('record-recorded-at')).not.toBeEmptyDOMElement()
  })

  it('shows no summary before any recording has been made', () => {
    render(<RecordPanel {...makeProps()} />)

    expect(screen.queryByTestId('record-duration')).not.toBeInTheDocument()
  })
})

describe('RecordPanel — audio (roadmap B.5)', () => {
  it('shows an unchecked "Record audio too" checkbox by default, enabled while idle', () => {
    render(<RecordPanel {...makeProps()} />)

    const toggle = screen.getByRole('checkbox', { name: /record audio too/i })
    expect(toggle).not.toBeChecked()
    expect(toggle).toBeEnabled()
  })

  it('disables the audio toggle whenever phase is not idle', () => {
    render(<RecordPanel {...makeProps({ phase: 'recording', recording: RECORDING })} />)

    expect(screen.getByRole('checkbox', { name: /record audio too/i })).toBeDisabled()
  })

  it('checking the toggle requests the microphone and becomes checked once granted', async () => {
    const user = userEvent.setup()
    const fakeRecorder = new FakeAudioRecorder()
    const createRecorder = vi.fn<() => Promise<Result<AudioRecorder, string>>>(() =>
      Promise.resolve(ok(fakeRecorder)),
    )
    render(
      <RecordPanel
        {...makeProps({ audioTestSeams: { createRecorder, openStore: () => Promise.resolve(new MemoryStore()) } })}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: /record audio too/i }))

    expect(createRecorder).toHaveBeenCalledTimes(1)
    await screen.findByRole('checkbox', { name: /record audio too/i, checked: true } as never)
  })

  it('a failed microphone request surfaces an error alert without crashing the panel', async () => {
    const user = userEvent.setup()
    const createRecorder = vi.fn<() => Promise<Result<AudioRecorder, string>>>(() =>
      Promise.resolve(err('Microphone access failed: Permission denied')),
    )
    render(
      <RecordPanel
        {...makeProps({ audioTestSeams: { createRecorder, openStore: () => Promise.resolve(new MemoryStore()) } })}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: /record audio too/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i)
    // The rest of the panel is still usable — this is additive, not fatal.
    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled()
  })

  it('clicking Record starts audio capture before the MIDI side, and Stop recording stops it', async () => {
    const user = userEvent.setup()
    const fakeRecorder = new FakeAudioRecorder()
    const calls: string[] = []
    const createRecorder = vi.fn<() => Promise<Result<AudioRecorder, string>>>(() => {
      fakeRecorder.start = () => {
        calls.push('audio-start')
        fakeRecorder.state = 'recording'
      }
      return Promise.resolve(ok(fakeRecorder))
    })
    const onStartRecording = vi.fn(() => calls.push('midi-start'))
    const onStopRecording = vi.fn(() => calls.push('midi-stop'))

    render(
      <RecordPanel
        {...makeProps({
          onStartRecording,
          onStopRecording,
          audioTestSeams: { createRecorder, openStore: () => Promise.resolve(new MemoryStore()) },
        })}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: /record audio too/i }))
    await screen.findByRole('checkbox', { name: /record audio too/i, checked: true } as never)

    await user.click(screen.getByRole('button', { name: 'Record' }))
    expect(calls).toEqual(['audio-start', 'midi-start'])
  })

  it('renders a stored recording\'s audio summary with a working Delete audio control', async () => {
    const user = userEvent.setup()
    const store = new MemoryStore()
    await putRecordingAudio(store, {
      recordingId: RECORDING.id,
      blob: new Blob(['x'], { type: 'audio/webm;codecs=opus' }),
      mimeType: 'audio/webm;codecs=opus',
      offsetMs: 0,
    })

    render(
      <RecordPanel
        {...makeProps({ recording: RECORDING, audioTestSeams: { openStore: () => Promise.resolve(store) } })}
      />,
    )

    const summary = await screen.findByTestId('record-audio-summary')
    expect(summary).toHaveTextContent(/webm/i)

    await user.click(within(summary).getByRole('button', { name: 'Delete audio' }))

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByTestId('record-audio-summary')).not.toBeInTheDocument()
  })

  it('replaying a recording with stored audio starts playback', async () => {
    const store = new MemoryStore()
    await putRecordingAudio(store, {
      recordingId: RECORDING.id,
      blob: new Blob(['x'], { type: 'audio/webm' }),
      mimeType: 'audio/webm',
      offsetMs: 0,
    })
    const playback = new FakeAudioPlayback()

    render(
      <RecordPanel
        {...makeProps({
          recording: RECORDING,
          audioTestSeams: {
            openStore: () => Promise.resolve(store),
            createPlayback: () => playback,
          },
        })}
      />,
    )
    await screen.findByTestId('record-audio-summary')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Replay' }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(playback.playCalls).toEqual([0])
  })
})
