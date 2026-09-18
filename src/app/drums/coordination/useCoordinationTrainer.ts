/**
 * The coordination trainer's state (roadmap DR-15): which drill mode, which
 * groove (layers mode) or fixed content (kicks mode), which step, how far
 * the learner has unlocked, and the `useGrooveRun` wired to the current
 * step's score. Mirrors `GrooveTrainerScreen`'s own wiring — a `GrooveScore`
 * plus a tempo turned into a `GrooveRunPlan`, a run built on top of it, and
 * a finished run recorded to `useDrumsHistoryStore` — with the addition of
 * `advance()` deciding whether the next step unlocks.
 *
 * Changing the mode or the groove retires the current progress: `index` and
 * `unlocked` reset to 0 and any run in flight stops. A different mode or
 * groove is a different drill list entirely, so a step index from the old
 * list would point at the wrong thing (or nothing) in the new one.
 *
 * A tempo change is deliberately NOT treated the same way (reversing an
 * earlier, more conservative choice here): the step list does not change
 * shape when the bpm does, so a learner slowing down to nail the step they
 * are stuck on must not be thrown back to step 1. `setBpm` still stops any
 * run in flight and clears the latched result — a verdict mid-flight was
 * graded at the old tempo, so it cannot stand — but `index` and `unlocked`
 * are left untouched. This now matches the groove trainer's own T.31, which
 * likewise lets a single groove's result survive a retune.
 *
 * ## Why `run.result` is latched here, not read straight from `useGrooveRun`
 *
 * `advance()` must move `index`/`unlocked` forward in the very same
 * `onFinished` call that a steady pass also grades in. But `useGrooveRun`
 * retires its OWN `result` the moment `plan.grooveId` changes (see that
 * file's own comment above `seenGrooveId`) — and moving `index` forward
 * changes `plan.grooveId` to the next step's score id. Both state updates
 * land in the same React commit, so without this latch the "Steady — next
 * step unlocked" verdict would be cleared before it ever painted: the
 * learner would see the next step already unlocked with no explanation why.
 * `latchedResult` copies `run.result` out the instant it appears (the same
 * "adjust state during render" pattern `useGrooveRun` itself uses for the
 * opposite purpose) so the verdict survives the step change, and is cleared
 * explicitly wherever the learner deliberately moves on: pressing Start
 * again, or picking a different mode/groove/tempo/step.
 */
import { useCallback, useMemo, useState } from 'react'
import { useDrumsHistoryStore } from '@app/state/drumsHistoryStore.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useGrooveRun, type GradedRun, type GrooveRunApi } from '@app/drums/groove/useGrooveRun.ts'
import { createBrowserRng } from '@app/sightreading/rng.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'
import { grooveTrainerLibrary } from '@core/drums/practice/library.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { Clock, DrumAudioOutput, Rng } from '@core/ports/index.ts'
import { advance, drillSteps, type DrillMode, type DrillStep } from './coordinationRun.ts'

/** Opens on the groove trainer's own default tempo — a familiar starting point. */
const DEFAULT_BPM = 80

export type CoordinationTrainer = {
  readonly mode: DrillMode
  readonly setMode: (m: DrillMode) => void
  readonly groove: GrooveScore
  readonly setGroove: (id: string) => void
  readonly steps: readonly DrillStep[]
  readonly index: number
  /** The highest step index the learner may pick. */
  readonly unlocked: number
  /** Ignored when `index` is beyond `unlocked`. */
  readonly select: (index: number) => void
  readonly bpm: number
  readonly setBpm: (bpm: number) => void
  readonly plan: GrooveRunPlan
  readonly run: GrooveRunApi
}

export type UseCoordinationTrainerOptions = {
  /** Injection seams for tests; each defaults to the real browser adapter via `useGrooveRun`. */
  readonly clock?: Clock
  readonly driver?: FrameDriver
  readonly audio?: () => DrumAudioOutput
  /** Test seam. Defaults to `createBrowserRng()`, created once per hook instance. */
  readonly rng?: Rng
  /** Passed straight through to `useGrooveRun` (roadmap DR-08): the rig's stored input offset, ms. */
  readonly inputOffsetMs?: number
}

