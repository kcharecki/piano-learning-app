/**
 * The success-gated tempo ladder (DR-10): the standard way rudiments are
 * practiced is not "play it once at a fixed bpm" but "prove it clean at a
 * tempo before the metronome moves" — this module is that state machine,
 * kept independent of any particular rudiment or of how "clean" gets judged
 * (that is the caller's grading logic; this module only reacts to a boolean
 * pass/fail per attempt).
 *
 * `done` is absorbing by design: once a ladder ends (plateau/ceiling/floor/
 * completed) it is a finished record of a practice run, not something a
 * stray extra `recordPass` call should silently resurrect and start moving
 * the bpm on again.
 *
 * Two termination rules are not spelled out letter-for-letter by DR-10's
 * spec and were resolved here as the most internally-consistent reading —
 * flagged rather than silently guessed:
 *  - 'floor': a fail streak always steps bpm down (clamped at `minBpm`), but
 *    that alone never ends the ladder — `failsToPlateau` does. 'floor' fires
 *    only when a pass FAILS while already sitting at `minBpm` (nowhere lower
 *    to retreat to), which is symmetric with 'ceiling' firing when a clean
 *    streak completes while already sitting at `maxBpm`. This can still race
 *    with `failsToPlateau`; plateau is checked first, so a fail that both
 *    completes the plateau streak AND lands at the floor reports 'plateau'.
 *  - 'up-then-down' descent target: the descent stops at `startBpm`, not at
 *    `minBpm` — reaching `startBpm` exactly (never undershooting past it)
 *    ends the ladder as 'completed'. A landing step is shortened below
 *    `stepBpm` rather than overshoot past `startBpm`, same as the ascent
 *    never overshoots past `maxBpm`.
 */

export type LadderMode = 'up' | 'up-then-down'

export type TempoLadderConfig = {
  readonly startBpm: number
  /** Default 5. */
  readonly stepBpm?: number
  /** Default 40. */
  readonly minBpm?: number
  /** Default 200. */
  readonly maxBpm?: number
  /** Default 'up'. */
  readonly mode?: LadderMode
  /** Consecutive clean passes required before a step up. Default 2. */
  readonly passesToAdvance?: number
  /** Consecutive failed passes that end the ladder as a plateau. Default 3. */
  readonly failsToPlateau?: number
}

export type TempoLadderState = {
  readonly bpm: number
  readonly direction: 'up' | 'down'
  readonly cleanStreak: number
  readonly failStreak: number
  /** The PR: highest bpm with a clean pass so far. `undefined` before any clean pass. */
  readonly bestCleanBpm: number | undefined
  readonly history: readonly { readonly bpm: number; readonly clean: boolean }[]
  readonly done: boolean
  readonly reason?: 'plateau' | 'ceiling' | 'floor' | 'completed'
}

const DEFAULT_STEP_BPM = 5
const DEFAULT_MIN_BPM = 40
const DEFAULT_MAX_BPM = 200
const DEFAULT_MODE: LadderMode = 'up'
const DEFAULT_PASSES_TO_ADVANCE = 2
const DEFAULT_FAILS_TO_PLATEAU = 3

function stepBpmOf(config: TempoLadderConfig): number {
  return config.stepBpm ?? DEFAULT_STEP_BPM
}
function minBpmOf(config: TempoLadderConfig): number {
  return config.minBpm ?? DEFAULT_MIN_BPM
}
function maxBpmOf(config: TempoLadderConfig): number {
  return config.maxBpm ?? DEFAULT_MAX_BPM
}
function modeOf(config: TempoLadderConfig): LadderMode {
  return config.mode ?? DEFAULT_MODE
}
function passesToAdvanceOf(config: TempoLadderConfig): number {
  return config.passesToAdvance ?? DEFAULT_PASSES_TO_ADVANCE
}
function failsToPlateauOf(config: TempoLadderConfig): number {
  return config.failsToPlateau ?? DEFAULT_FAILS_TO_PLATEAU
}

function clampBpm(bpm: number, config: TempoLadderConfig): number {
  return Math.min(maxBpmOf(config), Math.max(minBpmOf(config), bpm))
}

export function startLadder(config: TempoLadderConfig): TempoLadderState {
  return {
    bpm: clampBpm(config.startBpm, config),
    direction: 'up',
    cleanStreak: 0,
    failStreak: 0,
    bestCleanBpm: undefined,
    history: [],
    done: false,
  }
}

function bestCleanBpmAfter(
  previousBest: number | undefined,
  bpm: number,
  clean: boolean,
): number | undefined {
  if (!clean) return previousBest
  return previousBest === undefined ? bpm : Math.max(previousBest, bpm)
}

export function recordPass(
  state: TempoLadderState,
  clean: boolean,
  config: TempoLadderConfig,
): TempoLadderState {
  if (state.done) return state

  const history = [...state.history, { bpm: state.bpm, clean }]
  const bestCleanBpm = bestCleanBpmAfter(state.bestCleanBpm, state.bpm, clean)
  const step = stepBpmOf(config)
  const min = minBpmOf(config)
  const max = maxBpmOf(config)
  const base = { ...state, history, bestCleanBpm }

  if (!clean) {
    const failStreak = state.failStreak + 1
    const wasAtFloor = state.bpm <= min
    const bpm = clampBpm(state.bpm - step, config)
    if (failStreak >= failsToPlateauOf(config)) {
      return { ...base, bpm, cleanStreak: 0, failStreak, done: true, reason: 'plateau' }
    }
    if (wasAtFloor) {
      return { ...base, bpm, cleanStreak: 0, failStreak, done: true, reason: 'floor' }
    }
    return { ...base, bpm, cleanStreak: 0, failStreak }
  }

  const cleanStreak = state.cleanStreak + 1
  if (cleanStreak < passesToAdvanceOf(config)) {
    return { ...base, cleanStreak, failStreak: 0 }
  }

  // Streak complete: step the bpm in the current direction and reset it.
  if (state.direction === 'up') {
    if (state.bpm >= max) {
      if (modeOf(config) === 'up') {
        return { ...base, cleanStreak: 0, failStreak: 0, done: true, reason: 'ceiling' }
      }
      // 'up-then-down': flip direction and start stepping down from here.
      return { ...base, direction: 'down', cleanStreak: 0, failStreak: 0 }
    }
    return { ...base, bpm: clampBpm(state.bpm + step, config), cleanStreak: 0, failStreak: 0 }
  }

  // direction === 'down' (only reachable in 'up-then-down' mode) — descend
  // toward startBpm, never past it, ending 'completed' once it is reached.
  const startBpm = clampBpm(config.startBpm, config)
  if (state.bpm <= startBpm) {
    return { ...base, cleanStreak: 0, failStreak: 0, done: true, reason: 'completed' }
  }
  const bpm = Math.max(startBpm, clampBpm(state.bpm - step, config))
  return { ...base, bpm, cleanStreak: 0, failStreak: 0 }
}
