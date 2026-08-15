/**
 * Loop range picker (roadmap 1.18, REQ-3.2.3): a start and end measure, and a
 * toggle. Measure indices are converted to a tick range with `measureRange`
 * from `@core/notation/score.ts`, the same helper the domain's own tests use.
 *
 * The picked measures are kept locally, not in the shared store, so toggling
 * the loop off and back on remembers where it was — the store only holds the
 * ACTIVE range (`undefined` while off), which is what the transport needs.
 *
 * A loop can also be set from OUTSIDE this control (roadmap 2.11, REQ-3.3.5) —
 * e.g. an assessment's "practice these measures" shortcut calling the score
 * store's `setLoop` directly. The displayed From/to numbers always come from
 * local state (so a run of keystrokes composes the way a controlled input
 * normally does, even though the parent never echoes each intermediate range
 * back through `loop`); an effect keeps that local state in sync whenever
 * `loop` changes to something this control did not itself just emit — that is
 * what makes an externally-set loop show up, while a change this control
 * caused (its own `onChange` echoed back through `loop`) is a no-op here.
 * When `loop` goes back to `undefined`, the numbers stay exactly where the
 * last active loop (external or picked) left them.
 *
 * Roadmap 2.29 (REQ-3.9.3): tempo is now remembered PER loop range in
 * `scoreStore` (see that module's comment) — `tempoScale` here is always
 * whichever scale is currently in effect (the active loop's own scale, or the
 * whole-piece scale while unlooped), passed straight through from
 * `settings.tempoScale`. This control only displays it, next to the range it
 * belongs to, so that coupling is visible instead of surprising a learner who
 * slows down bars 5-8 and finds the whole piece slowed on unchecking Loop.
 * Nothing here decides what the number IS — that stays in `scoreStore`.
 */
import { measureRange, type Score } from '@core/notation/score.ts'
import { measuresInRange } from '@core/notation/measures.ts'
import type { LoopRange } from '@core/timing/transport.ts'
import { useEffect, useId, useRef, useState } from 'react'

export type LoopRangeControlProps = {
  readonly score: Score
  readonly loop: LoopRange | undefined
  readonly onChange: (loop: LoopRange | undefined) => void
  /** The tempo scale currently in effect for `loop` (or the whole-piece scale
   * while `loop` is `undefined`) — see the module comment. Display only. */
  readonly tempoScale: number
}

function sameRange(a: LoopRange | undefined, b: LoopRange | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.startTick === b.startTick && a.endTick === b.endTick
}

export function LoopRangeControl({ score, loop, onChange, tempoScale }: LoopRangeControlProps) {
  const lastMeasure = score.measures.length - 1
  const [startMeasure, setStartMeasure] = useState(0)
  const [endMeasure, setEndMeasure] = useState(lastMeasure)
  const lastEmitted = useRef<LoopRange | undefined>(undefined)
  const startId = useId()
  const endId = useId()
  const enabled = loop !== undefined

  // Sync from an externally-set loop, but not from the echo of our own
  // `onChange` — otherwise mid-edit keystrokes would keep getting overwritten
  // by the (stale, un-rerendered-with) range this control just emitted.
  useEffect(() => {
    if (loop === undefined) {
      setStartMeasure((s) => Math.min(s, lastMeasure))
      setEndMeasure((e) => Math.min(e, lastMeasure))
      return
    }
    if (sameRange(loop, lastEmitted.current)) return
    const range = measuresInRange(score, loop)
    setStartMeasure(range.startMeasure)
    setEndMeasure(range.endMeasure)
    lastEmitted.current = loop
  }, [loop, score, lastMeasure])

  function apply(nextStart: number, nextEnd: number, on: boolean): void {
    setStartMeasure(nextStart)
    setEndMeasure(nextEnd)
    const range = on ? measureRange(score, nextStart, nextEnd) : undefined
    lastEmitted.current = range
    onChange(range)
  }

  return (
    // Roadmap UI-10 (2026-08-12 UI audit): From/to measure used to sit as bare
    // `<label>text<input></label>` pairs crammed against each other with no
    // primitive backing them — replaced with `.field-row` of two `.field`s
    // (primitives.css), the documented shape for "a horizontal run of
    // labelled controls" (e.g. BPM/Beats/Beat unit on Metronome already uses
    // it). The group's own role/label are unchanged, so every existing query
    // by role or label text still resolves.
    <div className="loop-range-control" role="group" aria-label="Loop range">
      <div className="field-row">
        <div className="field">
          <label htmlFor={startId}>From measure</label>
          <input
            id={startId}
            type="number"
            min={1}
            max={lastMeasure + 1}
            value={startMeasure + 1}
            onChange={(event) => apply(Number(event.target.value) - 1, endMeasure, enabled)}
          />
        </div>
        <div className="field">
          <label htmlFor={endId}>To measure</label>
          <input
            id={endId}
            type="number"
            min={1}
            max={lastMeasure + 1}
            value={endMeasure + 1}
            onChange={(event) => apply(startMeasure, Number(event.target.value) - 1, enabled)}
          />
        </div>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => apply(startMeasure, endMeasure, event.target.checked)}
          />
          Loop
        </label>
      </div>
      <div className="stat loop-tempo" data-testid="loop-tempo">
        <span className="stat-value">{Math.round(tempoScale * 100)}%</span>
        <span className="stat-label">{enabled ? 'Loop tempo' : 'Tempo'}</span>
      </div>
    </div>
  )
}
