/**
 * Jazz ride drills (roadmap DR-15 "jazz ride introduction"): the classic
 * "spang-a-lang" ride pattern (1, 2, 2&, 3, 4, 4&), the hi-hat foot chicking
 * on 2 and 4, and one Ted Reed–style one-bar snare comp figure at a time —
 * mirroring `hhFoot.ts`/`openings.ts`'s shape (a fixed, cumulative-ish step
 * list, `{ score: GrooveScore }[]`), but this content is fixed rather than
 * derived from a caller-supplied groove: unlike those two, `jazzRideDrills`
 * takes no `groove` argument at all.
 *
 * Every score here is swung — `swingPercent: 67`, `swingUnit: 'eighth'` — so
 * `practice/plan.ts`'s `swungTick` is what actually makes the ride "spang" on
 * the &s rather than sit on a straight eighth grid; the notated ticks below
 * are, as always, the nominal (straight) grid (see `GrooveScore.swingPercent`'s
 * own doc comment).
 *
 * Steps 3-6 each carry ride + pedal + exactly ONE comp figure — they are NOT
 * cumulative like `hhFoot`'s or `openings`' steps, because stacking every
 * prior figure on top of the next would turn "comp on 4" into "comp on the &
 * of 2 AND on 4", which is a different (harder) exercise than the one each
 * step's title names.
 */
import { makeGrooveScore, type GrooveNoteInput, type GrooveScore } from '@core/drums/model/groove.ts'

export type JazzRideDrill = { readonly score: GrooveScore }

/**
 * The ride pattern, 1 2 2& 3 4 4&. Durations use the full straight-time gap
 * to the pattern's own next onset — 240 on every "&" (immediately followed,
 * 240 ticks later, by the next downbeat) and on beats 2/4 (immediately
 * followed by their own "&"), 480 on beats 1/3 (which have a full quarter of
 * room before their "&"). Onsets are drums; the duration is display-only
 * (`GrooveNote.durationTicks`'s own doc), so this only affects engraving.
 */
const RIDE_NOTES: readonly GrooveNoteInput[] = [
  { pad: 'rideBow', tick: 0, durationTicks: 480 }, // 1
  { pad: 'rideBow', tick: 480, durationTicks: 240 }, // 2
  { pad: 'rideBow', tick: 720, durationTicks: 240 }, // 2&
  { pad: 'rideBow', tick: 960, durationTicks: 480 }, // 3
  { pad: 'rideBow', tick: 1440, durationTicks: 240 }, // 4
  { pad: 'rideBow', tick: 1680, durationTicks: 240 }, // 4&
]

/** The hi-hat foot "chick" on 2 and 4 — the new timekeeping foundation underneath the ride. */
const PEDAL_NOTES: readonly GrooveNoteInput[] = [
  { pad: 'hhPedal', tick: 480, durationTicks: 480 },
  { pad: 'hhPedal', tick: 1440, durationTicks: 480 },
]

type Step = {
  readonly titleSuffix: string
  readonly withPedal: boolean
  readonly figureNotes: readonly GrooveNoteInput[]
}

const STEPS: readonly Step[] = [
  { titleSuffix: 'ride alone', withPedal: false, figureNotes: [] },
  { titleSuffix: 'ride and hi-hat foot', withPedal: true, figureNotes: [] },
  {
    titleSuffix: 'comp on the & of 2',
    withPedal: true,
    figureNotes: [{ pad: 'snare', tick: 720, durationTicks: 240 }],
  },
  {
    titleSuffix: 'comp on 4',
    withPedal: true,
    figureNotes: [{ pad: 'snare', tick: 1440, durationTicks: 240 }],
  },
  {
    titleSuffix: 'comp on the & of 1 and the & of 3',
    withPedal: true,
    figureNotes: [
      { pad: 'snare', tick: 240, durationTicks: 240 },
      { pad: 'snare', tick: 1200, durationTicks: 240 },
    ],
  },
  {
    titleSuffix: 'comp on 2 and the & of 4',
    withPedal: true,
    figureNotes: [
      { pad: 'snare', tick: 480, durationTicks: 240 },
      { pad: 'snare', tick: 1680, durationTicks: 240 },
    ],
  },
]

/**
 * The six jazz ride drills, `jazz-ride-1`..`jazz-ride-6`, in the fixed order
 * above. Deterministic; no rng, and unlike `hhFootDrills`/`openingDrills`
 * this takes no groove — its content never varies with what the learner
 * picked elsewhere.
 */
export function jazzRideDrills(): readonly JazzRideDrill[] {
  return STEPS.map((step, i) => {
    const notes: GrooveNoteInput[] = [
      ...RIDE_NOTES,
      ...(step.withPedal ? PEDAL_NOTES : []),
      ...step.figureNotes,
    ]
    const score = makeGrooveScore({
      id: `jazz-ride-${i + 1}`,
      title: `Jazz ride — ${step.titleSuffix}`,
      swingPercent: 67,
      swingUnit: 'eighth',
      measureCount: 1,
      notes,
    })
    return { score }
  })
}
