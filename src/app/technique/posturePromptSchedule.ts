/**
 * Roadmap 5.23 — the pure "is a posture check due?" decision for the
 * Technique screen. Kept as its own module, outside `useTechniqueDrill`, so
 * the schedule can carry property tests without a component, a real Clock,
 * or the hook's other wiring.
 *
 * ## The schedule
 *
 * Due when EITHER of two counters, tracked since the learner last
 * acknowledged the prompt, crosses its threshold:
 *
 *  - `runningMsSincePrompt` — cumulative wall time (via the injected
 *    `Clock`, summed across `start()`→`stop()` runs by the hook) the drill
 *    has actually been running, reaches `POSTURE_PROMPT_RUNNING_MS`.
 *  - `attemptsSincePrompt` — completed, scored attempts reach
 *    `POSTURE_PROMPT_ATTEMPT_COUNT`.
 *
 * Both counters reset together on acknowledgement.
 *
 * ## Why two signals, not one
 *
 * The two mechanisms the roadmap task names from the Taubman/Golandsky
 * literature fail differently:
 *
 *  - Sustained static tension (a dropped/braced wrist held rigid) builds
 *    with elapsed TIME under the position, even across one single long run
 *    that never produces a second "attempt" — a rep-count trigger alone
 *    would never fire for a learner who starts a drill and simply keeps
 *    playing.
 *  - Isolated finger motion (the fingers doing all the work, wrist and
 *    forearm uninvolved) builds with REPETITIONS — a learner who fires off
 *    many short, fast attempts back to back racks up reps quickly without
 *    ever crossing a wall-clock threshold.
 *
 * Either alone misses one failure mode, so either threshold reached is
 * sufficient to interrupt.
 *
 * ## Why not a short, fixed wall-clock timer (rejected)
 *
 * The roadmap task calls this out directly: a prompt on a short interval
 * (e.g. every 20s) fires during ordinary picker/setup time — reading the
 * drill list, adjusting tempo, waiting for a MIDI device — training the
 * learner to dismiss it by reflex before technique is even a factor. Gating
 * on RUNNING time only, at a threshold long enough to represent real
 * accumulated repetition (ten minutes of actual drilling, or six completed
 * attempts — a handful of real reps, not one), keeps the prompt meaningful
 * rather than habitual.
 */

export type PostureScheduleState = {
  /** Cumulative ms the drill has spent running since the last acknowledgement. */
  readonly runningMsSincePrompt: number
  /** Completed, scored attempts since the last acknowledgement. */
  readonly attemptsSincePrompt: number
}

/** Ten minutes of actual drilling time — see the module comment. */
export const POSTURE_PROMPT_RUNNING_MS = 10 * 60 * 1000

/** Six completed attempts — see the module comment. */
export const POSTURE_PROMPT_ATTEMPT_COUNT = 6

export const INITIAL_POSTURE_SCHEDULE_STATE: PostureScheduleState = {
  runningMsSincePrompt: 0,
  attemptsSincePrompt: 0,
}

/** Credit elapsed running time toward the schedule. `ms` must be >= 0. */
export function addRunningTime(state: PostureScheduleState, ms: number): PostureScheduleState {
  if (ms <= 0) return state
  return { ...state, runningMsSincePrompt: state.runningMsSincePrompt + ms }
}

/** Credit one completed, scored attempt toward the schedule. */
export function addAttempt(state: PostureScheduleState): PostureScheduleState {
  return { ...state, attemptsSincePrompt: state.attemptsSincePrompt + 1 }
}

/** The learner confirmed a human check — both counters restart from zero. */
export function acknowledgePrompt(): PostureScheduleState {
  return INITIAL_POSTURE_SCHEDULE_STATE
}

export function isPosturePromptDue(state: PostureScheduleState): boolean {
  return (
    state.runningMsSincePrompt >= POSTURE_PROMPT_RUNNING_MS ||
    state.attemptsSincePrompt >= POSTURE_PROMPT_ATTEMPT_COUNT
  )
}
