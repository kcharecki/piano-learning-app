/**
 * What the groove trainer offers, and in what order (roadmap DR-09/T.17).
 *
 * **Easiest first.** The picker opens on the first entry, so the first entry
 * has to be the groove a learner with no drum experience can actually get
 * through: `quarterNoteRock` puts every limb on a beat. The money beat, which
 * is the Rockschool Debut content this feature exists to teach, is one step
 * along; the open-hat variant is two.
 *
 * **`ghostFunkBar` is last, on purpose.** It is a real reference groove — half
 * of what makes it that groove is dynamics, eight ghosted snare strokes
 * against two accents — and it stayed OFF this list while the trainer only
 * graded onsets: offering it would have advertised a skill the app could not
 * sense, and graded the learner as though it had (a panel BLOCKER on the
 * first attempt at this feature). It comes back now that a pad press carries
 * a velocity (review round 3, RED 2 — keyboard Shift/Alt modifiers and MIDI
 * velocity both reach `padDynamics`; a mouse click is UNCLASSIFIED and
 * excluded from dynamics grading rather than silently marked wrong, see
 * `dynamics.ts`), placed last because it is the hardest entry: the finest
 * grid (sixteenths) AND the only one graded on touch, not just onset.
 */
import {
  ghostFunkBar,
  moneyBeat,
  moneyBeatOpenHat,
  quarterNoteRock,
} from '@core/drums/model/referenceGrooves.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'

/** The trainer's grooves, easiest first. See the module comment for what is not here and why. */
/**
 * Typed non-empty on purpose: the picker indexes this list and every caller
 * would otherwise need a branch for "the curriculum shipped no grooves",
 * which is a build failure, not a state a screen can render its way out of.
 */
export function grooveTrainerLibrary(): readonly [GrooveScore, ...GrooveScore[]] {
  return [quarterNoteRock(), moneyBeat(), moneyBeatOpenHat(), ghostFunkBar()]
}
