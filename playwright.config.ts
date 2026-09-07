import { defineConfig, devices } from '@playwright/test'

/**
 * E2E is intentionally a thin smoke layer — a handful of specs that prove the
 * app boots and the main screens wire up. All behavioural depth lives in the
 * fast `core` vitest suite. Do not grow this into the main test strategy.
 *
 * E2E_PORT exists for parallel worktree sessions (docs/WORKTREES.md): each
 * session runs its own dev server on its own port, so `reuseExistingServer`
 * can never latch onto ANOTHER session's server and test the wrong checkout.
 * `--strictPort` makes vite fail loudly instead of silently bumping to a
 * port nothing is watching.
 *
 * E2E_GATE is `scripts/e2e-gate.mjs` (roadmap T.18) saying "this run is the
 * commit gate", which changes two defaults:
 *
 *  - **no server reuse.** Reuse is fine for a session iterating on one spec
 *    against its own server; it is not fine for the gate, which has to grade
 *    THIS tree. Run 2026-08-21-1's first RED check reported "4 passed" at a
 *    commit where the screen did not exist, because a stale server on 5173
 *    was still serving the tree it was started in.
 *  - **one retry.** Not to be lenient: a claim spec that is red, or a spec
 *    pinned to copy that changed, fails every attempt, so retries cost the
 *    gate nothing against what it exists to catch. What they buy is trust.
 *    Two specs here assert on wall-clock behaviour (`rhythm-live-feedback`
 *    taps 90ms off a beat; `osmd-teardown` engraves a large score for 45s),
 *    and under 12 parallel workers on a developer machine each one failed
 *    once in three full runs and passed 3/3 when run alone. A gate that goes
 *    red one commit in three is a gate somebody switches off. The retry is
 *    visible: `e2e-gate.mjs` prints every test that needed one.
 */
const port = Number(process.env.E2E_PORT ?? 5173)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : process.env.E2E_GATE ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI && !process.env.E2E_GATE,
    timeout: 120_000,
  },
})
