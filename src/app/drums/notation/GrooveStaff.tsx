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
 *
 * The notehead and `open`/`accent` mark shapes live in `./NoteGlyphs.tsx`,
 * shared with `./DrumKey.tsx` so the staff and its legend can never draw two
 * subtly different versions of the same glyph.
 */
import type { CSSProperties, ReactElement } from 'react'
import type {
  EngravedBeam,
  EngravedCount,
  EngravedLine,
  EngravedNote,
  EngravedRest,
  EngravedTimeSignature,
  NoteMark,
  StaffLayout,
} from '@core/drums/engrave/layout.ts'
import { CLEF_WIDTH } from '@core/drums/engrave/layout.ts'
import {
  ACCENT_HALF_HEIGHT,
  AccentMark,
  MARK_GAP,
  NOTEHEAD_RX,
  NoteheadShape,
  OPEN_MARK_R,
  OpenMark,
} from './NoteGlyphs.tsx'

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

/**
 * Gap between a note's own edge and the first `ghost` parenthesis drawn off
 * it, and how far that parenthesis bulges outward. Two ghost notes one grid
 * slot apart must not merge into one bracket, which is exactly
 * `2 * (GHOST_GAP_X + GHOST_BULGE)` of horizontal room either side of the
 * gap between them — see `GrooveStaff.test.tsx`'s own check of that
 * inequality against `SLOT_WIDTH`. Exported so that test can hold this file
 * to it without duplicating the numbers.
 */
export const GHOST_GAP_X = NOTEHEAD_RX + 0.15
export const GHOST_BULGE = 0.25
const GHOST_HALF_HEIGHT = 0.7

/** A flag hangs off the stem tip, back towards the notehead. */
const FLAG_WIDTH = 0.7
const FLAG_DROP = 1.1
/** Where a second flag starts, measured back down the stem from the tip. */
const FLAG_STEP = 0.55

/** Beam rect height, and the step (thickness + gap) a further level offsets by. */
const BEAM_THICKNESS = 0.45
const BEAM_GAP = 0.3
const BEAM_STEP = BEAM_THICKNESS + BEAM_GAP

/** The percussion clef's two bars sit inside `CLEF_WIDTH`, scaled off it so
 *  they stay proportional if that constant ever changes. They span the
 *  staff's middle two spaces, centred on the middle line — a judgment call
 *  (the spec fixes no exact span), matched left/right by `CLEF_BAR_WIDTH`. */
const CLEF_BAR_1_X = CLEF_WIDTH * 0.35
const CLEF_BAR_2_X = CLEF_WIDTH * 0.7
const CLEF_BAR_WIDTH = 0.45
/** The clef bars span the staff's middle two spaces, inset from each end line. */
const CLEF_INSET = 1

/** Repeat barline: gap between its thin and thick lines, and how far inside the dots sit past the thin line. */
const REPEAT_LINE_GAP = 0.4
const REPEAT_DOT_INSET = 0.7
const REPEAT_DOT_R = 0.2

/** A quarter rest is drawn about this tall, centred on its own `y`. */
const REST_HALF_HEIGHT = 0.8
const REST_WIDTH = 0.5

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

/** Left/right parenthesis paths for a `ghost` mark, drawn as a curve rather than a text glyph. */
function parenPath(cx: number, cy: number, side: 'left' | 'right'): string {
  const sign = side === 'left' ? -1 : 1
  const anchorX = cx + sign * GHOST_GAP_X
  const bulgeX = anchorX + sign * GHOST_BULGE
  return `M ${anchorX} ${cy - GHOST_HALF_HEIGHT} Q ${bulgeX} ${cy} ${anchorX} ${cy + GHOST_HALF_HEIGHT}`
}

/**
 * Where each mark in `note.marks` lands. `open` and `accent` stack **upward
 * from `note.markAnchorY`** — a layout output, not something this component
 * derives, because it has to clear the note's own stem and beam, and only
 * `staff.ts` knows where those ended up. Stacking outward from the notehead
 * itself (the old behaviour) put the open-hi-hat circle exactly on the
 * hi-hat's stem, which is the notation for a HALF-open hi-hat — a different
 * articulation from the one the score said. `ghost` still draws beside the
 * head at `note.y` instead, and never consumes the stack. `note.marks` is
 * already ordered `open`, `accent`, `ghost` with no duplicates (the layout
 * module's own contract), so a single forward pass is enough.
 */
