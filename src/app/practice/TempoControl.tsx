/**
 * The practice-tempo slider (roadmap 1.18, REQ-3.2.2): 30%–200% of the
 * written tempo, showing both the percentage and the resulting bpm. `Transport`
 * itself accepts a wider range (`MIN_TEMPO_SCALE`/`MAX_TEMPO_SCALE` in
 * `@core/timing/tempo.ts`) — this control presents exactly what the
 * requirement asks for.
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
}

export function TempoControl({
  tempoScale,
  onChange,
  writtenBpm,
  effectiveBpm,
}: TempoControlProps) {
  const id = useId()
  const percent = Math.round(tempoScale * 100)
  return (
    <div className="tempo-control">
      <label htmlFor={id}>Tempo</label>
      <input
        id={id}
        type="range"
        min={MIN_PERCENT}
        max={MAX_PERCENT}
        value={percent}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <output>
        {percent}%
        {writtenBpm !== undefined &&
          ` — ${Math.round(effectiveBpm ?? writtenBpm)} bpm (written ${Math.round(writtenBpm)})`}
      </output>
    </div>
  )
}