export function useCoordinationTrainer(opts: UseCoordinationTrainerOptions = {}): CoordinationTrainer {
  const library = useMemo(() => grooveTrainerLibrary(), [])
  const [mode, setModeState] = useState<DrillMode>('layers')
  const [grooveId, setGrooveId] = useState(library[0].id)
  const [bpm, setBpmState] = useState(DEFAULT_BPM)
  const [index, setIndex] = useState(0)
  const [unlocked, setUnlocked] = useState(0)
  // Stable for the hook's life (like `library` above) so `steps` below is
  // not rebuilt — and 'kicks2' not re-drawn — on every render.
  const [rng] = useState<Rng>(() => opts.rng ?? createBrowserRng())

  const groove = library.find((g) => g.id === grooveId) ?? library[0]
  const steps = useMemo(() => drillSteps(mode, groove, rng), [mode, groove, rng])
  const boundedIndex = Math.min(index, steps.length - 1)
  const step = steps[boundedIndex] ?? steps[0]
  // `'openings'` legitimately returns `[]` for a groove with no hat on an
  // "&" (Quarter-Note Rock, the trainer's default) — see `openingDrills`'s
  // own doc comment. Every other mode's content is fixed or built from a
  // groove that always has notes, so `step` is only ever undefined here for
  // `'openings'`; `plan` falls back to the raw groove (never graded — `run`
  // is not started while there is nothing to drill) purely so this hook
  // never has to hand back a `GrooveRunPlan` for a step that does not exist.
  const plan = useMemo(() => planGrooveRun(step?.score ?? groove, bpm), [step, groove, bpm])

  const addAttempt = useDrumsHistoryStore((state) => state.addAttempt)

  const onFinished = useCallback(
    (result: GrooveRunResult): void => {
      if (step === undefined) return
      const next = advance({ index: boundedIndex, unlocked }, result.steady, steps.length)
      setIndex(next.index)
      setUnlocked(next.unlocked)
      addAttempt({
        grooveId: step.score.id,
        grooveTitle: step.score.title,
        bpm: plan.bpm,
        at: Date.now(),
        steady: result.steady,
        pads: result.pads.map((row) => ({
          pad: row.pad,
          expected: row.expected,
          matched: row.matched,
          ...(row.meanOffsetMs === undefined ? {} : { meanOffsetMs: row.meanOffsetMs }),
        })),
      })
    },
    [addAttempt, boundedIndex, plan, step, steps.length, unlocked],
  )

  const rawRun = useGrooveRun({
    plan,
    onFinished,
    ...(opts.clock === undefined ? {} : { clock: opts.clock }),
    ...(opts.audio === undefined ? {} : { audio: opts.audio }),
    ...(opts.driver === undefined ? {} : { driver: opts.driver }),
    ...(opts.inputOffsetMs === undefined ? {} : { inputOffsetMs: opts.inputOffsetMs }),
  })

  // See the module comment: this copies `rawRun.result` out the instant it
  // appears, during render (the same pattern `useGrooveRun` itself uses to
  // retire a stale result), so a verdict from a steady pass survives the
  // `index` bump that same pass triggers instead of being wiped by
  // `useGrooveRun`'s own "result retires when plan.grooveId changes" rule.
  const [latchedResult, setLatchedResult] = useState<GradedRun | undefined>(undefined)
  if (rawRun.result !== undefined && rawRun.result !== latchedResult) {
    setLatchedResult(rawRun.result)
  }

  // Nothing to drill (`'openings'` on a groove with no hat on an "&"):
  // Start is a no-op, so the fallback `plan` above is never run.
  const start = useCallback((): void => {
    if (step === undefined) return
    setLatchedResult(undefined)
    rawRun.start()
  }, [rawRun, step])

  const run: GrooveRunApi = { ...rawRun, result: latchedResult, start }

  const setMode = useCallback(
    (m: DrillMode): void => {
      rawRun.stop()
      setLatchedResult(undefined)
      setModeState(m)
      setIndex(0)
      setUnlocked(0)
    },
    [rawRun],
  )

  const setGroove = useCallback(
    (id: string): void => {
      rawRun.stop()
      setLatchedResult(undefined)
      setGrooveId(id)
      setIndex(0)
      setUnlocked(0)
    },
    [rawRun],
  )

  const setBpm = useCallback(
    (nextBpm: number): void => {
      // Deliberately does NOT reset index/unlocked — see the module comment.
      rawRun.stop()
      setLatchedResult(undefined)
      setBpmState(nextBpm)
    },
    [rawRun],
  )

  const select = useCallback(
    (i: number): void => {
      if (i > unlocked || i < 0 || i >= steps.length) return
      rawRun.stop()
      setLatchedResult(undefined)
      setIndex(i)
    },
    [rawRun, steps.length, unlocked],
  )

  return {
    mode,
    setMode,
    groove,
    setGroove,
    steps,
    index: boundedIndex,
    unlocked,
    select,
    bpm,
    setBpm,
    plan,
    run,
  }
}
