/**
 * Drives `runCli` end to end against a temp ledger file per test (never the real
 * `runs/ledger.ndjson`) and a fake `git` (never shells out to this repo), exercising the
 * frozen contract's gates the way the real `/improve-app` loop would call them. `--now` is
 * always injected, so nothing here touches the real clock either.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLedger, runCli } from './improve-run.mjs'

function tempLedger() {
  const dir = mkdtempSync(join(tmpdir(), 'improve-run-'))
  return join(dir, 'ledger.ndjson')
}

function cleanGit(overrides = {}) {
  return {
    statusPorcelain: () => '',
    gitDir: () => '/repo/.git',
    gitCommonDir: () => '/repo/.git',
    headSha: () => 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    headChangedPaths: () => [],
    ...overrides,
  }
}

/** Moves an injected ISO clock forward by `minutes` without touching the real one. */
const isoAt = (baseIso, minutes) => new Date(Date.parse(baseIso) + minutes * 60_000).toISOString()

function expectExit(result, code) {
  expect(result.exitCode, `expected exit ${code}, got ${result.exitCode}. stderr: ${result.stderr.join('\n')}`).toBe(code)
}

describe('start', () => {
  it('refuses when the previous run has no verdict event, and succeeds once one is recorded', () => {
    const ledger = tempLedger()
    const git = cleanGit()
    const base = '2026-08-20T09:00:00.000Z'

    expectExit(runCli(['start', '--ledger', ledger, '--now', base, '--budget', '120'], { git }), 0)
    const second = runCli(['start', '--ledger', ledger, '--now', isoAt(base, 5), '--budget', '120'], { git })
    expectExit(second, 1)
    expect(second.stderr.join(' ')).toMatch(/verdict/)

    expectExit(runCli(['verdict', '--none', '--ledger', ledger, '--now', isoAt(base, 6)], { git }), 0)
    expectExit(runCli(['start', '--ledger', ledger, '--now', isoAt(base, 7), '--budget', '120'], { git }), 0)
  })

  it('refuses on a dirty working tree, and when run from a worktree', () => {
    const dirty = cleanGit({ statusPorcelain: () => ' M src/core/foo.ts' })
    expectExit(runCli(['start', '--ledger', tempLedger(), '--now', '2026-08-20T09:00:00.000Z'], { git: dirty }), 1)

    const worktree = cleanGit({
      gitDir: () => '/repo/.claude/worktrees/x/.git',
      gitCommonDir: () => '/repo/.git',
    })
    expectExit(runCli(['start', '--ledger', tempLedger(), '--now', '2026-08-20T09:00:00.000Z'], { git: worktree }), 1)
  })
})

describe('persona rotation', () => {
  it('alternates PIANO/DRUMS across starts, and rewind offsets it so the next start reuses the same persona', () => {
    const ledger = tempLedger()
    const git = cleanGit()
    let now = '2026-08-20T09:00:00.000Z'
    const personas = []

    for (let i = 0; i < 3; i++) {
      expectExit(runCli(['start', '--ledger', ledger, '--now', now], { git }), 0)
      const starts = loadLedger(ledger).filter((e) => e.event === 'start')
      personas.push(starts[starts.length - 1].persona)
      now = isoAt(now, 1)
      expectExit(runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git }), 0)
      now = isoAt(now, 1)
    }

    expect(personas[0]).toMatch(/PIANO/)
    expect(personas[1]).toMatch(/DRUMS/)
    expect(personas[2]).toMatch(/PIANO/)
    expect(personas[0]).not.toBe(personas[2])

    expectExit(runCli(['rewind', '--reason', 'bootstrap correction', '--ledger', ledger, '--now', now], { git }), 0)
    now = isoAt(now, 1)
    expectExit(runCli(['start', '--ledger', ledger, '--now', now], { git }), 0)

    const starts = loadLedger(ledger).filter((e) => e.event === 'start')
    expect(starts[starts.length - 1].persona).toBe(personas[2])
  })
})

describe('mark', () => {
  function startedRun(git, budgetMin = 100) {
    const ledger = tempLedger()
    const base = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', base, '--budget', String(budgetMin)], { git })
    return { ledger, base }
  }

  it('exits 1 for mark 2 past the 25% discovery cap, and passes at 24%', () => {
    const git = cleanGit()

    const pass = startedRun(git)
    expectExit(runCli(['mark', '2', '--ledger', pass.ledger, '--now', isoAt(pass.base, 24)], { git }), 0)

    const fail = startedRun(git)
    expectExit(runCli(['mark', '2', '--ledger', fail.ledger, '--now', isoAt(fail.base, 26)], { git }), 1)
  })

  it('exits 1 at >=60% elapsed with no slice event', () => {
    const git = cleanGit()
    const { ledger, base } = startedRun(git)
    const result = runCli(['mark', '3', '--ledger', ledger, '--now', isoAt(base, 61)], { git })
    expectExit(result, 1)
    expect(result.stderr.join(' ')).toMatch(/ABORT/)
  })
})

