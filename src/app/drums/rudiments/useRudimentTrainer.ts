/**
 * The rudiment trainer's hook (roadmap DR-10): turns a `Rudiment` into a
 * playable groove on the snare, drives it through the same `useGrooveRun`
 * engine every groove screen uses, and grades each finished run against the
 * success-gated tempo ladder (`@core/drums/rudiment/tempoLadder.ts`),
 * persisting a personal best whenever the ladder has one to report.
 *
 * `RudimentTrainerScreen.tsx` is the only caller; this hook owns every piece
 * of grading/ladder/persistence logic so that component stays presentational.
 *
 * ## Why the plan's `grooveId` must NOT carry the bpm
 *
 * `useGrooveRun` retires its `result` exactly when `plan.grooveId` changes
 * (see that hook's own module comment) — a groove change is a different
 * chart, so the marking must not survive it. `rudimentToScore` names its
 * score `rudiment-<id>-x<cycles>`, which stays FIXED across a whole ladder
 * run, and that is what this hook passes through unchanged. An earlier cut
 * overrode it to `<id>@<bpm>` so a tempo step would read as a new chart and
 * clear the verdict; but the ladder steps the tempo on EVERY failed pass and
 * after every completed clean streak, so the verdict was retired in the same
 * commit it was graded — the learner saw "Not clean" for no frame at all.
 * A tempo step is not a chart change: the verdict carries the bpm it was
 * graded at (`GradedRun.bpm`, shown by the screen), so it stays readable
 * until the next run replaces it or the rudiment itself changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserClock } from '@app/practice/clock.ts'
import { useGrooveRun, type GrooveRunApi } from '@app/drums/groove/useGrooveRun.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import {
  MIN_EVENNESS_STROKES,
  recordPass,
  rudimentEvenness,
  rudimentToScore,
  startLadder,
  type LadderMode,
  type Rudiment,
  type TempoLadderConfig,
  type TempoLadderState,
} from '@core/drums/rudiment/index.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import { barsOf, cyclesForBars, isCleanPass } from './rudimentRun.ts'

export type UseRudimentTrainerOptions = {
  readonly rudiment: Rudiment
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
  readonly driver?: FrameDriver
  readonly now?: () => number
  /** Default 'up'. */
  readonly mode?: LadderMode
  /** Default 2. */
  readonly bars?: number
}

export type RudimentTrainerApi = {
  readonly score: GrooveScore
  readonly plan: GrooveRunPlan
  readonly ladder: TempoLadderState
  readonly config: TempoLadderConfig
  readonly run: GrooveRunApi
  readonly lastClean: boolean | undefined
  /**
   * 0..1 evenness of the strokes as played on the last finished run — see
   * `@core/drums/rudiment/evenness.ts`. `undefined` before any run finishes,
   * and for a run with fewer than `MIN_EVENNESS_STROKES` strokes.
   */
  readonly lastEvenness: number | undefined
  restart(): void
  tap(): void
}

const DEFAULT_BARS = 2

/**
 * `maxBpm: Math.max(rudiment.bpmBand.target, ...)` per the DR-10 contract — the
 * second operand was left as "..." in the brief. Read here as a defensive
 * floor of `rudiment.bpmBand.start`, so `TempoLadderConfig`'s own
 * `min <= max` requirement holds even for a hypothetical rudiment whose
 * researched target sits at or below its start (never true of the 40
 * bundled rudiments today). Flagged as a guess in the delivery notes.
 */
function ladderConfigFor(rudiment: Rudiment, mode: LadderMode): TempoLadderConfig {
  return {
    startBpm: rudiment.bpmBand.start,
    maxBpm: Math.max(rudiment.bpmBand.target, rudiment.bpmBand.start),
    mode,
  }
}

