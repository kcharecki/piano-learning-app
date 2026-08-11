/**
 * Practice log and timer (roadmap 2.9, REQ-3.9.5, REQ-3.10.4).
 *
 * `PracticeTimer` turns a start/stop button into a `PracticeEntry`: it takes a
 * `Clock` (monotonic elapsed time, for the live "how long have I been at this"
 * readout) and a `DateSource` (wall-clock epoch millis, for the entry's
 * `startedAt`/`endedAt` and for day-bucketing later). The two are injected
 * separately on purpose — see `src/core/ports/clock.ts` — even though the test
 * fake (`FakeClock`) happens to implement both from the same counter.
 *
 * ## Day boundaries
 *
 * `dailyTotals`, `currentStreakDays` and `longestStreakDays` all have to decide
 * which calendar day a timestamp belongs to. This is a single-user, offline,
 * personal app, so the only boundary that means anything to the user is their
 * OWN local midnight — not UTC midnight, which for most timezones lands in the
 * middle of a practice session and would silently split it onto the "wrong"
 * day. But `src/core` cannot read the system timezone (that is an impure,
 * environment-dependent lookup), so the offset is a required parameter:
 * `utcOffsetMinutes`, minutes to ADD to a UTC epoch-millis timestamp to get
 * local wall-clock time (e.g. `-300` for US Eastern Standard Time / UTC-5,
 * `+60` for Central European Time). The caller (an adapter, which is allowed to
 * ask the browser for `-new Date().getTimezoneOffset()`) supplies it; this
 * module never assumes UTC and never guesses.
 *
 * A session is credited to the local day it STARTED on. A session that
 * happens to straddle local midnight is not split — it is one entry, dated by
 * its start — but two separate sessions either side of midnight (one ending
 * 23:59, the next starting 00:01) are unambiguously two different days.
 */
import type { Clock, DateSource } from '@core/ports/index.ts'
import { invariant } from '@core/shared/invariant.ts'

export type ActivityKind =
  'technique' | 'sightreading' | 'repertoire' | 'lesson' | 'theory' | 'eartraining'

/** Every `ActivityKind`, in a stable display order. */
export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'technique',
  'sightreading',
  'repertoire',
  'lesson',
  'theory',
  'eartraining',
]

export type PracticeEntry = {
  readonly id: string
  /** Epoch milliseconds (`DateSource.epochMillis()`), when the session began. */
  readonly startedAt: number
  /** Epoch milliseconds, when the session ended. Always `>= startedAt`. */
  readonly endedAt: number
  readonly kind: ActivityKind
  /** The curriculum/repertoire item practiced, if it has a stable id. */
  readonly itemId?: string
  /** Human-readable label — always present, even when `itemId` is not. */
  readonly itemName: string
  /** Tempo achieved during the session, in BPM. Caller-defined precision. */
  readonly tempoBpm?: number
  /** Accuracy for the session. Caller-defined scale (e.g. 0–1) — this module never interprets it. */
  readonly accuracy?: number
  readonly note?: string
}

export type PracticeStartOptions = {
  readonly itemId?: string
}

export type PracticeStopOptions = {
  readonly tempoBpm?: number
  readonly accuracy?: number
  readonly note?: string
}

type Session = {
  readonly kind: ActivityKind
  readonly itemName: string
  readonly itemId?: string
  /** `Clock.now()` at start — monotonic, used only for `elapsedMs`. */
  readonly startClockMs: number
  /** `DateSource.epochMillis()` at start — wall-clock, stored on the entry. */
  readonly startedAt: number
}

/**
 * A start/stop stopwatch that emits a `PracticeEntry` on `stop()`. One session
 * at a time: calling `start()` while a session is already running is a
 * programmer error (the caller's UI should disable the start control), not a
 * silent restart that would lose the first session's data.
 */
export class PracticeTimer {
  private readonly clock: Clock
  private readonly date: DateSource
  private session: Session | null = null
  /**
   * Ids only need to be unique for the lifetime of this timer instance, not
   * globally: they are a debugging/React-key convenience, not a sync key. No
   * `Rng` is injected here (the constructor signature is fixed), so identity
   * comes from the start timestamp plus a per-instance counter rather than
   * randomness — deterministic, and collision-free unless two sessions in the
   * same instance start at the exact same millisecond, which the counter rules
   * out.
   */
  private nextSeq = 1