describe('pick — repeat-source gate', () => {
  it('refuses repeating the previous run\'s source unless harm=1, leader-gap<=2, or the thread was left open', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'

    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(
      runCli(['pick', '--source', '1a', '--cost', 'M', '--leader-gap', '0', '--harm', '0', '--thread', 'none',
        '--sum', '8', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['start', '--ledger', ledger, '--now', now], { git })

    const blocked = runCli(
      ['pick', '--source', '1a', '--cost', 'M', '--leader-gap', '9', '--harm', '0', '--thread', 'none',
        '--sum', '8', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(blocked, 1)

    expectExit(
      runCli(['pick', '--source', '1a', '--cost', 'M', '--leader-gap', '9', '--harm', '1', '--thread', 'none',
        '--sum', '8', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    expectExit(
      runCli(['pick', '--source', '1a', '--cost', 'M', '--leader-gap', '2', '--harm', '0', '--thread', 'none',
        '--sum', '8', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
  })

  it('excuses a repeated source when the previous run left the named thread open', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'

    runCli(['start', '--ledger', ledger, '--now', now], { git })
    runCli(['pick', '--source', '1b', '--cost', 'S', '--leader-gap', '9', '--harm', '0', '--thread', 'continuity',
      '--sum', '5', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git })
    expectExit(runCli(['thread', '--slug', 'continuity', '--state', 'open', '--ledger', ledger, '--now', now], { git }), 0)
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['start', '--ledger', ledger, '--now', now], { git })

    const excused = runCli(
      ['pick', '--source', '1b', '--cost', 'S', '--leader-gap', '9', '--harm', '0', '--thread', 'continuity',
        '--sum', '5', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(excused, 0)
  })
})

describe('pick — tier derivation', () => {
  it('derives Floor from S, M from M, L from L, and forces L when harm=1', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })

    const cases = [
      { cost: 'S', harm: '0', expected: 'Floor' },
      { cost: 'M', harm: '0', expected: 'M' },
      { cost: 'L', harm: '0', expected: 'L' },
      { cost: 'S', harm: '1', expected: 'L' },
    ]
    for (const c of cases) {
      const result = runCli(
        ['pick', '--source', '1a', '--sum', '5', '--cost', c.cost, '--leader-gap', '9', '--harm', c.harm,
          '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
        { git },
      )
      expectExit(result, 0)
    }

    const tiers = loadLedger(ledger)
      .filter((e) => e.event === 'pick')
      .map((e) => e.tier)
    expect(tiers).toEqual(cases.map((c) => c.expected))
  })
})

describe('thread', () => {
  it('exits 1 when a thread is picked for a 4th consecutive run', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'
    const sources = ['1a', '1b', '1c', '1d']

    for (let i = 0; i < 3; i++) {
      runCli(['start', '--ledger', ledger, '--now', now], { git })
      const pick = runCli(
        ['pick', '--source', sources[i], '--cost', 'S', '--leader-gap', '9', '--harm', '0', '--thread', 'groove-mode',
          '--sum', '5', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
        { git },
      )
      expectExit(pick, 0)
      now = isoAt(now, 5)
      runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
      now = isoAt(now, 5)
    }

    runCli(['start', '--ledger', ledger, '--now', now], { git })
    const fourth = runCli(
      ['pick', '--source', sources[3], '--cost', 'S', '--leader-gap', '9', '--harm', '0', '--thread', 'groove-mode',
        '--sum', '5', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(fourth, 1)
    expect(fourth.stderr.join(' ')).toMatch(/consecutive/)
  })
})

describe('panel', () => {
  it('exits 1 when a re-panel round uses a different --prompt-sha than round 1', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const dir = mkdtempSync(join(tmpdir(), 'improve-run-panel-'))
    const file = join(dir, 'panel-output.md')
    writeFileSync(file, 'panel notes')
    const now = '2026-08-20T09:00:00.000Z'
    const shaA = 'a'.repeat(64)
    const shaB = 'b'.repeat(64)

    runCli(['start', '--ledger', ledger, '--now', now], { git })
    runCli(['pick', '--source', '1a', '--cost', 'M', '--leader-gap', '9', '--harm', '0', '--thread', 'none',
      '--sum', '5', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git })

    expectExit(
      runCli(['panel', '--round', '1', '--role', 'skeptic', '--prompt-sha', shaA, '--file', file, '--ledger', ledger, '--now', now], { git }),
      0,
    )
    expectExit(
      runCli(['panel', '--round', '2', '--role', 'skeptic', '--prompt-sha', shaB, '--file', file, '--ledger', ledger, '--now', now], { git }),
      1,
    )
    expectExit(
      runCli(['panel', '--round', '2', '--role', 'skeptic', '--prompt-sha', shaA, '--file', file, '--ledger', ledger, '--now', now], { git }),
      0,
    )
  })
})

describe('slice', () => {
  it('exits 1 on a second slice event in the same run', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(runCli(['slice', '--sha', 'abc123', '--ledger', ledger, '--now', now], { git }), 0)
    expectExit(runCli(['slice', '--sha', 'def456', '--ledger', ledger, '--now', now], { git }), 1)
  })
})

describe('audit', () => {
  it('exits 0 on a clean ledger and exits 1, naming the line, on a hand-edited one', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })

    expectExit(runCli(['audit', '--ledger', ledger, '--now', now], { git }), 0)

    const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean)
    const startLineIndex = lines.findIndex((l) => JSON.parse(l).event === 'start')
    const tampered = JSON.parse(lines[startLineIndex])
    tampered.persona = 'Someone Else (PIANO)'
    lines[startLineIndex] = JSON.stringify(tampered)
    writeFileSync(ledger, `${lines.join('\n')}\n`)

    const dirty = runCli(['audit', '--ledger', ledger, '--now', now], { git })
    expectExit(dirty, 1)
    expect(dirty.stderr.join(' ')).toMatch(new RegExp(`line ${startLineIndex + 1}`))
  })
})

describe('finish', () => {
  it('exits 1 without mark 8, and exits 0 once every gate is satisfied', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    runCli(['mark', '0', '--ledger', ledger, '--now', now], { git })
    runCli(['slice', '--sha', 'abc123', '--ledger', ledger, '--now', now], { git })
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })

    const early = runCli(['finish', '--outcome', 'clean', '--ledger', ledger, '--now', now], { git })
    expectExit(early, 1)
    expect(early.stderr.join(' ')).toMatch(/mark 8/)

    runCli(['mark', '8', '--ledger', ledger, '--now', now], { git })
    expectExit(runCli(['finish', '--outcome', 'clean', '--ledger', ledger, '--now', now], { git }), 0)
  })

  it('does not require a slice event when the outcome is abort', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    runCli(['mark', '0', '--ledger', ledger, '--now', now], { git })
    runCli(['mark', '8', '--ledger', ledger, '--now', now], { git })
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })

    const result = runCli(['finish', '--outcome', 'abort', '--blocker', 'blocked on X', '--ledger', ledger, '--now', now], { git })
    expectExit(result, 0)
  })
})

