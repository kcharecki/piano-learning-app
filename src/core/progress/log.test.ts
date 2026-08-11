import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '@test/fakes.ts'
import { InvariantError } from '@core/shared/invariant.ts'
import {
  ACTIVITY_KINDS,
  currentStreakDays,
  dailyTotals,
  longestStreakDays,
  minutesByKind,
  PracticeTimer,
  toCsv,
  totalMinutes,
  type PracticeEntry,
} from './log.ts'

// -------------------------------------------------------------------- helpers

/** Epoch millis for a UTC calendar instant — a readable way to build fixtures. */
const utc = (y: number, m: number, d: number, h = 0, mi = 0, s = 0): number =>
  Date.UTC(y, m - 1, d, h, mi, s)

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

let seq = 0
const entry = (over: Partial<PracticeEntry> = {}): PracticeEntry => {
  seq += 1
  const startedAt = over.startedAt ?? utc(2026, 1, 1, 10, 0)
  return {
    id: `e${seq}`,
    startedAt,
    endedAt: startedAt + 10 * MINUTE,
    kind: 'technique',
    itemName: 'C major scale',
    ...over,
  }
}

// -------------------------------------------------------------- PracticeTimer

describe('PracticeTimer', () => {
  it('is idle until start(): not running, zero elapsed, stop() is a no-op', () => {
    const clock = new FakeClock(0)
    const timer = new PracticeTimer(clock, clock)
    expect(timer.running).toBe(false)
    expect(timer.elapsedMs).toBe(0)
    expect(timer.stop()).toBeUndefined()
  })

  it('reports elapsed time from the Clock while running, and 0 once stopped', () => {
    const clock = new FakeClock(1_000)
    const timer = new PracticeTimer(clock, clock)
    timer.start('technique', '5-finger patterns')
    expect(timer.running).toBe(true)
    clock.advance(45_000)
    expect(timer.elapsedMs).toBe(45_000)
    clock.advance(15_000)
    expect(timer.elapsedMs).toBe(60_000)
    timer.stop()
    expect(timer.running).toBe(false)
    expect(timer.elapsedMs).toBe(0)
  })

  it('stop() returns an entry with startedAt/endedAt from the DateSource and the given kind/itemName', () => {
    const clock = new FakeClock(utc(2026, 3, 1, 8, 0))
    const timer = new PracticeTimer(clock, clock)
    timer.start('sightreading', 'Level 3 set A')
    clock.advance(12 * MINUTE)
    const result = timer.stop()
    expect(result).toEqual({
      id: expect.any(String),
      startedAt: utc(2026, 3, 1, 8, 0),
      endedAt: utc(2026, 3, 1, 8, 12),
      kind: 'sightreading',
      itemName: 'Level 3 set A',
    })
  })

  it('carries itemId from start() and tempoBpm/accuracy/note from stop() onto the entry', () => {
    const clock = new FakeClock(0)
    const timer = new PracticeTimer(clock, clock)
    timer.start('repertoire', 'Für Elise', { itemId: 'furelise' })
    clock.advance(5 * MINUTE)
    const result = timer.stop({ tempoBpm: 96, accuracy: 0.87, note: 'better left hand today' })
    expect(result).toMatchObject({
      itemId: 'furelise',
      itemName: 'Für Elise',
      tempoBpm: 96,
      accuracy: 0.87,
      note: 'better left hand today',
    })
  })

  it('omits itemId/tempoBpm/accuracy/note entirely (not as undefined) when not supplied', () => {
    const clock = new FakeClock(0)
    const timer = new PracticeTimer(clock, clock)
    timer.start('theory', 'Intervals drill')
    const result = timer.stop()
    expect(result).toBeDefined()
    expect('itemId' in (result as PracticeEntry)).toBe(false)
    expect('tempoBpm' in (result as PracticeEntry)).toBe(false)
    expect('accuracy' in (result as PracticeEntry)).toBe(false)
    expect('note' in (result as PracticeEntry)).toBe(false)
  })

  it('gives each entry a distinct id across repeated start/stop cycles at the same clock value', () => {
    const clock = new FakeClock(0)
    const timer = new PracticeTimer(clock, clock)
    timer.start('eartraining', 'Interval ID')
    const first = timer.stop()
    timer.start('eartraining', 'Interval ID')
    const second = timer.stop()
    expect(first?.id).not.toBe(second?.id)
  })

  it('throws when start() is called while a session is already running', () => {
    const clock = new FakeClock(0)
    const timer = new PracticeTimer(clock, clock)
    timer.start('lesson', 'Weekly lesson')
    expect(() => timer.start('theory', 'Sneaking in a drill')).toThrow(InvariantError)
  })

  it('throws on a blank itemName', () => {
    const clock = new FakeClock(0)
    const timer = new PracticeTimer(clock, clock)
    expect(() => timer.start('technique', '   ')).toThrow(InvariantError)
  })

  it('stop() clears the session so a fresh start() is accepted afterwards', () => {
    const clock = new FakeClock(0)
    const timer = new PracticeTimer(clock, clock)
    timer.start('technique', 'Scales')
    timer.stop()
    expect(() => timer.start('technique', 'Scales again')).not.toThrow()
  })
})