export function useRudimentTrainer(options: UseRudimentTrainerOptions): RudimentTrainerApi {
  const { rudiment, mode = 'up', bars = DEFAULT_BARS } = options
  const nowFn = options.now ?? Date.now
  const recordRun = useDrumsRudimentStore((state) => state.recordRun)

  // One clock, shared by the groove engine and the evenness record below —
  // see the module comment: two independent `createBrowserClock()` calls
  // would not necessarily agree on their epoch, and evenness needs its onsets
  // measured against the exact same clock `useGrooveRun` grades against.
  const clockRef = useRef<Clock | undefined>(undefined)
  if (clockRef.current === undefined) clockRef.current = options.clock ?? createBrowserClock()
  const clock = clockRef.current

  const config = useMemo(() => ladderConfigFor(rudiment, mode), [rudiment, mode])

  const [ladder, setLadder] = useState<TempoLadderState>(() => startLadder(config))
  const [lastClean, setLastClean] = useState<boolean | undefined>(undefined)
  const [lastEvenness, setLastEvenness] = useState<number | undefined>(undefined)

  // The ladder resets when the RUDIMENT changes — not on a mode toggle, and
  // not on every render just because `config` is a fresh object each time.
  // Comparing identity during render and calling `setState` synchronously is
  // the documented way to reset state in response to a prop change; it is
  // the same discipline `useGrooveRun` applies to its own grooveId check.
  const [seenRudimentId, setSeenRudimentId] = useState(rudiment.id)
  if (rudiment.id !== seenRudimentId) {
    setSeenRudimentId(rudiment.id)
    setLadder(startLadder(config))
    setLastClean(undefined)
    setLastEvenness(undefined)
  }

  const cycles = useMemo(() => cyclesForBars(rudiment, bars), [rudiment, bars])
  const scoreBars = useMemo(() => barsOf(rudiment, cycles), [rudiment, cycles])
  const score = useMemo(() => rudimentToScore(rudiment, cycles), [rudiment, cycles])

  // The plan keeps `rudimentToScore`'s own grooveId — see the module comment
  // on why a tempo step must not read as a chart change.
  const plan = useMemo(
    (): GrooveRunPlan => planGrooveRun(score, ladder.bpm, { gradedBars: scoreBars }),
    [score, ladder.bpm, scoreBars],
  )

  // The learner's own stroke instants for the run currently in progress, in
  // onset order — fed to `rudimentEvenness` when the run finishes. Cleared
  // whenever the phase becomes 'count-in' (a fresh run starting), so a stale
  // tap from a previous attempt never survives into the next one's score.
  const tapsRef = useRef<number[]>([])

  // Mirrors `run.phase` into a ref so `tap()` (a stable callback) can read the
  // CURRENT phase without depending on it — `useGrooveRun` does the same
  // thing internally for its own phase checks. This lags the engine by at
  // most one frame: a stroke played in the very first frame of the graded
  // window may still see phaseRef holding 'count-in' and be excluded from the
  // evenness record, even though the engine itself already grades it.
  const phaseRef = useRef<GrooveRunApi['phase']>('idle')

  const onFinished = useCallback(
    (result: GrooveRunResult): void => {
      const taps = tapsRef.current
      const evenness = rudimentEvenness(taps)
      const clean = isCleanPass(result, evenness)
      const gradedBpm = plan.bpm
      const next = recordPass(ladder, clean, config)
      setLadder(next)
      setLastClean(clean)
      // Under MIN_EVENNESS_STROKES the score is 1 by definition, not by
      // playing — no line is more honest than "100% even" over silence.
      setLastEvenness(taps.length >= MIN_EVENNESS_STROKES ? evenness : undefined)
      // Contract: persist only once the ladder has a personal best to report
      // (`bestCleanBpm !== undefined`). That stays true forever once any pass
      // has ever been clean, so a later failed run still re-records the SAME
      // best rather than nothing — harmless, since the store keeps the max
      // across calls (`drumsRudimentStore.ts`), but flagged as the literal
      // reading of the contract rather than "only when THIS run was clean".
      if (next.bestCleanBpm !== undefined) {
        recordRun(rudiment.id, {
          bestCleanBpm: next.bestCleanBpm,
          lastBpm: gradedBpm,
          at: nowFn(),
        })
      }
    },
    [ladder, config, plan.bpm, recordRun, rudiment.id, nowFn],
  )

  const run = useGrooveRun({
    plan,
    onFinished,
    clock,
    ...(options.audio === undefined ? {} : { audio: options.audio }),
    ...(options.driver === undefined ? {} : { driver: options.driver }),
  })

  // Mirrored during render, not inside an effect: an effect would not commit
  // until after this render's `tap()` closures could already run (e.g. a
  // pointer handler firing between commits), which is exactly the one-frame
  // lag the module comment above already accounts for — mirroring later
  // would only make that lag worse.
  phaseRef.current = run.phase

  useEffect(() => {
    if (run.phase === 'count-in') tapsRef.current = []
  }, [run.phase])

  const restart = useCallback((): void => {
    setLadder(startLadder(config))
    setLastClean(undefined)
    setLastEvenness(undefined)
  }, [config])

  const tap = useCallback((): void => {
    run.hit('snare')
    if (phaseRef.current === 'playing') tapsRef.current.push(clock.now())
  }, [run, clock])

  return { score, plan, ladder, config, run, lastClean, lastEvenness, restart, tap }
}
