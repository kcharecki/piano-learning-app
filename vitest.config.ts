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
 * Two projects, deliberately split for speed:
 *  - `core`: pure TS domain logic, node environment, no DOM setup cost. This is
 *    the suite that must stay in the low-hundreds of milliseconds and is what
 *    `npm test` runs. Everything important lives here.
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
          include: ['src/core/**/*.test.ts', 'src/test/**/*.test.ts', 'scripts/**/*.test.mjs'],
          pool: 'threads',
          poolOptions: { threads: { isolate: false, singleThread: false } },
          testTimeout: 5_000,
          setupFiles: ['src/test/setup.core.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'ui',
          globals: true,
          environment: 'happy-dom',
          include: ['src/app/**/*.test.tsx', 'src/app/**/*.test.ts', 'src/adapters/**/*.test.ts'],
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
