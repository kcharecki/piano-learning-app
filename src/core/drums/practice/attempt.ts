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
 * therefore reads only `steady` (built from spread — see `grooveGrader.ts`'s
 * own module comment) and never the mean.
 *
 * ## The undisclosed proxy
 *
 * Nothing under `src/` reads `outputLatency` or `baseLatency`, and there is
 * no calibration step, so every millisecond this module prints is the
 * learner's true timing *plus* an unmeasured, unremovable constant. Printing
 * that number as if it were the learner's timing alone would be a false
 * claim of precision, not a rounding nicety, so `TIMING_CAVEAT` says what the
 * figure actually is everywhere a figure is shown, and `verdictText` — the
 * only text with any certifying weight — is built so it never needs the
 * number at all.
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
import type { GroovePerformance, PadResult } from './grooveGrader.ts'

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
 * One pad's result as a sentence: `Hi-hat — 16 of 16, 12 ms late`, or
 * `Snare — 0 of 4, 4 missed, 4 extra` when the limb went wrong.
 *
 * Misses and extras come before the offset because they are the bigger fact:
 * a learner who played the snare on 1 and 3 does not need to know how evenly
 * they did it. When nothing is missing and nothing is spurious, the offset —
 * mean and spread both, from `offsetPhrase` — is the only thing left to say.
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
  if (row.matched === 0) return `${counts}, ${problems.join(', ')}`
  return `${counts}, ${[...problems, offsetPhrase(row.meanOffsetMs, row.spreadMs)].join(', ')}`
}

/** The one word for the whole run, from counts and spread — never from the mean. */
export function verdictText(performance: Pick<GroovePerformance, 'complete' | 'steady'>): string {
  if (!performance.complete) return 'Not there yet'
  return performance.steady ? 'Steady run' : 'Every note, but the pulse is uneven'
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
