/**
 * The words the groove trainer's result panel is made of (roadmap DR-09/T.17).
 *
 * Split out of the screen because these sentences are the feature: "which limb
 * was off" is the whole claim, and a sentence that is only reachable by
 * driving a browser is a sentence nobody tests the edges of. Everything here
 * is pure — a `GrooveRunResult` in, strings out — so the awkward cases (a pad
 * that landed nothing, an offset that rounds to zero, a pad the groove never
 * asked for) are unit-testable without a DOM.
 *
 * ## Two rules the copy has to hold
 *
 * **A pad line always names a number.** `Hi-hat — 16 of 16` with nothing after
 * it tells a learner they were right without telling them how right; the
 * offset (or what went wrong) always follows the count.
 *
 * **The diagnosis is capped at two sentences.** The grader can find four
 * things wrong at once, and a screen that lists all four is a screen that
 * chooses nothing for the learner to fix. Worst first, then stop.
 */
import {
  ARTICULATION_SIBLINGS,
  worstUnisonGap,
  type ArticulationSlip,
  type GroovePadResult,
  type GrooveRunResult,
} from '@core/drums/practice/grade.ts'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import { displayOffsetMs } from '@core/drums/practice/betweenGrid.ts'
import type { DynamicsClass } from '@core/drums/model/groove.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import { GROOVE_PAD_LABEL } from './padLabels.ts'

/** How many diagnosis sentences the panel will show at once. See the module comment. */
export const MAX_DIAGNOSIS_SENTENCES = 2

/**
 * "Steady", not "clean" or "accurate": everything measured here includes the
 * machine's own latency, which shifts every stroke by the same constant. The
 * verdict is therefore about spread and drift — things a constant cannot fake
 * — and the word has to promise only that.
 */
export function verdictText(result: GrooveRunResult): string {
  return result.steady ? 'Steady run' : 'Not there yet'
}

/** Rounded to the millisecond, because tenths of a millisecond are below what any of this can resolve. */
function offsetPhrase(meanOffsetMs: number): string {
  const rounded = Math.round(Math.abs(meanOffsetMs))
  if (rounded === 0) return 'dead on'
  return `${rounded} ms ${meanOffsetMs > 0 ? 'late' : 'early'}`
}

/**
 * `pad`'s sibling in `ARTICULATION_SIBLINGS` (roadmap T.33) — the other
 * articulation of the same physical stroke (open vs. closed hi-hat) — or
 * `undefined` if `pad` is not part of any sibling pair. Reads the pair table
 * itself rather than hard-coding `hhOpen`/`hhClosed` here a second time, so a
 * future sibling pair needs no change in this file.
 */
function siblingPadOf(pad: MappedDrumPad): MappedDrumPad | undefined {
  for (const [a, b] of ARTICULATION_SIBLINGS) {
    if (a === pad) return b
    if (b === pad) return a
  }
  return undefined
}

/** Learner-facing word for a pad's own articulation flavour, e.g. `hhOpen` -> `'open'`. */
const ARTICULATION_WORD: Partial<Readonly<Record<MappedDrumPad, string>>> = {
  hhOpen: 'open',
  hhClosed: 'closed',
}

function articulationWord(pad: MappedDrumPad): string {
  return ARTICULATION_WORD[pad] ?? GROOVE_PAD_LABEL[pad].toLowerCase()
}

/**
 * What a slipped pad's line says after its count: the sibling articulation the
 * learner actually played, and the one the score asked for. Only ever called
 * with `row.slipped > 0`.
 */
function slipPhrase(row: GroovePadResult): string {
  const sibling = siblingPadOf(row.pad)
  if (sibling === undefined) return `${row.slipped} played the wrong articulation`
  return `${row.slipped} played ${articulationWord(sibling)} instead of ${articulationWord(row.pad)}`
}

/**
 * One pad's line: its count, then its own offset, then what it got wrong.
 *
 * A pad with `expected === 0` is one the learner played that this groove never
 * asks for. "0 of 0" would read as a pass, so that row says what it is.
 */
