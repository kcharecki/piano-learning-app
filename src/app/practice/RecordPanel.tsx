/**
 * Record & replay controls (roadmap 2.14, REQ-3.9.2). Purely presentational —
 * `useRecorder` owns the recording, the transport wiring and the phase; this
 * only renders buttons for it and a summary of the last completed take.
 */
import type { Recording } from '@core/practice/recorder.ts'
import type { RecorderUiPhase } from './useRecorder.ts'

export type RecordPanelProps = {
  readonly phase: RecorderUiPhase
  readonly recording: Recording | undefined
  /** Usually "a MIDI keyboard is connected"; Record is disabled without it. */
  readonly canRecord: boolean
  readonly onStartRecording: () => void
  readonly onStopRecording: () => void
  readonly onStartReplay: () => void
  readonly onStopReplay: () => void
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function formatRecordedAt(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString()
}

export function RecordPanel({
  phase,
  recording,
  canRecord,
  onStartRecording,
  onStopRecording,
  onStartReplay,
  onStopReplay,
}: RecordPanelProps) {
  return (
    <div className="record-panel" role="group" aria-label="Record and replay">
      <button type="button" onClick={onStartRecording} disabled={phase !== 'idle' || !canRecord}>
        Record
      </button>
      <button type="button" onClick={onStopRecording} disabled={phase !== 'recording'}>
        Stop recording
      </button>
      <button
        type="button"
        onClick={onStartReplay}
        disabled={phase !== 'idle' || recording === undefined}
      >
        Replay
      </button>
      <button type="button" onClick={onStopReplay} disabled={phase !== 'replaying'}>
        Stop replay
      </button>
      {phase === 'recording' && <p role="status">Recording…</p>}
      {phase === 'replaying' && <p role="status">Replaying…</p>}
      {recording !== undefined && (
        <dl className="record-summary" aria-label="Last recording">
          <dt>Duration</dt>
          <dd data-testid="record-duration">{formatSeconds(recording.durationMs)}</dd>
          <dt>Events</dt>
          <dd data-testid="record-event-count">{recording.events.length}</dd>
          <dt>Recorded at</dt>
          <dd data-testid="record-recorded-at">{formatRecordedAt(recording.recordedAt)}</dd>
        </dl>
      )}
    </div>
  )
}
