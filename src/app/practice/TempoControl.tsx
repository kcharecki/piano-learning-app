/**
 * The practice-tempo slider (roadmap 1.18, REQ-3.2.2): 30%–200% of the
 * written tempo. `Transport` itself accepts a wider range
 * (`MIN_TEMPO_SCALE`/`MAX_TEMPO_SCALE` in `@core/timing/tempo.ts`) — this
 * control presents exactly what the requirement asks for.
 *
 * UI-09 (2026-08-12 UI audit): the old readout printed THREE formats at once
 * ("50% — 60 bpm (written 120)"). Now there are exactly two: the field's own
 * label carries the "% of written" detail ("Tempo — 50% of written 120"),
 * and the `<output>` shows one number — the effective bpm a learner would
 * actually hear — at `--text-lg` (inherited from `.tempo-value` in
 * domain.css). The word "Tempo" stays in the label text (not just "50% of
 * written 120") so the control's accessible name still says what it is —
 * WCAG 2.5.3 Label in Name, and screen-reader context when tabbing straight
 * to the slider.
 */
import type { Bpm } from '@core/shared/units.ts'
import { useId } from 'react'

const MIN_PERCENT = 30
const MAX_PERCENT = 200

export type TempoControlProps = {
  /** 1 = written tempo. */
  readonly tempoScale: number
  readonly onChange: (scale: number) => void
  readonly writtenBpm: Bpm | undefined
  readonly effectiveBpm: Bpm | undefined
  /** Disables the slider — e.g. while an assessment run is in progress. */
  readonly disabled?: boolean
}

export function TempoControl({
  tempoScale,
  onChange,
  writtenBpm,
  effectiveBpm,
  disabled = false,
}: TempoControlProps) {
  const id = useId()
  const percent = Math.round(tempoScale * 100)
  const roundedWritten = writtenBpm === undefined ? undefined : Math.round(writtenBpm)
  const labelText =
    roundedWritten === undefined ? 'Tempo' : `Tempo — ${percent}% of written ${roundedWritten}`
  const valueText =
    roundedWritten === undefined ? `${percent}%` : `${Math.round(effectiveBpm ?? writtenBpm ?? 0)} bpm`

  return (
    <div className="field tempo-control">
      <label htmlFor={id}>{labelText}</label>
      <input
        id={id}
        type="range"
        min={MIN_PERCENT}
        max={MAX_PERCENT}
        value={percent}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <output htmlFor={id} className="tempo-value">
        {valueText}
      </output>
    </div>
  )
}
