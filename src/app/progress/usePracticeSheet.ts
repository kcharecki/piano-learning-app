/**
 * Data for the printable practice sheet (roadmap 5.47, REQ-3.10.4) — a
 * teacher/parent-readable summary of the trailing week's practice, reduced
 * from the same real stores `useDashboard` reads (`useProgressStore`), using
 * the same real core aggregation functions (`@core/progress/log.ts`) rather
 * than a second hand-rolled reduction.
 *
 * The window is the same trailing 7 days the dashboard's own "This week"
 * figure already uses (`useDashboard.ts`'s `WEEK_DAYS`) — a printed sheet
 * that disagreed with the screen the learner is looking at when they print
 * it would be its own kind of dishonesty. `date`/`utcOffsetMinutes` are
 * threaded through from `DashboardScreen`'s own props for the same reason
 * `useDashboard` takes them: a fixed `DateSource` in tests, the real browser
 * clock/timezone offset otherwise.
 *
 * Two collections are read straight off `practiceEntries` rather than through
 * `useDashboard`'s already-reduced `minutesByKind`/`dailyMinutes`, because
 * this hook needs a per-ITEM breakdown (what was practiced, not just what
 * category) that no existing reduction produces — recomputed here with the
 * exact same `startedAt`-based range test `@core/progress/log.ts` itself uses
 * (`totalMinutes`/`dailyTotals`), not a second, possibly-diverging definition
 * of "in range".
 */
import { useMemo } from 'react'
import type { DateSource } from '@core/ports/index.ts'
import {
  ACTIVITY_KINDS,
  dailyTotals,
  totalMinutes,
  type ActivityKind,
  type PracticeEntry,
} from '@core/progress/log.ts'
import { DAY_MS } from '@core/srs/scheduler.ts'
import { useProgressStore } from '@app/state/progressStore.ts'

/** Matches `useDashboard.ts`'s own trailing window — see the module comment. */
const WEEK_DAYS = 7
const MS_PER_MIN = 60_000

export type UsePracticeSheetOptions = {
  /** Wall-clock reading for "now". Defaults to the real browser clock. */
  readonly date?: DateSource
  /** Minutes to ADD to a UTC epoch-ms timestamp to get local wall-clock time — see `useDashboard.ts`. */
  readonly utcOffsetMinutes?: number
}

export type PracticeSheetCategoryRow = {
  readonly kind: ActivityKind
  readonly minutes: number
  readonly sessions: number
}

export type PracticeSheetItemRow = {
  readonly itemName: string
  readonly kind: ActivityKind
  readonly minutes: number
  readonly sessions: number
  /** Epoch ms of the most recent session on this item within the window. */
  readonly lastPracticedAt: number
}

export type PracticeSheetAssessmentRow = {
  readonly scoreTitle: string
  /** 0..1, from `AssessmentResult.accuracy` — see `PracticeSheet.tsx`'s caveat copy for what this does and does not cover. */
  readonly accuracy: number
  readonly at: number
}

export type PracticeSheetData = {
  readonly rangeStart: number
  readonly rangeEnd: number
  readonly totalDays: number
  /** Total practice minutes in the window, oldest-to-newest identical to `useDashboard`'s `weeklyMinutes`. */
  readonly totalMinutes: number
  /** Distinct local calendar days (of `totalDays`) with at least one minute of practice. */
  readonly daysPracticed: number
  /** One row per `ActivityKind` actually practiced in the window, in `ACTIVITY_KINDS` order. `[]` when nothing was. */
  readonly categories: readonly PracticeSheetCategoryRow[]
  /** One row per distinct item (by kind + itemId-or-name) practiced in the window, most recently practiced first. */
  readonly items: readonly PracticeSheetItemRow[]
  /** Repertoire assessments (`useProgressStore.assessments`) recorded in the window, oldest first. */
  readonly assessments: readonly PracticeSheetAssessmentRow[]
  /** `false` when the window has no practice entries at all — the sheet's empty state. */
  readonly hasActivity: boolean
}

const defaultDate: DateSource = { epochMillis: () => Date.now() }

const minutesOf = (entry: PracticeEntry): number => (entry.endedAt - entry.startedAt) / MS_PER_MIN

type MutableItemRow = {
  itemName: string
  kind: ActivityKind
  minutes: number
  sessions: number
  lastPracticedAt: number
}

export function usePracticeSheet(options: UsePracticeSheetOptions = {}): PracticeSheetData {
  const date = options.date ?? defaultDate
  const utcOffsetMinutes = options.utcOffsetMinutes ?? -new Date().getTimezoneOffset()
  const practiceEntries = useProgressStore((s) => s.practiceEntries)
  const assessments = useProgressStore((s) => s.assessments)

  return useMemo(() => {
    const rangeEnd = date.epochMillis()
    const rangeStart = rangeEnd - WEEK_DAYS * DAY_MS

    const entriesInRange = practiceEntries.filter(
      (e) => e.startedAt >= rangeStart && e.startedAt < rangeEnd,
    )

    const byKind = new Map<ActivityKind, { minutes: number; sessions: number }>()
    const byItem = new Map<string, MutableItemRow>()
    for (const entry of entriesInRange) {
      const minutes = minutesOf(entry)

      const kindAgg = byKind.get(entry.kind) ?? { minutes: 0, sessions: 0 }
      kindAgg.minutes += minutes
      kindAgg.sessions += 1
      byKind.set(entry.kind, kindAgg)

      const itemKey = `${entry.kind}:${entry.itemId ?? entry.itemName}`
      const itemAgg = byItem.get(itemKey)
      if (itemAgg === undefined) {
        byItem.set(itemKey, {
          itemName: entry.itemName,
          kind: entry.kind,
          minutes,
          sessions: 1,
          lastPracticedAt: entry.startedAt,
        })
      } else {
        itemAgg.minutes += minutes
        itemAgg.sessions += 1
        if (entry.startedAt > itemAgg.lastPracticedAt) itemAgg.lastPracticedAt = entry.startedAt
      }
    }

    const categories: readonly PracticeSheetCategoryRow[] = ACTIVITY_KINDS.filter(
      (kind) => (byKind.get(kind)?.sessions ?? 0) > 0,
    ).map((kind) => {
      const agg = byKind.get(kind)
      return { kind, minutes: agg?.minutes ?? 0, sessions: agg?.sessions ?? 0 }
    })

    const items: readonly PracticeSheetItemRow[] = [...byItem.values()].sort(
      (a, b) => b.lastPracticedAt - a.lastPracticedAt,
    )

    const daysPracticed = dailyTotals(practiceEntries, rangeStart, rangeEnd, utcOffsetMinutes).filter(
      (d) => d.minutes > 0,
    ).length

    const assessmentRows: readonly PracticeSheetAssessmentRow[] = assessments
      .filter((a) => a.at >= rangeStart && a.at < rangeEnd)
      .map((a) => ({ scoreTitle: a.scoreTitle, accuracy: a.result.accuracy, at: a.at }))
      .sort((a, b) => a.at - b.at)

    return {
      rangeStart,
      rangeEnd,
      totalDays: WEEK_DAYS,
      totalMinutes: totalMinutes(practiceEntries, rangeStart, rangeEnd),
      daysPracticed,
      categories,
      items,
      assessments: assessmentRows,
      hasActivity: entriesInRange.length > 0,
    }
  }, [date, utcOffsetMinutes, practiceEntries, assessments])
}
