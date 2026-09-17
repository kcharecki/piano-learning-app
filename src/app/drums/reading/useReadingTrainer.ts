/**
 * The rhythm reading trainer's run (roadmap DR-11): a generated one-voice
 * exercise, played through `useGrooveRun` exactly as the groove trainer does,
 * graded pad-agnostically (every tap, whichever pad or key it came from, is
 * reported to `useGrooveRun.hit('snare')` — see `ReadingTrainerScreen.tsx`),
 * and adapted to a new level whenever three runs in a row at the current
 * level clear or fall through `adaptReadingLevel`'s band.
 *
 * ## The staff never moves under the learner mid-run
 *
 * `adaptReadingLevel` can decide a new level the instant a run finishes, but
 * changing what is drawn at that moment would rewrite the exercise the
 * learner is still looking at the result of. So two levels are tracked
 * separately: `activeLevel` is what the CURRENT exercise was generated at,
 * and it only ever moves inside `next()`. The store's own `level` can move
 * the moment a run is graded (that is the whole point of adapting) — it is
 * simply not read again for generation until the learner asks for the next
 * exercise.
 *
 * ## Catching up to a level restored after mount (roadmap DR-11 review, MAJOR 1)
 *
 * `activeLevel` seeds itself from the store once, at the first render. That
 * is wrong the moment a caller restores a persisted level asynchronously —
 * `App.tsx` hydrates the reading store from storage in an effect that runs
 * AFTER this screen has already mounted and drawn a level-1 exercise, so a
 * learner who was on level 4 and reloads on `/drums/reading` would otherwise
 * be handed level 1 with no way back short of three level-1 runs. So an
 * effect below re-syncs `activeLevel` to the store's level for as long as
 * NOTHING has been played yet on this exercise — `hasRunRef` flips to `true`
 * the first time `start()` is actually called, and once it has, the learner
 * is committed to the exercise in front of them and this sync stops for
 * good (the store can still move ahead of `activeLevel` after that, exactly
 * as the section above describes — that is not this effect's job).
 *
 * ## Only this level's own runs count (roadmap DR-11 review, MAJOR 2)
 *
 * `adaptReadingLevel` itself already filters its `recent` argument down to
 * `current`-level runs before windowing — but it cannot filter what it is
 * never shown. The store keeps every run ever played, at every level,
 * forever; feeding it the whole thing (even reversed to chronological order)
 * means a demotion back to a level the learner already cleared can see that
 * OLD clearing run again and immediately promote back off it — the level a
 * single new run should never be able to move by itself. The fix is to only
 * ever hand `adaptReadingLevel` the newest CONTIGUOUS streak of runs at
 * `activeLevel`, reversed to the chronological order its own
 * `.slice(-WINDOW)` expects (the store keeps runs newest-first; see its own
 * module comment) — a run recorded at any OTHER level ends the streak right
 * there, so a run from before the level last changed can never reach this
 * window no matter how long the learner keeps playing at the level it moved
 * back to. No further cap is needed or wanted: a learner who plays one run
 * per exercise and presses `next()` between every one must still be able to
 * accumulate a real 3-run window over 3 exercises (see
 * `useReadingTrainer.test.ts`'s own case for exactly this).
 *
 * ## Seeding
 *
 * `initialSeed ?? Date.now()` is the one place this module touches the
 * clock, and only to seed the injected `Rng` at the edge — the rule every
 * app-layer port seam in this codebase follows. Every seed after that is
 * `nextSeed`'s deterministic LCG step, so a test can predict every exercise a
 * session will ever see from its starting seed.
 *
 * ## Why the exercise id carries the seed
 *
 * `useGrooveRun` retires its result exactly when `plan.grooveId` changes
 * (see that hook's own module comment) — the mechanism this hook leans on to
 * clear a graded run's verdict the moment `next()` draws a new one.
 * `generateReadingExercise`'s id is `reading-L<level>-<idPart>`, so passing
 * `ex-${seed}` as `idPart` guarantees a new id — and therefore a cleared
 * result — every time the seed advances, independent of whether the level
 * also happened to change.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGrooveRun, type GrooveRunApi } from '@app/drums/groove/useGrooveRun.ts'
import { useDrumsReadingStore } from '@app/state/drumsReadingStore.ts'
import type { FrameDriver } from '@app/practice/useTransportLoop.ts'
import type { GrooveScore } from '@core/drums/model/groove.ts'
import type { GrooveRunResult } from '@core/drums/practice/grade.ts'
import { MAX_BPM, MIN_BPM, planGrooveRun, type GrooveRunPlan } from '@core/drums/practice/plan.ts'
import {
  adaptReadingLevel,
  describeReadingLevel,
  generateReadingExercise,
  type ReadingLevel,
  type ReadingRunRecord,
} from '@core/drums/reading/index.ts'
import type { Clock, DrumAudioOutput } from '@core/ports/index.ts'
import { seededRng } from '@core/ports/rng.ts'
import { accuracyOf, nextSeed } from './readingRun.ts'

/** The persona's starting tempo — slow enough to read a fresh level cold. */
const DEFAULT_BPM = 80

