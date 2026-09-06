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
 *
 * ## What the horizontal head of the staff holds
 *
 * Left to right: the percussion clef in `[0, CLEF_WIDTH]`, the time signature
 * in the `TIME_SIGNATURE_WIDTH` after it, then the music, whose first notehead
 * sits half a slot further right again. There is **no opening barline**. There
 * used to be one at the same x as the first notehead, so it bisected every
 * beat-1 kick on every groove, and the clef was drawn to the left of it where
 * the staff lines had not started yet — the clef floated beside the staff
 * rather than sitting on it. The staff lines now start at x 0 and run to the
 * final barline, which is where a five-line staff's own left edge is: a bar's
 * opening is stated by the staff beginning, not by a redundant line drawn
 * through the first note of the bar.
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
  /**
   * Where the renderer starts stacking this note's `open` and `accent` marks,
   * growing **upward** from here (a smaller `y` for each further mark).
   * `ghost` ignores it and draws beside the head.
   *
   * It is a layout output rather than a renderer calculation because it has to
   * clear the note's own **stem and beam**, and only this module knows where
   * those ended up. The renderer used to stack marks outward from the notehead
   * itself, which put the open-hi-hat circle exactly on the hi-hat's stem: a
   * ring with a vertical bar through it is the sign for a HALF-open hi-hat,
   * a different articulation from the one the score said. That is the single
   * glyph this whole figure exists to state, so it gets its position from the
   * pass that knows the stem.
   *
   * For a `hands` note that is above the stem tip (or the beam, which is where
   * a beamed note's `stemToY` already points); for a `feet` note the stem runs
   * downward, so it is just above the notehead.
   */
  readonly markAnchorY: number
}

/**
 * One horizontal run of beam at one thickness level, at `EngravedBeam.y`
 * offset outward by `level - 1` steps.
 *
 * Levels exist separately because a beat's secondary (sixteenth) beam does not
 * always span the same notes its primary (eighth) beam does. Two sixteenths on
 * "1" and "1 a" are one beamed group — but only the primary beam runs the
 * whole way; each sixteenth carries its own **partial** secondary stub,
 * pointing at where its neighbour would be. Drawing the secondary beam full
 * width, as this once did, states four consecutive sixteenths where the music
 * has two notes and a gap.
 */
export type EngravedBeamSegment = {
  /** 1 for the eighth-note beam, 2 for the sixteenth-note beam. */
  readonly level: number
  readonly fromX: number
  readonly toX: number
}