// -------------------------------------------------------------- totalMinutes

describe('totalMinutes', () => {
  it('sums durations of entries starting in [from, to)', () => {
    const entries = [
      entry({ startedAt: utc(2026, 1, 1, 9, 0), endedAt: utc(2026, 1, 1, 9, 20) }), // 20 min, in range
      entry({ startedAt: utc(2026, 1, 1, 23, 0), endedAt: utc(2026, 1, 1, 23, 10) }), // 10 min, in range
      entry({ startedAt: utc(2026, 1, 2, 0, 0), endedAt: utc(2026, 1, 2, 0, 5) }), // out of range (>= to)
    ]
    const total = totalMinutes(entries, utc(2026, 1, 1, 0, 0), utc(2026, 1, 2, 0, 0))
    expect(total).toBe(30)
  })

  it('is 0 for an empty log or a range with nothing in it', () => {
    expect(totalMinutes([], 0, DAY)).toBe(0)
    const entries = [entry({ startedAt: utc(2026, 1, 5) })]
    expect(totalMinutes(entries, utc(2026, 1, 1), utc(2026, 1, 2))).toBe(0)
  })
})

// ------------------------------------------------------------ minutesByKind

describe('minutesByKind', () => {
  it('buckets minutes by kind and includes every ActivityKind, defaulting to 0', () => {
    const from = utc(2026, 1, 1)
    const to = utc(2026, 1, 2)
    const entries = [
      entry({ kind: 'technique', startedAt: from + HOUR, endedAt: from + HOUR + 5 * MINUTE }),
      entry({ kind: 'technique', startedAt: from + 2 * HOUR, endedAt: from + 2 * HOUR + 5 * MINUTE }),
      entry({ kind: 'theory', startedAt: from + 3 * HOUR, endedAt: from + 3 * HOUR + 15 * MINUTE }),
    ]
    const result = minutesByKind(entries, from, to)
    expect(Object.keys(result).sort()).toEqual([...ACTIVITY_KINDS].sort())
    expect(result.technique).toBe(10)
    expect(result.theory).toBe(15)
    expect(result.sightreading).toBe(0)
    expect(result.repertoire).toBe(0)
    expect(result.lesson).toBe(0)
    expect(result.eartraining).toBe(0)
  })

  it('excludes entries outside the range', () => {
    const entries = [entry({ kind: 'lesson', startedAt: utc(2025, 1, 1) })]
    const result = minutesByKind(entries, utc(2026, 1, 1), utc(2026, 1, 2))
    expect(result.lesson).toBe(0)
  })
})

// --------------------------------------------------------------- dailyTotals

