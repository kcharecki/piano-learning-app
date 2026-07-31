#!/usr/bin/env node
/**
 * Guards the "tests are fast" requirement in automation.
 *
 * A slow suite is a symptom, not just an annoyance: it means something impure
 * (DOM, real timers, IO, a heavyweight fixture) leaked into the domain core.
 * Failing the build here is cheaper than discovering it six months later.
 */
import { spawnSync } from 'node:child_process'

const BUDGET_MS = Number(process.env.CORE_SUITE_BUDGET_MS ?? 10_000)

const started = process.hrtime.bigint()
const result = spawnSync('npx', ['vitest', 'run', '--project', 'core', '--reporter', 'dot'], {
  stdio: 'inherit',
  shell: true,
})
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

if (result.status !== 0) {
  process.stderr.write('\n✗ core suite failed\n')
  process.exit(result.status ?? 1)
}

process.stdout.write(`\ncore suite wall time: ${elapsedMs.toFixed(0)}ms (budget ${BUDGET_MS}ms)\n`)

if (elapsedMs > BUDGET_MS) {
  process.stderr.write(
    `\n✗ core suite took ${elapsedMs.toFixed(0)}ms, over the ${BUDGET_MS}ms budget.\n` +
      `  Something impure or heavyweight has leaked into src/core. Find it rather than raising the budget.\n`,
  )
  process.exit(1)
}

process.stdout.write('✓ fast\n')
