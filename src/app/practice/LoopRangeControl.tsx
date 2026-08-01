/**
 * Loop range picker (roadmap 1.18, REQ-3.2.3): a start and end measure, and a
 * toggle. Measure indices are converted to a tick range with `measureRange`
 * from `@core/notation/score.ts`, the same helper the domain's own tests use.
 *
 * The picked measures are kept locally, not in the shared store, so toggling
 * the loop off and back on remembers where it was — the store only holds the
 * ACTIVE range (`undefined` while off), which is what the transport needs.
 */
import { measureRange, type Score } from '@core/notation/score.ts'
import type { LoopRange } from '@core/timing/transport.ts'
import { useId, useState } from 'react'

export type LoopRangeControlProps = {
  readonly score: Score
  readonly loop: LoopRange | undefined
  readonly onChange: (loop: LoopRange | undefined) => void
}

export function LoopRangeControl({ score, loop, onChange }: LoopRangeControlProps) {
  const lastMeasure = score.measures.length - 1
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(lastMeasure)
  const startId = useId()
  const endId = useId()
  const enabled = loop !== undefined

  function apply(nextStart: number, nextEnd: number, on: boolean): void {
    setStart(nextStart)
    setEnd(nextEnd)
    onChange(on ? measureRange(score, nextStart, nextEnd) : undefined)
  }

  return (
    <div className="loop-range-control" role="group" aria-label="Loop range">
      <label htmlFor={startId}>From measure</label>
      <input
        id={startId}
        type="number"
        min={1}
        max={lastMeasure + 1}
        value={start + 1}
        onChange={(event) => apply(Number(event.target.value) - 1, end, enabled)}
      />
      <label htmlFor={endId}>to measure</label>
      <input
        id={endId}
        type="number"
        min={1}
        max={lastMeasure + 1}
        value={end + 1}
        onChange={(event) => apply(start, Number(event.target.value) - 1, enabled)}
      />
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => apply(start, end, event.target.checked)}
        />
        Loop
      </label>
    </div>
  )
}
