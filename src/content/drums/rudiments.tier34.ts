/**
 * Tiers 3-4 of the 40 PAS International Drum Rudiments — the 23 rudiments
 * left over once tiers 1-2 (`rudiments.tier12.ts`) are set aside. PAS itself
 * does not rank these by difficulty; the tier-3-vs-4 split here is a
 * judgment call (per AGENTS' brief: "the ones commonly taught next" go in
 * tier 3), not a cited source.
 *
 * A handful of these are genuinely obscure enough that published sources
 * disagree on the exact sticking/accent placement, or the author simply
 * isn't fully confident of the standard reading. Each such rudiment says so
 * in its own comment; they are also called out in this package's delivery
 * notes rather than resolved silently. Everything else here (the roll
 * family, drag paradiddles, ratamacues, flam paradiddle) follows the
 * standard PAS chart directly.
 */
import { EIGHTH, makeRudiment, seq, SIXTEENTH, TRIPLET_EIGHTH } from './rudimentBuilders.ts'
import type { Rudiment } from '@core/drums/rudiment/types.ts'

const TIER3_BAND = { start: 60, target: 120 }
const TIER4_BAND = { start: 55, target: 110 }

export const TIER_3_RUDIMENTS: readonly Rudiment[] = [
  makeRudiment({
    id: 'six-stroke-roll',
    pasNumber: 8,
    name: 'Six Stroke Roll',
    tier: 3,
    strokes: seq('RLLRRL', SIXTEENTH, { accents: [0, 5] }),
    bpmBand: TIER3_BAND,
    transfer: 'Single-double-double-single roll for filling a beat-and-a-half phrase.',
  }),
  makeRudiment({
    id: 'ten-stroke-roll',
    pasNumber: 11,
    name: 'Ten Stroke Roll',
    tier: 3,
    strokes: seq('RLLRRLLRRL', SIXTEENTH, { accents: [0, 9] }),
    bpmBand: TIER3_BAND,
    transfer: 'A longer single-double roll for a two-and-a-half-beat fill build.',
  }),
  makeRudiment({
    id: 'triple-stroke-roll',
    pasNumber: 5,
    name: 'Triple Stroke Roll',
    tier: 3,
    strokes: seq('RRRLLL', SIXTEENTH),
    bpmBand: TIER3_BAND,
    transfer: 'Triple-bounce control that carries directly into buzz-roll dynamics.',
  }),
  makeRudiment({
    id: 'flamacue',
    pasNumber: 23,
    name: 'Flamacue',
    tier: 3,
    // Flam on the lead note and on the accented 4th note, alternating throughout: R(flam) L R L(flam,accent) R.
    strokes: seq('RLRLR', SIXTEENTH, { flams: [0, 3], accents: [3] }),
    bpmBand: TIER3_BAND,
    transfer: 'Signature fill-opener — flam into a mid-phrase accent, used constantly in fill vocabulary.',
  }),
  makeRudiment({
    id: 'flam-paradiddle',
    pasNumber: 24,
    name: 'Flam Paradiddle',
    tier: 3,
    strokes: seq('RLRRLRLL', SIXTEENTH, { flams: [0, 4], accents: [0, 4] }),
    bpmBand: TIER3_BAND,
    transfer: 'A paradiddle with flammed lead notes — thickens fills that move around toms.',
  }),
  makeRudiment({
    id: 'single-flammed-mill',
    pasNumber: 25,
    name: 'Single Flammed Mill',
    tier: 3,
    // Less certain: sources vary on exact placement. Modeled as a fully alternating
    // 6-note phrase with flams on the 1st and 4th notes, mirroring Flamacue's shape
    // but without the accent gap — flag this one if it needs correcting against a
    // specific method book.
    strokes: seq('RLRLRL', SIXTEENTH, { flams: [0, 3], accents: [0, 3] }),
    bpmBand: TIER3_BAND,
    transfer: 'Flammed mill pattern used to thicken sustained alternating fills.',
  }),
  makeRudiment({
    id: 'swiss-army-triplet',
    pasNumber: 28,
    name: 'Swiss Army Triplet',
    tier: 3,
    // "Flam, tap, tap" in triplet time, alternating lead hand: R(flam) L L | L(flam) R R.
    strokes: seq('RLLLRR', TRIPLET_EIGHTH, { flams: [0, 3], accents: [0, 3] }),
    bpmBand: TIER3_BAND,
    transfer: 'Triplet-feel flammed rudiment for shuffle and waltz-time fills.',
  }),
  makeRudiment({
    id: 'flam-drag',
    pasNumber: 30,
    name: 'Flam Drag',
    tier: 3,
    // Less certain: modeled as flam, tap, drag, tap — the two ornaments in one short phrase.
    strokes: seq('RLLR', EIGHTH, { flams: [0], drags: [2] }),
    bpmBand: TIER3_BAND,
    transfer: 'Combines both grace-note ornaments in one phrase — a compact fill accent.',
  }),
  makeRudiment({
    id: 'double-drag-tap',
    pasNumber: 33,
    name: 'Double Drag Tap',
    tier: 3,
    // Less certain: modeled as two drag-decorated alternating notes then an accented
    // tap, mirrored — "drag drag tap, drag drag tap".
    strokes: seq('LRLRLR', SIXTEENTH, { drags: [0, 1, 3, 4], accents: [2, 5] }),
    bpmBand: TIER3_BAND,
    transfer: 'Two drags into an accented tap — a common fill turnaround into the next phrase.',
  }),
  makeRudiment({
    id: 'single-dragadiddle',
    pasNumber: 35,
    name: 'Single Dragadiddle',
    tier: 3,
    // Less certain: modeled as a drag leading into a 3-note paradiddle-style tail.
    strokes: seq('RLLR', SIXTEENTH, { drags: [0] }),
    bpmBand: TIER3_BAND,
    transfer: 'Drag-led diddle shape for fills that need a soft lead-in before the accent.',
  }),
  makeRudiment({
    id: 'drag-paradiddle-1',
    pasNumber: 36,
    name: 'Drag Paradiddle #1',
    tier: 3,
    strokes: seq('RLRRLRLL', SIXTEENTH, { drags: [0, 4], accents: [0, 4] }),
    bpmBand: TIER3_BAND,
    transfer: 'A paradiddle with a soft drag lead-in on each half — softer than the flam version.',
  }),
  makeRudiment({
    id: 'single-ratamacue',
    pasNumber: 38,
    name: 'Single Ratamacue',
    tier: 3,
    // drag, tap, tap, accent — one drag-decorated note then a 3-note alternating tail.
    strokes: seq('RLRL', SIXTEENTH, { drags: [0], accents: [3] }),
    bpmBand: TIER3_BAND,
    transfer: 'The classic drag-into-accent fill-ender, used to punctuate a phrase before beat 1.',
  }),
]

