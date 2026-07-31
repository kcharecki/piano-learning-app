/**
 * Core suite setup. Deliberately near-empty: the core suite runs in `node` with
 * no DOM, and anything expensive added here is paid on every run. If you need
 * heavyweight setup, that is a signal the code under test is not pure enough.
 */
import { expect } from 'vitest'

expect.extend({
  toBeCloseToMs(received: number, expected: number, toleranceMs = 1) {
    const pass = Math.abs(received - expected) <= toleranceMs
    return {
      pass,
      message: () =>
        `expected ${received}ms ${pass ? 'not ' : ''}to be within ${toleranceMs}ms of ${expected}ms`,
    }
  },
})

declare module 'vitest' {
  interface Matchers<T = any> {
    toBeCloseToMs(expected: number, toleranceMs?: number): T
  }
}
