/**
 * `GrooveStaff` (roadmap DR-05) — renders an already-engraved `StaffLayout`
 * as SVG. This component does no music theory and no geometry: `staff.ts`
 * (`@core/drums/engrave/staff.ts`) has already placed every line, note, beam
 * and count label in staff-space units (one unit = the gap between two
 * adjacent staff lines, `y` growing downward, per that module's own doc
 * comment). This file's only job is turning those numbers into SVG elements
 * and, in `feature-drums-notation.css`, giving them a colour.
 *
 * The SVG's `viewBox` is exactly `0 0 layout.width layout.height`, so it
 * scales with its container (`.groove-staff { width: 100%; height: auto }`)
 * without this component ever learning what a pixel is — the same split
 * `core/notation/pianoRoll.ts` keeps with `app/practice/PianoRoll.tsx`.
 */
import type { CSSProperties, ReactElement } from 'react'
import type {
  EngravedBeam,
  EngravedCount,
  EngravedLine,
  EngravedNote,
  NoteMark,
  StaffLayout,
} from '@core/drums/engrave/layout.ts'
import { LEFT_MARGIN } from '@core/drums/engrave/layout.ts'
import type { Notehead } from '@core/drums/model/pad.ts'

export type GrooveStaffProps = {
  readonly layout: StaffLayout
  /** The pattern in words — becomes the figure's accessible name. */
  readonly label: string
  /** Identifies which groove is drawn; lands on `data-groove-staff`. */
  readonly grooveId: string
}

// All sizes below are staff-space units (the viewBox's own unit), never
// pixels — see the module comment. Colour, stroke width and font size are
// deliberately NOT here: they live in `feature-drums-notation.css` against
// design tokens, so this file stays free of raw hex and ad-hoc palettes.

/** Every notehead shape is sized off one rx/ry pair so all four read at the same weight. */
const NOTEHEAD_RX = 0.6
const NOTEHEAD_RY = 0.45
/** The `x`/`circleX` cross is drawn slightly smaller than the full notehead box so it reads as a stroke, not a filled block. */
const CROSS_RX = NOTEHEAD_RX * 0.85
const CROSS_RY = NOTEHEAD_RY * 0.85
/** The cross inside a `circleX` sits inside the circle, so it needs its own, smaller, radius. */
const CIRCLE_CROSS_RX = NOTEHEAD_RX * 0.55
const CIRCLE_CROSS_RY = NOTEHEAD_RY * 0.55
const CIRCLE_R = NOTEHEAD_RX

/** Gap left between a notehead's own edge and the first mark drawn off it. */
const MARK_GAP = 0.35
const OPEN_MARK_R = 0.32
const ACCENT_HALF_WIDTH = 0.4
const ACCENT_HALF_HEIGHT = 0.3
const GHOST_GAP_X = NOTEHEAD_RX + 0.3
const GHOST_HALF_HEIGHT = NOTEHEAD_RY + 0.25
const GHOST_BULGE = 0.3

/** A flag hangs off the stem tip, back towards the notehead. */
const FLAG_WIDTH = 0.7
const FLAG_DROP = 1.1
/** Where a second flag starts, measured back down the stem from the tip. */
const FLAG_STEP = 0.55

/** Beam rect height, and the step (thickness + gap) a second beam offsets by. */
const BEAM_THICKNESS = 0.45
const BEAM_GAP = 0.3
const BEAM_STEP = BEAM_THICKNESS + BEAM_GAP

/** The percussion clef's two bars sit before `LEFT_MARGIN`, scaled off it
 *  rather than hard-coded so they stay clear of the barline even if
 *  `LEFT_MARGIN` ever changes. They span the staff's middle two spaces,
 *  centred on the middle line — a judgment call (the spec fixes no exact
 *  span), matched left/right by `CLEF_BAR_WIDTH`. */
const CLEF_BAR_1_X = LEFT_MARGIN * 0.35
const CLEF_BAR_2_X = LEFT_MARGIN * 0.7
const CLEF_BAR_WIDTH = 0.45
/** The clef bars span the staff's middle two spaces, inset from each end line. */
const CLEF_INSET = 1

/**
 * Where the staff itself sits, read off the layout it came with. `layout.ts`
 * deliberately no longer publishes a constant for this: the engraver slides
 * the staff down whenever a score's ink reaches higher than the usual
 * hi-hat-and-stem headroom, so anything drawn against the staff (this clef,
 * the barlines) has to follow it rather than assume it.
 */
function staffSpan(lines: readonly EngravedLine[]): { readonly topY: number; readonly bottomY: number } {
  const top = lines[0]
  const bottom = lines[lines.length - 1]
  if (top === undefined || bottom === undefined) return { topY: 0, bottomY: 0 }
  return { topY: top.y, bottomY: bottom.y }
}

