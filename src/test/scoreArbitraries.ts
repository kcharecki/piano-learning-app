/**
 * Fast-check arbitraries over `Score`, shared by the score MODEL tests
 * (`score.test.ts`) and the score QUERY tests (`scoreQueries.test.ts`).
 *
 * They live here rather than in either test file because roadmap T.16 split
 * `score.ts` by concept, and both halves' property tests need the same
 * generators. Copying them into both files would leave two definitions of
 * "a valid random score" free to drift apart — which is the failure a property
 * test exists to rule out.
 */
import fc from 'fast-check'
import { makeScore, type Hand } from '@core/notation/score.ts'
import { buildTestScore } from './fixtures.ts'

/** Ticks in a bar of 4/4, the metre every arbitrary here generates. */
const BAR = 1920

type NoteSpec = { bar: number; beat: number; midi: number; hand: Hand; beats: number }

const noteSpecArb = fc.record<NoteSpec>({
  bar: fc.nat({ max: 5 }),
  beat: fc.nat({ max: 3 }),
  midi: fc.integer({ min: 40, max: 90 }),
  hand: fc.constantFrom<Hand>('left', 'right'),
  beats: fc.integer({ min: 1, max: 4 }),
})

/** Random but always-valid scores: 4/4, notes clipped so none crosses a barline. */
export const scoreArb = fc.array(noteSpecArb, { maxLength: 25 }).map((specs) =>
  buildTestScore(
    specs.map((s) => ({
      midi: s.midi,
      startTick: s.bar * BAR + s.beat * 480,
      durationTicks: Math.min(s.beats, 4 - s.beat) * 480,
      hand: s.hand,
    })),
    { measureCount: Math.max(1, ...specs.map((s) => s.bar + 1)) },
  ),
)

/**
 * The other shape a real import produces: ONE staff, declared with the clef it
 * opened with, carrying notes of both hands because the clef changes mid-piece.
 */
const singleStaffScoreArb = fc.array(noteSpecArb, { maxLength: 15 }).map((specs) =>
  makeScore({
    id: 'single-staff-clef-change',
    measures: Array.from({ length: Math.max(1, ...specs.map((s) => s.bar + 1)) }, () => ({})),
    notes: specs.map((s) => ({
      midi: s.midi,
      startTick: s.bar * BAR + s.beat * 480,
      durationTicks: Math.min(s.beats, 4 - s.beat) * 480,
      hand: s.hand,
      staff: 1,
    })),
    staves: [{ staff: 1, clef: 'treble', hand: 'right' }],
  }),
)

/**
 * The shape that actually discriminates: a grand staff whose UPPER staff turned
 * bass clef part-way, so staff 1 is declared 'right' while always carrying at
 * least one left-hand note, and staff 2 is a plain bass staff. Filtering the
 * staves by declared hand alone answers [2] for hands=['left'], stranding the
 * staff-1 notes. On a one-staff score the same mistake answers [] and is hidden
 * by the fallback, which is why `singleStaffScoreArb` alone pinned nothing.
 */
export const twoStaffScoreArb = fc.array(noteSpecArb, { maxLength: 15 }).map((specs) =>
  makeScore({
    id: 'two-staff-clef-change',
    measures: Array.from({ length: Math.max(1, ...specs.map((s) => s.bar + 1)) }, () => ({})),
    notes: [
      // A2 on the upper staff, in bass clef — always present, so every generated
      // case has a left-hand note standing on the staff declared 'right'.
      { midi: 45, startTick: 0, durationTicks: 480, hand: 'left' as const, staff: 1 },
      // E1 on the lower staff: an ordinary left-hand note on a staff declared 'left'.
      { midi: 28, startTick: 0, durationTicks: 480, hand: 'left' as const, staff: 2 },
      ...specs.map((s) => ({
        midi: s.midi,
        startTick: s.bar * BAR + s.beat * 480,
        durationTicks: Math.min(s.beats, 4 - s.beat) * 480,
        hand: s.hand,
        staff: 1,
      })),
    ],
    staves: [
      { staff: 1, clef: 'treble', hand: 'right' },
      { staff: 2, clef: 'bass', hand: 'left' },
    ],
  }),
)

export const anyScoreArb = fc.oneof(scoreArb, singleStaffScoreArb, twoStaffScoreArb)
export const HAND_SUBSETS: readonly (readonly Hand[])[] = [[], ['left'], ['right'], ['left', 'right']]
