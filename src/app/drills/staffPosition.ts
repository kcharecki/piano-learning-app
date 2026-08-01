/**
 * Pure staff-position math for `StaffNote.tsx` (roadmap 2.12, REQ-3.4.5).
 *
 * A flashcard's whole point is to make the learner read the note's POSITION
 * rather than be told its name, so the prompt has to be a real, computed
 * staff position — not text that would give the answer away.
 *
 * ## The step number
 *
 * `staffStep` returns an integer diatonic step, counted from the clef's
 * bottom line (step 0), where even steps are lines and odd steps are spaces —
 * this holds for both clefs because the bottom-line reference note of each
 * (E4 for treble, G2 for bass) is itself a line, and every diatonic letter
 * step alternates line/space by construction of the five-line staff. Steps
 * are plain diatonic distance (`letterIndex` + octave*7), so an accidental
 * (`alter`) never moves a note off its letter's line or space — sharps and
 * flats are drawn as a separate symbol, not a position shift.
 *
 * Verified against the standard mnemonics: treble lines bottom-to-top are E4
 * G4 B4 D5 F5 ("Every Good Boy Does Fine"), spaces F4 A4 C5 E5 ("FACE"); bass
 * lines are G2 B2 D3 F3 A3 ("Good Boys Do Fine Always"), spaces A2 C3 E3 G3.
 * Middle C4 lands two steps below the treble staff (step -2, a line — the
 * textbook one-ledger-line-below picture) and two steps above the bass staff
 * (step 10, also a line, by the same parity).
 */
import { letterIndex, type SpelledPitch } from '@core/theory/pitch.ts'
import type { Clef } from '@core/drills/flashcards.ts'

/** The bottom staff line's reference pitch for each clef. */
const CLEF_BOTTOM_LINE: Record<Clef, SpelledPitch> = {
  treble: { letter: 'E', alter: 0, octave: 4 },
  bass: { letter: 'G', alter: 0, octave: 2 },
}

/** Diatonic distance from C0 — the ordering `staffStep` measures steps along. */
function diatonicIndex(p: SpelledPitch): number {
  return p.octave * 7 + letterIndex(p.letter)
}

/**
 * `spelled`'s position on `clef`'s staff: 0 is the bottom line, 8 the top
 * line, even numbers lines and odd numbers spaces. Negative or above 8 means
 * below/above the staff — `ledgerSteps` says which ledger lines that needs.
 */
export function staffStep(spelled: SpelledPitch, clef: Clef): number {
  return diatonicIndex(spelled) - diatonicIndex(CLEF_BOTTOM_LINE[clef])
}

/**
 * Ledger line positions a note at `step` needs drawn for reference — even
 * steps only, since a ledger line is always drawn ON a line, never through a
 * space. A note one step off the staff (the space right below/above it) needs
 * none: it reads directly off the staff's own edge. A note further out needs
 * every ledger line from the staff's edge up to the nearest line AT OR
 * BEYOND it — including one for a note that itself sits in a ledger space,
 * exactly as engraved notation draws the reference line under/over a note
 * hanging past it (e.g. the third space below a treble staff still only
 * shows the two ledger lines nearer the staff, not a line through the note's
 * own space).
 */
export function ledgerSteps(step: number): readonly number[] {
  const out: number[] = []
  if (step < 0) {
    const anchor = step % 2 === 0 ? step : step + 1
    for (let s = -2; s >= anchor; s -= 2) out.push(s)
  } else if (step > 8) {
    const anchor = step % 2 === 0 ? step : step - 1
    for (let s = 10; s <= anchor; s += 2) out.push(s)
  }
  return out
}
