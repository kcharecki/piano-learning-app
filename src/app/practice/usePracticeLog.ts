/**
 * Practice-log wiring (roadmap 2.24, REQ-3.9.5) — the hook that makes
 * `PracticeTimer` (`@core/progress/log.ts`) reachable from a running practice
 * screen. `PracticeTimer` only turns a start/stop pair into a `PracticeEntry`;
 * this hook owns the React lifecycle around it — starting on demand, stopping
 * on demand, and stopping defensively on unmount so a screen navigated away
 * from mid-session never silently drops the entry — and appends every
 * finished entry to `useProgressStore` so it survives past this component.
 *
 * ## Clock vs. DateSource — never confuse the two
 *
 * `PracticeTimer`'s constructor is `(clock: Clock, date: DateSource)`, in that
 * order, and this hook must pass its own `options.clock`/`options.date`
 * straight through in the SAME order. `Clock.now()` is monotonic since an
 * arbitrary origin (page load) — it is not a wall-clock timestamp — while
 * `DateSource.epochMillis()` is the wall-clock reading `PracticeEntry.startedAt`/
 * `endedAt` are stamped with. Swapping the two here would be exactly the
 * roadmap-2.19 bug this file exists to not repeat: ms-since-page-load leaking
 * into a value that is supposed to be a real epoch timestamp, garbage the
 * instant it survives a reload. `Clock` and `DateSource` are deliberately
 * distinct port interfaces (`@core/ports/index.ts`) — only `FakeClock` happens
 * to implement both — so passing one where the other is expected is also a
 * type error, not just a runtime bug; see `usePracticeLog.test.ts` for the
 * behavioural half of that guarantee (two genuinely distinct fakes).
 *
 * ## One session at a time
 *
 * `PracticeTimer.start` throws if a session is already running (a programmer
 * error, per its own doc) — `start` here is a no-op instead, so a caller that
 * double-fires a "start practicing" action (e.g. a fast double click) cannot
 * crash the screen.
 */
import type { Clock, DateSource } from '@core/ports/index.ts'
import {
  PracticeTimer,
  type ActivityKind,
  type PracticeEntry,
  type PracticeStartOptions,
  type PracticeStopOptions,
} from '@core/progress/log.ts'
import { useEffect, useState } from 'react'
import { useProgressStore } from '@app/state/progressStore.ts'

export type UsePracticeLogOptions = {
  readonly clock: Clock
  readonly date: DateSource
}

export type UsePracticeLog = {
  readonly running: boolean
  /**
   * Milliseconds elapsed since `start()`, read live off the monotonic
   * `Clock` — a function, not a value, because nothing here re-renders on a
   * clock tick; callers wanting a ticking readout poll this themselves (e.g.
   * from their own frame loop). Zero when idle.
   */
  elapsedMs(): number
  /** No-op if a session is already running. */
  start(kind: ActivityKind, itemName: string, opts?: PracticeStartOptions): void
  /**
   * Ends the running session (if any), appends the finished entry to
   * `useProgressStore`, and returns it. `undefined`, with no store write, if
   * nothing was running.
   */
  stop(opts?: PracticeStopOptions): PracticeEntry | undefined
}

export function usePracticeLog(options: UsePracticeLogOptions): UsePracticeLog {
  // Materialised once, like the other port-backed instances this practice
  // screen already holds this way (`MidiRecorder` in `useRecorder.ts`):
  // `clock`/`date` are themselves stable for the lifetime of the screen.
  const [timer] = useState<PracticeTimer>(() => new PracticeTimer(options.clock, options.date))
  const [running, setRunning] = useState(false)
  const addPracticeEntry = useProgressStore((s) => s.addPracticeEntry)

  // Safety net: a session still running when this hook unmounts (the learner
  // navigated away, or the caller simply forgot to call `stop()`) is stopped
  // here and its entry is still stored, rather than silently discarded.
  // `timer.stop()` is a harmless no-op (returns `undefined`) if `stop()` was
  // already called before unmount, so this can never double-store an entry.
  useEffect(
    () => () => {
      const entry = timer.stop()
      if (entry !== undefined) useProgressStore.getState().addPracticeEntry(entry)
    },
    [timer],
  )

  function start(kind: ActivityKind, itemName: string, opts: PracticeStartOptions = {}): void {
    if (timer.running || itemName.trim().length === 0) return
    timer.start(kind, itemName, opts)
    setRunning(true)
  }

  function stop(opts: PracticeStopOptions = {}): PracticeEntry | undefined {
    const entry = timer.stop(opts)
    if (entry !== undefined) addPracticeEntry(entry)
    setRunning(false)
    return entry
  }

  return { running, elapsedMs: () => timer.elapsedMs, start, stop }
}
