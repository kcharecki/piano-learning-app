/**
 * Read-ahead toggle (roadmap 2.26, REQ-3.4.5) — the "notation progressively
 * hidden behind the cursor" drill. `useReadAhead` owns the actual occlusion
 * logic; this only renders the checkbox that turns it on and off.
 */
export type ReadAheadControlProps = {
  readonly enabled: boolean
  readonly onToggle: (enabled: boolean) => void
  /** Disables the checkbox — e.g. while an assessment run is in progress. */
  readonly disabled?: boolean
}

export function ReadAheadControl({ enabled, onToggle, disabled = false }: ReadAheadControlProps) {
  return (
    <div className="read-ahead-control" role="group" aria-label="Read ahead">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        Read ahead
      </label>
    </div>
  )
}