function markCenters(note: EngravedNote): ReadonlyArray<{ readonly mark: NoteMark; readonly y: number }> {
  let offset = 0
  const centers: Array<{ mark: NoteMark; y: number }> = []
  for (const mark of note.marks) {
    if (mark === 'ghost') {
      centers.push({ mark, y: note.y })
      continue
    }
    const half = mark === 'open' ? OPEN_MARK_R : ACCENT_HALF_HEIGHT
    centers.push({ mark, y: note.markAnchorY - offset - half })
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
      return <OpenMark cx={note.x} cy={y} />
    case 'accent':
      return <AccentMark cx={note.x} cy={y} />
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
      <NoteheadShape notehead={note.notehead} cx={note.x} cy={note.y} />
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
      {beam.segments.map((segment) => {
        const centerY = beam.y + (segment.level - 1) * direction * BEAM_STEP
        return (
          <rect
            key={`${segment.level}-${segment.fromX}-${segment.toX}`}
            className="groove-beam"
            x={segment.fromX}
            y={centerY - BEAM_THICKNESS / 2}
            width={segment.toX - segment.fromX}
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

/**
 * The meter, stated once at the head of the staff. `ts.y` is the top staff
 * line's own `y` (the contract in `layout.ts`); the two digits stack over
 * the staff's middle, one per half, so they read the way a printed time
 * signature does rather than sitting off to one side of it. Decorative to a
 * screen reader — the figure's `aria-label` already speaks the meter.
 */
function TimeSignature({ ts }: { readonly ts: EngravedTimeSignature }): ReactElement {
  const upperY = ts.y + 1
  const lowerY = ts.y + 3
  return (
    <g className="groove-time-signature" aria-hidden="true">
      <text className="groove-time-signature-digit" x={ts.x} y={upperY} textAnchor="middle" dominantBaseline="central">
        {ts.beats}
      </text>
      <text className="groove-time-signature-digit" x={ts.x} y={lowerY} textAnchor="middle" dominantBaseline="central">
        {ts.beatType}
      </text>
    </g>
  )
}

/**
 * A quarter rest, drawn as a stroked zigzag rather than a text glyph — the
 * app cannot rely on a music font being installed. `EngravedRest.beats` is
 * always 1 today (the layout module's own doc comment), and this is the only
 * glyph a whole-beat rest needs at that count, so there is nothing yet to
 * switch on.
 */
function quarterRestPath(x: number, y: number): string {
  const top = y - REST_HALF_HEIGHT
  const bottom = y + REST_HALF_HEIGHT
  const upperKink = y - REST_HALF_HEIGHT * 0.35
  const lowerKink = y + REST_HALF_HEIGHT * 0.35
  return [
    `M ${x + REST_WIDTH} ${top}`,
    `L ${x - REST_WIDTH * 0.6} ${upperKink}`,
    `L ${x + REST_WIDTH} ${y}`,
    `L ${x - REST_WIDTH} ${lowerKink}`,
    `Q ${x + REST_WIDTH * 0.7} ${bottom - 0.15} ${x - REST_WIDTH * 0.3} ${bottom}`,
  ].join(' ')
}

function Rests({ rests }: { readonly rests: readonly EngravedRest[] }): ReactElement {
  return (
    <g className="groove-rests" aria-hidden="true">
      {rests.map((rest) => (
        <path
          key={`${rest.voice}-${rest.x}`}
          className="groove-rest groove-rest-quarter"
          d={quarterRestPath(rest.x, rest.y)}
        />
      ))}
    </g>
  )
}

/**
 * The end-of-line repeat barline (thick line, thin line just inside it, two
 * dots) drawn in place of a plain barline when `layout.playCount > 1`. The
 * figure states one bar; the trainer grades `playCount` of them, and this is
 * notation's own way of saying so instead of leaving the chart and the
 * grading silently disagreeing about how much music there is.
 */
function RepeatBarline({
  x,
  topY,
  bottomY,
}: {
  readonly x: number
  readonly topY: number
  readonly bottomY: number
}): ReactElement {
  const thinX = x - REPEAT_LINE_GAP
  const dotX = thinX - REPEAT_DOT_INSET
  return (
    <g className="groove-repeat-barline" aria-hidden="true">
      <line className="groove-repeat-barline-thin" x1={thinX} x2={thinX} y1={topY} y2={bottomY} />
      <line className="groove-repeat-barline-thick" x1={x} x2={x} y1={topY} y2={bottomY} />
      <circle className="groove-repeat-dot" cx={dotX} cy={topY + 1.5} r={REPEAT_DOT_R} />
      <circle className="groove-repeat-dot" cx={dotX} cy={topY + 2.5} r={REPEAT_DOT_R} />
    </g>
  )
}

export function GrooveStaff({ layout, label, grooveId }: GrooveStaffProps): ReactElement {
  const { topY, bottomY } = staffSpan(layout.staffLines)
  const lastBarlineIndex = layout.barlines.length - 1
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
      {layout.barlines.map((x, i) =>
        i === lastBarlineIndex && layout.playCount > 1 ? (
          <RepeatBarline key={x} x={x} topY={topY} bottomY={bottomY} />
        ) : (
          <line key={x} className="groove-barline" x1={x} x2={x} y1={topY} y2={bottomY} />
        ),
      )}
      <PercussionClef topY={topY} bottomY={bottomY} />
      <TimeSignature ts={layout.timeSignature} />
      <Rests rests={layout.rests} />
      {layout.beams.map((beam) => (
        <Beam key={beam.noteIds.join('-')} beam={beam} />
      ))}
      {layout.notes.map((note) => (
        <Note key={note.id} note={note} />
      ))}
      <CountRow counts={layout.counts} />
      {layout.repeatLabel !== undefined && (
        <g className="groove-repeat-label-group" aria-hidden="true">
          <text
            className="groove-repeat-label"
            x={layout.repeatLabel.x}
            y={layout.repeatLabel.y}
            textAnchor="end"
          >
            {layout.repeatLabel.text}
          </text>
        </g>
      )}
    </svg>
  )
}
