/**
 * Accuracy-gated level advance for the rhythm reading generator (DR-11),
 * mirroring the piano sight-reading adaptive pattern: look at the last
 * `READING_ADAPT_WINDOW` runs played AT THE CURRENT LEVEL (a run at a
 * different level — e.g. one from before the last level change — tells us
 * nothing about readiness at this level, so it is filtered out rather than
 * counted), and move at most one level in the direction the whole window
 * agrees on. Never skips a level and never leaves 1..7, because a jump would
 * throw the learner at material with no scaffolding under it.
 */
import { invariant } from '@core/shared/invariant.ts'
import { MAX_READING_LEVEL, MIN_READING_LEVEL, type ReadingLevel } from './levels.ts'

export type ReadingRunRecord = {
  readonly level: ReadingLevel
  /** 0..1. */
  readonly accuracy: number
}

/** How many recent same-level runs must agree before the level moves. */
export const READING_ADAPT_WINDOW = 3

/** Below the low end, every run must fall to move down; above the high end, every run must clear to move up. */
export const READING_ADAPT_BAND: readonly [number, number] = [0.6, 0.9]

function clampLevel(level: number): ReadingLevel {
  const clamped = Math.min(MAX_READING_LEVEL, Math.max(MIN_READING_LEVEL, level))
  invariant(
    clamped === 1 || clamped === 2 || clamped === 3 || clamped === 4 || clamped === 5 || clamped === 6 || clamped === 7,
    `clamped level ${clamped} is not a ReadingLevel`,
  )
  return clamped
}

/**
 * Up one level when the last `READING_ADAPT_WINDOW` runs at `current` all
 * exceed `READING_ADAPT_BAND[1]`; down one when all fall below
 * `READING_ADAPT_BAND[0]`; otherwise unchanged. Runs at a level other than
 * `current` do not count towards the window.
 */
export function adaptReadingLevel(
  current: ReadingLevel,
  recent: readonly ReadingRunRecord[],
): ReadingLevel {
  const [low, high] = READING_ADAPT_BAND
  const atCurrent = recent.filter((run) => run.level === current)
  const window = atCurrent.slice(-READING_ADAPT_WINDOW)
  if (window.length < READING_ADAPT_WINDOW) return current

  if (window.every((run) => run.accuracy > high)) return clampLevel(current + 1)
  if (window.every((run) => run.accuracy < low)) return clampLevel(current - 1)
  return current
}
