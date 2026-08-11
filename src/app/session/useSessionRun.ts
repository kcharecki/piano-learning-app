/**
 * Makes a `PlannedSession` runnable (roadmap 5.44): a persisted position
 * within today's plan (which item is current, which are already done), a
 * timer per item driven by the injected `Clock`/`DateSource` through the
 * EXISTING `usePracticeLog` hook (roadmap 2.24, reused from
 * `@app/practice/usePracticeLog.ts` — not a second logging path, every
 * `PracticeEntry` still comes from that one hook), and an explicit
 * "complete this item, move to the next" step.
 *
 * ## Why this hook keeps its own tiny persisted record
 *
 * `usePracticeLog` already persists every FINISHED `PracticeEntry` via
 * `useProgressStore` + `persistence.ts` (both outside this task's file
 * boundary, and correctly so — shared, main-thread-only infrastructure). But
 * "which of today's five planned items is CURRENT, and which are already
 * done" cannot be recovered from the practice log alone: the same exercise
 * id can legitimately appear twice in one plan (`fillSegment` repeats
 * candidates once they run out), and a learner may have practiced that same
 * id on a different day, or from a different screen entirely, without that
 * being part of THIS run. So this hook keeps a small run record — the plan
 * snapshot taken at "Start session" plus a parallel `doneFlags` array — and
 * persists it independently through the `Store` port: same port
 * `persistence.ts` uses, its own (collection, key) pair, following the
 * established "reuse `COLLECTIONS.settings`, no IndexedDB migration needed"
 * pattern `persistence.ts` already uses for `levelState`/`earTraining`.
 *
 * This hook opens its OWN `Store` connection via `createIdbStore` rather
 * than threading through `App.tsx`'s — `App.tsx`, `persistence.ts` and
 * `progressStore.ts` are all outside this task's file boundary (see
 * `docs/agent-brief.md`), and IndexedDB natively supports multiple
 * independent connections to the same database, so this neither races nor
 * conflicts with the app's main connection. Writes here are simple
 * (`put`/`delete`, last write wins) rather than `persistence.ts`'s
 * queue-with-sequence-numbers: that machinery exists there to survive a
 * rapid stream of store-driven writes (every keystroke on a score's tempo
 * slider, for example); a session run only ever writes on a handful of
 * discrete clicks per sitting (start, complete x N), so the race that queue
 * guards against cannot arise here.
 *
 * ## What actually gets logged, and when
 *
 * This hook never touches `PracticeEntry` directly — every entry is still
 * produced by `usePracticeLog`'s own `start`/`stop`, exactly like every
 * other screen (roadmap 5.14). The mount/current-item effect below mirrors
 * `useLessons.ts`'s pattern exactly: `start()` is deferred one macrotask and
 * cancelled in cleanup, because React 18 StrictMode's synchronous
 * mount→cleanup→remount double-invoke would otherwise store a real,
 * near-zero-duration phantom entry for the first item on every fresh mount
 * — a `PracticeTimer` session is not the idempotent kind of resource that
 * pattern is usually applied to (see `usePracticeLog.ts`'s own module doc).
 * `completeCurrentItem` itself never calls `stop()`/`start()` directly: it
 * only advances `doneFlags`, and the resulting change to `currentIndex`
 * changes the effect's dependency key, whose cleanup closes the just-
 * finished item's entry and whose (deferred) body opens the next one — one
 * mechanism handles both the manual "Complete" click and the automatic
 * resume-into-a-running-timer after a reload.
 */
import { useEffect, useRef, useState } from 'react'
import type { Clock, DateSource, Store } from '@core/ports/index.ts'
import { COLLECTIONS } from '@core/ports/store.ts'
import type { PlannedSession, SessionSegmentKind } from '@core/curriculum/session.ts'
import type { Exercise } from '@core/curriculum/types.ts'
import type { ActivityKind } from '@core/progress/log.ts'
import { usePracticeLog } from '@app/practice/usePracticeLog.ts'
import { createBrowserClock } from '@app/practice/clock.ts'
import { createIdbStore } from '@adapters/store/idb.ts'

