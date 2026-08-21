/**
 * What a graded groove run leaves behind (roadmap DR-09), and the sentences
 * the learner reads about it.
 *
 * ## Why the wording lives in core
 *
 * `gradeGroovePerformance` (`./grooveGrader.ts`) returns counts, offsets and
 * a spread; every one of them still has to become a sentence a beginner can
 * act on. Putting that here rather than in the screen is deliberate: the
 * whole point of DR-09 is that the app names the limb that was wrong, so the
 * naming is behaviour, not decoration, and it gets the same unit tests as the
 * matching does. The screen stays a layout — it renders the strings this
 * module hands it.
 *
 * ## Why "dead on" instead of "0 ms late"
 *
 * A signed mean offset of −0.4 ms is noise, not information, and rendering it
 * as "0 ms early" invites a beginner to chase a number that is already inside
 * their own motor jitter. Anything inside `DEAD_ON_MS` — mean or spread — is
 * therefore folded into "dead on" rather than shown as a number. The
 * threshold is small enough that a real, systematic rush or drag — the thing
 * this trainer exists to expose — always survives it.
 *
 * ## Why the mean is never enough — bias and spread are different faults
 *
 * The mean alone used to lie twice. First, early and late cancel: a hi-hat
 * played alternately 80 ms early and 80 ms late averages to zero, so
 * `offsetPhrase` printed "dead on" for a performance that was never once near
 * the beat. Second, a mean can be wrong for a reason that has nothing to do
 * with the learner: device latency — the e-kit's scan time plus the speaker
 * or headphone output delay — adds the *same constant* to every hit this
 * module ever sees. A constant shifts the mean and cannot touch how far hits
 * scatter from each other, so `spreadMs` (from `grooveGrader.ts`) is the one
 * figure this module can trust to be about the learner and not the laptop.
 *
 * That is why `offsetPhrase` takes both figures, and why they carry different
 * advice: a learner uniformly late has a listening problem, or a slow rig,
 * and telling them to "come in earlier" may just be telling them to fight
 * their own hardware. A learner scattered either side of the beat has a motor
 * problem, fixed by practising slower, and telling them their average is fine
 * is useless — they were never playing to the average. `verdictText`
 * therefore reads only `steady` and the pad-alignment gap below (never a
 * single pad's mean — see the next section for why the gap is different).
 *
 * ## A whole pad shifted by a grid step is not "late" — it is a phase slip
 *
 * A third fault looks like bias at first but is not: a pad played consistently
 * one grid position away from where it was written (Ghost Funk Bar's hi-hat
 * line played a whole sixteenth late is the case that exposed it) matches the
 * *next* onset every time under a tolerance window sized for jitter, not for
 * a full note value. The resulting "matched" pairs are real hits paired with
 * the wrong note, so their mean offset is a fact about the mismatch, not
 * about the learner's timing, and printing it — "11 ms late" — is worse than
 * useless: the learner never once played where it was written, and the one
 * number they are given says otherwise. `grooveGrader.ts` detects this
 * (`PadResult.phaseSlipSteps`) and hands over the shift in grid units and the
 * grid's own name (`gridTicks`); `phaseSlipPhrase` is the sentence that names
 * it instead of measuring it, and `padLineText` prefers it over any offset
 * whenever it applies.
 *
 * ## A flam is not an uneven pulse — it is two even pulses, unaligned
 *
 * A fourth fault also used to collapse into "the pulse is uneven": kick and
 * hi-hat each individually dead steady, but the kick consistently 60-70 ms
 * behind the hi-hat they share a beat with — a flam. Every pad's own spread
 * is fine, so blaming "the pulse" is a false diagnosis with the wrong fix
 * (practising slower does nothing for a limb that is already even). What is
 * actually wrong is cross-pad: `GroovePerformance.padAlignmentMs` (from
 * `grooveGrader.ts`) is the gap between the latest and earliest pad's own
 * means, and unlike a single pad's mean it survives the undisclosed-latency
 * problem below — see `FLAM_GAP_NOTE`'s own comment for why a *difference* of
 * two means cancels a constant that neither mean alone can. `verdictText`
 * names the limb (`laggingPad`/`leadingPad`) precisely because this is the
 * one number in the whole module trustworthy enough to hang a sentence on.
 *
 * ## The undisclosed proxy
 *
 * Nothing under `src/` reads `outputLatency` or `baseLatency`, and there is
 * no calibration step, so every millisecond this module prints about a
 * *single* pad is the learner's true timing *plus* an unmeasured, unremovable
 * constant. Printing that number as if it were the learner's timing alone
 * would be a false claim of precision, not a rounding nicety, so
 * `TIMING_CAVEAT` says what the figure actually is everywhere a single-pad
 * figure is shown. `verdictText` is built so its certifying word never needs
 * one of those single-pad numbers — the one number it does sometimes print,
 * the pad-alignment gap, is the one this proxy cannot touch, and it says so
 * via `FLAM_GAP_NOTE` rather than relying on `TIMING_CAVEAT` to cover it.
 *
 * ## The stored attempt
 *
 * `DrumsGrooveAttempt` is the persisted shape (`PersistedDrumsHistory`), so it
 * holds only plain data: no `GrooveScore` reference (a stored run must stay
 * readable after the content it came from changes), and `at` is an epoch
 * millisecond supplied by the caller from the injected `Clock`, never read
 * here — core does not call `Date.now()`. `clean` is renamed `steady` because
 * it now means exactly what `GroovePerformance.steady` means: complete, and
 * even.
 *
 * ## Why `lastRunSummary` prints the verdict and the extras
 *
 * The previous version printed only `matched of expected` per pad, on the
 * theory that a returning-tomorrow reminder should be one line, not a wall of
 * milliseconds. That theory survives; the implementation of it did not:
 * dropping `extra` meant a pad played twice as often as asked for still
 * showed "16 of 16", and dropping the verdict meant a run the screen called
 * "Not there yet" at the time read back, after a reload, as three perfect
 * counts in a row — the exact false certainty this whole change exists to
 * remove. The fix keeps the one-line budget (still no per-pad milliseconds)
 * but restores the two facts whose absence made the line wrong: the verdict
 * up front, and each pad's extra count where it has one.
 */
