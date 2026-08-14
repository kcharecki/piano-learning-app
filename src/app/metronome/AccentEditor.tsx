/**
 * One toggle per beat of the current metre (roadmap 2.28, REQ-3.9.1): lets
 * "accents on 1 and 4 of 7/8" be expressed directly, instead of only ever
 * getting `defaultAccents`.
 *
 * Controlled component: `accents` is owned by the caller (`useMetronome`),
 * this only renders it and reports toggles. The one thing it does own is
 * shape safety — `resizeAccents` is exported so `useMetronome` can apply the
 * exact same rule when the time signature changes elsewhere (e.g. a BPM
 * field, not this component), and this component applies it again on render
 * so a beat count change is never displayed with a stale-length pattern for
 * even one frame: indices that still exist keep their value, new ones default
 * from `defaultAccents(timeSignature)`, removed ones are dropped.
 *
 * Redesigned (roadmap UI-16, 2026-08-14 UI audit) as a `.seg-control`-style
 * row of per-beat toggles instead of a column of "Beat N (accent)" buttons:
 * each chip shows only its beat number so a 7- or 8-beat metre still reads as
 * one compact row inside the Meter card. `aria-pressed` is the state hook —
 * `primitives.css`'s generic `button[aria-pressed="true"]` rule already
 * outranks `.seg-control > *`'s plain background reset on specificity, so the
 * accented chips light up correctly with zero CSS of this component's own.
 * The full "Beat N" wording moves to `aria-label` so the accessible name
 * stays descriptive even though the visible glyph is now just the number.
 */
import { defaultAccents, type AccentPattern } from '@core/timing/metronome.ts'
import type { TimeSignature } from '@core/notation/score.ts'
import { useEffect, useId, useMemo } from 'react'

export type AccentEditorProps = {
  readonly timeSignature: TimeSignature
  readonly accents: AccentPattern
  readonly onChange: (accents: AccentPattern) => void
  readonly disabled?: boolean
}

/**
 * Resize `accents` to exactly `ts.beats` entries: keep whatever overlaps by
 * index, default the rest from `defaultAccents(ts)`. `accents[i] ?? def` is
 * deliberately not `accents[i] || def` — an explicit `false` (no accent on
 * that beat) must survive, only a genuinely missing index falls back.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a pure helper deliberately shared with useMetronome.ts, not a component
export function resizeAccents(accents: AccentPattern, ts: TimeSignature): AccentPattern {
  const defaults = defaultAccents(ts)
  return defaults.map((def, i) => accents[i] ?? def)
}

function sameAccents(a: AccentPattern, b: AccentPattern): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export function AccentEditor({ timeSignature, accents, onChange, disabled = false }: AccentEditorProps) {
  const display = useMemo(() => resizeAccents(accents, timeSignature), [accents, timeSignature])
  const labelId = useId()

  // The metre changed (or `accents` arrived the wrong length): push the
  // resized pattern back up so the caller's own state — which is what
  // `useMetronome` actually schedules clicks from — never disagrees with what
  // is on screen. Guarded by value, not reference, so this settles in one
  // extra render instead of looping: once the caller's `accents` prop equals
  // `display` by value, `resizeAccents` of it reproduces the same values.
  useEffect(() => {
    if (!sameAccents(display, accents)) onChange(display)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the resized pattern itself should trigger this
  }, [display])

  function toggle(index: number): void {
    onChange(display.map((value, i) => (i === index ? !value : value)))
  }

  return (
    <div className="field metronome-accent-field">
      <label id={labelId}>Accents</label>
      <div className="seg-control metronome-accent-seg" role="group" aria-labelledby={labelId}>
        {display.map((accented, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={accented}
            aria-label={`Beat ${i + 1}${accented ? ', accented' : ''}`}
            disabled={disabled}
            onClick={() => toggle(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}
