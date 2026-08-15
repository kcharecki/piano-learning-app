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
    // Roadmap UI-27 (2026-08-15, toolbar-height fix): From/to measure used to
    // be two `.field`s (primitives.css) inside a `.field-row` — each stacks
    // its label ABOVE its input, ~58px tall. That was fine as a drawer
    // section (roadmap UI-10); promoted into the sticky toolbar, it made this
    // the tallest thing in the row after `.hand-mute-control`'s single-line
    // seg-control, and the toolbar's own height is now permanently subtracted
    // from the learner's view of the score every scroll. `.field-inline`
    // (primitives.css) puts label and input on ONE line instead, matching
    // every other toolbar control's height (`--control-h`).
    //
    // The visible label text is shortened ("From measure" -> "From") and the
    // full wording moves to `aria-label`, which WINS over the `<label>`
    // association for the accessible name (WAI-ARIA accname computation) —
    // `aria-label` still literally contains the visible text ("From measure"
    // contains "From"), satisfying WCAG 2.5.3 Label in Name, and every
    // existing `getByLabelText('From measure')` query still resolves because
    // it matches the computed accessible name, not the rendered label text.
    // This is purely a toolbar-width concession (see feature-practice.css's
    // own comment on the loop-range-fields' explicit input width) — sitting
    // beside transport, hands, tempo and mic in one sticky band left no room
    // for "From measure"/"To measure" to render in full.
    <div className="loop-range-control" role="group" aria-label="Loop range">
      <div className="loop-range-fields">
        <div className="field-inline">
          <label htmlFor={startId}>From</label>
          <input
            id={startId}
            type="number"
            min={1}
            max={lastMeasure + 1}
            value={startMeasure + 1}
            aria-label="From measure"
            onChange={(event) => apply(Number(event.target.value) - 1, endMeasure, enabled)}
          />
        </div>
        <div className="field-inline">
          <label htmlFor={endId}>To</label>
          <input
            id={endId}
            type="number"
            min={1}
            max={lastMeasure + 1}
            value={endMeasure + 1}
            aria-label="To measure"
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
      {/* Roadmap UI-24 (2026-08-15 final visual pass): rendered only while a
          loop is ACTIVE. Unlooped, this repeated a number the sticky transport
          toolbar directly above the score already shows twice ("Tempo — 100% of
          written 100" and "100 bpm") — a third readout of one value, and the
          only thing in the Range group's right-hand half, so it floated alone in
          the panel's dead space with no control beside it. Looped, it is not a
          duplicate at all: it is THIS range's own remembered scale (roadmap
          2.29), which is exactly the coupling the module comment above exists to
          make visible, so it stays. */}
      {enabled && (
        <div className="stat loop-tempo" data-testid="loop-tempo">
          <span className="stat-value">{Math.round(tempoScale * 100)}%</span>
          <span className="stat-label">Loop tempo</span>
        </div>
      )}
    </div>
  )
}
