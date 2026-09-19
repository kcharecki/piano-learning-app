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
import { useCallback, useMemo, useRef, useState } from 'react'
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
import { barsOf, cyclesForBars, isCleanPass, rudimentAccents, type RudimentAccentResult } from './rudimentRun.ts'

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
  /**
   * DR-10 accents: the snare row's accent grading for the last finished run —
   * `undefined` before any run finishes, and reset (not carried over) wherever
   * `lastClean` resets, since both describe the same run. See
   * `rudimentAccents` (`rudimentRun.ts`) for what each field means.
   */
  readonly lastAccents: RudimentAccentResult | undefined
  restart(): void
  /**
   * Forwards to `run.hit('snare', velocity)` — a rudiment is one voice, so
   * every tap is a snare stroke. `velocity` absent (an on-screen pad press)
   * records an unclassified stroke, same as the groove trainer's own pads;
   * given, it is graded against the pattern's notated accents (DR-10
   * accents) exactly like a keyboard/e-kit stroke on the groove trainer.
   */
  tap(velocity?: number): void
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
  const [lastAccents, setLastAccents] = useState<RudimentAccentResult | undefined>(undefined)

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
    setLastAccents(undefined)
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
  // onset order — fed to `rudimentEvenness` when the run finishes. Each entry
  // is the engine's OWN stamped instant: exactly the ms `run.hit()` returns,
  // which is exactly the ms it recorded into its own grading list — never a
  // value read off a mirrored phase. Cleared by `wrappedStart` below, at the
  // moment a fresh run is requested, so a stale tap from a previous attempt
  // never survives into the next one's score.
  const tapsRef = useRef<number[]>([])

  const onFinished = useCallback(
    (result: GrooveRunResult): void => {
      const taps = tapsRef.current
      const evenness = rudimentEvenness(taps)

      // DR-10 accents: the rudiment is one voice, so its own accent grading
      // lives entirely on the snare row — `expectedDynamics` comes from the
      // PLAN (what was notated), `dynamics` from the RESULT (what was
      // actually graded). Falls back to an all-zero `PadDynamicsResult` if
      // the snare row is somehow absent (never true today — `rudimentToScore`
      // always writes every stroke to 'snare') rather than throwing, so a
      // future multi-pad rudiment would read as "nothing graded" instead of
      // crashing the run.
      const expectedDynamics = plan.pads.find((pad) => pad.pad === 'snare')?.expectedDynamics ?? []
      const snareDynamics = result.pads.find((pad) => pad.pad === 'snare')?.dynamics ?? {
        graded: 0,
        wrong: 0,
        softWanted: 0,
        loudWanted: 0,
        ghostInstants: 0,
        accentInstants: 0,
        unclassified: 0,
        normalInstants: 0,
        loudNormals: 0,
      }
      const accents = rudimentAccents(expectedDynamics, snareDynamics)

      // RED-A (round 3): the over-accenting gate only applies to a rudiment
      // that notates an accent in the first place — `accents.notated` is
      // this run's own true count, already derived from the plan above, so
      // it is passed straight through rather than re-derived a second time.
      const clean = isCleanPass(result, evenness, accents.notated)
      const gradedBpm = plan.bpm

      const next = recordPass(ladder, clean, config)
      setLadder(next)
      setLastClean(clean)
      setLastAccents(accents)
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
    [ladder, config, plan.bpm, plan.pads, recordRun, rudiment.id, nowFn],
  )

  const run = useGrooveRun({
    plan,
    onFinished,
    clock,
    ...(options.audio === undefined ? {} : { audio: options.audio }),
    ...(options.driver === undefined ? {} : { driver: options.driver }),
  })

  // Cleared at the moment a fresh run is actually requested, not on a
  // phase-edge effect: with an early tap now acceptable (DR-10, the grader's
  // own acceptance window opens before `gradedOrigin`), a phase-edge effect
  // only fires on the NEXT render after `start()` flips the ref, so a second
  // `start()` fired while still mid count-in could leave a stale tap from the
  // previous attempt sitting in `tapsRef` until the effect catches up.
  // Clearing inline, in the same call that starts the run, has no such gap.
  // `rawStart` is the engine's own `start` (a stable `useCallback` inside
  // `useGrooveRun`, so this hook's own `useCallback` actually memoises
  // something — `run` itself is a fresh object literal every render) and is
  // used ONLY here: every caller of this hook must start a run through
  // `wrappedStart`, never `rawStart` directly, so the tap record is empty by
  // construction whenever a graded window can begin.
  const { start: rawStart } = run
  const wrappedStart = useCallback((): void => {
    tapsRef.current = []
    rawStart()
  }, [rawStart])

  const restart = useCallback((): void => {
    setLadder(startLadder(config))
    setLastClean(undefined)
    setLastEvenness(undefined)
    setLastAccents(undefined)
  }, [config])

  const tap = useCallback(
    (velocity?: number): void => {
      const ms = run.hit('snare', velocity)
      if (ms !== undefined) tapsRef.current.push(ms)
    },
    [run],
  )

  return {
    score,
    plan,
    ladder,
    config,
    run: { ...run, start: wrappedStart },
    lastClean,
    lastEvenness,
    lastAccents,
    restart,
    tap,
  }
}
