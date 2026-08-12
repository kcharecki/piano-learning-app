/**
 * Record & replay controls (roadmap 2.14, REQ-3.9.2). `useRecorder` owns the
 * MIDI recording, the transport wiring and the phase; this renders buttons
 * for it, a summary of the last completed take, and — roadmap B.5 — the
 * optional audio half.
 *
 * ## Why the audio wiring lives here, not in `useRecorder`
 *
 * `PracticeScreen` (owned by another session for this slice) renders
 * `RecordPanel` with a fixed, already-written prop list — it cannot be
 * edited to forward new fields from `useRecorder`. But it already hands this
 * component the exact callbacks that start/stop the MIDI recorder
 * (`onStartRecording` etc.), so wrapping THOSE — calling into
 * `useAudioRecording` immediately before/after each one — puts audio capture
 * on the same user action as MIDI capture without needing any new prop from
 * the parent. See `useAudioRecording`'s module comment (`useRecorder.ts`)
 * for the full contract, in particular how `beginCapture`/`markMidiOrigin`
 * measure the start offset instead of assuming it.
 *
 * ## What this demotes (docs/DESIGN.md "Adding means demoting")
 *
 * Four new interactive elements would otherwise land straight onto an
 * already-dense, already-collapsed practice screen (the "Record audio too"
 * toggle, its error text, the saved-audio summary, and Delete audio). Per
 * rule 3's "groups" clause, they are GROUPED behind their own nested
 * `<details>` ("Audio recording") inside this panel, collapsed by default —
 * the only thing always visible is one more disclosure line, not four more
 * controls. The existing Record/Stop/Replay/Stop replay buttons and the
 * Duration/Events/Recorded at summary are unchanged.
 */
import type { Recording } from '@core/practice/recorder.ts'
import { useAudioRecording, type RecorderUiPhase, type UseAudioRecordingOptions } from './useRecorder.ts'

export type RecordPanelProps = {
  readonly phase: RecorderUiPhase
  readonly recording: Recording | undefined
  /** Usually "a MIDI keyboard is connected"; Record is disabled without it. */
  readonly canRecord: boolean
  readonly onStartRecording: () => void
  readonly onStopRecording: () => void
  readonly onStartReplay: () => void
  readonly onStopReplay: () => void
  /**
   * Test seams for the internal `useAudioRecording` call — never set by
   * `PracticeScreen` (real defaults apply: the real microphone, the real
   * IndexedDB store, `performance.now`). Exists so `RecordPanel.test.tsx` can
   * inject fakes without a real `getUserMedia`/`MediaRecorder`/IndexedDB.
   */
  readonly audioTestSeams?: Pick<
    UseAudioRecordingOptions,
    'openStore' | 'createRecorder' | 'createPlayback' | 'now'
  >
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function formatRecordedAt(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString()
}

/** `'audio/webm;codecs=opus'` -> `'webm'` — the container name only, not the full mime string. */
function formatAudioFormat(mimeType: string): string {
  return mimeType.split(';')[0]?.split('/')[1] ?? mimeType
}

function formatAudioSize(sizeBytes: number): string {
  return `${(sizeBytes / 1024).toFixed(1)} KB`
}

export function RecordPanel({
  phase,
  recording,
  canRecord,
  onStartRecording,
  onStopRecording,
  onStartReplay,
  onStopReplay,
  audioTestSeams,
}: RecordPanelProps) {
  const audio = useAudioRecording({ phase, recording, ...audioTestSeams })

  function handleRecord(): void {
    // Order matters: `beginCapture` starts the mic BEFORE the MIDI side, and
    // `markMidiOrigin` reads the clock right AFTER it — both ends of the
    // bracket `useAudioRecording` uses to measure the real start offset
    // between the two, all inside this one click.
    audio.beginCapture()
    onStartRecording()
    audio.markMidiOrigin()
  }

  function handleStopRecording(): void {
    onStopRecording()
    audio.endCapture()
  }

  function handleReplay(): void {
    onStartReplay()
    audio.beginPlayback()
  }

  function handleStopReplay(): void {
    onStopReplay()
    audio.endPlayback()
  }

  const recordingWithAudio = phase === 'recording' && audio.enabled && audio.status === 'recording'

  return (
    <div className="record-panel" role="group" aria-label="Record and replay">
      <button type="button" onClick={handleRecord} disabled={phase !== 'idle' || !canRecord}>
        Record
      </button>
      <button type="button" onClick={handleStopRecording} disabled={phase !== 'recording'}>
        Stop recording
      </button>
      <button
        type="button"
        onClick={handleReplay}
        disabled={phase !== 'idle' || recording === undefined}
      >
        Replay
      </button>
      <button type="button" onClick={handleStopReplay} disabled={phase !== 'replaying'}>
        Stop replay
      </button>
      {phase === 'recording' && (
        <p role="status">Recording{recordingWithAudio ? ' (with audio)' : ''}…</p>
      )}
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
      <details className="record-audio-details">
        <summary>Audio recording</summary>
        <label className="record-audio-toggle">
          <input
            type="checkbox"
            checked={audio.enabled}
            disabled={phase !== 'idle'}
            onChange={(e) => audio.setEnabled(e.target.checked)}
          />
          Record audio too
        </label>
        {audio.status === 'requesting' && <p role="status">Requesting microphone…</p>}
        {audio.error !== undefined && <p role="alert">{audio.error}</p>}
        {audio.audio !== undefined && (
          <p className="record-audio-summary" data-testid="record-audio-summary">
            {formatAudioFormat(audio.audio.mimeType)} · {formatAudioSize(audio.audio.sizeBytes)}
            <button
              type="button"
              className="btn-danger record-audio-delete"
              onClick={audio.deleteAudio}
              disabled={phase !== 'idle'}
            >
              Delete audio
            </button>
          </p>
        )}
      </details>
    </div>
  )
}