import type { MappedDrumPad, DrumPad } from '@core/drums/model/pad.ts'
import { PAD_ALIGNMENT_MS, type GroovePerformance, type PadResult } from './grooveGrader.ts'

/**
 * What the learner calls each pad. Kit vocabulary, not MusicXML instrument
 * names (`instrumentNameOf` gives "Closed Hi-Hat", which is what a file
 * format wants and not what a drummer says).
 */
export const GROOVE_PAD_LABEL: Record<MappedDrumPad, string> = {
  kick: 'Kick',
  hhPedal: 'Hi-hat pedal',
  tomFloor: 'Floor tom',
  tomMid: 'Mid tom',
  snare: 'Snare',
  snareRim: 'Rim shot',
  crossStick: 'Cross stick',
  tomHigh: 'High tom',
  hhClosed: 'Hi-hat',
  hhOpen: 'Open hi-hat',
  rideBow: 'Ride',
  rideBell: 'Ride bell',
  rideEdge: 'Ride edge',
  crash1: 'Crash',
  crash2: 'Second crash',
  splash: 'Splash',
}

/** A live hit the kit map could not classify — see `DrumPad`'s own doc. */
const UNMAPPED_LABEL = 'Unrecognised hit'

export function padLabel(pad: DrumPad): string {
  return pad === 'unmapped' ? UNMAPPED_LABEL : GROOVE_PAD_LABEL[pad]
}

/** Inside this, an offset — mean or spread — is folded into "dead on" rather than shown as a number. See the module comment. */
export const DEAD_ON_MS = 2

/**
 * Plain, second-person disclosure that the figures the learner is about to
 * read are not pure timing. See the module comment's "undisclosed proxy"
 * section for why a proxy the learner is not told about is not acceptable —
 * this string is how it gets told.
 */
export const TIMING_CAVEAT =
  'These milliseconds include the delay of your keyboard and speakers, not just your own timing. ' +
  'That is why a run is judged on how even it was, not on exactly where it landed.'

/**
 * A signed mean offset, and its spread, to the phrase for it. Positive mean
 * is late (the hit came after the note), negative is early — the sign
 * convention `PadResult.meanOffsetMs` already uses. `spreadMs` has no sign;
 * it only ever adds "and it was scattered by this much", never a direction.
 *
 * The two figures are reported together but are not the same claim — see the
 * module comment's "bias and spread" section for why a run that is even but
 * uniformly late reads differently from a run that is centred on the beat
 * but scattered around it.
 */
export function offsetPhrase(meanOffsetMs: number | undefined, spreadMs: number | undefined): string {
  if (meanOffsetMs === undefined) return 'nothing landed'
  const mean = Math.round(meanOffsetMs)
  const spread = spreadMs === undefined ? undefined : Math.round(spreadMs)
  const spreadTail = spread !== undefined && spread > DEAD_ON_MS ? `, ±${spread} ms` : ''
  if (Math.abs(mean) <= DEAD_ON_MS) {
    return spreadTail === '' ? 'dead on' : `centred on the beat${spreadTail}`
  }
  const base = mean > 0 ? `${mean} ms late` : `${-mean} ms early`
  return `${base}${spreadTail}`
}