  constructor(clock: Clock, date: DateSource) {
    this.clock = clock
    this.date = date
  }

  /** Begin timing. `itemName` is the human-readable label shown in the log. */
  start(kind: ActivityKind, itemName: string, opts: PracticeStartOptions = {}): void {
    invariant(this.session === null, 'PracticeTimer.start: a session is already running')
    invariant(itemName.trim().length > 0, 'PracticeTimer.start: itemName must not be blank')
    this.session = {
      kind,
      itemName,
      ...(opts.itemId === undefined ? {} : { itemId: opts.itemId }),
      startClockMs: this.clock.now(),
      startedAt: this.date.epochMillis(),
    }
  }

  /**
   * End timing and return the finished entry, or `undefined` if nothing was
   * running (calling `stop()` twice, or before any `start()`, is harmless).
   */
  stop(opts: PracticeStopOptions = {}): PracticeEntry | undefined {
    const session = this.session
    if (session === null) return undefined
    this.session = null
    return {
      id: `pe-${session.startedAt}-${this.nextSeq++}`,
      startedAt: session.startedAt,
      endedAt: this.date.epochMillis(),
      kind: session.kind,
      ...(session.itemId === undefined ? {} : { itemId: session.itemId }),
      itemName: session.itemName,
      ...(opts.tempoBpm === undefined ? {} : { tempoBpm: opts.tempoBpm }),
      ...(opts.accuracy === undefined ? {} : { accuracy: opts.accuracy }),
      ...(opts.note === undefined ? {} : { note: opts.note }),
    }
  }

  /** Milliseconds elapsed since `start()`, measured on the monotonic `Clock`. Zero when idle. */
  get elapsedMs(): number {
    return this.session === null ? 0 : this.clock.now() - this.session.startClockMs
  }

  get running(): boolean {
    return this.session !== null
  }
}

// --------------------------------------------------------------- aggregation

const MS_PER_MIN = 60_000
const MS_PER_DAY = 86_400_000

const minutesOf = (entry: PracticeEntry): number => (entry.endedAt - entry.startedAt) / MS_PER_MIN

/** `true` if `entry` started within the half-open range `[from, to)`. */
const startedInRange = (entry: PracticeEntry, from: number, to: number): boolean =>
  entry.startedAt >= from && entry.startedAt < to

/** Total practice time, in minutes, for entries starting in `[from, to)`. */
export function totalMinutes(entries: readonly PracticeEntry[], from: number, to: number): number {
  let total = 0
  for (const entry of entries) if (startedInRange(entry, from, to)) total += minutesOf(entry)
  return total
}

/** Practice time in `[from, to)`, in minutes, broken down by `ActivityKind`. Every kind is present, defaulting to 0. */
export function minutesByKind(
  entries: readonly PracticeEntry[],
  from: number,
  to: number,
): Record<ActivityKind, number> {
  const totals = Object.fromEntries(ACTIVITY_KINDS.map((k) => [k, 0])) as Record<
    ActivityKind,
    number
  >
  for (const entry of entries) {
    if (!startedInRange(entry, from, to)) continue
    totals[entry.kind] += minutesOf(entry)
  }
  return totals
}

/** Local calendar day index (days since the Unix epoch) for `epochMs` under `utcOffsetMinutes`. */
function localDayIndex(epochMs: number, utcOffsetMinutes: number): number {
  return Math.floor((epochMs + utcOffsetMinutes * MS_PER_MIN) / MS_PER_DAY)
}

/**
 * Proleptic-Gregorian civil date from a day count since 1970-01-01 (Howard
 * Hinnant's `civil_from_days`: http://howardhinnant.github.io/date_algorithms.html).
 * Pure integer arithmetic — no `Date` object, which `src/core` may not use.
 * Correct for every day count, positive or negative, verified against `Date`
 * across a 400-year-plus fuzz range in the test file.
 */
