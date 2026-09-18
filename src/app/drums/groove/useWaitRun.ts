/**
 * Wait mode's run (roadmap DR-09 "wait mode"): no clock, no click track, no
 * grading, mounted alongside `useGrooveRun` rather than replacing it — the
 * screen picks whichever hook's `start`/`stop`/`hit` the Wait switch selects.
 *
 * The playhead is `@core/drums/practice/wait.ts`'s own state machine
 * (`WaitStep`/`WaitState`/`applyWaitHit`); this hook is the thin React shell
 * around it, mirroring `useGrooveRun`'s own `withAudio` best-effort discipline
 * — a stroke always sounds and flashes even if the audio device throws — and
 * its lazy, injectable `DrumAudioOutput` factory.
 *
 * `HIT_VELOCITY` in `useGrooveRun.ts` is not exported (it is a private
 * module constant there), so this hook defines its own copy, `WAIT_HIT_VELOCITY`,
 * at the same value (96) rather than reach into that module's internals.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { createDrumAudioOutput } from '@adapters/audio/drumAudio.ts'
import type { MappedDrumPad } from '@core/drums/model/pad.ts'
import {
  applyWaitHit,
  INITIAL_WAIT_STATE,
  waitSteps,
  type WaitHitOutcome,
  type WaitState,
  type WaitStep,
} from '@core/drums/practice/wait.ts'
import type { GrooveRunPlan } from '@core/drums/practice/plan.ts'
import type { DrumAudioOutput } from '@core/ports/index.ts'
import type { PadFlash } from './useGrooveRun.ts'

/** See the module comment: `useGrooveRun.ts`'s own `HIT_VELOCITY` is not exported. */
const WAIT_HIT_VELOCITY = 96

export type WaitRunPhase = 'idle' | 'waiting' | 'done'

export type UseWaitRunOptions = {
  readonly plan: GrooveRunPlan
  /** Test seam; defaults to the same lazy synth `useGrooveRun` builds. */
  readonly audio?: () => DrumAudioOutput
}

export type WaitRunApi = {
  readonly phase: WaitRunPhase
  readonly steps: readonly WaitStep[]
  readonly state: WaitState
  /** Outcome of the most recent hit during a wait run, undefined until one lands; cleared by start(). */
  readonly lastOutcome: WaitHitOutcome | undefined
  readonly flash: PadFlash | undefined
  start: () => void
  stop: () => void
  hit: (pad: MappedDrumPad) => void
}

export function useWaitRun(options: UseWaitRunOptions): WaitRunApi {
  const { plan } = options
  const audioFactory = options.audio ?? createDrumAudioOutput
  const audioRef = useRef<DrumAudioOutput | undefined>(undefined)

  const steps = useMemo(() => waitSteps(plan), [plan])
  const stepsRef = useRef<readonly WaitStep[]>(steps)
  stepsRef.current = steps

  const [phase, setPhase] = useState<WaitRunPhase>('idle')
  const [state, setState] = useState<WaitState>(INITIAL_WAIT_STATE)
  const [lastOutcome, setLastOutcome] = useState<WaitHitOutcome | undefined>(undefined)
  const [flash, setFlash] = useState<PadFlash | undefined>(undefined)

  const phaseRef = useRef<WaitRunPhase>('idle')
  const stateRef = useRef<WaitState>(INITIAL_WAIT_STATE)
  const seqRef = useRef(0)

  // A plan change resets to idle regardless of the current phase — the same
  // discipline `useGrooveRun` uses for a groove change during render, so
  // there is no committed frame in which the run is still walking steps (or
  // sitting at "done") for a plan the screen has already moved on from.
  const [seenPlan, setSeenPlan] = useState(plan)
  if (plan !== seenPlan) {
    setSeenPlan(plan)
    phaseRef.current = 'idle'
    stateRef.current = INITIAL_WAIT_STATE
    setPhase('idle')
    setState(INITIAL_WAIT_STATE)
  }

  const withAudio = useCallback(
    (use: (out: DrumAudioOutput) => void): void => {
      try {
        if (audioRef.current === undefined) audioRef.current = audioFactory()
        use(audioRef.current)
      } catch {
        // Best-effort by design — see the module comment.
      }
    },
    [audioFactory],
  )

  const start = useCallback((): void => {
    stateRef.current = INITIAL_WAIT_STATE
    setState(INITIAL_WAIT_STATE)
    setLastOutcome(undefined)
    const nextPhase: WaitRunPhase = stepsRef.current.length === 0 ? 'done' : 'waiting'
    phaseRef.current = nextPhase
    setPhase(nextPhase)
  }, [])

  const stop = useCallback((): void => {
    phaseRef.current = 'idle'
    stateRef.current = INITIAL_WAIT_STATE
    setPhase('idle')
    setState(INITIAL_WAIT_STATE)
    setLastOutcome(undefined)
  }, [])

  const hit = useCallback(
    (pad: MappedDrumPad): void => {
      seqRef.current += 1
      setFlash({ pad, seq: seqRef.current })
      // A stroke on any pad always sounds and flashes — required, extra or
      // outside a run, exactly like `useGrooveRun.hit`'s own unconditional
      // `sound()` call.
      withAudio((out) => out.strike(pad, WAIT_HIT_VELOCITY))

      // Outside a run entirely (`idle`), a stroke is inert start to finish —
      // it must not arm the state machine at INITIAL_WAIT_STATE. Once the run
      // is `done`, `applyWaitHit` is still called: `stateRef.current` is
      // already at `steps.length`, so it is a pure no-op that reports the
      // `'done'` outcome rather than silently freezing `lastOutcome` at
      // whatever the completing hit last said.
      if (phaseRef.current === 'idle') return
      const applied = applyWaitHit(stepsRef.current, stateRef.current, pad)
      stateRef.current = applied.state
      setState(applied.state)
      setLastOutcome(applied.outcome)
      if (applied.state.stepIndex >= stepsRef.current.length) {
        phaseRef.current = 'done'
        setPhase('done')
      }
    },
    [withAudio],
  )

  return { phase, steps, state, lastOutcome, flash, start, stop, hit }
}
