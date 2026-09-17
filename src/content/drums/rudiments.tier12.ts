/**
 * Tiers 1-2 of the 40 PAS International Drum Rudiments, in the Wooton/Vic
 * Firth learning order (not the PAS list's own 1-40 numbering — that lives
 * in each entry's `pasNumber`). Split from tiers 3-4 (`rudiments.tier34.ts`)
 * purely to stay under this repo's 500-line file cap; `rudiments.ts` merges
 * both into one `RUDIMENTS` array.
 *
 * Every stroke sequence is written as a sticking string via `seq` (see
 * `rudimentBuilders.ts`) so it reads the same way a printed rudiment chart
 * does and can be checked against one by eye. `bpmBand` for tier 1 is the
 * spec-given 60..100; tiers 2-4 use a slower start (more strokes per cycle
 * needs more control before speed) and a higher target, which is this
 * author's practice-literature estimate rather than a cited figure — a
 * judgment call, same as the tier-3-vs-4 split lower down.
 */
import { EIGHTH, makeRudiment, QUARTER, seq, SIXTEENTH, TRIPLET_EIGHTH } from './rudimentBuilders.ts'
import type { Rudiment } from '@core/drums/rudiment/types.ts'

const TIER1_BAND = { start: 60, target: 100 }
const TIER2_BAND = { start: 70, target: 120 }

export const TIER_1_RUDIMENTS: readonly Rudiment[] = [
  makeRudiment({
    id: 'single-stroke-roll',
    pasNumber: 1,
    name: 'Single Stroke Roll',
    tier: 1,
    strokes: seq('RLRLRLRL', SIXTEENTH),
    bpmBand: TIER1_BAND,
    transfer: 'The alternating sticking underneath every fill and hand pattern on the kit.',
  }),
  makeRudiment({
    id: 'multiple-bounce-roll',
    pasNumber: 4,
    name: 'Multiple Bounce Roll',
    tier: 1,
    strokes: seq('RLRL', EIGHTH, { buzzes: [0, 1, 2, 3] }),
    bpmBand: TIER1_BAND,
    transfer: 'The press/buzz-roll technique behind sustained snare rolls under crash swells.',
  }),
  makeRudiment({
    id: 'double-stroke-open-roll',
    pasNumber: 6,
    name: 'Double Stroke Open Roll',
    tier: 1,
    strokes: seq('RRLLRRLL', SIXTEENTH),
    bpmBand: TIER1_BAND,
    transfer: 'The open-to-closed roll every rudimental fill and cadence builds from.',
  }),
  makeRudiment({
    id: 'single-paradiddle',
    pasNumber: 16,
    name: 'Single Paradiddle',
    tier: 1,
    strokes: seq('RLRRLRLL', SIXTEENTH, { accents: [0, 4] }),
    bpmBand: TIER1_BAND,
    transfer: 'Moves a fill around the kit while keeping a clear accent on beat 1.',
  }),
  makeRudiment({
    id: 'flam',
    pasNumber: 20,
    name: 'Flam',
    tier: 1,
    strokes: seq('RL', QUARTER, { flams: [0, 1] }),
    bpmBand: TIER1_BAND,
    transfer: 'The grace-note thickening used on backbeats and fill accents across the kit.',
  }),
  makeRudiment({
    id: 'drag',
    pasNumber: 31,
    name: 'Drag',
    tier: 1,
    strokes: seq('RL', QUARTER, { drags: [0, 1] }),
    bpmBand: TIER1_BAND,
    transfer: 'The ruff ornament that opens fills and thickens backbeat accents.',
  }),
]