export function padLineText(row: GroovePadResult): string {
  const label = GROOVE_PAD_LABEL[row.pad]
  if (row.expected === 0) return `${label} — not in this groove, ${row.extra} extra`

  // Always non-empty: `matched > 0` gives an offset, and `matched === 0` with
  // something expected gives a miss.
  const parts: string[] = []
  if (row.meanOffsetMs !== undefined) parts.push(offsetPhrase(row.meanOffsetMs))
  if (row.missed > 0) parts.push(`${row.missed} missed`)
  if (row.extra > 0) parts.push(`${row.extra} extra`)
  // Roadmap T.33: an expected instant struck on time but on the sibling
  // articulation is neither a match nor a miss — it gets its own words here
  // rather than silently vanishing from the count.
  if (row.slipped > 0) parts.push(slipPhrase(row))
  return `${label} — ${row.matched} of ${row.expected}, ${parts.join(', ')}`
}

/**
 * What one grid step is called at this groove's density, so a phase slip can be
 * reported in musical units rather than as "1 step".
 *
 * DR-07: `slipSteps` counts NOMINAL grid steps (`GrooveRunPlan.
 * nominalSubdivisionTicks` — the shift cell `runSlipSteps` uses), so the name
 * has to come from the same nominal cell (`nominalSubdivisionMs`), not the
 * swung `subdivisionMs` (which only sizes the match window) — naming the step
 * from a different cell than the one that produced the count would mislabel a
 * swung score's slip (e.g. calling a whole nominal eighth a "sixteenth"
 * because the swung grid happens to be finer).
 */
