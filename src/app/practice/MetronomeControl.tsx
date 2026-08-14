/**
 * Metronome toggle with subdivision (roadmap 1.18, REQ-3.9.1). The accent
 * pattern itself is not user-editable here — `usePracticeEngine` lets
 * `@core/timing/metronome.ts` supply `defaultAccents` for the score's time
 * signature, which is what gives the downbeat its click.
 *
 * Roadmap UI-10 (2026-08-12 UI audit): the subdivision select used to render
 * always, permanently `disabled` while the metronome was off — a control the
 * current state could never enable, sitting there greyed out. It now mounts
 * only while `enabled` is true, matching DESIGN.md's "a disabled control that
 * can never be enabled is hidden, not greyed" rule; the `disabled` PROP (the
 * separate "assessment running" freeze) still disables it in place once it is
 * showing, exactly as before.
 */
import { SUBDIVISIONS, type Subdivision } from '@core/timing/metronome.ts'
import { useId } from 'react'

export type MetronomeControlProps = {
  readonly enabled: boolean
  readonly onToggle: (enabled: boolean) => void
  readonly subdivision: Subdivision
  readonly onSubdivisionChange: (subdivision: Subdivision) => void
  /** Disables both the toggle and the subdivision select — e.g. while an assessment run is in progress. */
  readonly disabled?: boolean
}

export function MetronomeControl({
  enabled,
  onToggle,
  subdivision,
  onSubdivisionChange,
  disabled = false,
}: MetronomeControlProps) {
  const id = useId()
  return (
    <div className="metronome-control" role="group" aria-label="Metronome">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        Metronome
      </label>
      {enabled && (
        <div className="field-inline">
          <label htmlFor={id}>Subdivision</label>
          <select
            id={id}
            value={subdivision}
            disabled={disabled}
            onChange={(event) => onSubdivisionChange(Number(event.target.value) as Subdivision)}
          >
            {SUBDIVISIONS.map((value) => (
              <option key={value} value={value}>
                {value === 1 ? 'Beat' : `${value} clicks / beat`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
