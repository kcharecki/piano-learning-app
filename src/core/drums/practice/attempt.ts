/**
 * What a finished groove run leaves behind (roadmap DR-09/T.17) — the record
 * the trainer writes to `drumsHistoryStore` and reads back as "Last run: …"
 * when the learner returns to the screen.
 *
 * ## Nothing is ever added here as a required field
 *
 * `persistence.ts` restores a slice all-or-nothing: its validator returns
 * false and the whole history is dropped, silently, as corrupt. That is the
 * right behaviour for a hand-edited or truly broken blob, and the wrong
 * behaviour for a record written by last month's version of this app that
 * simply predates a field — which is exactly how the first attempt at this
 * feature shipped a shape that could not read its own older records
 * (T.17.5). So the rule for this type is structural rather than procedural:
 * the five identity fields below are the whole required surface, and every
 * later addition is optional, defaulted at the read site. A change that needs
 * a required field needs a new key and a real migration, not an edit here.
 */
import type { MappedDrumPad } from '@core/drums/model/pad.ts'

export type DrumsGroovePadAttempt = {
  readonly pad: MappedDrumPad
  readonly expected: number
  readonly matched: number
  /** Positive is late. Absent when nothing on this pad matched. */
  readonly meanOffsetMs?: number
}

export type DrumsGrooveAttempt = {
  readonly grooveId: string
  /** Stored, not looked up: a groove can be renamed or retired and an old run still reads back. */
  readonly grooveTitle: string
  readonly bpm: number
  /** Wall-clock epoch ms, from a `DateSource` at the app edge. */
  readonly at: number
  readonly steady: boolean
  /** Optional by rule — see the module comment. */
  readonly pads?: readonly DrumsGroovePadAttempt[]
}