describe('dailyTotals', () => {
  it('returns one entry per day in [from, to), zero-filled, in order', () => {
    const from = utc(2026, 1, 1)
    const to = utc(2026, 1, 4) // three days: Jan 1, 2, 3
    const entries = [entry({ startedAt: utc(2026, 1, 1, 9, 0), endedAt: utc(2026, 1, 1, 9, 30) })]
    const result = dailyTotals(entries, from, to, 0)
    expect(result).toEqual([
      { date: '2026-01-01', minutes: 30 },
      { date: '2026-01-02', minutes: 0 },
      { date: '2026-01-03', minutes: 0 },
    ])
  })

  it('is empty when to <= from', () => {
    expect(dailyTotals([], utc(2026, 1, 2), utc(2026, 1, 1), 0)).toEqual([])
    expect(dailyTotals([], utc(2026, 1, 1), utc(2026, 1, 1), 0)).toEqual([])
  })

  it('buckets by LOCAL day, not UTC day, once an offset is given', () => {
    // 2026-01-02T02:00 UTC is 2026-01-01T21:00 local at UTC-5 (offset -300), so
    // the same session lands on a different date depending on the offset. The
    // range is padded well clear of the boundary so the offset shifting which
    // days it spans is not itself what the assertion is checking.
    const entries = [entry({ startedAt: utc(2026, 1, 2, 2, 0), endedAt: utc(2026, 1, 2, 2, 30) })]
    const from = utc(2025, 12, 30)
    const to = utc(2026, 1, 5)
    const minutesOn = (
      result: readonly { date: string; minutes: number }[],
      date: string,
    ): number => result.find((r) => r.date === date)?.minutes ?? -1
    const withOffset = dailyTotals(entries, from, to, -300)
    expect(minutesOn(withOffset, '2026-01-01')).toBe(30)
    expect(minutesOn(withOffset, '2026-01-02')).toBe(0)
    const withoutOffset = dailyTotals(entries, from, to, 0)
    expect(minutesOn(withoutOffset, '2026-01-01')).toBe(0)
    expect(minutesOn(withoutOffset, '2026-01-02')).toBe(30)
  })

  it('sums multiple sessions on the same local day', () => {
    const entries = [
      entry({ startedAt: utc(2026, 1, 1, 9, 0), endedAt: utc(2026, 1, 1, 9, 10) }),
      entry({ startedAt: utc(2026, 1, 1, 20, 0), endedAt: utc(2026, 1, 1, 20, 25) }),
    ]
    const result = dailyTotals(entries, utc(2026, 1, 1), utc(2026, 1, 2), 0)
    expect(result).toEqual([{ date: '2026-01-01', minutes: 35 }])
  })
})

// ----------------------------------------------------------- streak helpers

/** Build one entry per given local day (UTC offset 0), at noon that day, 10 minutes long. */
const entriesOnDays = (dayIndices: readonly number[]): PracticeEntry[] =>
  dayIndices.map((d) => {
    const startedAt = d * DAY + 12 * HOUR
    return entry({ startedAt, endedAt: startedAt + 10 * MINUTE })
  })