/**
 * The note-value vocabulary a beginner already has for their own part —
 * "sixteenth", not "120 ticks" — for the grid spacings `phaseSlipPhrase`
 * actually has to name. Deliberately not exhaustive: a spacing this map does
 * not know, and `gridTicks === undefined` (fewer than two notes on the pad,
 * so there is no spacing to name), both fall through to `UNNAMED_GRID_STEP`
 * rather than a guessed name — see that constant's own comment.
 */
const GRID_STEP_NAMES: Record<number, { readonly singular: string; readonly plural: string }> = {
  480: { singular: 'quarter', plural: 'quarters' },
  320: { singular: 'dotted quarter', plural: 'dotted quarters' },
  240: { singular: 'eighth', plural: 'eighths' },
  160: { singular: 'eighth triplet', plural: 'eighth triplets' },
  120: { singular: 'sixteenth', plural: 'sixteenths' },
  60: { singular: 'thirty-second', plural: 'thirty-seconds' },
}

/**
 * What `phaseSlipPhrase` says when it cannot name the grid it slipped by. A
 * wrong name (e.g. calling a quintuplet gap a "sixteenth") would be a false
 * statement about the learner's part; a vague-but-true one is not.
 */
const UNNAMED_GRID_STEP = { singular: 'step of the pattern', plural: 'steps of the pattern' }

const SMALL_COUNT_WORDS = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
]

/** A small positive count in words — "two", not "2" — the way a teacher says it out loud. */
function spellCount(n: number): string {
  return SMALL_COUNT_WORDS[n - 1] ?? String(n)
}

/**
 * The sentence for a pad whose whole line landed one or more grid positions
 * away from where it was written — see the module comment's "why the mean is
 * never enough" section for the sibling reasoning on bias vs. spread; this is
 * the third shape a systematic offset can take. It never prints a
 * millisecond figure: every hit on this pad matched *some* note near it, just
 * the wrong one, so a millisecond offset here would describe a phantom
 * near-match rather than what actually happened, which is that the learner
 * played a nameable, different position in the pattern throughout.
 */
function phaseSlipPhrase(pad: DrumPad, phaseSlipSteps: number, gridTicks: number | undefined): string {
  const steps = Math.abs(phaseSlipSteps)
  const name = (gridTicks === undefined ? undefined : GRID_STEP_NAMES[gridTicks]) ?? UNNAMED_GRID_STEP
  const noun = steps === 1 ? name.singular : name.plural
  const direction = phaseSlipSteps > 0 ? 'behind' : 'ahead of'
  return `your ${padLabel(pad).toLowerCase()} is ${spellCount(steps)} ${noun} ${direction} the click`
}

/**
 * One pad's result as a sentence: `Hi-hat — 16 of 16, 12 ms late`, or
 * `Snare — 0 of 4, 4 missed, 4 extra` when the limb went wrong.
 *
 * Misses and extras come before the offset because they are the bigger fact:
 * a learner who played the snare on 1 and 3 does not need to know how evenly
 * they did it. When nothing is missing and nothing is spurious, the offset —
 * mean and spread both, from `offsetPhrase` — is the only thing left to say.
 *
 * Two refinements on top of that, both from the same evidence rule — an
 * offset is only ever printed about the notes it was actually computed from:
 *
 * - A phase slip (`phaseSlipSteps`) takes priority over everything else. The
 *   "matched" pairs behind a slipped pad's offset are hits paired with the
 *   *wrong* note, so the offset they would produce is not a fact about the
 *   learner's timing at all; `phaseSlipPhrase` replaces it, even when misses
 *   or extras are also present (a slipped line commonly has both, at the
 *   pattern's edges).
 * - Otherwise, the offset is printed only when the pad matched every note it
 *   was asked for and nothing more (`missed === 0 && extra === 0`). A pad
 *   that is missing notes or has spurious ones has an offset computed from
 *   only the subset that happened to land — not evidence about the pad as a
 *   whole, and stating it invites exactly the false "8 of 20 ... dead on"
 *   reading this rule exists to rule out.
 */
export function padLineText(row: PadResult): string {
  const label = padLabel(row.pad)
  if (row.expected === 0) {
    return `${label} — not in this groove, ${row.extra} extra`
  }
  const counts = `${label} — ${row.matched} of ${row.expected}`
  const problems: string[] = []
  if (row.missed > 0) problems.push(`${row.missed} missed`)
  if (row.extra > 0) problems.push(`${row.extra} extra`)

  if (row.phaseSlipSteps !== undefined && row.phaseSlipSteps !== 0) {
    return `${counts}, ${[...problems, phaseSlipPhrase(row.pad, row.phaseSlipSteps, row.gridTicks)].join(', ')}`
  }
  if (row.matched === 0 || row.missed > 0 || row.extra > 0) {
    return `${counts}, ${problems.join(', ')}`
  }
  return `${counts}, ${[...problems, offsetPhrase(row.meanOffsetMs, row.spreadMs)].join(', ')}`
}

