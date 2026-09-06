/**
 * The shape of an engraved groove (roadmap DR-05) — types only, so the
 * geometry (`./staff.ts`) and the renderer (`@app/drums/notation/GrooveStaff.tsx`)
 * can be built and reviewed against one written contract rather than against
 * each other.
 *
 * ## Units and axes
 *
 * Every number here is in **staff spaces**, never pixels: one unit is the
 * distance between two adjacent staff lines. The renderer picks a scale and a
 * viewBox; this module and `./staff.ts` never learn what a pixel is, the same
 * split `core/notation/pianoRoll.ts` keeps with `app/practice/PianoRoll.tsx`.
 *
 * `y` grows **downward**, as SVG's does, so a smaller `y` is higher on the
 * staff. The five staff lines sit at `staffLines[0].y + 0..4`.
 *
 * ## Why the vertical box is derived, not fixed
 *
 * It used to be fixed — a constant `STAFF_TOP_Y`, a constant count-row `y`
 * and a constant height, all calibrated for hi-hats. That is wrong at both
 * ends of the pad table, and one end was wrong for content the trainer ships
 * today: a kick sits in the bottom space with its stem pointing **down**, so
 * its stem ran 0.5 spaces past the count row and straight through the "1 & 2 &"
 * labels on every groove with a kick in it — which is all of them. At the
 * other end, `splash` sits two spaces above the top line, so its stem-up tip
 * landed at a negative `y`, off the top of the canvas entirely.
 *
 * No single pair of constants can be right for both, because how far the ink
 * reaches above and below the staff is a property of *the notes in this
 * score*, not of the staff. So `./staff.ts` measures the score and places the
 * staff inside a box that fits it: the constants below are the minimums and
 * the paddings that measurement uses, and `StaffLayout.height`,
 * `staffLines[].y` and `EngravedCount.y` carry the answer. A layout is still
 * guaranteed entirely non-negative, so the renderer's viewBox stays
 * `0 0 width height` and never carries an offset.
 *
 * The consequence for the renderer: it must read the staff's position off
 * `layout.staffLines`, never off a constant here.
 */
import type { DynamicsClass } from '@core/drums/model/groove.ts'
import type { MappedDrumPad, Notehead, Voice } from '@core/drums/model/pad.ts'

/** A mark drawn with a notehead, beyond the notehead shape itself. */
export type NoteMark = 'open' | 'accent' | 'ghost'

export type EngravedNote = {
  /** The model's own `GrooveNote.id` — `measureIndex.pad.tick`. */
  readonly id: string
  readonly pad: MappedDrumPad
  readonly tick: number
  readonly x: number
  readonly y: number
  readonly notehead: Notehead
  readonly voice: Voice
  readonly dynamics: DynamicsClass
  /** Always in the order `open`, `accent`, `ghost`; never contains duplicates. */
  readonly marks: readonly NoteMark[]
  /**
   * Flags to draw at the stem tip: 0 for a quarter or longer, and 0 for any
   * note carried by a beam (a beam IS the flag, shared). Otherwise 1 for an
   * eighth, 2 for a sixteenth.
   *
   * Without this an unbeamed eighth would draw as a bare stem — which is a
   * quarter note. Rhythm is the whole content of a drum part, so a figure
   * that cannot tell those apart is not merely plain, it is wrong.
   */
  readonly flags: number
  /**
   * Where this note's stem ends; it starts at the notehead. Above the head for
   * `hands` (`stemToY < y`), below it for `feet` (`stemToY > y`) — the
   * hands-up/feet-down convention `voiceOf` exists to express. Notes sharing a
   * voice and a tick share one stem, so they share this value.
   */
  readonly stemToY: number
}

export type EngravedBeam = {
  readonly voice: Voice
  /** The notes this beam joins, in ascending `x`. Never fewer than two. */
  readonly noteIds: readonly string[]
  readonly fromX: number
  readonly toX: number
  readonly y: number
  /** Beam lines to draw: 1 for eighths, 2 for sixteenths. */
  readonly count: number
}

export type EngravedLine = {
  readonly y: number
  readonly fromX: number
  readonly toX: number
}

/** One label in the count row under the staff ("1", "&", "e", "a"). */
export type EngravedCount = {
  readonly text: string
  readonly x: number
  readonly y: number
}

export type StaffLayout = {
  readonly width: number
  readonly height: number
  /** Exactly five, top to bottom, one space apart. The staff's position is here and nowhere else. */
  readonly staffLines: readonly EngravedLine[]
  /** The x of every barline, opening and final included, in ascending order. */
  readonly barlines: readonly number[]
  /** One per `GrooveScore` note, in the score's own order. */
  readonly notes: readonly EngravedNote[]
  readonly beams: readonly EngravedBeam[]
  readonly counts: readonly EngravedCount[]
}

/**
 * Least headroom above the top staff line, used when the score's own ink asks
 * for less. Sized for the hi-hat — the pad in routine use that sits highest —
 * so the common groove keeps the airy proportions it had before the box was
 * derived, rather than every staff paying for a `splash` nobody plays.
 */
export const MIN_STAFF_TOP_Y = 5
/** x of the opening barline; the percussion clef is drawn in the space before it. */
export const LEFT_MARGIN = 3
/**
 * Horizontal space one grid slot occupies — a bar is as wide as the notes in
 * it need, not a constant.
 *
 * It was a constant (12 spaces per bar) and that is too tight the moment a
 * bar is busy: 16 sixteenths in 12 spaces puts noteheads 0.75 apart when a
 * notehead is 1.2 wide, so they overlap, and their ghost parentheses merge
 * into one long bracket. Even the shipped Money Beat, at eight eighths to the
 * bar, left 0.3 of a space between hi-hats — and telling those eight apart is
 * the entire point of the figure, since one of them is the open hat.
 *
 * The slot is the count row's own subdivision (`gridStepFor`), so spacing and
 * counting always agree: a bar of quarters is narrow, a bar of sixteenths is
 * four times as wide, and the staff space itself never changes size.
 */
export const SLOT_WIDTH = 2.2
/** Breathing room after the final barline. */
export const RIGHT_MARGIN = 1
/** How far a stem runs from its notehead. */
export const STEM_LENGTH = 3.5
/**
 * Room reserved above a notehead that carries marks. The renderer stacks
 * `open` and `accent` outward from the head (`GrooveStaff.markCenters`); this
 * is the budget it must stay inside, checked by that component's own test, so
 * core can reserve the space without importing the renderer's glyph sizes.
 */
export const MARK_RESERVE = 2.5
/**
 * Slack past the topmost and bottommost ink, so a stroked end does not sit
 * exactly on the canvas edge and get clipped by half its own width.
 */
export const EDGE_PAD = 0.25
/** Distance from the lowest ink (or the bottom staff line) down to the count row's baseline. */
export const COUNT_ROW_GAP = 1.5
/** Room below the count row's baseline for the glyphs' descenders and a margin. */
export const COUNT_ROW_DESCENT = 1.5