function stepName(beatMs: number, nominalSubdivisionMs: number): string {
  const perBeat = beatMs / nominalSubdivisionMs
  if (perBeat >= 3.5) return 'sixteenth'
  if (perBeat >= 1.5) return 'eighth'
  return 'beat'
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * DR-07 between-grid (DR-08/DR-11, review round 2 — RED-2): the sentence for
 * the between-grid band — see `GroovePadResult.looseOffsetMs`'s own doc for
 * why that band is neither a match nor a whole-step slip, and why it gets
 * its own sentence rather than falling into "missed" (which is what the
 * generic "every stroke landed outside its window" sentence used to say
 * about exactly this shape of run — wrong, because the pattern and the
 * entry ARE right; only the hands are late or early by less than a grid
 * step).
 *
 * RED-2: the previous version took a SINGLE pad and always blamed it alone.
 * A whole-kit run that is uniformly late (say, a learner who simply came in
 * late on the count-in) has EVERY limb sitting in the band by the same
 * amount and the same sign — naming one limb ("Kick landed about 130 ms
 * behind...") is not just incomplete, it is advice that would break a
 * groove that was internally correct ("pull the kick back" when the kick
 * was never out of time with the other limbs). This now reads the whole
 * kit and picks one of three shapes:
 *
 * - every played pad is in the band, all the same sign (whole-kit lag/rush)
 *   → one sentence blaming the CLICK, not a limb: "pull/push EVERYTHING".
 * - some pads are in the band and at least one other played pad is
 *   confirmed on its own grid position → the usual one-limb sentence,
 *   naming the limb with the largest `|looseOffsetMs|` (ties go to the
 *   first pad in `pads` order), now saying explicitly what the other limbs
 *   it should meet actually did.
 * - anything else (mixed signs across a partial band, or no played pad
 *   confirmed on-grid to compare against) → `undefined`: naming a single
 *   limb here would be a guess, not a diagnosis.
 *
 * `displacementSteps === 0` is the same "on its own grid position" test the
 * per-pad whole-step-displacement sentence above uses — reused here rather
 * than re-derived, so the two sentences agree on what "on the grid" means.
 */
export function betweenGridSentence(
  pads: readonly Pick<GroovePadResult, 'pad' | 'expected' | 'displacementSteps' | 'looseOffsetMs' | 'hits'>[],
  plan: Pick<GrooveRunPlan, 'windowMs' | 'beatMs' | 'nominalSubdivisionMs'>,
): string | undefined {
  // AMBER (review): `expected > 0` alone let a pad the learner never struck
  // at all (kick/hh/hhOpen all loose, snare silent — "0 of N, N missed" on
  // its own row) count as "played". That pad is never loose (no hits to be
  // loose) and never on-grid (no hits to confirm a grid position from)
  // either, so it silently broke BOTH the whole-kit shape
  // (`loose.length === played.length`) and the per-limb one
  // (`onGrid.length === played.length - 1`) — the whole-kit sentence above
  // could no longer fire, and the run fell through to the generic "every
  // stroke landed outside its window" sentence instead, even though the
  // kit that DID play was internally correct. Mirrors the same
  // `expected > 0 && hits > 0` predicate `diagnosisSentences` already uses
  // to build its own `played` list for the per-pad displacement sentence.
  const played = pads.filter((row) => row.expected > 0 && row.hits > 0)
  const loose = played.filter((row) => row.looseOffsetMs !== undefined)
  if (loose.length === 0) return undefined

  const onGrid = played.filter((row) => row.displacementSteps === 0)
  const quantity = plural(1, stepName(plan.beatMs, plan.nominalSubdivisionMs))
  const windowRounded = Math.round(plan.windowMs)

  const signs = new Set(loose.map((row) => Math.sign(row.looseOffsetMs ?? 0)))
  if (loose.length === played.length && signs.size === 1) {
    const meanMs = loose.reduce((sum, row) => sum + (row.looseOffsetMs ?? 0), 0) / loose.length
    const rounded = displayOffsetMs(meanMs, plan.windowMs)
    const behind = meanMs > 0
    return (
      `Every limb landed about ${rounded} ms ${behind ? 'behind' : 'ahead of'} the click on most strokes — ` +
      `outside the ${windowRounded} ms window, short of ${quantity}. The pattern is there; ` +
      `${behind ? 'pull everything back' : 'push everything forward'} to meet the click.`
    )
  }

  if (onGrid.length === 0) return undefined

  let worst: (typeof loose)[number] | undefined
  let worstAbs = -Infinity
  for (const row of loose) {
    const abs = Math.abs(row.looseOffsetMs ?? 0)
    if (abs <= worstAbs) continue
    worst = row
    worstAbs = abs
  }
  // Unreachable (`loose.length > 0` above guarantees a `worst`), but keeps
  // the type checker honest about `worst` without a non-null assertion.
  if (worst === undefined) return undefined

  const ms = worst.looseOffsetMs ?? 0
  const rounded = displayOffsetMs(ms, plan.windowMs)
  const behind = ms > 0
  const label = GROOVE_PAD_LABEL[worst.pad]

  // Denominator is every OTHER played pad (`played.length - 1`, excluding
  // only the named `worst` pad) — not `played.length - loose.length`. With
  // more than one loose pad (mixed signs, e.g.) the non-worst loose pads are
  // still "other" pads that are not on the grid, so they must count against
  // "all others on grid" too; using `loose.length` silently canceled them out.
  const allOthersOnGrid = onGrid.length === played.length - 1
  const others = allOthersOnGrid
    ? { phrase: 'the other limbs sit', closing: 'them' }
    : (() => {
        const labels = onGrid.map((row) => GROOVE_PAD_LABEL[row.pad])
        const single = labels.length === 1
        return { phrase: `${labels.join(' and ')} ${single ? 'sits' : 'sit'}`, closing: single ? 'it' : 'them' }
      })()

  return (
    `${label} landed about ${rounded} ms ${behind ? 'behind' : 'ahead of'} the click on most strokes — ` +
    `outside the ${windowRounded} ms window, short of ${quantity}, while ${others.phrase} on the grid. ` +
    `${behind ? 'Pull it back' : 'Push it forward'} to meet ${others.closing}.`
  )
}

/** The pad furthest past `limit` on `metric`, or `undefined` when none is past it. */
function worstOver(
  pads: readonly GroovePadResult[],
  metric: (row: GroovePadResult) => number | undefined,
  limit: number,
): GroovePadResult | undefined {
  let worst: GroovePadResult | undefined
  let worstValue = limit
  for (const row of pads) {
    const value = metric(row)
    if (value === undefined || value <= worstValue) continue
    worst = row
    worstValue = value
  }
  return worst
}

/** Learner-facing family name for a sibling-articulation sentence, e.g. `hhOpen`/`hhClosed` -> `'hi-hat'`. */
const ARTICULATION_FAMILY_NAME: Partial<Readonly<Record<MappedDrumPad, string>>> = {
  hhOpen: 'hi-hat',
  hhClosed: 'hi-hat',
}

/**
 * The sentence for one direction of a sibling-articulation mixup (roadmap
 * T.33), e.g. "The hi-hat was played closed where the score asks for open (2
 * of 4)." — evidence-bearing like every other diagnosis sentence: it names
 * the count `slip` actually happened, out of how many the score asked for on
 * `slip.expected`'s own row.
 *
 * A pure, separately-exported function (rather than inlined in
 * `diagnosisSentences`) so the wording is unit-tested on its own, same as
 * every other sentence builder in this file.
 */
export function articulationSentence(slip: ArticulationSlip, result: GrooveRunResult): string {
  const expectedRow = result.pads.find((row) => row.pad === slip.expected)
  const expectedCount = expectedRow?.expected ?? slip.count
  const familyName = ARTICULATION_FAMILY_NAME[slip.expected] ?? GROOVE_PAD_LABEL[slip.expected].toLowerCase()
  return `The ${familyName} was played ${articulationWord(slip.played)} where the score asks for ${articulationWord(slip.expected)} (${slip.count} of ${expectedCount}).`
}

/** The `ArticulationSlip` that explains the most struck-but-mislabelled instants, or `undefined` when there are none. */
function worstArticulationSlip(result: GrooveRunResult): ArticulationSlip | undefined {
  let worst: ArticulationSlip | undefined
  for (const slip of result.articulation) {
    if (worst === undefined || slip.count > worst.count) worst = slip
  }
  return worst
}

/**
 * DR-07 tail / DR-03: the pad with the most wrong-velocity graded hits
 * (accent/ghost instants played at the wrong dynamic), ties going to the
 * first pad in `pads` order — `undefined` when every graded pad's dynamics
 * came out clean. Dynamics never affect `steady`/timing (see the contract on
 * `padDynamics`), so this is read independently of every timing branch below,
 * including the early `result.steady` return.
 */
function worstDynamicsPad(pads: readonly GroovePadResult[]): GroovePadResult | undefined {
  let worst: GroovePadResult | undefined
  for (const row of pads) {
    if (row.dynamics.wrong <= 0) continue
    if (worst === undefined || row.dynamics.wrong > worst.dynamics.wrong) worst = row
  }
  return worst
}

/**
 * One sentence for the pad `worstDynamicsPad` picked out. A pad can have both
 * kinds of dynamics mistake at once (some ghost notes played full AND some
 * accents played soft); the sentence budget is one, so only the larger kind
 * is named — and BOTH the count and the denominator stay within that one
 * kind: `softWanted` of `ghostInstants`, or `loudWanted` of `accentInstants`,
 * never `graded` (both kinds combined). `graded` as a denominator would
 * overstate the count — "16 of 20 ghost notes" on a pad with 16 ghosts and 4
 * accents claims 20 ghost notes were even possible, when only 16 were.
 */
function dynamicsSentence(row: GroovePadResult): string {
  const label = GROOVE_PAD_LABEL[row.pad]
  const { softWanted, loudWanted, ghostInstants, accentInstants } = row.dynamics
  if (softWanted >= loudWanted) {
    return `${label}: ${softWanted} of the ${plural(ghostInstants, 'ghost note')} you hit came out full. Play them under the hi-hat.`
  }
  return `${label}: ${loudWanted} of the ${plural(accentInstants, 'accent')} you hit came out soft. Lean into them.`
}

/**
 * RED (review round 3): a mouse-only run on a dynamics-notated groove (e.g.
 * Ghost-Funk Bar) used to grade `wrong: 0` everywhere and print nothing —
 * every accent/ghost stroke came back UNCLASSIFIED (RED 3's own contract:
 * an on-screen pad click carries no velocity), so the run read as a clean
 * "Steady run" pass on the exact groove that exists to teach ghost notes.
 * `wrong: 0` is technically true and also silently means nothing was ever
 * assessed — this note is the difference between the two, read straight off
 * `dynamics.graded`/`dynamics.unclassified` rather than the verdict.
 *
 * Deliberately takes the FIELDS a caller already has (the orphan-signals
 * lint rule) — `pads` need only their own `dynamics`. The function does NOT
 * pair the two arrays up by index; it sums each one independently —
 * `notated` from every entry of `expectedDynamicsByPad`, `graded`/
 * `unclassified` from every entry of `pads` — so the two lists need not even
 * be the same length or share an order with each other. What each array DOES
 * need is to be complete on its OWN side: `pads` covers every pad the run
 * touched, and `expectedDynamicsByPad` covers every pad the plan notates,
 * each entry holding that one pad's own fields. The screen passes both
 * because it is the one place holding both a `GrooveRunResult` and the
 * `GrooveRunPlan` it was graded against — not because this function needs
 * them zipped together.
 *
 * `notated` (how many accent/ghost instants the groove even has) gates
 * everything: a groove with none of its own (Money Beat) gets no note at
 * all, whatever `graded`/`unclassified` come out to — there is nothing this
 * note could be telling that learner. Then:
 * - nothing graded, something unclassified: on-screen pads cannot express
 *   dynamics at all — say so plainly, once, and name the fix (keyboard/e-kit).
 * - some graded, some unclassified: a MIXED run (say, keyboard for one hand,
 *   mouse for the other) — the verdict undercounts, so say exactly how much
 *   of the picture it actually saw.
 * - nothing unclassified: either every notated stroke was graded (nothing to
 *   add), or nothing matched at all (the timing lines already cover that
 *   case) — either way, no note.
 */
export function dynamicsCoverageNote(
  pads: readonly Pick<GroovePadResult, 'dynamics'>[],
  expectedDynamicsByPad: readonly (readonly DynamicsClass[])[],
): string | undefined {
  const notated = expectedDynamicsByPad.reduce(
    (sum, expectedDynamics) => sum + expectedDynamics.filter((d) => d !== 'normal').length,
    0,
  )
  if (notated === 0) return undefined

  const graded = pads.reduce((sum, row) => sum + row.dynamics.graded, 0)
  const unclassified = pads.reduce((sum, row) => sum + row.dynamics.unclassified, 0)

  if (unclassified === 0) return undefined
  if (graded === 0) {
    return 'Dynamics were not graded: on-screen pads carry no velocity. Use Shift and Alt on the keyboard, or an e-kit.'
  }
  return `Dynamics graded on ${graded} of ${graded + unclassified} strokes; on-screen pad hits carry no velocity.`
}

/**
 * Why the run was not steady, worst cause first. Empty for a steady run that
 * also played its dynamics cleanly — a learner who got it right does not need
 * a list of things that were nearly wrong — but NOT unconditionally empty for
 * every steady run: dynamics wrongness never touches `steady` (timing-only,
 * see `padDynamics`'s contract), so a perfectly steady run that ghosted or
 * accented the wrong stroke still gets its one dynamics sentence below.
 */
export function diagnosisSentences(
  result: GrooveRunResult,
  plan: GrooveRunPlan,
): readonly string[] {
  // DR-07 tail / DR-03: dynamics wrongness never touches `steady` (that field
  // stays purely about timing — see `padDynamics`'s contract), so a run that
  // is perfectly steady but played every accent/ghost at the wrong volume
  // must still surface its one dynamics sentence, even though every other
  // branch below is timing-only and skipped for a steady run.
  if (result.steady) {
    const worstDyn = worstDynamicsPad(result.pads)
    return worstDyn === undefined ? [] : [dynamicsSentence(worstDyn)]
  }

  // Checked on hits, not on matches (T.17.8): a run where nothing registered
  // and a run where everything landed in the wrong place both have zero
  // matches, and only one of them is a rig problem.
  if (result.totalHits === 0) {
    return [
      'Nothing registered at all. Tap a pad now — if it does not light up and sound, the run could not see it either.',
    ]
  }

  // R1: hits registered, but every one of them missed its window — a
  // uniform offset that is not a whole nominal grid-step (a flat latency-like
  // ms shift, say) has no matches for `slipSteps`, `worstUnisonGap`,
  // `spreadMs` or `driftMs` to read (all need matched hits), so without this
  // branch the panel said only "Not there yet" with no diagnosis at all.
  //
  // Round-3 RED, still true after DR-07: gated on `result.slipSteps ===
  // undefined` too — a drill (straight or swung) shifted by exactly one whole
  // NOMINAL grid-step also has every pad `matched === 0` (the grid position
  // pass can't match anything either), but `slipSteps` is defined there and
  // names the fix precisely ("sat 1 beat behind the click"). Without this
  // gate, this branch would pre-empt that strictly more useful sentence with
  // the generic one below it.
  // DR-07 between-grid (review round 2 — RED-2): a run that looks like
  // "every stroke missed" can still have a between-grid sentence to print
  // (see `betweenGridSentence`'s own doc) — that is a strictly more useful,
  // more correct diagnosis than the generic sentence below ("the pattern is
  // there, where you came in is not" reads as a rig/count-in problem, when
  // really the hands are simply sitting a fraction of a grid step off — or,
  // now, the whole kit uniformly is), so this falls through to the block
  // chain instead of returning early. Gated on `betweenGridSentence` itself
  // being DEFINED, not merely on some pad having a `looseOffsetMs` — a run
  // can have loose pads and still resolve to `undefined` (case d in that
  // function's own doc), and in that shape there is no more useful
  // sentence to fall through to, so the generic one below has to fire.
  const between = betweenGridSentence(result.pads, plan)
  if (
    result.slipSteps === undefined &&
    result.pads.length > 0 &&
    result.pads.every((padRow) => padRow.matched === 0) &&
    between === undefined
  ) {
    return [
      'Every stroke landed outside its window — the pattern is there, where you came in is not. Restart on the count-in.',
    ]
  }

  const sentences: string[] = []

  // Roadmap T.33: an articulation mixup is named first — a pattern played
  // with the wrong hi-hat state throughout is a different fix from a timing
  // problem, and conflating the two under a timing sentence would send a
  // learner practising the wrong thing.
  const worstSlip = worstArticulationSlip(result)
  if (worstSlip !== undefined) sentences.push(articulationSentence(worstSlip, result))

  if (result.slipSteps !== undefined) {
    const steps = Math.abs(result.slipSteps)
    const direction = result.slipSteps > 0 ? 'behind' : 'ahead of'
    sentences.push(
      `The whole pattern sat ${plural(steps, stepName(plan.beatMs, plan.nominalSubdivisionMs))} ${direction} the click. The pattern is right; where you came in is not.`,
    )
  }

  // DR-07 tail: named only when the whole-pattern vote above could NOT agree
  // (`result.slipSteps === undefined`) — when it did agree, the sentence
  // above already explains the whole run, and this one would either repeat
  // it or contradict it. Within that case, this fires ONLY for exactly one
  // played pad off its own grid position while every OTHER played pad sits
  // on its own grid (`displacementSteps === 0`) — a clean "this one limb is
  // the problem" shape. Two or more displaced pads, or any played pad whose
  // own grid position could not be pinned down at all
  // (`displacementSteps === undefined`), gets no sentence here: naming one
  // limb when the picture is actually ambiguous would be a guess dressed up
  // as a diagnosis.
  //
  // Review round 2:
  // RED #1 — `played` must require `onGrid.length >= 1`. With exactly ONE
  // pad played, `onGrid.length === 0 === played.length - 1` held trivially,
  // so a learner who played only the hi-hat (kick and snare silent, "0 of 4,
  // 4 missed" on their own rows) was told the hi-hat sat off "the other
  // limbs" — limbs that never played at all, and so proved nothing about
  // where the hi-hat actually sat.
  // AMBER #4 — `played` is filtered to `expected > 0` too. A stray press on a
  // pad the groove never asks for (`expected === 0`, `displacementSteps`
  // always `undefined` for it — see `padDisplacement.ts`) used to count as a
  // "played" row with neither an off nor an on-grid verdict, which could
  // silently break the `off.length === 1 && onGrid.length === played.length
  // - 1` shape and swallow an otherwise-valid diagnosis.
  if (result.slipSteps === undefined) {
    const played = result.pads.filter((row) => row.expected > 0 && row.hits > 0)
    const off = played.filter((row) => row.displacementSteps !== undefined && row.displacementSteps !== 0)
    const onGrid = played.filter((row) => row.displacementSteps === 0)
    if (off.length === 1 && onGrid.length >= 1 && onGrid.length === played.length - 1) {
      const offRow = off[0]
      const offSteps = offRow?.displacementSteps
      if (offRow !== undefined && offSteps !== undefined) {
        const steps = Math.abs(offSteps)
        const direction = offSteps > 0 ? 'behind' : 'ahead of'
        // AMBER #3: says explicitly that the OTHER limbs sit on the grid —
        // the old "They are right" could read as contradicting a second
        // sentence below about one of those same on-grid limbs being loose
        // (`worstOver` on `spreadMs`/`driftMs` says nothing about grid
        // position, only about consistency around its own mean).
        sentences.push(
          `${GROOVE_PAD_LABEL[offRow.pad]} sat ${plural(steps, stepName(plan.beatMs, plan.nominalSubdivisionMs))} ${direction} the other limbs, which sit on the grid. Move ${GROOVE_PAD_LABEL[offRow.pad]} to meet them.`,
        )
      }
    }
  }

  // DR-07 between-grid: named after per-pad displacement (a whole-step slip
  // is always the more specific, more useful diagnosis when both could
  // apply — and by construction they cannot both apply to the SAME pad,
  // since `looseOffsetMs` is only ever computed when that pad's own
  // `displacementSteps` is `undefined`), before dynamics. `between` was
  // already computed above, for the early-return gate — reused here rather
  // than recomputed, since `betweenGridSentence` is a pure function of the
  // same `result.pads`/`plan` either way.
  if (between !== undefined) sentences.push(between)

  // DR-07 tail / DR-03: dynamics named after per-pad displacement, before the
  // unison/flam block, per the contract's ordering.
  const worstDyn = worstDynamicsPad(result.pads)
  if (worstDyn !== undefined) sentences.push(dynamicsSentence(worstDyn))

  const flam = worstUnisonGap(result)
  if (flam !== undefined) {
    const [first, second] = flam.pads
    sentences.push(
      `${GROOVE_PAD_LABEL[first]} and ${GROOVE_PAD_LABEL[second]} are written on the same stroke here, and you played them ${Math.round(flam.gapMs)} ms apart.`,
    )
  }

  const loose = worstOver(result.pads, (row) => row.spreadMs, result.limits.spreadMs)
  if (loose !== undefined) {
    sentences.push(
      `${GROOVE_PAD_LABEL[loose.pad]} scattered ${Math.round(loose.spreadMs ?? 0)} ms around its own average, against a ${Math.round(result.limits.spreadMs)} ms budget. That is the limb to slow down for.`,
    )
  }

  const drifting = worstOver(result.pads, (row) => Math.abs(row.driftMs ?? 0), result.limits.driftMs)
  if (drifting !== undefined) {
    const drift = drifting.driftMs ?? 0
    sentences.push(
      `${GROOVE_PAD_LABEL[drifting.pad]} moved ${Math.round(Math.abs(drift))} ms ${drift > 0 ? 'later' : 'earlier'} between the first half of the run and the second.`,
    )
  }

  return sentences.slice(0, MAX_DIAGNOSIS_SENTENCES)
}

/** The one-line summary of a stored attempt, shown when the learner comes back to the screen. */
export function lastRunText(title: string, bpm: number, steady: boolean): string {
  return `Last run: ${title} at ${bpm} bpm — ${steady ? 'steady' : 'not there yet'}`
}

/**
 * Always shown alongside a result (roadmap T.31), because the result now
 * survives a tempo change: without this line, a learner who retuned after a
 * run would be reading per-limb offsets with no way to tell what tempo they
 * were measured at.
 */
export function gradedAtText(bpm: number): string {
  return `Graded at ${bpm} bpm`
}
