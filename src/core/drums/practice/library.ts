/**
 * What the groove trainer offers, and in what order (roadmap DR-09/T.17).
 *
 * **Easiest first.** The picker opens on the first entry, so the first entry
 * has to be the groove a learner with no drum experience can actually get
 * through: `quarterNoteRock` puts every limb on a beat. The money beat, which
 * is the Rockschool Debut content this feature exists to teach, is one step
 * along; the open-hat variant is two.
 *
 * **`ghostFunkBar` is deliberately absent.** It is a real reference groove and
 * it round-trips through MusicXML like the others, but half of what makes it
 * that groove is dynamics — eight ghosted snare strokes against two accents.
 * The trainer grades onsets. It has no velocity to read from a pad press or a
 * key, so offering it would advertise a skill the app cannot sense and then
 * grade the learner as though it had; that was a panel BLOCKER on the first
 * attempt at this feature, and the fix is to not offer it, not to grade it
 * loosely. It comes back when a pad press carries a velocity (DR-02's e-kit
 * path, or a pressure-sensitive input), and not before.
 */
import {
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
  return [quarterNoteRock(), moneyBeat(), moneyBeatOpenHat()]
}
