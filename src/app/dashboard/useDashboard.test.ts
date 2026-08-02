/**
 * `useDashboard` (roadmap 4.7, REQ-3.10.1/REQ-3.10.2): reads already-persisted
 * store state and reduces it for display via the core functions. Every
 * assertion below either (a) recomputes the expected value with the same
 * core function the hook uses, so a hardcoded `0` or a mislabelled stat
 * fails, or (b) asserts the documented empty state for a section with no
 * writer yet (technique attempts, repertoire pieces, level state).
 */
import type { DateSource } from '@core/ports/index.ts'
import {
  currentStreakDays,
  dailyTotals,
  longestStreakDays,
  minutesByKind,
  totalMinutes,
  type ActivityKind,
  type PracticeEntry,
} from '@core/progress/log.ts'
import { DAY_MS, retentionStats, type Card } from '@core/srs/scheduler.ts'
import { MIN_LEVEL } from '@core/sightreading/adaptive.ts'
import type { SightReadingRecord } from '@core/sightreading/session.ts'
import { TRACKS } from '@core/curriculum/types.ts'
import { renderHook, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useSightReadingStore } from '@app/state/sightReadingStore.ts'
import { useFlashcardStore } from '@app/state/flashcardStore.ts'
import { useDashboard, type UseDashboardOptions } from './useDashboard.ts'

class FakeDateSource implements DateSource {
  private current: number
  constructor(current: number) {
    this.current = current
  }
  epochMillis(): number {
    return this.current
  }
}

// Deliberately NOT a midnight instant: `now` sits at 20:00 on an arbitrary
// day, so subtracting a session's duration (or a whole number of days) never
// silently crosses a local-day boundary the fixture did not intend, under
// utcOffsetMinutes = 0.
const NOW = 20_000 * DAY_MS + 20 * 60 * 60 * 1000

function resetStores(): void {
  useProgressStore.setState({ assessments: [], recordings: [], practiceEntries: [] })
  useSightReadingStore.setState({ level: MIN_LEVEL, history: [] })
  useFlashcardStore.setState({ cardsById: {} })
}

afterEach(() => {
  cleanup()
  resetStores()
})

function entry(
  dayOffset: number,
  minutes: number,
  kind: ActivityKind,
  itemName: string,
): PracticeEntry {
  // Ends at the same time-of-day, `dayOffset` days before `NOW` — so a
  // reasonable `minutes` duration never crosses into the previous local day.
  const endedAt = NOW - dayOffset * DAY_MS
  return {
    id: `pe-${dayOffset}-${kind}`,
    startedAt: endedAt - minutes * 60_000,
    endedAt,
    kind,
    itemName,
  }
}

function setup(overrides: Partial<UseDashboardOptions> = {}) {
  const date: DateSource = overrides.date ?? new FakeDateSource(NOW)
  const options: UseDashboardOptions = { date, utcOffsetMinutes: 0, ...overrides }
  return renderHook((p: UseDashboardOptions) => useDashboard(p), { initialProps: options })
}

describe('useDashboard — empty stores', () => {
  it('reports honest zeros/empties for every section, never a fabricated number', () => {
    const { result } = setup()
    const data = result.current

    expect(data.streak).toEqual({ currentDays: 0, longestDays: 0 })
    expect(data.weeklyMinutes).toBe(0)
    for (const kind of Object.values(data.minutesByKind)) expect(kind).toBe(0)
    // A rolling 7*24h window touches 7 or 8 distinct local calendar days
    // depending on what time of day "now" is — dailyTotals's own job, not
    // this hook's to second-guess — so assert "at least a week's worth of
    // zero-filled days", not a hardcoded bucket count.
    expect(data.dailyMinutes.length).toBeGreaterThanOrEqual(7)
    expect(data.dailyMinutes.every((d) => d.minutes === 0)).toBe(true)

    expect(data.sightReadingLevel).toBe(MIN_LEVEL)
    expect(data.sightReadingTrend).toEqual([])

    expect(data.retention).toEqual({ total: 0, due: 0, young: 0, mature: 0, averageEase: 0 })

    expect(data.techniqueAttempts).toEqual([])
    expect(data.repertoirePieces).toEqual([])
    expect(data.repertoireDue).toEqual([])

    expect(data.curriculumAvailable).toBe(false)
    expect(data.levels).toHaveLength(TRACKS.length)
    for (const l of data.levels) {
      if (l.track === 'sight-reading') {
        expect(l.level).toBe(MIN_LEVEL)
      } else {
        expect(l.level).toBeUndefined()
      }
      expect(l.criteria).toEqual([])
    }

    expect(data.techniqueTrend).toEqual([])
    expect(data.techniqueBestBpmByDrill).toEqual({})
  })
})

