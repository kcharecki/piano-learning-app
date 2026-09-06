/**
 * `DrumKey` (roadmap DR-05) — the legend a percussion staff needs and this
 * app's first version shipped without. Percussion notation has no fixed
 * convention: the same staff position and notehead shape name different
 * drums from one method book to the next, so a chart that never names its
 * noteheads is only readable by someone who already knew the pattern before
 * they looked at it. It sits under `GrooveStaff`, drawing one row per pad
 * that actually appears in the score, using the exact same glyph-drawing
 * code (`./NoteGlyphs.tsx`) the staff itself uses — so the circle a learner
 * sees here is provably the same circle they see on the staff, not a second,
 * hand-copied drawing of it that can quietly drift out of sync.
 *
 * This is also, deliberately, the one place a sighted learner gets an
 * explanation a screen-reader learner already had for free: `describeGroove`
 * speaks an "open" articulation in words, but nothing sighted ever told a
 * reader that the circle over a hi-hat note names a FOOT technique (holding
 * the pedal up), not a second thing to hit with a stick. See the caption
 * below — the panel graded its absence a MAJOR.
 */
import type { ReactElement } from 'react'
import type { EngravedNote, StaffLayout } from '@core/drums/engrave/layout.ts'
import type { MappedDrumPad, Notehead } from '@core/drums/model/pad.ts'
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
  readonly y: number
  readonly notehead: Notehead
  readonly mark: KeyMark | undefined
}

/**
 * One row per distinct pad in `layout.notes`, highest on the staff first
 * (ascending `y`), ties on pad name so the order never depends on `Map`
 * iteration order. `open` wins over `accent` when a pad's notes carry both
 * across the score — nothing in this trainer's content puts both on one pad
 * today, so that tie-break never actually fires, but the identity-defining
 * articulation is the one worth surfacing if it ever does.
 */
function padRows(notes: readonly EngravedNote[]): readonly PadRow[] {
  const byPad = new Map<MappedDrumPad, { y: number; notehead: Notehead; hasOpen: boolean; hasAccent: boolean }>()
  for (const note of notes) {
    const existing = byPad.get(note.pad)
    byPad.set(note.pad, {
      y: existing?.y ?? note.y,
      notehead: existing?.notehead ?? note.notehead,
      hasOpen: (existing?.hasOpen ?? false) || note.marks.includes('open'),
      hasAccent: (existing?.hasAccent ?? false) || note.marks.includes('accent'),
    })
  }
  return [...byPad.entries()]
    .map(([pad, info]) => ({
      pad,
      y: info.y,
      notehead: info.notehead,
      mark: info.hasOpen ? ('open' as const) : info.hasAccent ? ('accent' as const) : undefined,
    }))
    .sort((a, b) => a.y - b.y || a.pad.localeCompare(b.pad))
}

/** Half the glyph's own bounding box — sized to fit every notehead shape,
 *  including the `diamond`'s rotated corners, the widest case. */
const GLYPH_HALF = 0.75
const GLYPH_PAD = 0.2

function markHalfHeight(mark: KeyMark): number {
  return mark === 'open' ? OPEN_MARK_R : ACCENT_HALF_HEIGHT
}

/**
 * The same notehead and `open`/`accent` glyphs `GrooveStaff` draws, sized
 * for a small legend row rather than a staff position. There is no stem
 * here to clear, so the mark simply stacks directly above the notehead.
 */
function PadGlyph({ notehead, mark }: { readonly notehead: Notehead; readonly mark: KeyMark | undefined }): ReactElement {
  const topExtra = mark === undefined ? 0 : MARK_GAP + markHalfHeight(mark) * 2
  const width = (GLYPH_HALF + GLYPH_PAD) * 2
  const height = GLYPH_HALF + GLYPH_PAD + topExtra + GLYPH_HALF + GLYPH_PAD
  const cx = width / 2
  const noteCy = height - GLYPH_HALF - GLYPH_PAD
  const markCy = mark === undefined ? undefined : noteCy - GLYPH_HALF - MARK_GAP - markHalfHeight(mark)
  return (
    <svg className="drum-key-glyph" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <NoteheadShape notehead={notehead} cx={cx} cy={noteCy} />
      {mark === 'open' && markCy !== undefined && <OpenMark cx={cx} cy={markCy} />}
      {mark === 'accent' && markCy !== undefined && <AccentMark cx={cx} cy={markCy} />}
    </svg>
  )
}

const OPEN_HAT_CAPTION =
  'The circle means the hi-hat is open — on a kit your left foot lifts the pedal as you strike. Here it is its own pad.'

export function DrumKey(props: DrumKeyProps): ReactElement {
  const { layout, labelFor, keyFor } = props
  const rows = padRows(layout.notes)
  const showsOpenCaption = rows.some((row) => row.mark === 'open')
  return (
    <div className="drum-key" data-drum-key="">
      <ul className="drum-key-list">
        {rows.map((row) => {
          const key = keyFor(row.pad)
          return (
            <li key={row.pad} className="drum-key-row">
              <PadGlyph notehead={row.notehead} mark={row.mark} />
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