function PercussionClef({
  topY,
  bottomY,
}: {
  readonly topY: number
  readonly bottomY: number
}): ReactElement {
  const barTopY = topY + CLEF_INSET
  const barBottomY = bottomY - CLEF_INSET
  return (
    <g className="groove-clef" aria-hidden="true">
      <rect
        className="groove-clef-bar"
        x={CLEF_BAR_1_X - CLEF_BAR_WIDTH / 2}
        y={barTopY}
        width={CLEF_BAR_WIDTH}
        height={barBottomY - barTopY}
      />
      <rect
        className="groove-clef-bar"
        x={CLEF_BAR_2_X - CLEF_BAR_WIDTH / 2}
        y={barTopY}
        width={CLEF_BAR_WIDTH}
        height={barBottomY - barTopY}
      />
    </g>
  )
}

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

function NoteheadShape({ note }: { readonly note: EngravedNote }): ReactElement {
  const shape: Notehead = note.notehead
  switch (shape) {
    case 'normal':
      return (
        <ellipse
          className="groove-notehead groove-notehead-normal"
          cx={note.x}
          cy={note.y}
          rx={NOTEHEAD_RX}
          ry={NOTEHEAD_RY}
        />
      )
    case 'x':
      return (
        <Cross
          className="groove-notehead groove-notehead-x"
          cx={note.x}
          cy={note.y}
          rx={CROSS_RX}
          ry={CROSS_RY}
        />
      )
    case 'diamond':
      return (
        <rect
          className="groove-notehead groove-notehead-diamond"
          x={note.x - NOTEHEAD_RX}
          y={note.y - NOTEHEAD_RY}
          width={NOTEHEAD_RX * 2}
          height={NOTEHEAD_RY * 2}
          transform={`rotate(45 ${note.x} ${note.y})`}
        />
      )
    case 'circleX':
      return (
        <g className="groove-notehead groove-notehead-circle-x">
          <circle cx={note.x} cy={note.y} r={CIRCLE_R} />
          <Cross
            className="groove-notehead-circle-x-cross"
            cx={note.x}
            cy={note.y}
            rx={CIRCLE_CROSS_RX}
            ry={CIRCLE_CROSS_RY}
          />
        </g>
      )
    /* istanbul ignore next -- `Notehead` is a closed union; this only guards a future variant at compile time. */
    default: {
      const exhaustive: never = shape
      throw new Error(`Unhandled notehead shape: ${String(exhaustive)}`)
    }
  }
}

/** Left/right parenthesis paths for a `ghost` mark, drawn as a curve rather than a text glyph. */
function parenPath(cx: number, cy: number, side: 'left' | 'right'): string {
  const sign = side === 'left' ? -1 : 1
  const anchorX = cx + sign * GHOST_GAP_X
  const bulgeX = anchorX + sign * GHOST_BULGE
  return `M ${anchorX} ${cy - GHOST_HALF_HEIGHT} Q ${bulgeX} ${cy} ${anchorX} ${cy + GHOST_HALF_HEIGHT}`
}

/**
 * Where each mark in `note.marks` lands. `open` and `accent` both draw above
 * the notehead, so when a note carries both they stack outward one after
 * another rather than overlapping; `ghost` draws beside the head instead and
 * never consumes that stack. `note.marks` is already ordered `open`,
 * `accent`, `ghost` with no duplicates (the layout module's own contract),
 * so a single forward pass is enough.
 */
function markCenters(note: EngravedNote): ReadonlyArray<{ readonly mark: NoteMark; readonly y: number }> {
  let offset = NOTEHEAD_RY + MARK_GAP
  const centers: Array<{ mark: NoteMark; y: number }> = []
  for (const mark of note.marks) {
    if (mark === 'ghost') {
      centers.push({ mark, y: note.y })
      continue
    }
    const half = mark === 'open' ? OPEN_MARK_R : ACCENT_HALF_HEIGHT
    centers.push({ mark, y: note.y - offset - half })
    offset += half * 2 + MARK_GAP
  }
  return centers
}

function MarkGlyph({
  mark,
  note,
  y,
}: {
  readonly mark: NoteMark
  readonly note: EngravedNote
  readonly y: number
}): ReactElement {
  switch (mark) {
    case 'open':
      return <circle className="groove-mark groove-mark-open" cx={note.x} cy={y} r={OPEN_MARK_R} />
    case 'accent': {
      const points = [
        `${note.x - ACCENT_HALF_WIDTH},${y - ACCENT_HALF_HEIGHT}`,
        `${note.x + ACCENT_HALF_WIDTH},${y}`,
        `${note.x - ACCENT_HALF_WIDTH},${y + ACCENT_HALF_HEIGHT}`,
      ].join(' ')
      return <polyline className="groove-mark groove-mark-accent" points={points} />
    }
    case 'ghost':
      return (
        <g className="groove-mark groove-mark-ghost">
          <path d={parenPath(note.x, note.y, 'left')} />
          <path d={parenPath(note.x, note.y, 'right')} />
        </g>
      )
    /* istanbul ignore next -- `NoteMark` is a closed union; this only guards a future variant at compile time. */
    default: {
      const exhaustive: never = mark
      throw new Error(`Unhandled note mark: ${String(exhaustive)}`)
    }
  }
}