export type EngravedBeam = {
  readonly voice: Voice
  /** The notes this beam joins, in ascending `x`. Never fewer than two. */
  readonly noteIds: readonly string[]
  /** The whole group's span — `segments` is what to actually draw. */
  readonly fromX: number
  readonly toX: number
  readonly y: number
  /** Never empty, and always contains exactly one `level: 1` segment. */
  readonly segments: readonly EngravedBeamSegment[]
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

/**
 * A voice's silence for one whole beat, drawn in that voice's half of the
 * staff. The engraver writes one rest per silent BEAT and never subdivides
 * further: a drum chart states the pulse a limb is resting through, and a bar
 * of hi-hats with the kick out on 2 and 4 wants two quarter rests, not a
 * thicket of sixteenth rests inside the beats the limb does play. A beat a
 * voice plays any part of gets no rest at all — the beam over it already says
 * where its subdivisions are.
 */
export type EngravedRest = {
  readonly voice: Voice
  readonly x: number
  readonly y: number
  /** How many beats this rest covers. Always 1 today; the renderer picks its glyph from it. */
  readonly beats: number
}

/** The meter, stated once at the head of the staff as engraving requires. */
export type EngravedTimeSignature = {
  readonly beats: number
  readonly beatType: number
  /** Centre x of both digits. */
  readonly x: number
  /** The top staff line's `y`; the renderer stacks the two digits over the staff's middle. */
  readonly y: number
}

/** The "×N" over a repeat barline, present only when `playCount > 1`. */
export type EngravedRepeatLabel = {
  readonly text: string
  readonly x: number
  readonly y: number
}

export type StaffLayout = {
  readonly width: number
  readonly height: number
  /** Exactly five, top to bottom, one space apart. The staff's position is here and nowhere else. */
  readonly staffLines: readonly EngravedLine[]
  /**
   * The x of every barline between measures, plus the final one, in ascending
   * order. There is **no opening barline** — see the module doc. The last
   * entry is the final barline, and it is a REPEAT barline exactly when
   * `playCount > 1`.
   */
  readonly barlines: readonly number[]
  readonly timeSignature: EngravedTimeSignature
  /** One per `GrooveScore` note, in the score's own order. */
  readonly notes: readonly EngravedNote[]
  readonly beams: readonly EngravedBeam[]
  readonly rests: readonly EngravedRest[]
  readonly counts: readonly EngravedCount[]
  /**
   * How many times the drawn music is played through. The figure states one
   * bar; the trainer grades two, so before this the chart and the marking
   * disagreed by a whole bar and a learner who played exactly what was drawn
   * was told they had missed half of it. The repeat is the notation's own
   * answer to that, and it is here rather than in the renderer so the count
   * comes from the run's plan and not from a constant.
   *
   * Always at least 1. `1` means no repeat barline and no label.
   */
  readonly playCount: number
  /** Present exactly when `playCount > 1`. */
  readonly repeatLabel: EngravedRepeatLabel | undefined
}

/** Options for `engraveGroove`. */
export type EngraveOptions = {
  /** See `StaffLayout.playCount`. Must be a positive integer; defaults to 1. */
  readonly playCount?: number
}

/**
 * Least headroom above the top staff line, used when the score's own ink asks
 * for less. Sized for the hi-hat — the pad in routine use that sits highest —
 * so the common groove keeps the airy proportions it had before the box was
 * derived, rather than every staff paying for a `splash` nobody plays.
 */
export const MIN_STAFF_TOP_Y = 5
/**
 * The percussion clef's own width, from x 0. The staff lines start at 0 and
 * run under it, which is what makes it a clef ON a staff rather than a mark
 * beside one.
 */
export const CLEF_WIDTH = 2.6
/** Width the time signature's two stacked digits occupy, immediately after the clef. */
export const TIME_SIGNATURE_WIDTH = 1.8
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
 * Gap between a note's stem tip (or, for a `feet` note, its notehead) and the
 * first mark stacked off it — the distance `EngravedNote.markAnchorY` sits at.
 */
export const MARK_ANCHOR_GAP = 0.8
/**
 * Room reserved for the marks themselves, beyond `MARK_ANCHOR_GAP`. The
 * renderer stacks `open` and `accent` upward from `markAnchorY`; this is the
 * budget it must stay inside, checked by that component's own test, so core
 * can reserve the space without importing the renderer's glyph sizes.
 */
export const MARK_RESERVE = 2.5
/**
 * Room for the "×N" repeat label, when there is one — reserved above **all**
 * the score's other ink, not merely above the top staff line. Placing it a
 * fixed distance over the staff put it in the middle of the stem field: on
 * Money Beat the hi-hat stems reach four spaces above the top line, so the
 * label was drawn straight across the last one.
 */
export const REPEAT_LABEL_RESERVE = 2.2
/** Gap between the score's topmost note ink and the repeat label's baseline. */
export const REPEAT_LABEL_GAP = 0.6
/**
 * Extra width between the last notehead and the final barline when that
 * barline is a repeat. A repeat barline is not a line, it is an apparatus —
 * a thick line, a thin one, and two dots in the second and third spaces — and
 * the dots reach back into the bar. Without this the dots landed on the last
 * slot: on Quarter-Note Rock one was drawn exactly on the beat-4 snare, which
 * reads as a notehead with a dot on it rather than as a repeat.
 *
 * It is the renderer's whole budget: every part of the repeat apparatus must
 * fall within this distance of the final barline, and `GrooveStaff`'s own test
 * holds it to that.
 */
export const REPEAT_BARLINE_RESERVE = 1.4
/**
 * Slack past the topmost and bottommost ink, so a stroked end does not sit
 * exactly on the canvas edge and get clipped by half its own width.
 */
export const EDGE_PAD = 0.25
/** Distance from the lowest ink (or the bottom staff line) down to the count row's baseline. */
export const COUNT_ROW_GAP = 1.5
/** Room below the count row's baseline for the glyphs' descenders and a margin. */
export const COUNT_ROW_DESCENT = 1.5
