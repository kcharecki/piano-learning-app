/**
 * `DrumKey` (roadmap DR-05 / T.30) — the legend a percussion staff needs and
 * this app's first version shipped without. Percussion notation has no fixed
 * convention: the same staff position and notehead shape name different
 * drums from one method book to the next, so a chart that never names its
 * noteheads is only readable by someone who already knew the pattern before
 * they looked at it.
 *
 * The first version of this legend drew only the notehead SHAPE per pad —
 * an adversarial panel rejected it, because snare and kick both use the
 * `normal` (ellipse) notehead and so drew as byte-identical rows. A learner
 * who read those two rows the wrong way round scored `0 of 4, 4 missed,
 * 4 extra` on both limbs, having played exactly the right thing. In drum
 * notation POSITION is the identity and shape is secondary, so this version
 * draws each row as a miniature staff excerpt — five lines, the notehead at
 * its real vertical position (read straight off the same `EngravedNote.y`
 * the staff itself drew, never a second, hand-picked position that could
 * drift from it), and a stem in the pad's own voice direction. Position and
 * shape now both encode the pad, exactly the panel's standing consensus.
 *
 * It reuses the exact same glyph-drawing code (`./NoteGlyphs.tsx`) the staff
 * itself uses, so a shape a learner sees here is provably the same shape
 * they see on the staff, not a hand-copied second drawing of it.
 *
 * This is also, deliberately, the one place a sighted learner gets an
 * explanation a screen-reader learner already had for free: `describeGroove`
 * speaks an "open" articulation in words, but nothing sighted ever told a
 * reader that the circle over a hi-hat note names a FOOT technique (holding
 * the pedal up), not a second thing to hit with a stick. See the caption
 * below — the panel graded its absence a MAJOR.
 */
import type { ReactElement } from 'react'
import { at } from '@core/shared/invariant.ts'
import type { EngravedNote, StaffLayout } from '@core/drums/engrave/layout.ts'
import type { MappedDrumPad, Notehead, Voice } from '@core/drums/model/pad.ts'
import { ACCENT_HALF_HEIGHT, AccentMark, MARK_GAP, NoteheadShape, OPEN_MARK_R, OpenMark } from './NoteGlyphs.tsx'

export type DrumKeyProps = {
  readonly layout: StaffLayout
  /** Human name for a pad, e.g. "Open hi-hat". */
  readonly labelFor: (pad: MappedDrumPad) => string
  /** The key that plays it here, already labelled ("J", "Space"), or undefined. */
  readonly keyFor: (pad: MappedDrumPad) => string | undefined
}

/**
 * Only these two get drawn in the key. `ghost` is a per-hit dynamic — the
 * same snare can be played ghosted on one note and accented on the next —
 * not a fact about the pad itself, so it has nothing to add to a legend that
 * is naming pads, not individual hits.
 */
type KeyMark = 'open' | 'accent'

type PadRow = {
  readonly pad: MappedDrumPad
  /** Absolute `y`, same units and origin as `EngravedNote.y` — only used to sort and to derive the row's position relative to its own mini staff. */
  readonly y: number
  readonly notehead: Notehead
  readonly voice: Voice
  readonly mark: KeyMark | undefined
}

/**
 * One row per distinct pad in `layout.notes`, highest on the staff first
 * (ascending `y`), ties on pad name so the order never depends on `Map`
 * iteration order. `open` wins over `accent` when a pad's notes carry both
 * across the score — nothing in this trainer's content puts both on one pad
 * today, so that tie-break never actually fires, but the identity-defining
 * articulation is the one worth surfacing if it ever does. `voice` is
 * carried alongside `y` and `notehead` on the same assumption their own doc
 * comments already make: every note for one pad shares a voice, because
 * `voiceOf` is a function of the pad alone.
 */
function padRows(notes: readonly EngravedNote[]): readonly PadRow[] {
  const byPad = new Map<
    MappedDrumPad,
    { y: number; notehead: Notehead; voice: Voice; hasOpen: boolean; hasAccent: boolean }
  >()
  for (const note of notes) {
    const existing = byPad.get(note.pad)
    byPad.set(note.pad, {
      y: existing?.y ?? note.y,
      notehead: existing?.notehead ?? note.notehead,
      voice: existing?.voice ?? note.voice,
      hasOpen: (existing?.hasOpen ?? false) || note.marks.includes('open'),
      hasAccent: (existing?.hasAccent ?? false) || note.marks.includes('accent'),
    })
  }
  return [...byPad.entries()]
    .map(([pad, info]) => ({
      pad,
      y: info.y,
      notehead: info.notehead,
      voice: info.voice,
      mark: info.hasOpen ? ('open' as const) : info.hasAccent ? ('accent' as const) : undefined,
    }))
    .sort((a, b) => a.y - b.y || a.pad.localeCompare(b.pad))
}

function markHalfHeight(mark: KeyMark): number {
  return mark === 'open' ? OPEN_MARK_R : ACCENT_HALF_HEIGHT
}

// ------------------------------------------------------------- mini staff

/**
 * Width of each row's own five-line staff excerpt, in the same staff-space
 * units `layout.ts` uses — wide enough to read as a staff, not so wide the
 * legend reads as a second score.
 */
const MINI_WIDTH = 5
const MINI_NOTE_X = MINI_WIDTH / 2
/** Keeps the drawn lines just short of the row's own edges. */
const LINE_INSET = 0.3
/**
 * Deliberately shorter than the real staff's `STEM_LENGTH` (3.5): a legend
 * row only has to state which DIRECTION a stem goes, not draw it at the
 * length the real staff needs to clear beams and marks, and a full-length
 * stem would blow the compact row height this row is meant to keep.
 */