describe('currentStreakDays', () => {
  it('a session at 23:59 and one at 00:01 the next day are two distinct days', () => {
    const day0 = utc(2026, 1, 1)
    const entries = [
      entry({ startedAt: day0 + 23 * HOUR + 59 * MINUTE, endedAt: day0 + 24 * HOUR }),
      entry({ startedAt: day0 + DAY + MINUTE, endedAt: day0 + DAY + 2 * MINUTE }),
    ]
    const now = day0 + DAY + 5 * MINUTE // "now" is still day 2
    expect(currentStreakDays(entries, now, 0)).toBe(2)
  })

  it('a one-day gap breaks the streak', () => {
    const day0 = utc(2026, 1, 1)
    // Practiced day 0 and day 2, skipped day 1. "now" is day 2.
    const entries = [
      entry({ startedAt: day0 + 9 * HOUR, endedAt: day0 + 9 * HOUR + 10 * MINUTE }),
      entry({
        startedAt: day0 + 2 * DAY + 9 * HOUR,
        endedAt: day0 + 2 * DAY + 9 * HOUR + 10 * MINUTE,
      }),
    ]
    const now = day0 + 2 * DAY + 10 * HOUR
    expect(currentStreakDays(entries, now, 0)).toBe(1) // only "today" (day 2) counts — the gap on day 1 stopped it there
  })

  it('practicing twice in one day does not count as two days', () => {
    const day0 = utc(2026, 1, 1)
    const entries = [
      entry({ startedAt: day0 + 9 * HOUR, endedAt: day0 + 9 * HOUR + 10 * MINUTE }),
      entry({ startedAt: day0 + 20 * HOUR, endedAt: day0 + 20 * HOUR + 10 * MINUTE }),
    ]
    expect(currentStreakDays(entries, day0 + 21 * HOUR, 0)).toBe(1)
  })

  it('a streak that includes today counts in full', () => {
    const entries = entriesOnDays([0, 1, 2, 3, 4])
    const now = 4 * DAY + HOUR // "today" is day 4, the last practiced day
    expect(currentStreakDays(entries, now, 0)).toBe(5)
  })

  it('a streak that ended yesterday (not today) does not count — returns 0', () => {
    const entries = entriesOnDays([0, 1, 2, 3]) // last practiced day is day 3
    const now = 4 * DAY + HOUR // "today" is day 4 — not practiced
    expect(currentStreakDays(entries, now, 0)).toBe(0)
  })

  it('is 0 for an empty log', () => {
    expect(currentStreakDays([], utc(2026, 1, 1), 0)).toBe(0)
  })

  it('a day containing only an ear-training session extends the streak (roadmap 5.15) — the streak is a property of the DAY, not the activity kind', () => {
    const day0 = utc(2026, 1, 1)
    const entries = [
      entry({ kind: 'repertoire', startedAt: day0, endedAt: day0 + 10 * MINUTE }),
      entry({
        kind: 'eartraining',
        startedAt: day0 + DAY + 9 * HOUR,
        endedAt: day0 + DAY + 9 * HOUR + 10 * MINUTE,
      }),
    ]
    const now = day0 + DAY + 10 * HOUR // "today" is day 1, practiced only by eartraining
    expect(currentStreakDays(entries, now, 0)).toBe(2)
  })

  it('a day with no logged activity of ANY kind breaks the streak, same as a repertoire-only gap', () => {
    const day0 = utc(2026, 1, 1)
    // Practiced day 0 (eartraining) and day 2 (theory), nothing on day 1.
    const entries = [
      entry({ kind: 'eartraining', startedAt: day0 + 9 * HOUR, endedAt: day0 + 9 * HOUR + 10 * MINUTE }),
      entry({
        kind: 'theory',
        startedAt: day0 + 2 * DAY + 9 * HOUR,
        endedAt: day0 + 2 * DAY + 9 * HOUR + 10 * MINUTE,
      }),
    ]
    const now = day0 + 2 * DAY + 10 * HOUR
    expect(currentStreakDays(entries, now, 0)).toBe(1) // only today (day 2) counts
  })

  it('every ActivityKind independently extends a streak, one kind per day, none repeated', () => {
    // Guards the whole enum, not just eartraining — a future kind added to
    // ACTIVITY_KINDS with some accidental kind-filter reintroduced elsewhere
    // would still pass a single-kind test but fail this one.
    const entries = ACTIVITY_KINDS.map((kind, i) => {
      const startedAt = i * DAY + 9 * HOUR
      return entry({ kind, startedAt, endedAt: startedAt + 10 * MINUTE })
    })
    const now = (ACTIVITY_KINDS.length - 1) * DAY + 10 * HOUR
    expect(currentStreakDays(entries, now, 0)).toBe(ACTIVITY_KINDS.length)
  })
})

describe('longestStreakDays', () => {
  it('finds the longest run of consecutive practiced days, not just the most recent', () => {
    // Practiced days 0,1,2 (run of 3), then a gap, then 5,6,7,8 (run of 4).
    const entries = entriesOnDays([0, 1, 2, 5, 6, 7, 8])
    expect(longestStreakDays(entries, 0)).toBe(4)
  })

  it('is 0 for an empty log and 1 for a single day', () => {
    expect(longestStreakDays([], 0)).toBe(0)
    expect(longestStreakDays(entriesOnDays([3]), 0)).toBe(1)
  })

  it('collapses multiple sessions on one day to a single streak day', () => {
    const day0 = utc(2026, 1, 1)
    const entries = [
      entry({ startedAt: day0 + HOUR, endedAt: day0 + HOUR + MINUTE }),
      entry({ startedAt: day0 + 2 * HOUR, endedAt: day0 + 2 * HOUR + MINUTE }),
    ]
    expect(longestStreakDays(entries, 0)).toBe(1)
  })
})

// --------------------------------------------------------- streak properties

