/**
 * Shared vocabulary for the drum MusicXML bridge (DR-04) — the parser
 * (`./parse.ts`) and writer (`./write.ts`) must agree on every one of these
 * tables byte-for-byte, so they live once, here.
 *
 * MusicXML has no first-class hi-hat/flam/drag/rimshot semantics (research
 * §5 notes OSMD itself has open gaps here — issue #887). Rather than invent
 * non-standard tags, every marking below reuses a REAL, schema-legal
 * MusicXML element for a plausible purpose, the same way real notation
 * software repurposes `<technical><open/>`/`<stopped/>` for hi-hat state:
 *
 *  - dynamics `accent`  -> `<notations><articulations><accent/></articulations></notations>`
 *  - dynamics `ghost`   -> `<notehead parentheses="yes">…</notehead>` (research §2's own convention)
 *  - articulation `open`   -> `<notations><technical><open/></technical></notations>`
 *  - articulation `choke`  -> `<notations><technical><other-technical>choke</other-technical></technical></notations>`
 *    (`<damp/>` is NOT valid here — it is a `<direction-type>` element, not a
 *    `<technical>` child; `<other-technical>` is the schema-legal escape
 *    hatch `<technical>` itself provides for exactly this case)
 *  - articulation `buzz`   -> `<notations><ornaments><tremolo type="single">3</tremolo></ornaments></notations>`
 *    (the standard single-note-tremolo buzz/multiple-bounce-roll marking)
 *  - articulation `flam`/`drag` -> `<notations><ornaments><other-ornament>flam</other-ornament></ornaments></notations>`
 *    (a real grace-note flam is future work — see the module doc in `./parse.ts`)
 *  - sticking `R`/`L` -> `<notations><technical><other-technical>R</other-technical></technical></notations>`
 *
 * `choke` and sticking can both be present on one note, so `<technical>` can
 * carry two `<other-technical>` children at once (schema-legal — it is a
 * repeatable choice group); `./parse.ts` disambiguates them by TEXT
 * (`'choke'` vs `R`/`L`), not by position.
 *
 * Pad IDENTITY never depends on any of the above — see `./instrument.ts`.
 * `<midi-unpitched>` is written as `gmNoteOf(pad) + 1`: the MusicXML spec's
 * `midi-128` type is 1-based ("MusicXML uses 1-based numbers rather than the
 * 0-based numbers often found in MIDI 1.0 documentation" — same offset
 * `<midi-program>` uses), so GM note 36 (kick) is written `37`.
 */
import type { Articulation } from '../articulation.ts'
import type { SwingUnit } from '../groove.ts'

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * `<type>` values in quarter notes, largest first — the vocabulary the
 * writer emits (`typeAndDots`). There is deliberately no reverse
 * (`<type>` -> quarters) table here: `./parse.ts` never falls back to
 * deriving a duration from `<type>`+dots (every note this bridge writes
 * carries an explicit `<duration>`, see that module's doc), so a
 * `QUARTERS_BY_TYPE` table would have no reader — removed rather than kept
 * as a table nothing consults.
 */
export const TYPE_QUARTERS: readonly (readonly [string, number])[] = [
  ['whole', 4],
  ['half', 2],
  ['quarter', 1],
  ['eighth', 0.5],
  ['16th', 0.25],
  ['32nd', 0.125],
  ['64th', 0.0625],
]

/** One dot adds a half, two dots three quarters — matches `core/notation/musicxml.ts`'s rule. */
export const dotFactor = (dots: number): number => 2 - 2 ** -dots

/** The largest `<type>` whose (possibly dotted) value does not exceed the duration. Engraving only. */
export function typeAndDots(durationTicks: number, ticksPerQuarter: number): { type: string; dots: number } {
  const quarters = durationTicks / ticksPerQuarter
  for (const [type, base] of TYPE_QUARTERS) {
    if (base > quarters && type !== '64th') continue
    let dots = 0
    while (dots < 2 && base * dotFactor(dots + 1) <= quarters) dots++
    return { type, dots }
  }
  return { type: '64th', dots: 0 } // unreachable: the loop always matches on '64th'
}

/** `<midi-channel>` for drums — GM percussion channel 10 (research §3). */
export const MIDI_PERCUSSION_CHANNEL = 10

/** The `choke` articulation, named for the `<technical>` markup it drives — see the module doc. */
export const CHOKE_ARTICULATION = 'choke' satisfies Articulation
export const OPEN_ARTICULATION = 'open' satisfies Articulation

/**
 * `<swing-type>`'s value is a MusicXML `note-type-value` string, which does
 * not spell "sixteenth" out — it uses `16th`, same short form `typeAndDots`
 * above already writes for note types. This is the one place the two
 * vocabularies (`SwingUnit` and MusicXML's `note-type-value`) touch, so the
 * mapping lives here rather than duplicated in `./write.ts`/`./parse.ts`.
 */
export const SWING_TYPE_XML: Readonly<Record<SwingUnit, string>> = {
  eighth: 'eighth',
  sixteenth: '16th',
}

export function swingUnitOfXml(value: string): SwingUnit | undefined {
  if (value === 'eighth') return 'eighth'
  if (value === '16th') return 'sixteenth'
  return undefined
}
