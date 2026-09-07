#!/usr/bin/env node
/**
 * The e2e step `npm run verify` never had (roadmap T.18).
 *
 * `verify` was `check:* && typecheck && lint && test:all`, and Playwright ran
 * only under `verify:full`, which sessions run once — so a claim spec that is
 * RED passes the commit gate. Run 2026-08-21-1 committed with
 * `e2e/improve-DR-09.spec.ts` failing 3 of 4 under 4860 green tests. Run
 * 2026-08-24-1 changed two feedback strings and shipped over two e2e specs
 * pinned to the old wording; they were fixed two commits later. "Tests green,
 * feature dead in the browser" is the failure mode this whole process exists
 * to stop, and the suite that could see it was outside the gate.
 *
 * Two things have to be true at once, which is why this is a script and not
 * one more `&&` in package.json:
 *
 * 1. **A spec that fails must turn the gate red.** Not "red unless a dev
 *    server on 5173 happens to be serving some other checkout" — that trap
 *    cost run 2026-08-21-1 a RED check that reported "4 passed" at a commit
 *    where the screen did not exist. So the gate takes a free port of its own
 *    and forbids server reuse (`E2E_GATE`), whatever is listening on 5173.
 * 2. **A spec that is red ON PURPOSE must not.** This project commits claim
 *    specs before the feature, and T.17 left two of them red for weeks. A gate
 *    that cannot say "expected red until DR-09 lands" gets switched off the
 *    first time it is inconvenient, so the expectation is DATA
 *    (`e2e/expected-red.json`), read by the gate, not a comment in a file.
 *
 * The registry is deliberately hostile to being used as a mute button:
 *  - an entry that stops failing is a failure ("it passes now — tick the row"),
 *    so a landed feature cannot leave a dead exemption behind;
 *  - an entry naming a spec file that does not exist is a failure;
 *  - an entry must cite a roadmap id that is an OPEN box in `ROADMAP.md`, so a
 *    failing spec cannot be parked against work that is already claimed done.
 *
 *   node scripts/e2e-gate.mjs [--registry <path>] [--report <path>] [-- <playwright args>]
 *
 * `--report` evaluates an existing Playwright JSON report instead of running
 * the suite; it is how this script's own proof re-checks a recorded run.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_REGISTRY = 'e2e/expected-red.json'

/**
 * Playwright's JSON report nests suites by file and by describe block. Flatten
 * it to the only thing the gate reasons about: one row per test, carrying the
 * spec file it lives in and whether it passed.
 *
 * `status` on a spec's test is Playwright's own vocabulary: `expected` (passed,
 * or failed a test marked `fail`), `unexpected` (failed every attempt),
 * `flaky` (failed, then passed on the retry the gate grants), `skipped`.
 *
 * Flaky is NOT failed. The gate exists to catch a spec that is red — a claim
 * spec ahead of its feature, a spec pinned to copy that changed — and those
 * fail every attempt. What flaky catches here is a developer machine running
 * twelve browsers at once under two wall-clock specs; calling that red would
 * make the gate go red about one commit in three, which is how gates get
 * switched off. So it is reported, by name, and does not fail the run.
 *
 * @param {unknown} report
 * @returns {Array<{spec: string, title: string, failed: boolean, flaky: boolean, skipped: boolean}>}
 */
export function flattenReport(report) {
  /** @type {Array<{spec: string, title: string, failed: boolean, flaky: boolean, skipped: boolean}>} */
  const rows = []
  /** @param {any} suite */
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        rows.push({
          spec: basename(String(spec.file ?? suite.file ?? '')),
          title: String(spec.title ?? ''),
          failed: test.status === 'unexpected',
          flaky: test.status === 'flaky',
          skipped: test.status === 'skipped',
        })
      }
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of /** @type {any} */ (report)?.suites ?? []) walk(suite)
  return rows
}

/**
 * The whole verdict as a function of three inputs, so every arm is testable
 * without a browser, a dev server or a git tree.
 *
 * @param {{
 *   results: ReadonlyArray<{spec: string, title: string, failed: boolean, flaky?: boolean, skipped: boolean}>,
 *   entries: readonly unknown[],
 *   specFiles: readonly string[],
 *   openRoadmapIds: readonly string[],
 *   scoped?: boolean,
 * }} input
 * @returns {{ok: boolean, problems: string[], expectedRed: number}}
 */