/**
 * The flags on an unbeamed short note, drawn as curves off the stem tip on
 * the notehead's side of it — one for an eighth, two for a sixteenth. A note
 * a beam already carries has `flags === 0`, so this renders nothing: the beam
 * is that note's flag, and drawing both would say the duration twice.
 */
function Flags({ note }: { readonly note: EngravedNote }): ReactElement | null {
  if (note.flags === 0) return null
  // Stems point away from the head, so the flag always curves back towards
  // it: down for a hands note (stem up), up for a feet note (stem down).
  const towardsHead = note.stemToY < note.y ? 1 : -1
  return (
    <g className="groove-flags">
      {Array.from({ length: note.flags }, (_, i) => {
        const fromY = note.stemToY + i * FLAG_STEP * towardsHead
        const toY = fromY + FLAG_DROP * towardsHead
        return (
          <path
            key={i}
            className="groove-flag"
            d={`M ${note.x} ${fromY} Q ${note.x + FLAG_WIDTH} ${fromY + (FLAG_DROP / 2) * towardsHead} ${note.x + FLAG_WIDTH * 0.75} ${toY}`}
          />
        )
      })}
    </g>
  )
}

function Note({ note }: { readonly note: EngravedNote }): ReactElement {
  return (
    // `data-note-id` is a product contract, not a test hook: DR-05's spec
    // requires every notehead to be addressable so the trainer can later
    // colour one on a hit without re-engraving the whole staff.
    <g className="groove-note" data-note-id={note.id} data-pad={note.pad}>
      <line className="groove-stem" x1={note.x} y1={note.y} x2={note.x} y2={note.stemToY} />
      <Flags note={note} />
      <NoteheadShape note={note} />
      {markCenters(note).map(({ mark, y }) => (
        <MarkGlyph key={mark} mark={mark} note={note} y={y} />
      ))}
    </g>
  )
}

function Beam({ beam }: { readonly beam: EngravedBeam }): ReactElement {
  const direction = beam.voice === 'hands' ? 1 : -1
  return (
    <>
      {Array.from({ length: beam.count }, (_, i) => {
        const centerY = beam.y + i * direction * BEAM_STEP
        return (
          <rect
            key={i}
            className="groove-beam"
            x={beam.fromX}
            y={centerY - BEAM_THICKNESS / 2}
            width={beam.toX - beam.fromX}
            height={BEAM_THICKNESS}
          />
        )
      })}
    </>
  )
}

function CountRow({ counts }: { readonly counts: readonly EngravedCount[] }): ReactElement {
  // The figure's `aria-label` already speaks the pattern in words, so a
  // screen reader reading "1 e and a" glyph by glyph off this row would be
  // noise, not information.
  return (
    <g className="groove-count-row" aria-hidden="true">
      {counts.map((count) => (
        <text
          key={`${count.x}-${count.text}`}
          className="groove-count"
          x={count.x}
          y={count.y}
          textAnchor="middle"
        >
          {count.text}
        </text>
      ))}
    </g>
  )
}

export function GrooveStaff({ layout, label, grooveId }: GrooveStaffProps): ReactElement {
  const { topY, bottomY } = staffSpan(layout.staffLines)
  // The one number the stylesheet cannot work out for itself. It keeps the
  // staff space a fixed size on screen instead of stretching each groove to
  // the card: a bar of sixteenths is a wider figure than a bar of quarters,
  // not the same figure with smaller notes. Still a count of staff spaces,
  // not pixels — `feature-drums-notation.css` owns what one is worth.
  const sizing = { '--groove-staff-width': layout.width } as CSSProperties
  return (
    <svg
      className="groove-staff"
      style={sizing}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={label}
      data-groove-staff={grooveId}
      preserveAspectRatio="xMidYMid meet"
    >
      {layout.staffLines.map((line) => (
        <line
          key={line.y}
          className="groove-staff-line"
          x1={line.fromX}
          x2={line.toX}
          y1={line.y}
          y2={line.y}
        />
      ))}
      {layout.barlines.map((x) => (
        <line
          key={x}
          className="groove-barline"
          x1={x}
          x2={x}
          y1={topY}
          y2={bottomY}
        />
      ))}
      <PercussionClef topY={topY} bottomY={bottomY} />
      {layout.beams.map((beam) => (
        <Beam key={beam.noteIds.join('-')} beam={beam} />
      ))}
      {layout.notes.map((note) => (
        <Note key={note.id} note={note} />
      ))}
      <CountRow counts={layout.counts} />
    </svg>
  )
}