describe('streak properties', () => {
  it('a run of N consecutive practiced days ending today has currentStreakDays === N', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 2000 }), // "today" as a day index
        fc.integer({ min: 1, max: 60 }), // run length
        (todayDay, n) => {
          const days = Array.from({ length: n }, (_, i) => todayDay - i)
          const entries = entriesOnDays(days)
          const now = todayDay * DAY + 12 * HOUR
          expect(currentStreakDays(entries, now, 0)).toBe(n)
        },
      ),
    )
  })

  it('longestStreakDays never exceeds the number of distinct practiced days', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -500, max: 500 }), { minLength: 0, maxLength: 40 }),
        (days) => {
          const entries = entriesOnDays(days)
          const distinct = new Set(days).size
          const longest = longestStreakDays(entries, 0)
          expect(longest).toBeLessThanOrEqual(distinct)
          expect(longest).toBeGreaterThanOrEqual(0)
        },
      ),
    )
  })

  it('inserting a single-day gap in the middle of a run caps the streak at the tail length', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: 1, max: 20 }), // days before the gap
        fc.integer({ min: 1, max: 20 }), // days after the gap, ending today
        (todayDay, before, after) => {
          const tail = Array.from({ length: after }, (_, i) => todayDay - i)
          const gapDay = todayDay - after // deliberately skipped
          const head = Array.from({ length: before }, (_, i) => gapDay - 1 - i)
          const entries = entriesOnDays([...head, ...tail])
          const now = todayDay * DAY + 12 * HOUR
          expect(currentStreakDays(entries, now, 0)).toBe(after)
        },
      ),
    )
  })
})

// ------------------------------------------------------------------- export

describe('toCsv', () => {
  it('has a header row naming every field', () => {
    const [header] = toCsv([]).split('\n')
    expect(header).toBe('id,startedAt,endedAt,kind,itemId,itemName,tempoBpm,accuracy,note')
  })

  it('leaves optional fields blank when absent', () => {
    const csv = toCsv([entry()])
    const [, row] = csv.split('\n')
    expect(row).toBe(
      `e${seq},${utc(2026, 1, 1, 10, 0)},${utc(2026, 1, 1, 10, 10)},technique,,C major scale,,,`,
    )
  })

  /** A small RFC 4180 parser, independent of the module under test, to prove toCsv's escaping round-trips. */
  function parseCsv(csv: string): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let inQuotes = false
    let i = 0
    while (i < csv.length) {
      const c = csv[i]
      if (inQuotes) {
        if (c === '"') {
          if (csv[i + 1] === '"') {
            field += '"'
            i += 2
            continue
          }
          inQuotes = false
          i += 1
          continue
        }
        field += c
        i += 1
        continue
      }
      if (c === '"') {
        inQuotes = true
        i += 1
        continue
      }
      if (c === ',') {
        row.push(field)
        field = ''
        i += 1
        continue
      }
      if (c === '\n') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
        i += 1
        continue
      }
      field += c
      i += 1
    }
    row.push(field)
    rows.push(row)
    return rows
  }

  it('survives a note containing a comma, a quote and a newline, round-tripped through an independent CSV parser', () => {
    const tricky = 'left hand, "measure 12" felt\nshaky today'
    const entries = [entry({ note: tricky })]
    const csv = toCsv(entries)
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(2) // header + one data row
    const [header, dataRow] = rows as [string[], string[]]
    const noteIndex = header.indexOf('note')
    expect(dataRow[noteIndex]).toBe(tricky)
  })

  it('round-trips arbitrary note strings (including commas, quotes, CR, LF) through the CSV parser', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (note) => {
        const entries = [entry({ note })]
        const rows = parseCsv(toCsv(entries))
        const [header, dataRow] = rows as [string[], string[]]
        const noteIndex = header.indexOf('note')
        expect(dataRow[noteIndex]).toBe(note)
      }),
    )
  })

  it('round-trips numeric and kind fields for a full entry', () => {
    const e = entry({ itemId: 'i1', tempoBpm: 88, accuracy: 0.5, note: 'ok', kind: 'repertoire' })
    const rows = parseCsv(toCsv([e]))
    const [header, dataRow] = rows as [string[], string[]]
    const col = (name: string): string => (dataRow as string[])[header.indexOf(name)] as string
    expect(col('id')).toBe(e.id)
    expect(col('startedAt')).toBe(String(e.startedAt))
    expect(col('endedAt')).toBe(String(e.endedAt))
    expect(col('kind')).toBe('repertoire')
    expect(col('itemId')).toBe('i1')
    expect(col('itemName')).toBe(e.itemName)
    expect(col('tempoBpm')).toBe('88')
    expect(col('accuracy')).toBe('0.5')
    expect(col('note')).toBe('ok')
  })
})