/** Two bars: enough to judge a steady pulse without making a wrong exercise a long one to sit through. */
const DEFAULT_MEASURES = 2

export type UseReadingTrainerOptions = {
  readonly clock?: Clock
  readonly audio?: () => DrumAudioOutput
  readonly driver?: FrameDriver
  readonly initialSeed?: number
  readonly initialBpm?: number
  readonly measures?: number
}

export type ReadingTrainerApi = {
  /** The level the CURRENT exercise was drawn at — see the module comment. */
  readonly level: ReadingLevel
  readonly levelText: string
  readonly score: GrooveScore
  readonly plan: GrooveRunPlan
  readonly bpm: number
  readonly run: GrooveRunApi
  readonly lastAccuracy: number | undefined
  /** What the last graded run did to the level, or `undefined` if it did nothing. */
  readonly levelChanged: 'up' | 'down' | undefined
  /** Draws a new exercise at the store's current level. */
  next(): void
  setBpm(bpm: number): void
  /** Pad-agnostic: every tap counts as the one voice every exercise is graded on. */
  tap(): void
}

function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm))
}

export function useReadingTrainer(options: UseReadingTrainerOptions = {}): ReadingTrainerApi {
  const measures = options.measures ?? DEFAULT_MEASURES

  const storeLevel = useDrumsReadingStore((state) => state.level)
  const setStoreLevel = useDrumsReadingStore((state) => state.setLevel)
  const addRun = useDrumsReadingStore((state) => state.addRun)

  const [seed, setSeed] = useState<number>(() => options.initialSeed ?? Date.now())
  // Starts at whatever the store held at mount (its persisted level, or the
  // default); after that it only moves inside `next()` — see the module
  // comment. The effect below keeps this synced to a LATER-arriving
  // persisted level too, for as long as `hasRunRef` says nothing has
  // actually been played yet (MAJOR 1).
  const [activeLevel, setActiveLevel] = useState<ReadingLevel>(storeLevel)
  const [bpm, setBpmState] = useState<number>(() => clampBpm(options.initialBpm ?? DEFAULT_BPM))
  const [levelChanged, setLevelChanged] = useState<'up' | 'down' | undefined>(undefined)

  /** Flips true the first time `start()` is actually called — see the module comment (MAJOR 1). */
  const hasRunRef = useRef(false)

  const score = useMemo(
    () => generateReadingExercise({ level: activeLevel, measures, id: `ex-${seed}` }, seededRng(seed)),
    [activeLevel, measures, seed],
  )

  // The exercise loops exactly `score.measures.length` bars — no repeat, the
  // reading trainer states the whole task on the staff once.
  const plan = useMemo(
    () => planGrooveRun(score, bpm, { gradedBars: score.measures.length }),
    [score, bpm],
  )

  const onFinished = useCallback(
    (result: GrooveRunResult): void => {
      const accuracy = accuracyOf(result)
      const record: ReadingRunRecord = { level: activeLevel, accuracy }
      addRun(record)

      // Minor a: once the store has already moved off `activeLevel`, this
      // staff is stale — the decision that moved it has been made and
      // announced, and re-evaluating on every further run played here (before
      // the learner asks for `next()`) would re-announce it, or walk the
      // level past where the last decision actually landed.
      if (useDrumsReadingStore.getState().level !== activeLevel) {
        setLevelChanged(undefined)
        return
      }

      // MAJOR 2: the newest CONTIGUOUS streak of runs at `activeLevel` — a
      // run recorded at any OTHER level ends it right there — reversed to
      // the chronological order `adaptReadingLevel`'s own `.slice(-WINDOW)`
      // expects (the store itself keeps runs newest-first; see its own
      // module comment, and this hook's own "Only this level's own runs
      // count"). No further cap: `adaptReadingLevel` already declines to
      // move until it sees a full window, so a short streak is simply not
      // enough yet, not something to track separately.
      const runsNewestFirst = useDrumsReadingStore.getState().runs
      const streak: ReadingRunRecord[] = []
      for (const pastRun of runsNewestFirst) {
        if (pastRun.level !== activeLevel) break
        streak.push(pastRun)
      }
      const chronological = [...streak].reverse()

      const newLevel = adaptReadingLevel(activeLevel, chronological)
      if (newLevel === activeLevel) {
        setLevelChanged(undefined)
        return
      }
      setStoreLevel(newLevel)
      setLevelChanged(newLevel > activeLevel ? 'up' : 'down')
    },
    [activeLevel, addRun, setStoreLevel],
  )

  const rawRun = useGrooveRun({
    plan,
    onFinished,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.audio === undefined ? {} : { audio: options.audio }),
    ...(options.driver === undefined ? {} : { driver: options.driver }),
  })

  // MAJOR 1: the one place `start()` is actually invoked, so the resync
  // effect below can tell "nothing played yet" from "a run is under way".
  const start = useCallback((): void => {
    hasRunRef.current = true
    rawRun.start()
  }, [rawRun])
  const run: GrooveRunApi = useMemo(() => ({ ...rawRun, start }), [rawRun, start])

  // MAJOR 1: re-sync `activeLevel` to a level the store restores AFTER this
  // hook already mounted (see the module comment) — but only while the
  // learner has not committed to the exercise on screen: no run has ever
  // started, it is currently idle, and nothing has been graded.
  useEffect(() => {
    if (hasRunRef.current) return
    if (run.phase !== 'idle' || run.result !== undefined) return
    if (storeLevel !== activeLevel) setActiveLevel(storeLevel)
  }, [storeLevel, activeLevel, run.phase, run.result])

  const next = useCallback((): void => {
    // MAJOR 4: without this, `useGrooveRun`'s `phase` is left at `'graded'`
    // from the run that just finished — `result` clears on the groove-id
    // change below, but nothing else resets `phase`, so the new exercise
    // would open captioned "Run finished".
    rawRun.stop()
    setSeed((current) => nextSeed(current))
    setActiveLevel(useDrumsReadingStore.getState().level)
    setLevelChanged(undefined)
  }, [rawRun])

  const setBpm = useCallback((bpmValue: number): void => {
    setBpmState(clampBpm(bpmValue))
  }, [])

  const tap = useCallback((): void => {
    run.hit('snare')
  }, [run])

  const lastAccuracy = run.result === undefined ? undefined : accuracyOf(run.result.result)

  return {
    level: activeLevel,
    levelText: describeReadingLevel(activeLevel),
    score,
    plan,
    bpm,
    run,
    lastAccuracy,
    levelChanged,
    next,
    setBpm,
    tap,
  }
}
