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
 * ## Why the plan's `grooveId` carries the bpm
 *
 * `useGrooveRun` retires its `result` exactly when `plan.grooveId` changes
 * (see that hook's own module comment) — a groove change is a different
 * chart, so the marking must not survive it. `rudimentToScore` names its
 * score `rudiment-<id>-x<cycles>`, which stays FIXED across a whole ladder
 * run (the cycle count depends only on the rudiment and the bar target, never
 * on tempo) — so without help, `useGrooveRun` would leave a stale verdict on
 * screen labelled with a bpm the ladder has already left behind. The tempo
 * ladder moving the tempo is the same kind of event here as a groove change
 * is for the groove trainer, so `plan.grooveId` is overridden below to
 * `<rudiment.id>@<bpm>`, built fresh from `planGrooveRun`'s own result (which
 * has no notion of the ladder) — this makes a tempo step read as "a new
 * chart" to that retirement rule, which is exactly the behaviour wanted here.
 */
import { useCallback, useMemo, useState } from 'react'
import { useGrooveRun, type GrooveRunApi } from '@app/drums/groove/useGrooveRun.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import { useDrumsRudimentStore } from '@app/state/drumsRudimentStore.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'
import { planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import {
  recordPass,
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

  const config = useMemo(() => ladderConfigFor(rudiment, mode), [rudiment, mode])

  const [ladder, setLadder] = useState<TempoLadderState>(() => startLadder(config))
  const [lastClean, setLastClean] = useState<boolean | undefined>(undefined)

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
  }

  const cycles = useMemo(() => cyclesForBars(rudiment, bars), [rudiment, bars])
  const scoreBars = useMemo(() => barsOf(rudiment, cycles), [rudiment, cycles])
  const score = useMemo(() => rudimentToScore(rudiment, cycles), [rudiment, cycles])

  const plan = useMemo((): GrooveRunPlan => {
    const base = planGrooveRun(score, ladder.bpm, { gradedBars: scoreBars })
    // See the module comment: the ladder moving the tempo must read as a new
    // chart to `useGrooveRun`'s own result-retirement rule.
    return { ...base, grooveId: `${rudiment.id}@${ladder.bpm}` }
  }, [score, ladder.bpm, scoreBars, rudiment.id])

  const onFinished = useCallback(
    (result: GrooveRunResult): void => {
      const clean = isCleanPass(result)
      const gradedBpm = plan.bpm
      const next = recordPass(ladder, clean, config)
      setLadder(next)
      setLastClean(clean)
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
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.audio === undefined ? {} : { audio: options.audio }),
    ...(options.driver === undefined ? {} : { driver: options.driver }),
  })

  const restart = useCallback((): void => {
    setLadder(startLadder(config))
    setLastClean(undefined)
  }, [config])

  const tap = useCallback((): void => {
    run.hit('snare')
  }, [run])

  return { score, plan, ladder, config, run, lastClean, restart, tap }
}
