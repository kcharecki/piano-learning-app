/**
 * The microphone-fallback toggle (roadmap 5.7 / B.1, REQ-3.3.7) — the
 * `MidiDeviceStatus` sibling for the mic. A checkbox, not automatic: turning
 * it on triggers a real browser permission prompt, so it must be the
 * learner's own choice, never fired on page load.
 */
export type MicInputControlProps = {
  readonly enabled: boolean
  /** Is the capture loop actually running? `false` while connecting, or after `error`. */
  readonly connected: boolean
  readonly error: string | undefined
  readonly onToggle: (enabled: boolean) => void
}

export function MicInputControl({ enabled, connected, error, onToggle }: MicInputControlProps) {
  const state = connected ? 'connected' : error !== undefined ? 'error' : enabled ? 'connecting' : 'off'

  return (
    <div className="mic-input-control">
      <label className="mic-input-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        Use microphone
      </label>
      {enabled && (
        <p className="mic-input-status" role="status" data-state={state}>
          {connected
            ? 'Microphone listening — sing or play a note.'
            : error !== undefined
              ? `Microphone unavailable (${error})`
              : 'Requesting microphone access…'}
        </p>
      )}
    </div>
  )
}
