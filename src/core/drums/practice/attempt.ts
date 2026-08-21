/**
 * What a graded groove run leaves behind (roadmap DR-09), and the sentences
 * the learner reads about it.
 *
 * ## Why the wording lives in core
 *
 * `gradeGroovePerformance` (`./grooveGrader.ts`) returns counts and signed
 * offsets; every one of them still has to become a sentence a beginner can
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
 * their own motor jitter. Anything inside `DEAD_ON_MS` is therefore reported
 * as dead on. The threshold is small enough that a real, systematic rush or
 * drag — the thing this trainer exists to expose — always survives it.
 *
 * ## The stored attempt
 *
 * `DrumsGrooveAttempt` is the persisted shape (`PersistedDrumsHistory`), so it
 * holds only plain data: no `GrooveScore` reference (a stored run must stay
 * readable after the content it came from changes), and `at` is an epoch
 * millisecond supplied by the caller from the injected `Clock`, never read
 * here — core does not call `Date.now()`.
 */
import type { MappedDrumPad, DrumPad } from '@core/drums/model/pad.ts'
import type { PadResult } from './grooveGrader.ts'

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

/** Inside this, a mean offset is reported as dead on rather than as a number. See the module comment. */
export const DEAD_ON_MS = 2

/**
 * A signed mean offset -> the phrase for it. Positive is late (the hit came
 * after the note), negative is early, which is the sign convention
 * `PadResult.meanOffsetMs` already uses.
 */
export function offsetPhrase(meanOffsetMs: number | undefined): string {
  if (meanOffsetMs === undefined) return 'nothing landed'
  const rounded = Math.round(meanOffsetMs)
  if (Math.abs(rounded) <= DEAD_ON_MS) return 'dead on'
  return rounded > 0 ? `${rounded} ms late` : `${-rounded} ms early`
}

/**
 * One pad's result as a sentence: `Hi-hat — 16 of 16, 12 ms late`, or
 * `Snare — 0 of 4, 4 missed, 4 extra` when the limb went wrong.
 *
 * Misses and extras come before the offset because they are the bigger fact:
 * a learner who played the snare on 1 and 3 does not need to know how evenly
 * they did it. When nothing is missing and nothing is spurious, the offset is
 * the only thing left to say.
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
  return `${counts}, ${[...problems, offsetPhrase(row.meanOffsetMs)].join(', ')}`
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
  readonly clean: boolean
  /** In the order the screen showed the pads, so the stored run reads back the way it was played. */
  readonly pads: readonly PadResult[]
}

/**
 * The one line the screen shows on arrival, so a learner who comes back
 * tomorrow can see what they last did without pressing anything:
 * `Last run: Money Beat at 80 bpm — Hi-hat 16 of 16, Snare 4 of 4, Kick 4 of 4`.
 *
 * Counts only, no offsets: this is a reminder of where they got to, and three
 * millisecond figures in one sentence is a wall, not a reminder.
 */
export function lastRunSummary(attempt: DrumsGrooveAttempt): string {
  const pads = attempt.pads
    .filter((row) => row.expected > 0)
    .map((row) => `${padLabel(row.pad)} ${row.matched} of ${row.expected}`)
    .join(', ')
  const head = `Last run: ${attempt.grooveTitle} at ${attempt.bpm} bpm`
  return pads.length === 0 ? head : `${head} — ${pads}`
}
