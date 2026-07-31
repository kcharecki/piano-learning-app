import type { Millis } from '../shared/units.ts'

/**
 * Time source. Injected everywhere so that transport, metronome, matcher and
 * SRS are deterministic under test — the suite advances a FakeClock instead of
 * waiting on real time, which is why there are no sleeps in the test run.
 */
export interface Clock {
  /** Monotonic time since some fixed origin. Never wall-clock. */
  now(): Millis
}

/**
 * Wall-clock date source, separate from `Clock` because they answer different
 * questions: `Clock` is for elapsed time (monotonic, may not be epoch-based),
 * `DateSource` is for "which calendar day is this practice session on".
 */
export interface DateSource {
  /** Milliseconds since the Unix epoch. */
  epochMillis(): number
}

/**
 * Schedules callbacks in the future. The audio adapter uses a look-ahead
 * scheduler on top of this; tests use a fake that fires on demand.
 */
export interface Scheduler {
  /** Run `fn` after `delay` ms. Returns a handle for cancellation. */
  schedule(delayMs: number, fn: () => void): number
  cancel(handle: number): void
}
