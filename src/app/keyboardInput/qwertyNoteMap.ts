/**
 * The computer-keyboard note mapping (roadmap 5.5) — one fixed physical-key
 * layout, shared by every screen that answers with a note (Practice,
 * Flashcards, Theory, Dictation).
 *
 * The bottom row (A S D F G H J K L ;) plays the white keys of a C-major
 * scale-and-a-third, in order; the row above (W E T Y U O P) plays the black
 * keys, each positioned over the white-key gap it sits at on a real piano
 * (no key above the D-F or J-K gaps, which is where a real keyboard has no
 * black key either). This is the geography a learner already has muscle
 * memory for from the on-screen and MIDI keyboards, just laid sideways.
 *
 * Keyed by `KeyboardEvent.code` (the physical key), not `.key`, so the
 * mapping does not change under Shift or a non-QWERTY layout.
 */
import { midi as asMidi, type Midi } from '@core/shared/units.ts'

const OFFSET_BY_CODE: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
}

/** The note a physical key plays, `baseNote` steps up from `KeyA`. `undefined` for an unmapped key. */
export function noteForCode(code: string, baseNote: Midi): Midi | undefined {
  const offset = OFFSET_BY_CODE[code]
  return offset === undefined ? undefined : asMidi(baseNote + offset)
}

/**
 * `KeyA` always plays the BOTTOM of the caller's range, not middle C.
 *
 * The mapping only ever climbs (offsets 0..16) — it cannot reach a note below
 * its base. Anchoring at middle C looked tidy but made every note below it
 * unreachable: the bundled sample's own first beat is 48-52-55-60, and only
 * the 60 would have been playable. Anchoring at `low` instead means the
 * bottom of whatever range a screen actually asks for is always `KeyA`, and
 * everything the mapping CAN reach is real, playable content rather than
 * empty headroom above the piece.
 */
export function defaultBaseNote(low: Midi, _high: Midi): Midi {
  return low
}