export const TIER_4_RUDIMENTS: readonly Rudiment[] = [
  makeRudiment({
    id: 'eleven-stroke-roll',
    pasNumber: 12,
    name: 'Eleven Stroke Roll',
    tier: 4,
    strokes: seq('RRLLRRLLRRL', SIXTEENTH, { accents: [10] }),
    bpmBand: TIER4_BAND,
    transfer: 'A near-3-beat accented roll for extended, dramatic fill build-ups.',
  }),
  makeRudiment({
    id: 'thirteen-stroke-roll',
    pasNumber: 13,
    name: 'Thirteen Stroke Roll',
    tier: 4,
    strokes: seq('RRLLRRLLRRLLR', SIXTEENTH, { accents: [12] }),
    bpmBand: TIER4_BAND,
    transfer: 'A long accented roll for full-bar fill build-ups into a section change.',
  }),
  makeRudiment({
    id: 'fifteen-stroke-roll',
    pasNumber: 14,
    name: 'Fifteen Stroke Roll',
    tier: 4,
    strokes: seq('RRLLRRLLRRLLRRL', SIXTEENTH, { accents: [14] }),
    bpmBand: TIER4_BAND,
    transfer: 'A near-4-beat accented roll for a full-bar dynamic swell.',
  }),
  makeRudiment({
    id: 'seventeen-stroke-roll',
    pasNumber: 15,
    name: 'Seventeen Stroke Roll',
    tier: 4,
    strokes: seq('RRLLRRLLRRLLRRLLR', SIXTEENTH, { accents: [16] }),
    bpmBand: TIER4_BAND,
    transfer: 'The longest accented roll on the list — a full-bar-plus dynamic build.',
  }),
  makeRudiment({
    id: 'flam-paradiddle-diddle',
    pasNumber: 26,
    name: 'Flam Paradiddle-Diddle',
    tier: 4,
    strokes: seq('RLRRLL LRLLRR', SIXTEENTH, { flams: [0, 6], accents: [0, 6] }),
    bpmBand: TIER4_BAND,
    transfer: 'Flammed paradiddle-diddle — a thick, driving fill shape across three limbs worth of toms.',
  }),
  makeRudiment({
    id: 'pataflafla',
    pasNumber: 27,
    name: 'Pataflafla',
    tier: 4,
    // "Flam, tap, flam, tap" alternating hands: R(flam) R L(flam) L.
    strokes: seq('RRLL', EIGHTH, { flams: [0, 2], accents: [0, 2] }),
    bpmBand: TIER4_BAND,
    transfer: 'Alternating flammed taps — a distinctive, symmetrical fill accent.',
  }),
  makeRudiment({
    id: 'inverted-flam-tap',
    pasNumber: 29,
    name: 'Inverted Flam Tap',
    tier: 4,
    // Less certain: modeled as Flam Tap with the flam moved to the second note of
    // each pair instead of the first (the "inversion").
    strokes: seq('RRLL', EIGHTH, { flams: [1, 3], accents: [1, 3] }),
    bpmBand: TIER4_BAND,
    transfer: 'Flam Tap with the accent placement flipped — trains independence from the standard version.',
  }),
  makeRudiment({
    id: 'lesson-25',
    pasNumber: 34,
    name: 'Lesson 25',
    tier: 4,
    // Less certain: modeled as a compact two-drag alternating phrase, a shorter
    // sibling of Double Drag Tap — flag this one if it needs correcting against
    // Wilcoxon's original notation.
    strokes: seq('RLRL', SIXTEENTH, { drags: [0, 2], accents: [1, 3] }),
    bpmBand: TIER4_BAND,
    transfer: 'A compact double-drag phrase historically used as a standalone reading exercise.',
  }),
  makeRudiment({
    id: 'drag-paradiddle-2',
    pasNumber: 37,
    name: 'Drag Paradiddle #2',
    tier: 4,
    strokes: seq('RLRLRR LRLRLL', SIXTEENTH, { drags: [0, 6], accents: [0, 6] }),
    bpmBand: TIER4_BAND,
    transfer: 'A double-paradiddle with a soft drag lead-in on each half.',
  }),
  makeRudiment({
    id: 'double-ratamacue',
    pasNumber: 39,
    name: 'Double Ratamacue',
    tier: 4,
    // Two drag-decorated alternating notes, then a 3-note accented tail — one more
    // drag than Single Ratamacue, continuing the same alternating sticking.
    strokes: seq('RLRLR', SIXTEENTH, { drags: [0, 1], accents: [4] }),
    bpmBand: TIER4_BAND,
    transfer: 'A weightier drag-into-accent fill-ender than the single version.',
  }),
  makeRudiment({
    id: 'triple-ratamacue',
    pasNumber: 40,
    name: 'Triple Ratamacue',
    tier: 4,
    // Three drag-decorated alternating notes, then a 3-note accented tail.
    strokes: seq('RLRLRL', SIXTEENTH, { drags: [0, 1, 2], accents: [5] }),
    bpmBand: TIER4_BAND,
    transfer: 'The heaviest drag-into-accent fill-ender — a strong, deliberate phrase closer.',
  }),
]