const MINI_STEM_LENGTH = 2
/**
 * Half the glyph's own bounding box — sized to fit every notehead shape,
 * including the `diamond`'s rotated corners, the widest case
 * (`sqrt(NOTEHEAD_RX² + NOTEHEAD_RY²)`).
 */
const GLYPH_HALF = 0.75
/** Slack past the topmost/bottommost ink so a stroked end is not clipped by half its own width. */
const EDGE_PAD = 0.3

type MiniGeometry = {
  readonly viewBoxTop: number
  readonly viewBoxHeight: number
  readonly stemToY: number
  readonly markCy: number | undefined
}

/**
 * Where everything in one row lands, relative to THIS ROW's own top staff
 * line (always drawn at local `y = 0`). Mirrors `staff.ts`'s real geometry at
 * legend scale: the stem runs up for `hands`, down for `feet`
 * (`voiceOf`'s hands-stems-up / feet-stems-down convention), and a mark
 * stacks clear of the stem for a hands note — landing an `open` ring ON the
 * stem is the notation for a HALF-open hi-hat, a different articulation,
 * which is exactly the defect `GrooveStaff`'s own `markAnchorY` contract
 * exists to prevent on the staff itself. A feet note's stem runs away from
 * the head, so its mark only has to clear the notehead.
 */
function miniGeometry(relY: number, voice: Voice, mark: KeyMark | undefined): MiniGeometry {
  const stemDir = voice === 'hands' ? -1 : 1
  const stemToY = relY + stemDir * MINI_STEM_LENGTH
  const markHalf = mark === undefined ? 0 : markHalfHeight(mark)
  const markCy =
    mark === undefined
      ? undefined
      : voice === 'hands'
        ? stemToY - MARK_GAP - markHalf
        : relY - GLYPH_HALF - MARK_GAP - markHalf

  const markTop = markCy === undefined ? undefined : markCy - markHalf
  const markBottom = markCy === undefined ? undefined : markCy + markHalf
  const tops = [0, relY - GLYPH_HALF, stemToY, ...(markTop === undefined ? [] : [markTop])]
  const bottoms = [4, relY + GLYPH_HALF, stemToY, ...(markBottom === undefined ? [] : [markBottom])]
  const viewBoxTop = Math.min(...tops) - EDGE_PAD
  const viewBoxBottom = Math.max(...bottoms) + EDGE_PAD
  return { viewBoxTop, viewBoxHeight: viewBoxBottom - viewBoxTop, stemToY, markCy }
}

/**
 * One row's staff excerpt: five lines, this pad's real notehead at its real
 * vertical position (`row.y - topLineY`, the same subtraction `GrooveStaff`
 * would need to place it on the real staff), a short stem in its voice's
 * direction, and its mark if it carries one. `aria-hidden` because the row's
 * text (name, then key) is what a screen reader needs — this is a picture
 * for a sighted reader, same split the old `PadGlyph` kept.
 */
function MiniStaff({ row, topLineY }: { readonly row: PadRow; readonly topLineY: number }): ReactElement {
  const relY = row.y - topLineY
  const { viewBoxTop, viewBoxHeight, stemToY, markCy } = miniGeometry(relY, row.voice, row.mark)
  return (
    <svg
      className="drum-key-mini-staff"
      viewBox={`0 ${viewBoxTop} ${MINI_WIDTH} ${viewBoxHeight}`}
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((lineOffset) => (
        <line
          key={lineOffset}
          className="groove-staff-line"
          x1={LINE_INSET}
          x2={MINI_WIDTH - LINE_INSET}
          y1={lineOffset}
          y2={lineOffset}
        />
      ))}
      <line className="groove-stem" x1={MINI_NOTE_X} y1={relY} x2={MINI_NOTE_X} y2={stemToY} />
      <NoteheadShape notehead={row.notehead} cx={MINI_NOTE_X} cy={relY} />
      {row.mark === 'open' && markCy !== undefined && <OpenMark cx={MINI_NOTE_X} cy={markCy} />}
      {row.mark === 'accent' && markCy !== undefined && <AccentMark cx={MINI_NOTE_X} cy={markCy} />}
    </svg>
  )
}

const OPEN_HAT_CAPTION =
  'The circle means the hi-hat is open — on a kit your left foot lifts the pedal as you strike. Here it is its own pad.'

export function DrumKey(props: DrumKeyProps): ReactElement {
  const { layout, labelFor, keyFor } = props
  const rows = padRows(layout.notes)
  const showsOpenCaption = rows.some((row) => row.mark === 'open')
  const topLineY = at(layout.staffLines, 0).y
  return (
    <div className="drum-key" data-drum-key="">
      <ul className="drum-key-list">
        {rows.map((row) => {
          const key = keyFor(row.pad)
          return (
            <li key={row.pad} className="drum-key-row">
              <MiniStaff row={row} topLineY={topLineY} />
              {/* Label and shortcut share one box so the row's flex gap never
                  opens a space before the comma ("Hi-hat , J"). */}
              <span className="drum-key-text">
                <span className="drum-key-label">{labelFor(row.pad)}</span>
                {key !== undefined && <span className="drum-key-shortcut">, {key}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {showsOpenCaption && <p className="drum-key-caption">{OPEN_HAT_CAPTION}</p>}
    </div>
  )
}