/**
 * The one extra sentence the flam verdict in `verdictText` earns. A single
 * pad's own milliseconds carry an unmeasured device-latency constant (see the
 * module comment's "undisclosed proxy" section), but the *gap between two
 * pads'* means does not: the same constant is added to both, so it cancels
 * out of their difference. This sentence is the only place that distinction
 * is spelled out for the learner, kept to one line on purpose.
 */
export const FLAM_GAP_NOTE =
  'That gap is real: a slow keyboard or speakers would delay every drum by the same amount, not just one.'

/**
 * The one word — or, for a flam, one short named sentence — for the whole
 * run. Reads counts, spread, and now cross-pad alignment, but never any
 * single pad's mean — see the module comment.
 *
 * `padAlignmentMs`/`laggingPad`/`leadingPad` are optional here, not merely
 * defaulted: `lastRunSummary` calls this from `DrumsGrooveAttempt`, the
 * persisted shape, which does not carry them (see that type's own doc — a
 * stored run holds plain data only). When they are missing, this function
 * cannot tell a flam (every pad's own pulse fine, two pads not together)
 * apart from a genuinely uneven pad, so it must not guess at either fault by
 * name; `'Every note, but not together yet'` is the sentence that stays true
 * regardless of which one it was. When the caller does have live
 * `GroovePerformance` alignment figures, the more specific sentence — naming
 * the limb, the way a teacher would — is used instead, but only when
 * alignment is in fact the failure (`padAlignmentMs > PAD_ALIGNMENT_MS`); if
 * alignment is fine and the run is still unsteady, the fault can only be a
 * pad's own spread, so the uneven-pulse sentence is still the true one there.
 */
export function verdictText(
  performance: Pick<GroovePerformance, 'complete' | 'steady'> &
    Partial<Pick<GroovePerformance, 'padAlignmentMs' | 'laggingPad' | 'leadingPad'>>,
): string {
  if (!performance.complete) return 'Not there yet'
  if (performance.steady) return 'Steady run'

  const { padAlignmentMs, laggingPad, leadingPad } = performance
  if (padAlignmentMs !== undefined && laggingPad !== undefined && leadingPad !== undefined) {
    if (padAlignmentMs > PAD_ALIGNMENT_MS) {
      const lagging = padLabel(laggingPad).toLowerCase()
      const leading = padLabel(leadingPad).toLowerCase()
      return `Your ${lagging} is ${Math.round(padAlignmentMs)} ms behind your ${leading}. ${FLAM_GAP_NOTE}`
    }
    return 'Every note, but the pulse is uneven'
  }
  return 'Every note, but not together yet'
}

/**
 * A finished, graded run, as it is stored (`PersistedDrumsHistory.attempts`).
 * Plain data only — see the module comment on why no `GrooveScore` is kept.
 */
export type DrumsGrooveAttempt = {
  readonly grooveId: string
  readonly grooveTitle: string
  readonly bpm: number
  /** How many passes of the groove were graded — the count-in bar is not one of them. */
  readonly repeats: number
  /** Epoch milliseconds, from the caller's injected `Clock`. */
  readonly at: number
  /** `GroovePerformance.steady` at the time this run was graded: complete, and even. */
  readonly steady: boolean
  /** In the order the screen showed the pads, so the stored run reads back the way it was played. */
  readonly pads: readonly PadResult[]
}

/**
 * The one line the screen shows on arrival, so a learner who comes back
 * tomorrow can see what they last did without pressing anything:
 * `Last run: Money Beat at 80 bpm — Steady run: Hi-hat 16 of 16, Snare 4 of
 * 4, Kick 4 of 4`.
 *
 * Still one line and still no per-pad milliseconds — that budget was never
 * the problem. But the verdict and each pad's extra count are back: see the
 * module comment's last section for why leaving them out was a defect, not
 * economy. `complete` is recomputed from `pads` rather than stored, because
 * "complete" is exactly "nothing missed and nothing extra, anywhere" and the
 * pads already say that; storing a second copy would only give it a chance
 * to drift from the counts sitting right next to it.
 */
export function lastRunSummary(attempt: DrumsGrooveAttempt): string {
  const complete =
    attempt.pads.some((row) => row.expected > 0) &&
    attempt.pads.every((row) => row.missed === 0 && row.extra === 0)
  const verdict = verdictText({ complete, steady: attempt.steady })
  const padList = attempt.pads
    .filter((row) => row.expected > 0)
    .map((row) => {
      const extraTail = row.extra > 0 ? ` (${row.extra} extra)` : ''
      return `${padLabel(row.pad)} ${row.matched} of ${row.expected}${extraTail}`
    })
    .join(', ')
  const head = `Last run: ${attempt.grooveTitle} at ${attempt.bpm} bpm — ${verdict}`
  return padList.length === 0 ? head : `${head}: ${padList}`
}
