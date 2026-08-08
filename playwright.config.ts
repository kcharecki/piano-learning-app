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
 */
const port = Number(process.env.E2E_PORT ?? 5173)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