describe('useDashboard — practice log', () => {
  it('matches core/progress/log\'s own functions for streak, weekly time, per-kind and daily totals', () => {
    const entries: PracticeEntry[] = [
      entry(0, 30, 'technique', 'Scales'),
      entry(1, 15, 'sightreading', 'Level 2 piece'),
      entry(3, 10, 'repertoire', 'Fur Elise'),
      entry(4, 10, 'theory', 'Key signatures'),
      entry(5, 10, 'warmup', 'Warmup'),
    ]
    useProgressStore.setState({ practiceEntries: entries })

    const { result } = setup()
    const data = result.current

    const from = NOW - 7 * DAY_MS
    expect(data.streak.currentDays).toBe(currentStreakDays(entries, NOW, 0))
    expect(data.streak.longestDays).toBe(longestStreakDays(entries, 0))
    // Sanity: the fixture is built so today+yesterday streak (2) differs from
    // the longer, older run of three consecutive days (3) — a stat that
    // silently swapped current/longest would still pass an `.toBe(core(...))`
    // assertion against itself, so pin the actual numbers too.
    expect(data.streak.currentDays).toBe(2)
    expect(data.streak.longestDays).toBe(3)

    expect(data.weeklyMinutes).toBe(totalMinutes(entries, from, NOW))
    expect(data.weeklyMinutes).toBe(75)

    expect(data.minutesByKind).toEqual(minutesByKind(entries, from, NOW))
    expect(data.minutesByKind.technique).toBe(30)
    expect(data.minutesByKind.sightreading).toBe(15)

    expect(data.dailyMinutes).toEqual(dailyTotals(entries, from, NOW, 0))
  })

  it('buckets by LOCAL day, not UTC day — a non-zero offset changes the streak and daily totals', () => {
    // A session that ends 30 minutes after UTC midnight: under offset 0 it
    // falls on the later UTC day; under offset -720 (UTC-12) local time is
    // still the previous day. A hardcoded `0` in place of the offset option
    // would make both runs agree.
    const utcMidnight = 20_000 * DAY_MS
    const entries: PracticeEntry[] = [
      {
        id: 'pe-boundary',
        startedAt: utcMidnight,
        endedAt: utcMidnight + 30 * 60_000,
        kind: 'technique',
        itemName: 'Scales',
      },
    ]
    useProgressStore.setState({ practiceEntries: entries })
    const now = utcMidnight + 30 * 60_000

    const zeroOffset = renderHook((p: UseDashboardOptions) => useDashboard(p), {
      initialProps: { date: new FakeDateSource(now), utcOffsetMinutes: 0 },
    })
    const negativeOffset = renderHook((p: UseDashboardOptions) => useDashboard(p), {
      initialProps: { date: new FakeDateSource(now), utcOffsetMinutes: -720 },
    })

    expect(negativeOffset.result.current.dailyMinutes).not.toEqual(
      zeroOffset.result.current.dailyMinutes,
    )
    expect(negativeOffset.result.current.streak.currentDays).toBe(
      currentStreakDays(entries, now, -720),
    )
    expect(negativeOffset.result.current.dailyMinutes).toEqual(
      dailyTotals(entries, now - 7 * DAY_MS, now, -720),
    )

    zeroOffset.unmount()
    negativeOffset.unmount()
  })
})

describe('useDashboard — sight-reading history', () => {
  it('reports the persisted level and an oldest-first accuracy trend regardless of storage order', () => {
    const history: SightReadingRecord[] = [
      { pieceId: 'p2', readAt: NOW - 1_000, accuracy: 0.9, level: 3 },
      { pieceId: 'p1', readAt: NOW - 5_000, accuracy: 0.7, level: 2 },
    ]
    useSightReadingStore.setState({ level: 4, history })

    const { result } = setup()
    const data = result.current

    expect(data.sightReadingLevel).toBe(4)
    expect(data.sightReadingTrend).toEqual([
      { at: NOW - 5_000, accuracy: 0.7 },
      { at: NOW - 1_000, accuracy: 0.9 },
    ])
  })
})

describe('useDashboard — flashcard SRS retention', () => {
  it('matches core/srs/scheduler\'s retentionStats over the persisted theory cards, excluding reading-drill cards', () => {
    const theoryCards: Card[] = [
      {
        id: 'key-signature-0',
        due: NOW - 1,
        intervalDays: 30,
        ease: 2.6,
        reps: 5,
        lapses: 0,
        introducedAt: NOW - 100 * DAY_MS,
      },
      {
        id: 'interval-on-staff-60-3-major',
        due: NOW + DAY_MS,
        intervalDays: 3,
        ease: 2.3,
        reps: 2,
        lapses: 1,
        introducedAt: NOW - 10 * DAY_MS,
      },
    ]
    // Reading-drill cards (not theory) — must be excluded from "Theory retention".
    const readingCards: Card[] = [
      { id: 'note-name-60', due: NOW, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, introducedAt: NOW },
      { id: 'staff-to-key-64', due: NOW, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, introducedAt: NOW },
    ]
    const cardsById = Object.fromEntries(
      [...theoryCards, ...readingCards].map((c) => [c.id, c]),
    )
    useFlashcardStore.setState({ cardsById })

    const { result } = setup()

    expect(result.current.retention).toEqual(retentionStats(theoryCards, NOW))
    expect(result.current.retention.total).toBe(2)
  })
})
