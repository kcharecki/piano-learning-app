/**
 * Pad <-> `<score-instrument>` identity — the part this module's doc comment
 * calls out as the thing that must NOT depend on display position or on a
 * possibly-colliding GM note (`snareRim`/`snare` share GM note 38).
 *
 * The writer declares one `<score-instrument>` per pad actually used, with
 * `<instrument-name>` set to `instrumentNameOf(pad)` — an exact, unambiguous
 * string. The parser's primary path matches that name straight back to a
 * pad, which is what makes OUR OWN round trip exact regardless of any GM
 * collision. A file we did not write ourselves (no matching name) falls back
 * to `<midi-unpitched>` via `padByGmNote`, which is inherently lossy where
 * GM collides — documented, not a bug: this bridge's contract is an exact
 * round trip of OUR OWN content, not universal drum-MusicXML interop.
 */
import { gmNoteOf, instrumentNameOf, MAPPED_PADS, padByInstrumentName, type MappedDrumPad } from '../pad.ts'

export type InstrumentId = string

/** Pads used in `score`, in canonical `MAPPED_PADS` order — the writer's declaration order. */
export function usedPads(
  score: { readonly notes: readonly { readonly pad: MappedDrumPad }[] },
): readonly MappedDrumPad[] {
  const present = new Set(score.notes.map((n) => n.pad))
  return MAPPED_PADS.filter((pad) => present.has(pad))
}

export function instrumentIdFor(index: number): InstrumentId {
  return `P1-I${index + 1}`
}

/** First pad (canonical order) whose GM note matches — the foreign-file fallback. Lossy on a collision. */
const PAD_BY_GM_NOTE: ReadonlyMap<number, MappedDrumPad> = (() => {
  const map = new Map<number, MappedDrumPad>()
  for (const pad of MAPPED_PADS) {
    const note = gmNoteOf(pad)
    if (note !== undefined && !map.has(note)) map.set(note, pad)
  }
  return map
})()

export function padByGmNote(note: number): MappedDrumPad | undefined {
  return PAD_BY_GM_NOTE.get(note)
}

/**
 * `instrumentNameOf`, narrowed for a statically-`MappedDrumPad` caller —
 * `instrumentNameOf` is `undefined` only for `unmapped`, which cannot occur
 * here since the parameter type already excludes it.
 */
export function padInstrumentName(pad: MappedDrumPad): string {
  const name = instrumentNameOf(pad)
  if (name === undefined) throw new Error(`unreachable: mapped pad ${pad} has no instrument name`)
  return name
}

export { padByInstrumentName }