function civilFromDays(days: number): {
  readonly y: number
  readonly m: number
  readonly d: number
} {
  const z = days + 719468
  const era = Math.trunc((z >= 0 ? z : z - 146096) / 146097)
  const doe = z - era * 146097 // [0, 146096]
  const yoe = Math.trunc(
    (doe - Math.trunc(doe / 1460) + Math.trunc(doe / 36524) - Math.trunc(doe / 146096)) / 365,
  ) // [0, 399]
  const doy = doe - (365 * yoe + Math.trunc(yoe / 4) - Math.trunc(yoe / 100)) // [0, 365]
  const mp = Math.trunc((5 * doy + 2) / 153) // [0, 11]
  const d = doy - Math.trunc((153 * mp + 2) / 5) + 1 // [1, 31]
  const m = mp < 10 ? mp + 3 : mp - 9 // [1, 12]
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return { y, m, d }
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0')

/** ISO 8601 date (`YYYY-MM-DD`) for a local day index. */
function isoDateFromDayIndex(dayIndex: number): string {
  const { y, m, d } = civilFromDays(dayIndex)
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`
}

/**
 * One entry per local calendar day touched by `[from, to)`, in order, INCLUDING
 * days with zero practice — so this is the right shape to feed straight into a
 * bar chart without the caller having to fill gaps. Empty (`[]`) if `to <= from`.
 */
export function dailyTotals(
  entries: readonly PracticeEntry[],
  from: number,
  to: number,
  utcOffsetMinutes: number,
): readonly { readonly date: string; readonly minutes: number }[] {
  if (to <= from) return []
  const byDay = new Map<number, number>()
  for (const entry of entries) {
    if (!startedInRange(entry, from, to)) continue
    const day = localDayIndex(entry.startedAt, utcOffsetMinutes)
    byDay.set(day, (byDay.get(day) ?? 0) + minutesOf(entry))
  }
  const firstDay = localDayIndex(from, utcOffsetMinutes)
  const lastDay = localDayIndex(to - 1, utcOffsetMinutes)
  const out: { date: string; minutes: number }[] = []
  for (let day = firstDay; day <= lastDay; day++) {
    out.push({ date: isoDateFromDayIndex(day), minutes: byDay.get(day) ?? 0 })
  }
  return out
}

/** The distinct local days (as day indices) on which at least one session started. */
function practicedDayIndices(
  entries: readonly PracticeEntry[],
  utcOffsetMinutes: number,
): Set<number> {
  const days = new Set<number>()
  for (const entry of entries) days.add(localDayIndex(entry.startedAt, utcOffsetMinutes))
  return days
}

/**
 * Consecutive local days of practice, counting backward from today. Practicing
 * more than once on the same day still counts as one day. A streak only
 * "counts" if it includes today: if the most recent practice was yesterday (or
 * earlier), today has not happened yet as far as the streak is concerned, and
 * this returns 0 rather than crediting a day that has not been practiced.
 */
export function currentStreakDays(
  entries: readonly PracticeEntry[],
  now: number,
  utcOffsetMinutes: number,
): number {
  const days = practicedDayIndices(entries, utcOffsetMinutes)
  const today = localDayIndex(now, utcOffsetMinutes)
  // Starting the walk at `today` gives the "must include today" rule for free:
  // if today was not practiced, `days.has(today)` is false on the very first
  // check and the loop contributes nothing.
  let streak = 0
  for (let day = today; days.has(day); day--) streak++
  return streak
}

/** The longest run of consecutive practiced local days anywhere in `entries`. */
export function longestStreakDays(
  entries: readonly PracticeEntry[],
  utcOffsetMinutes: number,
): number {
  const days = [...practicedDayIndices(entries, utcOffsetMinutes)].sort((a, b) => a - b)
  let longest = 0
  let current = 0
  let previous: number | null = null
  for (const day of days) {
    current = previous !== null && day === previous + 1 ? current + 1 : 1
    if (current > longest) longest = current
    previous = day
  }
  return longest
}

// -------------------------------------------------------------------- export

/** RFC 4180 field escaping: quote (and double internal quotes) whenever the field contains a comma, quote or newline. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

const CSV_COLUMNS = [
  'id',
  'startedAt',
  'endedAt',
  'kind',
  'itemId',
  'itemName',
  'tempoBpm',
  'accuracy',
  'note',
] as const

/** Serialize entries as CSV (header row first) for REQ-3.10.4's data export. */
export function toCsv(entries: readonly PracticeEntry[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const entry of entries) {
    const row = [
      entry.id,
      String(entry.startedAt),
      String(entry.endedAt),
      entry.kind,
      entry.itemId ?? '',
      entry.itemName,
      entry.tempoBpm === undefined ? '' : String(entry.tempoBpm),
      entry.accuracy === undefined ? '' : String(entry.accuracy),
      entry.note ?? '',
    ]
    lines.push(row.map(csvField).join(','))
  }
  return lines.join('\n')
}
