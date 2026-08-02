/**
 * Tempo ramp control (roadmap 2.27, REQ-3.9.1): enable/disable, the from/to/
 * step bpm that seed `useTempoRamp`'s `start`, and a live readout of the
 * current rung. All the ramp arithmetic lives in `useTempoRamp` /
 * `@core/timing/metronome.ts` — this component only renders the `RampState`
 * it is handed and forwards the four settings back up.
 */
import { MIN_BPM, MAX_BPM, type RampState } from '@core/timing/metronome.ts'
import { useId } from 'react'

export type TempoRampControlProps = {
  readonly enabled: boolean
  readonly onToggle: (enabled: boolean) => void
  readonly fromBpm: number
  readonly onFromBpmChange: (bpm: number) => void
  readonly toBpm: number
  readonly onToBpmChange: (bpm: number) => void
  readonly stepBpm: number
  readonly onStepBpmChange: (bpm: number) => void
  /** Clean repetitions needed at a rung before it steps — fixed per drill, not user-edited here. */
  readonly repsPerStep: number
  readonly state: RampState | undefined
  /**
   * The bpm the next completed rung will reach, banked from the settings the
   * running ramp actually started with — NOT recomputed from `stepBpm`/
   * `toBpm`, which may have been edited since. `undefined` while no ramp is
   * running or the ramp is already done.
   */
  readonly nextBpm: number | undefined
  /** Disables every control — e.g. while an assessment run is in progress. */
  readonly disabled?: boolean
}

function readout(props: TempoRampControlProps): string {
  const { enabled, state, repsPerStep, nextBpm } = props
  if (!enabled || state === undefined) return 'Tempo ramp is off'
  if (state.done || nextBpm === undefined) {
    return `${Math.round(state.currentBpm)} bpm — target reached`
  }
  const remaining = repsPerStep - state.repsAtCurrent
  const reps = remaining === 1 ? 'repetition' : 'repetitions'
  return `${Math.round(state.currentBpm)} bpm — ${remaining} clean ${reps} to ${Math.round(nextBpm)} bpm`
}

export function TempoRampControl(props: TempoRampControlProps) {
  const {
    enabled,
    onToggle,
    fromBpm,
    onFromBpmChange,
    toBpm,
    onToBpmChange,
    stepBpm,
    onStepBpmChange,
    disabled = false,
  } = props
  const fromId = useId()
  const toId = useId()
  const stepId = useId()

  return (
    <div className="tempo-ramp-control" role="group" aria-label="Tempo ramp">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        Tempo ramp
      </label>

      <label htmlFor={fromId}>From (bpm)</label>
      <input
        id={fromId}
        type="number"
        min={MIN_BPM}
        max={MAX_BPM}
        value={fromBpm}
        disabled={disabled}
        onChange={(event) => {
          const n = Number(event.target.value)
          if (Number.isFinite(n) && n >= MIN_BPM) onFromBpmChange(n)
        }}
      />

      <label htmlFor={toId}>To (bpm)</label>
      <input
        id={toId}
        type="number"
        min={MIN_BPM}
        max={MAX_BPM}
        value={toBpm}
        disabled={disabled}
        onChange={(event) => {
          const n = Number(event.target.value)
          if (Number.isFinite(n) && n >= MIN_BPM) onToBpmChange(n)
        }}
      />

      <label htmlFor={stepId}>Step (bpm)</label>
      <input
        id={stepId}
        type="number"
        min={1}
        max={MAX_BPM}
        value={stepBpm}
        disabled={disabled}
        onChange={(event) => {
          const n = Number(event.target.value)
          if (Number.isFinite(n) && n >= 1) onStepBpmChange(n)
        }}
      />

      <p role="status">{readout(props)}</p>
    </div>
  )
}
