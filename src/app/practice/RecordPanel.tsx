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
 *
 * ## Roadmap UI-10 (2026-08-12 UI audit): four buttons down to two toggles
 *
 * The original four-button row (Record, Stop recording, Replay, Stop replay)
 * always showed three of the four disabled at rest — the exact "greyed
 * control the current state can never enable right now" pattern DESIGN.md
 * rule 2 exists to kill. This collapses each pair into ONE toggle:
 * - Record/Stop share a button — icon swaps on `phase === 'recording'`, and
 *   the label reads "Stop recording" rather than a bare "Stop": the sticky
 *   transport toolbar (roadmap UI-09) already has its OWN always-rendered
 *   "Stop" icon button (`TransportControls`), so a bare "Stop" here would
 *   collide with it — two controls sharing one accessible name on the same
 *   screen, unresolvable by role+name alone. Escalated rather than resolved
 *   silently: docs/ui-overhaul-brief.md's own wording for this button was a
 *   bare "Stop".
 * - Replay/Stop replay share a second button, rendered ONLY once a take
 *   exists AND nothing is currently recording — before a first take, or
 *   while one is being made, there is nothing this button could ever do, so
 *   it is absent rather than disabled (the "hidden, not greyed" rule).
 * The "Audio recording" disclosure stays a nested `<details>` inside this
 * same `role="group"`, now styled as a quiet secondary line
 * (feature-audio-recording.css) rather than a second bordered block.
 */
import { Icon } from '@app/ui/Icon.tsx'
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

  const isRecording = phase === 'recording'
  const isReplaying = phase === 'replaying'

  function handleRecordToggle(): void {
    if (isRecording) {
      onStopRecording()
      audio.endCapture()
      return
    }
    // Order matters: `beginCapture` starts the mic BEFORE the MIDI side, and
    // `markMidiOrigin` reads the clock right AFTER it — both ends of the
    // bracket `useAudioRecording` uses to measure the real start offset
    // between the two, all inside this one click.
    audio.beginCapture()
    onStartRecording()
    audio.markMidiOrigin()
  }

  function handleReplayToggle(): void {
    if (isReplaying) {
      onStopReplay()
      audio.endPlayback()
      return
    }
    onStartReplay()
    audio.beginPlayback()
  }

  const recordingWithAudio = isRecording && audio.enabled && audio.status === 'recording'
  // Record/Stop is disabled only while the OTHER thing (replay) is running —
  // while recording itself it stays enabled so the same button can stop it.
  const recordToggleDisabled = isReplaying || (phase === 'idle' && !canRecord)
  // Replay/Stop replay: absent with no take yet, or while a new one is being
  // made — "hidden, not greyed" (DESIGN.md rule 2) for a state this button
  // can never act on right now.
  const showReplayToggle = recording !== undefined && !isRecording

  return (
    <div className="record-panel" role="group" aria-label="Record and replay">
      <button
        type="button"
        aria-pressed={isRecording}
        onClick={handleRecordToggle}
        disabled={recordToggleDisabled}
      >
        <Icon name={isRecording ? 'stop' : 'record'} />
        {isRecording ? 'Stop recording' : 'Record'}
      </button>
      {showReplayToggle && (
        <button type="button" aria-pressed={isReplaying} onClick={handleReplayToggle}>
          <Icon name={isReplaying ? 'stop' : 'play'} />
          {isReplaying ? 'Stop replay' : 'Replay'}
        </button>
      )}
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
