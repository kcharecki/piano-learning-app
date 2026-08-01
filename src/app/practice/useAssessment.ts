/**
 * Assessment mode wiring (roadmap 2.11, REQ-3.3.4, REQ-3.3.5) — the end-of-run
 * story on top of the live, per-note colouring `useNoteFeedback` already
 * provides. Where that hook judges notes AS they are played, this one runs an
 * independent `NoteMatcher` for one fixed-tempo, no-wait-mode pass, reduces
 * the finished pass with `assess()` (`core/practice/assessment.ts`), and
 * derives the review-screen data — problem measures and one-click loop
 * suggestions — with `problemMeasures`/`suggestedLoops`/`suggestedTempoScale`
 * (`core/practice/review.ts`). No music logic lives here; this hook only
 * feeds the real core modules and reports what they say.
 *
 * ## Why this needs its own matcher, not `useNoteFeedback`'s
 *
 * `useNoteFeedback` does not expose the full `MatchResult[]` stream `assess()`
 * needs (only a running `MatchSummary`), and this file does not own that
 * module — so a second, independent `NoteMatcher` is built for the run. The
 * two matchers simply run in parallel against the same MIDI events; nothing
 * about the live one is disturbed.
 *
 * ## Turning a MIDI timestamp into a matcher millisecond, the easy way
 *
 * `useNoteFeedback` has to reconstruct the transport's tick position every
 * frame because tempo scale and pausing can both change the tick↔ms mapping
 * out from under it (see that hook's own module comment). Assessment mode
 * doesn't have that problem: `start()` forces the tempo scale to exactly 1
 * (REQ-3.3.4's "fixed tempo"), and a running assessment can never be paused
 * or sought. With scale pinned at 1 and no pausing, the transport's own
 * anchoring means `tickToMs(writtenTempo, positionTicks)` and "wall-clock ms
 * since the run started" are the SAME function of time. So this hook just
 * remembers the clock reading at the moment `start()` calls `play()` and
 * turns every MIDI event into a matcher millisecond with one subtraction —
 * no cursor interception, no resampled anchor, no dependency on
 * `usePracticeEngine` or `ScoreViewerHandle` at all.
 *
 * ## Detecting the run's end
 *
 * The transport has no "I reached the end" callback reachable from here — only
 * `usePracticeEngine`'s `phase`. A run in progress can only reach `'stopped'`
 * by playing off the end of the score (the transport's own `end` event, which
 * is what flips `runState` to `'stopped'` — see `transport.ts`), because
 * `start()` clears any loop and the practice screen does not offer Pause/Stop
 * while an assessment is running (REQ-3.3.4's "no stopping"). So a
 * `phase === 'stopped'` transition while a run is in flight IS the run
 * finishing; `finalizeRun` closes every still-open matcher window (a trailing
 * note nobody pressed must count as `missed`, not vanish) and reduces the
 * result.
 */
import type { Hand, Score } from '@core/notation/score.ts'
import { measureRange, scoreDurationTicks } from '@core/notation/score.ts'
import type { Clock, DateSource, MidiInput } from '@core/ports/index.ts'
import { assess, type AssessmentResult } from '@core/practice/assessment.ts'
import { MATCHER_DEFAULTS, NoteMatcher } from '@core/practice/matcher.ts'
import {
  problemMeasures,
  suggestedLoops,
  suggestedTempoScale,
  type ProblemMeasure,
  type SuggestedLoop,
} from '@core/practice/review.ts'
import { bpmAtTick, makeTempoMap, tickToMs, type TempoMap } from '@core/timing/tempo.ts'
import type { LoopRange, TransportState } from '@core/timing/transport.ts'
import { millis as asMillis, ticks as asTicks } from '@core/shared/units.ts'
import { useEffect, useMemo, useRef, useState } from 'react'

export type AssessmentRunPhase = 'idle' | 'running' | 'complete'

export type UseAssessmentOptions = {
  readonly score: Score | undefined
  readonly activeHands: readonly Hand[]
  readonly midiInput: MidiInput | undefined
  readonly clock: Clock
  readonly date: DateSource
  /** `usePracticeEngine`'s `phase` — watched to detect the run reaching the end. */
  readonly phase: TransportState
  /** Starts the transport from the top; a fresh `play()` from `'stopped'` always is. */
  readonly play: () => void
  readonly setTempoScale: (scale: number) => void
  readonly setWaitModeEnabled: (enabled: boolean) => void
  readonly setLoop: (loop: LoopRange | undefined) => void
}

