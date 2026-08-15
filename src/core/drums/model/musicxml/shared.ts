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
 *  - articulation `choke`  -> `<notations><technical><damp/></technical></notations>`
 *  - articulation `buzz`   -> `<notations><ornaments><tremolo type="single">3</tremolo></ornaments></notations>`
 *    (the standard single-note-tremolo buzz/multiple-bounce-roll marking)
 *  - articulation `flam`/`drag` -> `<notations><ornaments><other-ornament>flam</other-ornament></ornaments></notations>`
 *    (a real grace-note flam is future work — see the module doc in `./parse.ts`)
 *  - sticking `R`/`L` -> `<notations><technical><other-technical>R</other-technical></technical></notations>`
 *
 * Pad IDENTITY never depends on any of the above — see `./instrument.ts`.
 * `<midi-unpitched>` is written as `gmNoteOf(pad) + 1`: the MusicXML spec's
 * `midi-128` type is 1-based ("MusicXML uses 1-based numbers rather than the
 * 0-based numbers often found in MIDI 1.0 documentation" — same offset
 * `<midi-program>` uses), so GM note 36 (kick) is written `37`.
 */
import type { Articulation } from '../articulation.ts'
import type { DynamicsClass } from '../groove.ts'

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** `<type>` values in quarter notes, largest first — the vocabulary the writer emits. */
export const TYPE_QUARTERS: readonly (readonly [string, number])[] = [
  ['whole', 4],
  ['half', 2],
  ['quarter', 1],
  ['eighth', 0.5],
  ['16th', 0.25],
  ['32nd', 0.125],
  ['64th', 0.0625],
]

/** The same table, keyed for the parser's `<type>` -> quarters lookup. */
export const QUARTERS_BY_TYPE: Readonly<Record<string, number>> = Object.fromEntries(TYPE_QUARTERS)

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

export const ORNAMENT_ARTICULATIONS: ReadonlySet<Articulation> = new Set(['flam', 'drag', 'buzz'])
export const TECHNICAL_ARTICULATIONS: ReadonlySet<Articulation> = new Set(['open', 'choke'])

export const DAMP_ARTICULATION = 'choke' satisfies Articulation
export const OPEN_ARTICULATION = 'open' satisfies Articulation

export function isDynamicsClass(value: string): value is DynamicsClass {
  return value === 'accent' || value === 'normal' || value === 'ghost'
}