/** Which `ActivityKind` each segment logs its completed time under (roadmap 5.45 adds `warmup`). */
export const SEGMENT_ACTIVITY_KIND: Readonly<Record<SessionSegmentKind, ActivityKind>> = {
  warmup: 'warmup',
  technique: 'technique',
  'sight-reading': 'sightreading',
  // The lesson segment's only real candidate today is "practice the loaded
  // score" (`@app/session/candidates.ts`'s `lessonCandidates`, `Exercise.kind`
  // `'repertoire'`) — matching `'repertoire'` here is the same bucket
  // `PracticeScreen.tsx` already logs plain score practice under.
  lesson: 'repertoire',
  // theory-ear's only real candidates today are flashcard decks — matching
  // `'theory'`, the same bucket `FlashcardScreen` logs under (roadmap 5.14).
  'theory-ear': 'theory',
}

export const SESSION_RUN_COLLECTION: string = COLLECTIONS.settings
export const SESSION_RUN_KEY = 'todaySessionRun'

export type SessionRunSnapshot = {
  readonly plan: PlannedSession
  /** The learner's local calendar day the run was started on (`Date#toDateString()`); a
   * restored snapshot from an earlier day is treated as stale and discarded. */
  readonly dayKey: string
  /** Parallel to `plan.items` — `true` once that item has been completed. */
  readonly doneFlags: readonly boolean[]
}

export type UseSessionRunOptions = {
  readonly clock?: Clock
  readonly date?: DateSource
  /** Injection seam for tests; defaults to the real IndexedDB store, exactly like `App.tsx`'s own `openStore`. */
  readonly openStore?: () => Promise<Store>
}

export type UseSessionRunResult = {
  /** `true` once the initial restore attempt has resolved (found, not found, or failed) — gates auto-resume so a fresh "Start session" click cannot race a still-in-flight restore. */
  readonly hydrated: boolean
  readonly run: SessionRunSnapshot | undefined
  /** Index into `run.plan.items` of the current (not yet done) item; `undefined` when there is no run, or every item is done. */
  readonly currentIndex: number | undefined
  /** Whether the current item's timer is actively running — `false` for the instant between "current item changed" and the deferred `start()` actually landing (see the module doc), and once the whole run is complete. */
  readonly running: boolean
  /** Milliseconds elapsed on the CURRENT item's timer, read live off the injected `Clock`. Zero when nothing is running. */
  elapsedMs(): number
  /** Begins a run from `plan`, replacing any existing one. */
  startSession(plan: PlannedSession): void
  /** Marks the current item done and advances; a no-op if there is no run or every item is already done. */
  completeCurrentItem(): void
  /** Discards the current run (persisted copy included) and returns to planning. */
  planNewSession(): void
}

// --------------------------------------------------------------- validation

function isValidExercise(value: unknown): value is Exercise {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    typeof e.kind === 'string' &&
    typeof e.title === 'string' &&
    typeof e.estimatedMinutes === 'number' &&
    Number.isFinite(e.estimatedMinutes)
  )
}

function isValidSessionItem(value: unknown): value is PlannedSession['items'][number] {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.segment === 'string' &&
    typeof item.minutes === 'number' &&
    Number.isFinite(item.minutes) &&
    isValidExercise(item.exercise)
  )
}

function isValidPlannedSession(value: unknown): value is PlannedSession {
  if (typeof value !== 'object' || value === null) return false
  const plan = value as Record<string, unknown>
  return (
    typeof plan.totalMinutes === 'number' &&
    Array.isArray(plan.items) &&
    plan.items.every(isValidSessionItem) &&
    typeof plan.bySegment === 'object' &&
    plan.bySegment !== null
  )
}

function isValidSessionRunSnapshot(value: unknown): value is SessionRunSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const run = value as Record<string, unknown>
  if (typeof run.dayKey !== 'string') return false
  if (!isValidPlannedSession(run.plan)) return false
  if (!Array.isArray(run.doneFlags) || !run.doneFlags.every((d) => typeof d === 'boolean')) {
    return false
  }
  return run.doneFlags.length === run.plan.items.length
}

// -------------------------------------------------------------------- hook

function findCurrentIndex(doneFlags: readonly boolean[]): number | undefined {
  const idx = doneFlags.findIndex((done) => !done)
  return idx === -1 ? undefined : idx
}

