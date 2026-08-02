/**
 * Tempo ramping (roadmap 2.27, REQ-3.9.1: "+2 BPM per clean repetition"),
 * wired to the practice screen. `startRamp`/`advanceRamp` in
 * `@core/timing/metronome.ts` own the actual ramp arithmetic — banking clean
 * repetitions, stepping the tempo, stopping at the target — this hook only
 * holds the settings + `RampState` as one unit, feeds it repetitions as the
 * learner plays, and translates `currentBpm` into the `tempoScale` multiplier
 * the practice screen already understands (REQ-3.2.2): `tempoScale =
 * currentBpm / writtenBpm`, clamped exactly the way `scoreStore.setTempoScale`
 * clamps a manual slider move, so a ramp can never push the transport outside
 * the range the rest of the app enforces.
 *
 * A FAILED repetition does not lower the tempo — `advanceRamp` itself only
 * resets the clean-repetition counter on failure and never decreases
 * `currentBpm` — because punishing one bad pass by dropping the learner back
 * down a rung is the obvious wrong behaviour for a drill whose whole point is
 * "earn the next notch, keep what you already earned".
 */
import { useCallback, useState } from 'react'
import {
  advanceRamp,
  startRamp,
  type RampSettings,
  type RampState,
} from '@core/timing/metronome.ts'
import { clampScale } from '@core/timing/tempo.ts'
import type { Bpm } from '@core/shared/units.ts'

type Internal = {
  readonly settings: RampSettings
  readonly state: RampState
}

export type TempoRamp = {
  /** Whether a ramp is currently running (started, not stopped, not yet done). */
  readonly enabled: boolean
  readonly state: RampState | undefined
  /**
   * Multiplier on the score's WRITTEN tempo that plays the ramp's current
   * bpm, clamped the same way the tempo slider is. `undefined` while no ramp
   * is running or the score's written bpm is not yet known.
   */
  readonly tempoScale: number | undefined
  /**
   * The bpm the transport is actually playing at once `tempoScale` has been
   * clamped — may fall short of `state.currentBpm` when the ramp's target
   * asks for a scale outside `MIN_TEMPO_SCALE..MAX_TEMPO_SCALE`.
   */
  readonly effectiveBpm: number | undefined
  /**
   * The bpm the next completed rung will reach, computed from the settings
   * banked at `start()` — never from live, possibly-since-edited props.
   * `undefined` while no ramp is running or the ramp is already done.
   */
  readonly nextBpm: number | undefined
  /** Clean repetitions needed per rung, banked at `start()`. */
  readonly repsPerStep: number | undefined
  start(settings: RampSettings): void
  /** Fold one repetition into the ramp. A clean pass may raise the tempo; a failed one never lowers it. */
  reportRepetition(clean: boolean): void
  stop(): void
}

export function useTempoRamp(writtenBpm: Bpm | undefined): TempoRamp {
  const [internal, setInternal] = useState<Internal | undefined>(undefined)

  const start = useCallback((settings: RampSettings) => {
    setInternal({ settings, state: startRamp(settings) })
  }, [])

  const stop = useCallback(() => {
    setInternal(undefined)
  }, [])

  const reportRepetition = useCallback((clean: boolean) => {
    setInternal((current) =>
      current === undefined
        ? current
        : { settings: current.settings, state: advanceRamp(current.settings, current.state, clean) },
    )
  }, [])

  const state = internal?.state
  const settings = internal?.settings

  const tempoScale =
    state !== undefined && writtenBpm !== undefined && writtenBpm > 0
      ? clampScale(state.currentBpm / writtenBpm)
      : undefined

  const effectiveBpm =
    tempoScale !== undefined && writtenBpm !== undefined ? tempoScale * writtenBpm : undefined

  const nextBpm =
    state !== undefined && settings !== undefined && !state.done
      ? advanceRamp(
          settings,
          { ...state, repsAtCurrent: settings.repsPerStep - 1 },
          true,
        ).currentBpm
      : undefined

  return {
    enabled: state !== undefined && !state.done,
    state,
    tempoScale,
    effectiveBpm,
    nextBpm,
    repsPerStep: settings?.repsPerStep,
    start,
    reportRepetition,
    stop,
  }
}
