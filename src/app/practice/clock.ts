/**
 * Real wall-clock time for the practice screen (roadmap 1.18) — the one place
 * in `src/app/practice` allowed to touch `performance.now()`. Everywhere else
 * takes a `Clock` port, exactly like the core suite's `FakeClock`, so the
 * transport it drives stays deterministic under test.
 */
import type { Clock } from '@core/ports/index.ts'
import { millis } from '@core/shared/units.ts'

export function createBrowserClock(): Clock {
  return { now: () => millis(performance.now()) }
}
