/**
 * Shared notehead and mark glyph primitives (roadmap DR-05), used by both
 * `GrooveStaff` (drawing the actual score) and `DrumKey` (drawing one small
 * exemplar of each pad in the legend). The adversarial panel that reviewed
 * this feature found the earlier renderer's `open` mark landing on the
 * hi-hat's own stem — the sign for a different articulation entirely — and
 * part of the root cause was organisational: nothing forced the staff's
 * glyphs and a future legend's glyphs to agree with each other. One drawing
 * function per shape, imported by both callers, is what keeps that from
 * happening again by construction rather than by remembering to keep two
 * copies in sync.
 *
 * Every dimension here is in the same staff-space units `layout.ts` and
 * `GrooveStaff` use — see that module's doc comment. `DrumKey` does not sit
 * on a staff, so it picks its own small viewBox per row, but it reuses these
 * exact numbers so a hi-hat drawn in the key is the same shape as the one
 * drawn on the staff, just smaller.
 */
import type { ReactElement } from 'react'
import type { Notehead } from '@core/drums/model/pad.ts'

/** Every notehead shape is sized off one rx/ry pair so all four read at the same weight. */
export const NOTEHEAD_RX = 0.6
export const NOTEHEAD_RY = 0.45
/** The `x`/`circleX` cross is drawn slightly smaller than the full notehead box so it reads as a stroke, not a filled block. */
const CROSS_RX = NOTEHEAD_RX * 0.85
const CROSS_RY = NOTEHEAD_RY * 0.85
/** The cross inside a `circleX` sits inside the circle, so it needs its own, smaller, radius. */
const CIRCLE_CROSS_RX = NOTEHEAD_RX * 0.55
const CIRCLE_CROSS_RY = NOTEHEAD_RY * 0.55
const CIRCLE_R = NOTEHEAD_RX

export const OPEN_MARK_R = 0.32
export const ACCENT_HALF_WIDTH = 0.4
export const ACCENT_HALF_HEIGHT = 0.3
/** Gap between a notehead (or the previous mark) and the next mark stacked off it. */
export const MARK_GAP = 0.35

/** Two crossing strokes, shared by the `x` notehead and the cross inside `circleX`. */
function Cross({
  cx,
  cy,
  rx,
  ry,
  className,
}: {
  readonly cx: number
  readonly cy: number
  readonly rx: number
  readonly ry: number
  readonly className: string
}): ReactElement {
  return (
    <g className={className}>
      <line x1={cx - rx} y1={cy - ry} x2={cx + rx} y2={cy + ry} />
      <line x1={cx - rx} y1={cy + ry} x2={cx + rx} y2={cy - ry} />
    </g>
  )
}

/** One of the four notehead shapes, centred on `(cx, cy)`. */
export function NoteheadShape({
  notehead,
  cx,
  cy,
}: {
  readonly notehead: Notehead
  readonly cx: number
  readonly cy: number
}): ReactElement {
  switch (notehead) {
    case 'normal':
      return (
        <ellipse
          className="groove-notehead groove-notehead-normal"
          cx={cx}
          cy={cy}
          rx={NOTEHEAD_RX}
          ry={NOTEHEAD_RY}
        />
      )
    case 'x':
      return <Cross className="groove-notehead groove-notehead-x" cx={cx} cy={cy} rx={CROSS_RX} ry={CROSS_RY} />
    case 'diamond':
      return (
        <rect
          className="groove-notehead groove-notehead-diamond"
          x={cx - NOTEHEAD_RX}
          y={cy - NOTEHEAD_RY}
          width={NOTEHEAD_RX * 2}
          height={NOTEHEAD_RY * 2}
          transform={`rotate(45 ${cx} ${cy})`}
        />
      )
    case 'circleX':
      return (
        <g className="groove-notehead groove-notehead-circle-x">
          <circle cx={cx} cy={cy} r={CIRCLE_R} />
          <Cross
            className="groove-notehead-circle-x-cross"
            cx={cx}
            cy={cy}
            rx={CIRCLE_CROSS_RX}
            ry={CIRCLE_CROSS_RY}
          />
        </g>
      )
    /* istanbul ignore next -- `Notehead` is a closed union; this only guards a future variant at compile time. */
    default: {
      const exhaustive: never = notehead
      throw new Error(`Unhandled notehead shape: ${String(exhaustive)}`)
    }
  }
}

/** The `open` mark: a hollow circle, centred on `(cx, cy)`. */
export function OpenMark({ cx, cy }: { readonly cx: number; readonly cy: number }): ReactElement {
  return <circle className="groove-mark groove-mark-open" cx={cx} cy={cy} r={OPEN_MARK_R} />
}

/** The `accent` mark: a sideways chevron (`>`), centred on `(cx, cy)`. */
export function AccentMark({ cx, cy }: { readonly cx: number; readonly cy: number }): ReactElement {
  const points = [
    `${cx - ACCENT_HALF_WIDTH},${cy - ACCENT_HALF_HEIGHT}`,
    `${cx + ACCENT_HALF_WIDTH},${cy}`,
    `${cx - ACCENT_HALF_WIDTH},${cy + ACCENT_HALF_HEIGHT}`,
  ].join(' ')
  return <polyline className="groove-mark groove-mark-accent" points={points} />
}
