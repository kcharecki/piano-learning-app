import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

const alias = {
  '@core': r('./src/core'),
  '@app': r('./src/app'),
  '@adapters': r('./src/adapters'),
  '@content': r('./src/content'),
  '@test': r('./src/test'),
}

/**
 * Three projects, deliberately split for speed:
 *  - `core`: pure TS domain logic, node environment, no DOM setup cost. This is
 *    the suite that must stay in the low-hundreds of milliseconds and is what
 *    `npm test` runs. Everything important lives here.
 *  - `scripts`: node-environment tests for the repo's own tooling
 *    (scripts/**\/*.test.mjs). These hit the real filesystem/repo (e.g.
 *    orphan-signals.test.mjs's "the real scan" runs four scans over this
 *    actual repo, ~2.8s on its own) so they are split out of `core` to keep
 *    `npm test` fast; they still run under `npm run test:all` / CI via
 *    `npm run test:scripts`. None of these tests use the `toBeCloseToMs`
 *    matcher from `src/test/setup.core.ts`, so no setupFiles are needed here.
 *  - `ui`: React component tests in happy-dom. Slower to boot, so it is a
 *    separate project and only runs in `npm run test:all` / CI.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    restoreMocks: true,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'core',
          globals: true,
          environment: 'node',
          include: [
            'src/core/**/*.test.ts',
            'src/content/**/*.test.ts',
            'src/test/**/*.test.ts',
          ],
          pool: 'threads',
          poolOptions: { threads: { isolate: false, singleThread: false } },
          testTimeout: 5_000,
          setupFiles: ['src/test/setup.core.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'scripts',
          globals: true,
          environment: 'node',
          include: ['scripts/**/*.test.mjs'],
          pool: 'threads',
          poolOptions: { threads: { isolate: false, singleThread: false } },
          testTimeout: 5_000,
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'ui',
          globals: true,
          environment: 'happy-dom',
          include: [
            'src/app/**/*.test.tsx',
            'src/app/**/*.test.ts',
            'src/adapters/**/*.test.ts',
            // Design-system primitives are CSS + structure, so their tests are
            // DOM renders and belong here, not in `core` (roadmap UI-01: the
            // form primitives shipped with 9 render tests that this project
            // silently never ran, because the glob stopped at src/app).
            'src/design-system/**/*.test.tsx',
          ],
          setupFiles: ['src/test/setup.ui.ts'],
          testTimeout: 10_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/core/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', 'src/core/**/types.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
})