export function e2eGateVerdict({ results, entries, specFiles, openRoadmapIds, scoped = false }) {
  /** @type {string[]} */
  const problems = []
  const known = new Set(specFiles.map((f) => basename(f)))

  /** @type {Array<{spec: string, test: string, roadmap: string}>} */
  const valid = []
  entries.forEach((raw, i) => {
    const e = /** @type {any} */ (raw)
    const where = `expected-red[${i}]`
    const spec = typeof e?.spec === 'string' ? basename(e.spec) : ''
    if (spec === '') {
      problems.push(`${where}: needs a "spec" naming the spec file that is red.`)
      return
    }
    if (typeof e?.test !== 'string' || e.test === '') {
      problems.push(`${where} (${spec}): needs a "test" — the exact test title, or "*" for the whole file.`)
      return
    }
    if (typeof e?.roadmap !== 'string' || e.roadmap === '') {
      problems.push(`${where} (${spec}): needs a "roadmap" id, so the red spec points at the work that closes it.`)
      return
    }
    if (typeof e?.reason !== 'string' || e.reason.trim().length < 20) {
      problems.push(`${where} (${spec}): needs a "reason" of at least 20 characters saying why it is red on purpose.`)
      return
    }
    if (!known.has(spec)) {
      problems.push(`${where}: "${spec}" is not a spec file — the exemption outlived the spec; delete it.`)
      return
    }
    if (!openRoadmapIds.includes(e.roadmap)) {
      problems.push(
        `${where} (${spec}): roadmap ${e.roadmap} is not an open box in ROADMAP.md. ` +
          'A spec cannot be red on purpose against work nobody owes.',
      )
      return
    }
    valid.push({ spec, test: e.test, roadmap: e.roadmap })
  })

  const matches = (entry, row) => entry.spec === row.spec && (entry.test === '*' || entry.test === row.title)

  for (const row of results) {
    if (!row.failed) continue
    if (valid.some((entry) => matches(entry, row))) continue
    problems.push(`FAILED: ${row.spec} › ${row.title}`)
  }

  for (const entry of valid) {
    const covered = results.filter((row) => matches(entry, row))
    if (covered.length === 0) {
      // A run scoped to one spec (`-- e2e/foo.spec.ts`) legitimately contains
      // none of the others, so only the full-suite gate can conclude anything
      // from an entry matching nothing.
      if (scoped) continue
      problems.push(
        `expected-red ${entry.spec} › ${entry.test} matched no test in this run — ` +
          'the title changed, or the test was deleted.',
      )
      continue
    }
    if (!covered.some((row) => row.failed)) {
      problems.push(
        `expected-red ${entry.spec} › ${entry.test} PASSES now (roadmap ${entry.roadmap}). ` +
          'Tick the row and delete the entry — an exemption nobody needs is one nobody re-reads.',
      )
    }
  }

  return { ok: problems.length === 0, problems, expectedRed: valid.length }
}

/**
 * Roadmap ids with an unchecked box, in the file's own `- [ ] ID **…**` shape.
 * The id is the first token after the box and the shapes vary — `T.30`,
 * `DR-09`, `U.3`, `5.53`, `REQ-3.6.1` — so this takes the token and keeps the
 * ones carrying a digit, rather than guessing a pattern the roadmap never
 * agreed to.
 */
export function openRoadmapIdsFrom(markdown) {
  return [...markdown.matchAll(/^- \[ \] (\S+)/gm)].map((m) => m[1]).filter((id) => /\d/.test(id))
}

/** A port nothing else holds, so a stale server can never grade the wrong tree. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => (port === 0 ? reject(new Error('no free port')) : resolvePort(port)))
    })
  })
}

function specFilesIn(dir) {
  if (!existsSync(dir)) return []
  return spawnSync('git', ['ls-files', '--', `${dir}/*.spec.ts`], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean)
}

async function main() {
  const argv = process.argv.slice(2)
  let registryPath = DEFAULT_REGISTRY
  let reportPath = ''
  /** @type {string[]} */
  let passthrough = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--registry' && argv[i + 1]) registryPath = argv[++i]
    else if (argv[i] === '--report' && argv[i + 1]) reportPath = argv[++i]
    else if (argv[i] === '--') {
      passthrough = argv.slice(i + 1)
      break
    } else {
      console.error('usage: node scripts/e2e-gate.mjs [--registry <path>] [--report <path>] [-- <playwright args>]')
      process.exit(2)
      return
    }
  }

  /** @type {unknown[]} */
  let entries = []
  const registryFile = resolve(process.cwd(), registryPath)
  if (existsSync(registryFile)) {
    try {
      const parsed = JSON.parse(readFileSync(registryFile, 'utf8'))
      entries = Array.isArray(parsed?.expectedRed) ? parsed.expectedRed : []
    } catch (err) {
      console.error(`${registryPath} is not readable JSON: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
      return
    }
  }

  let tempDir = ''
  let jsonFile = reportPath
  let ranOutput = ''
  if (reportPath === '') {
    tempDir = mkdtempSync(join(tmpdir(), 'e2e-gate-'))
    jsonFile = join(tempDir, 'report.json')
    const port = process.env.E2E_PORT ?? String(await freePort())
    process.stdout.write(`e2e gate: playwright on port ${port}, no server reuse, one retry\n`)
    const run = spawnSync(
      process.execPath,
      [resolve('node_modules/@playwright/test/cli.js'), 'test', '--reporter=json', ...passthrough],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          E2E_PORT: port,
          E2E_GATE: '1',
          PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
        },
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    ranOutput = `${run.stdout ?? ''}${run.stderr ?? ''}`
  }

  /** @type {unknown} */
  let report
  try {
    report = JSON.parse(readFileSync(jsonFile, 'utf8'))
  } catch {
    console.error('e2e gate: playwright produced no JSON report — the run itself failed.')
    if (ranOutput !== '') console.error(ranOutput.slice(-4000))
    if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true })
    process.exit(1)
    return
  }
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true })

  const results = flattenReport(report)
  const roadmapFile = resolve(process.cwd(), 'ROADMAP.md')
  const verdict = e2eGateVerdict({
    results,
    entries,
    specFiles: specFilesIn('e2e'),
    openRoadmapIds: existsSync(roadmapFile) ? openRoadmapIdsFrom(readFileSync(roadmapFile, 'utf8')) : [],
    scoped: passthrough.length > 0,
  })

  const ran = results.filter((r) => !r.skipped).length
  for (const row of results.filter((r) => r.flaky)) {
    process.stdout.write(`e2e gate: flaky — ${row.spec} › ${row.title} failed once and passed on the retry.\n`)
  }
  if (!verdict.ok) {
    console.error(`e2e gate: RED — ${verdict.problems.length} problem(s) over ${ran} test(s).`)
    for (const problem of verdict.problems) console.error(`  ${problem}`)
    console.error('  Expected-red specs are declared in e2e/expected-red.json, never in a comment.')
    process.exit(1)
    return
  }
  process.stdout.write(`e2e gate: ok — ${ran} test(s), ${verdict.expectedRed} expected-red.\n`)
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) main()