export function useSessionRun(options: UseSessionRunOptions = {}): UseSessionRunResult {
  const [clock] = useState<Clock>(() => options.clock ?? createBrowserClock())
  const [date] = useState<DateSource>(() => options.date ?? { epochMillis: () => Date.now() })
  const practiceLog = usePracticeLog({ clock, date })
  const practiceLogRef = useRef(practiceLog)
  practiceLogRef.current = practiceLog

  const openStoreImpl = useRef(options.openStore ?? createIdbStore)
  const storePromiseRef = useRef<Promise<Store> | undefined>(undefined)
  function getStore(): Promise<Store> {
    storePromiseRef.current ??= openStoreImpl.current()
    return storePromiseRef.current
  }

  function todayKey(): string {
    return new Date(date.epochMillis()).toDateString()
  }

  const [run, setRun] = useState<SessionRunSnapshot | undefined>(undefined)
  const [hydrated, setHydrated] = useState(false)

  // Restore once on mount. A stale (earlier-day) or corrupt saved run is
  // silently discarded — a learner who cannot start today's session has lost
  // more than one who lost yesterday's leftover position (same philosophy as
  // `App.tsx`'s own restore).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const store = await getStore()
        const raw = await store.get<unknown>(SESSION_RUN_COLLECTION, SESSION_RUN_KEY)
        if (!cancelled && isValidSessionRunSnapshot(raw) && raw.dayKey === todayKey()) {
          setRun(raw)
        }
      } catch {
        // Swallowed — the session still runs fine unpersisted from scratch.
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
    // Restore is a one-shot, mount-only effect — `date`/`getStore` are stable
    // for this hook's lifetime (see the `useState` initialisers above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist on every change, once hydration has had its chance to apply a
  // restored value first — writing back the initial `undefined` before that
  // would overwrite a real saved run with nothing the instant this mounts.
  useEffect(() => {
    if (!hydrated) return
    void (async () => {
      try {
        const store = await getStore()
        if (run === undefined) {
          await store.delete(SESSION_RUN_COLLECTION, SESSION_RUN_KEY)
        } else {
          await store.put(SESSION_RUN_COLLECTION, SESSION_RUN_KEY, run)
        }
      } catch {
        // Swallowed — a failed save must not crash a running session.
      }
    })()
  }, [run, hydrated])

  const currentIndex = run === undefined ? undefined : findCurrentIndex(run.doneFlags)
  const currentItem =
    run !== undefined && currentIndex !== undefined ? run.plan.items[currentIndex] : undefined
  const currentItemRef = useRef(currentItem)
  currentItemRef.current = currentItem

  // The timer per item (roadmap 5.44), keyed on WHICH item is current: stop
  // whatever was running, then (deferred — see the module doc) start the new
  // current item's timer under its segment's ActivityKind. `undefined` when
  // there is no run or the run is complete, in which case this only stops.
  const currentItemKey =
    currentItem === undefined ? undefined : `${currentIndex}:${currentItem.exercise.id}`
  useEffect(() => {
    const timer = setTimeout(() => {
      practiceLogRef.current.stop()
      const item = currentItemRef.current
      if (item === undefined) return
      practiceLogRef.current.start(SEGMENT_ACTIVITY_KIND[item.segment], item.exercise.title, {
        itemId: item.exercise.id,
      })
    }, 0)
    return () => {
      clearTimeout(timer)
      practiceLogRef.current.stop()
    }
  }, [currentItemKey])

  function startSession(plan: PlannedSession): void {
    setRun({ plan, dayKey: todayKey(), doneFlags: plan.items.map(() => false) })
  }

  function completeCurrentItem(): void {
    setRun((current) => {
      if (current === undefined) return current
      const idx = findCurrentIndex(current.doneFlags)
      if (idx === undefined) return current
      const doneFlags = current.doneFlags.map((done, i) => (i === idx ? true : done))
      return { ...current, doneFlags }
    })
  }

  function planNewSession(): void {
    setRun(undefined)
  }

  return {
    hydrated,
    run,
    currentIndex,
    running: practiceLog.running,
    elapsedMs: () => practiceLog.elapsedMs(),
    startSession,
    completeCurrentItem,
    planNewSession,
  }
}

