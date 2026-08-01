/**
 * `RecordPanel` (roadmap 2.14, REQ-3.9.2): thin per house style (render, wire,
 * roles) — the actual recording/replay behaviour is `useRecorder`'s, already
 * covered in `useRecorder.test.ts`.
 */
import type { Recording } from '@core/practice/recorder.ts'
import { midi, millis } from '@core/shared/units.ts'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordPanel, type RecordPanelProps } from './RecordPanel.tsx'

afterEach(cleanup)

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
  it('is a landmark exposing Record and Stop recording, Record enabled while idle and connected', () => {
    render(<RecordPanel {...makeProps()} />)

    const group = screen.getByRole('group', { name: 'Record and replay' })
    expect(within(group).getByRole('button', { name: 'Record' })).toBeEnabled()
    expect(within(group).getByRole('button', { name: 'Stop recording' })).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Stop replay' })).toBeDisabled()
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

  it('while recording: Stop recording is enabled, Record and Replay are not, and a status announces it', async () => {
    const user = userEvent.setup()
    const onStopRecording = vi.fn()
    render(<RecordPanel {...makeProps({ phase: 'recording', onStopRecording })} />)

    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled()
    const stopButton = screen.getByRole('button', { name: 'Stop recording' })
    expect(stopButton).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(/recording/i)

    await user.click(stopButton)
    expect(onStopRecording).toHaveBeenCalledTimes(1)
  })

  it('Replay is enabled only once a recording exists and nothing else is running', () => {
    const { rerender } = render(<RecordPanel {...makeProps({ recording: undefined })} />)
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled()

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

  it('while replaying: Stop replay is enabled, Record and Replay are not, and a status announces it', async () => {
    const user = userEvent.setup()
    const onStopReplay = vi.fn()
    render(<RecordPanel {...makeProps({ phase: 'replaying', recording: RECORDING, onStopReplay })} />)

    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled()
    const stopButton = screen.getByRole('button', { name: 'Stop replay' })
    expect(stopButton).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(/replaying/i)

    await user.click(stopButton)
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
