/**
 * Wait mode toggle (roadmap 1.18, REQ-3.3.3), showing which notes it is
 * currently waiting for — `usePracticeEngine` drives the actual gating via
 * `WaitModeController` from `@core/practice/waitmode.ts`; this only renders
 * its `WaitState`.
 */
import { midiToName } from '@core/theory/pitch.ts'
import type { WaitState } from '@core/practice/waitmode.ts'
import type { Midi } from '@core/shared/units.ts'

export type WaitModeControlProps = {
  readonly enabled: boolean
  readonly onToggle: (enabled: boolean) => void
  readonly wait: WaitState | undefined
  /** Disables the checkbox — e.g. while an assessment run is in progress. */
  readonly disabled?: boolean
}

/** Distinct pitches still owed — required notes minus the ones already struck. */
function pendingPitches(wait: WaitState): readonly Midi[] {
  const out: Midi[] = []
  for (const note of wait.requiredNotes) {
    if (!wait.satisfiedNotes.includes(note.midi) && !out.includes(note.midi)) out.push(note.midi)
  }
  return out
}

export function WaitModeControl({
  enabled,
  onToggle,
  wait,
  disabled = false,
}: WaitModeControlProps) {
  const pending = wait === undefined ? [] : pendingPitches(wait)
  return (
    <div className="wait-mode-control" role="group" aria-label="Wait mode">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        Wait for me
      </label>
      {enabled && wait?.waiting === true && (
        <p role="status">
          Waiting for:{' '}
          {pending.length > 0 ? pending.map((note) => midiToName(note)).join(', ') : 'nothing'}
        </p>
      )}
    </div>
  )
}
