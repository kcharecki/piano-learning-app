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
 *
 * ## The repertoire write (REQ-3.8.2, M4 acceptance Defect 1)
 *
 * `@core/repertoire/repertoire.ts`'s `recordSession` (and the `bestAccuracy`
 * it maintains) had exactly zero call sites in `src/app/**` outside test
 * files — confirmed by grep during the M4 acceptance pass
 * (`docs/m4-acceptance-2026-08-11.md`, Defect 1) — so a repertoire piece's
 * "days since last practice" could never move off "never practised" no
 * matter how much a learner actually played it. `PracticeScreen.tsx` is the
 * ONLY caller that logs `kind: 'repertoire'` (every drill screen logs its
 * own kind — technique/theory/sightreading/lesson/eartraining — see the grep
 * across `src/app/**` for `.start('repertoire'`), and it does so for BOTH an
 * ordinary practice run and an assessment run: `useAssessment.start()` drives
 * the same `engine.phase` transitions `PracticeScreen`'s own start/stop
 * effect watches, so an assessment's finish already reaches `stop()` here
 * through the identical path — one call site to fix covers both. `itemId` on
 * that call is `item.score.id`, i.e. the LOADED SCORE's id, not a repertoire
 * piece's own `id` — matching against `RepertoirePiece.scoreId` (see
 * `recordRepertoireSessionIfApplicable` below) is what "only when the loaded
 * scoreId actually matches a repertoire piece" means in practice.
 *
 * `sessionFromEntry` (`@core/repertoire/repertoire.ts`) is reused verbatim,
 * per its own doc comment's stated intent, so `RepertoirePiece.sessions` has
 * exactly one writer and `bestAccuracy` rides along automatically — it is
 * derived from `session.accuracy` inside core's `recordSession`, so there is
 * no second call needed to fix that half of Defect 1.
 */
import type { Clock, DateSource } from '@core/ports/index.ts'
import {
  PracticeTimer,
  type ActivityKind,
  type PracticeEntry,
  type PracticeStartOptions,
  type PracticeStopOptions,
} from '@core/progress/log.ts'
import { sessionFromEntry } from '@core/repertoire/repertoire.ts'
import { useEffect, useState } from 'react'
import { useProgressStore } from '@app/state/progressStore.ts'
import { useRepertoireStore } from '@app/state/repertoireStore.ts'

/**
 * A finished 'repertoire' session shorter than this is far more likely an
 * accidental Play/Stop double-tap than real practice — see this file's
 * module comment ("A session with no real duration is not a session" in the
 * task that added this). Recording it anyway would do two wrong things at
 * once: move a piece off "never practised" for a tap that was not practice,
 * and (worse, per REQ-3.8.4) reset a 'maintained' piece's 21-day review
 * clock for nothing, hiding it from "review due" for three weeks. 1 second
 * comfortably clears real playing (even a single held chord takes longer)
 * while still catching a stray double-click. This gate applies ONLY to the
 * repertoire write — `useProgressStore`'s practice-log entry is unaffected,
 * exactly as it always was, so the learner's overall time-practised log
 * keeps recording every session regardless of length.
 */
const MIN_REPERTOIRE_SESSION_MS = 1_000

/**
 * Writes `entry` into the matching repertoire piece's history, if all three
 * hold: the entry is a `'repertoire'`-kind log (only `PracticeScreen.tsx`
 * produces these — see the module comment), its `itemId` (the loaded
 * score's id) matches some library piece's `scoreId`, and the session ran
 * long enough to count (`MIN_REPERTOIRE_SESSION_MS`). Matches on
 * `piece.scoreId`, never `piece.id`: those are deliberately different
 * fields (see `RepertoirePiece`'s own doc comment) — `entry.itemId` is a
 * SCORE id, and `recordSession` itself wants the PIECE's id as its first
 * argument, which this function reads off the matched piece rather than
 * assuming the two ids ever coincide.
 */
function recordRepertoireSessionIfApplicable(entry: PracticeEntry): void {
  if (entry.kind !== 'repertoire' || entry.itemId === undefined) return
  if (entry.endedAt - entry.startedAt < MIN_REPERTOIRE_SESSION_MS) return
  const piece = useRepertoireStore.getState().pieces.find((p) => p.scoreId === entry.itemId)
  if (piece === undefined) return
  useRepertoireStore.getState().recordSession(piece.id, sessionFromEntry(entry))
}

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
      if (entry !== undefined) {
        useProgressStore.getState().addPracticeEntry(entry)
        recordRepertoireSessionIfApplicable(entry)
      }
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
    if (entry !== undefined) {
      addPracticeEntry(entry)
      recordRepertoireSessionIfApplicable(entry)
    }
    setRunning(false)
    return entry
  }

  return { running, elapsedMs: () => timer.elapsedMs, start, stop }
}