export const TIER_2_RUDIMENTS: readonly Rudiment[] = [
  makeRudiment({
    id: 'single-stroke-four',
    pasNumber: 2,
    name: 'Single Stroke Four',
    tier: 2,
    strokes: seq('RLRL', SIXTEENTH),
    bpmBand: TIER2_BAND,
    transfer: 'Four-note alternating bursts for filling one beat at a time between toms.',
  }),
  makeRudiment({
    id: 'single-stroke-seven',
    pasNumber: 3,
    name: 'Single Stroke Seven',
    tier: 2,
    strokes: seq('RLRLRLR', SIXTEENTH, { accents: [6] }),
    bpmBand: TIER2_BAND,
    transfer: 'Odd-count alternating sticking for 7-over-a-beat tom fills and turnarounds.',
  }),
  makeRudiment({
    id: 'double-paradiddle',
    pasNumber: 17,
    name: 'Double Paradiddle',
    tier: 2,
    strokes: seq('RLRLRR LRLRLL', SIXTEENTH, { accents: [0, 6] }),
    bpmBand: TIER2_BAND,
    transfer: 'Extends the paradiddle across 3 beats — common in 6/8 and triplet-feel fills.',
  }),
  makeRudiment({
    id: 'triple-paradiddle',
    pasNumber: 18,
    name: 'Triple Paradiddle',
    tier: 2,
    strokes: seq('RLRLRLRR LRLRLRLL', SIXTEENTH, { accents: [0, 8] }),
    bpmBand: TIER2_BAND,
    transfer: 'A 4-beat paradiddle variant for long, evenly-accented fills across the kit.',
  }),
  makeRudiment({
    id: 'single-paradiddle-diddle',
    pasNumber: 19,
    name: 'Single Paradiddle-Diddle',
    tier: 2,
    strokes: seq('RLRRLL LRLLRR', SIXTEENTH, { accents: [0, 6] }),
    bpmBand: TIER2_BAND,
    transfer: 'A paradiddle with an extra diddle — sets up smooth double-stroke kit moves.',
  }),
  makeRudiment({
    id: 'five-stroke-roll',
    pasNumber: 7,
    name: 'Five Stroke Roll',
    tier: 2,
    strokes: seq('RRLLR', SIXTEENTH, { accents: [4] }),
    bpmBand: TIER2_BAND,
    transfer: 'The short accented roll used to punctuate fills and set up a crash.',
  }),
  makeRudiment({
    id: 'seven-stroke-roll',
    pasNumber: 9,
    name: 'Seven Stroke Roll',
    tier: 2,
    strokes: seq('RRLLRRL', SIXTEENTH, { accents: [6] }),
    bpmBand: TIER2_BAND,
    transfer: 'A longer accented roll for filling a bar-and-a-half phrase before a downbeat.',
  }),
  makeRudiment({
    id: 'nine-stroke-roll',
    pasNumber: 10,
    name: 'Nine Stroke Roll',
    tier: 2,
    strokes: seq('RRLLRRLLR', SIXTEENTH, { accents: [8] }),
    bpmBand: TIER2_BAND,
    transfer: 'A two-and-a-quarter-beat accented roll for extended fill build-ups.',
  }),
  makeRudiment({
    id: 'flam-tap',
    pasNumber: 22,
    name: 'Flam Tap',
    tier: 2,
    strokes: seq('RRLL', EIGHTH, { flams: [0, 2], accents: [0, 2] }),
    bpmBand: TIER2_BAND,
    transfer: 'Flammed double-stroke feel used for thick, driving snare grooves and fills.',
  }),
  makeRudiment({
    id: 'flam-accent',
    pasNumber: 21,
    name: 'Flam Accent',
    tier: 2,
    strokes: seq('RLRLRL', TRIPLET_EIGHTH, { flams: [0, 3], accents: [0, 3] }),
    bpmBand: TIER2_BAND,
    transfer: 'Triplet-feel flammed accents for shuffles and 12/8 fill phrasing.',
  }),
  makeRudiment({
    id: 'single-drag-tap',
    pasNumber: 32,
    name: 'Single Drag Tap',
    tier: 2,
    strokes: seq('RRLL', EIGHTH, { drags: [0, 2], accents: [1, 3] }),
    bpmBand: TIER2_BAND,
    transfer: 'Drag-into-tap feel used to thicken backbeats without a full flam.',
  }),
]