describe('spec', () => {
  it('requires HEAD to touch exactly the e2e spec file, with a nonzero --red-exit', () => {
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'

    const wrongPaths = cleanGit({ headChangedPaths: () => ['e2e/improve-DR-01.spec.ts', 'src/app/foo.tsx'] })
    runCli(['start', '--ledger', ledger, '--now', now], { git: wrongPaths })
    expectExit(runCli(['spec', '--id', 'DR-01', '--red-exit', '1', '--ledger', ledger, '--now', now], { git: wrongPaths }), 1)

    const rightPath = cleanGit({ headChangedPaths: () => ['e2e/improve-DR-01.spec.ts'] })
    expectExit(runCli(['spec', '--id', 'DR-01', '--red-exit', '0', '--ledger', ledger, '--now', now], { git: rightPath }), 1)
    expectExit(runCli(['spec', '--id', 'DR-01', '--red-exit', '1', '--ledger', ledger, '--now', now], { git: rightPath }), 0)
  })
})

describe('status', () => {
  it('reports no run before start, and the run state after', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const before = runCli(['status', '--ledger', ledger], { git })
    expectExit(before, 0)
    expect(before.stdout.join(' ')).toMatch(/no run in progress/)

    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now, '--budget', '100'], { git })
    const after = runCli(['status', '--ledger', ledger, '--now', isoAt(now, 10)], { git })
    expectExit(after, 0)
    expect(after.stdout.join(' ')).toMatch(/elapsed: 10%/)
  })
})

describe('usage errors', () => {
  it('exits 2 for an unknown subcommand and for a missing required flag', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    expectExit(runCli(['bogus'], { git }), 2)
    runCli(['start', '--ledger', ledger, '--now', '2026-08-20T09:00:00.000Z'], { git })
    expectExit(runCli(['slice', '--ledger', ledger, '--now', '2026-08-20T09:00:00.000Z'], { git }), 2)
  })
})