export type UseAssessment = {
  readonly phase: AssessmentRunPhase
  readonly result: AssessmentResult | undefined
  /** Worst measures first; empty on a clean run. */
  readonly problems: readonly ProblemMeasure[]
  /** One suggested loop per group of nearby problem measures — the one-click list. */
  readonly loops: readonly SuggestedLoop[]
  /** No-op if no score is loaded or a run is already in progress. */
  readonly start: () => void
  /** REQ-3.3.5: sets the loop to this suggestion, slows to the run's suggested
   * practice tempo, and starts playing — the one-click path. */
  readonly practiceLoop: (loop: SuggestedLoop) => void
}

/** Everything a run needs to turn its own MIDI events into a finished `AssessmentResult`. */
type Run = {
  readonly score: Score
  readonly tempo: TempoMap
  readonly matcher: NoteMatcher
  readonly tempoBpm: number
  /** `clock.now()` at the instant this run's `play()` was issued — see the module comment. */
  readonly anchorMs: number
}

export function useAssessment(options: UseAssessmentOptions): UseAssessment {
  const [phase, setPhase] = useState<AssessmentRunPhase>('idle')
  const [result, setResult] = useState<AssessmentResult | undefined>(undefined)
  const [assessedScore, setAssessedScore] = useState<Score | undefined>(undefined)
  const runRef = useRef<Run | undefined>(undefined)
  const optionsRef = useRef(options)
  optionsRef.current = options

  // A different (or unloaded) score makes an in-flight run and a finished
  // result equally meaningless — both are about a piece that is no longer the
  // one on screen.
  useEffect(() => {
    runRef.current = undefined
    setPhase('idle')
    setResult(undefined)
    setAssessedScore(undefined)
  }, [options.score])

  function finalizeRun(): void {
    const run = runRef.current
    if (run === undefined) return
    // Close every window still open at the end of the piece — a trailing note
    // nobody got to must count as `missed`, not go unreported because no MIDI
    // event ever arrived to advance the matcher's clock past it.
    const endMs =
      (tickToMs(run.tempo, scoreDurationTicks(run.score)) as number) +
      MATCHER_DEFAULTS.toleranceMs +
      1
    run.matcher.advanceTo(asMillis(endMs))
    const assessed = assess(run.score, run.matcher.results, {
      tempoBpm: run.tempoBpm,
      date: optionsRef.current.date,
      scoreId: run.score.id,
    })
    runRef.current = undefined
    setResult(assessed)
    setAssessedScore(run.score)
    setPhase('complete')
  }

  // The only reachable way `phase` becomes `'stopped'` while a run is in
  // flight is the transport playing off the end — see the module comment.
  useEffect(() => {
    if (options.phase === 'stopped') finalizeRun()
  }, [options.phase])

  // Feed the assessment's own matcher, independent of useNoteFeedback's.
  useEffect(() => {
    if (options.midiInput === undefined) return undefined
    return options.midiInput.onEvent((event) => {
      const run = runRef.current
      if (run === undefined) return
      const estimated = asMillis(event.time - run.anchorMs)
      if (event.type === 'noteOn') run.matcher.noteOn(event.note, estimated)
      else if (event.type === 'noteOff') run.matcher.noteOff(event.note, estimated)
    })
  }, [options.midiInput])

  function start(): void {
    const score = optionsRef.current.score
    if (score === undefined || runRef.current !== undefined) return
    const tempo = makeTempoMap(score.tempos)
    const matcher = new NoteMatcher(score, tempo, { hands: optionsRef.current.activeHands })
    runRef.current = {
      score,
      tempo,
      matcher,
      tempoBpm: bpmAtTick(tempo, asTicks(0)),
      anchorMs: optionsRef.current.clock.now(),
    }
    setResult(undefined)
    setAssessedScore(undefined)
    setPhase('running')
    // Fixed tempo, no wait mode, and a clean loop-free run top to bottom
    // (REQ-3.3.4) — a stale loop or wait-mode gate would turn "the piece" into
    // something other than the whole piece.
    optionsRef.current.setWaitModeEnabled(false)
    optionsRef.current.setLoop(undefined)
    optionsRef.current.setTempoScale(1)
    optionsRef.current.play()
  }

  function practiceLoop(loop: SuggestedLoop): void {
    if (assessedScore === undefined || result === undefined) return
    optionsRef.current.setLoop(measureRange(assessedScore, loop.startMeasure, loop.endMeasure))
    optionsRef.current.setTempoScale(suggestedTempoScale(result))
    optionsRef.current.play()
  }

  const problems = useMemo(() => (result === undefined ? [] : problemMeasures(result)), [result])
  const loops = useMemo(
    () => (assessedScore === undefined ? [] : suggestedLoops(assessedScore, problems)),
    [assessedScore, problems],
  )

  return { phase, result, problems, loops, start, practiceLoop }
}
