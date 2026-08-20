/**
 * Drives `runCli` end to end against a temp ledger file per test (never the real
 * `runs/ledger.ndjson`) and a fake `git` (never shells out to this repo), exercising the
 * frozen contract's gates the way the real `/improve-app` loop would call them. `--now` is
 * always injected, so nothing here touches the real clock either.
 *
 * `--now` is gated behind IMPROVE_RUN_ALLOW_FAKE_CLOCK=1 in the real CLI (see runCli in
 * improve-run.mjs) so a live run can't freeze its own budget clock by passing --now. Every
 * test in this file legitimately needs the fake clock, so it's set once here at module load
 * rather than per test; the one test that exercises the gate itself deletes and restores it.
 */
process.env.IMPROVE_RUN_ALLOW_FAKE_CLOCK = '1'

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
    verifyCommit: () => true,
    showFile: () => "test('spec', () => { expect(1).toBe(1) })",
    ...overrides,
  }
}

/** Moves an injected ISO clock forward by `minutes` without touching the real one. */
const isoAt = (baseIso, minutes) => new Date(Date.parse(baseIso) + minutes * 60_000).toISOString()

function expectExit(result, code) {
  expect(result.exitCode, `expected exit ${code}, got ${result.exitCode}. stderr: ${result.stderr.join('\n')}`).toBe(code)
}

// ---- panel fixtures -------------------------------------------------------------------------
// `panel` computes its template hash from disk (docs/panel/<role>.md in real usage) rather than
// accepting one as a flag — see cmdPanel in improve-run.mjs. AGENTS.md bars real IO in tests
// ("never real time, real randomness, or real IO in a test"), so these fixtures stand in for the
// real docs/panel/ directory via the injectable --panel-dir flag rather than reading or, worse,
// mutating the repo's actual docs/panel/*.md files to simulate drift.

function panelFixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'improve-run-panel-tpl-'))
  for (const role of ['skeptic', 'regression-hunter', 'teacher', 'rival']) {
    writeFileSync(join(dir, `${role}.md`), `# ${role} template v1\n`)
  }
  return dir
}

function panelOutputFile() {
  const dir = mkdtempSync(join(tmpdir(), 'improve-run-panel-out-'))
  const file = join(dir, 'panel-output.md')
  writeFileSync(file, 'panel notes')
  return file
}

function runPanel(ledger, now, git, { round, role, panelDir, file, blockers = 0, majors = 0, minors = 0 }) {
  return runCli(
    ['panel', '--round', String(round), '--role', role, '--file', file, '--panel-dir', panelDir,
      '--blockers', String(blockers), '--majors', String(majors), '--minors', String(minors),
      '--ledger', ledger, '--now', now],
    { git },
  )
}

/** Records a panel event for every Floor seat (skeptic, regression-hunter) at `round` — the
 * minimum `finish` (for any non-abort outcome, at an S-cost/harm=0 pick's Floor tier) requires. */
function floorPanelSweep(ledger, now, git, panelDir, file, round = 1, severities = {}) {
  for (const role of ['skeptic', 'regression-hunter']) {
    expectExit(runPanel(ledger, now, git, { round, role, panelDir, file, ...severities }), 0)
  }
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

  it('records instrument as a first-class, replay-derivable field alongside persona', () => {
    const ledger = tempLedger()
    const git = cleanGit()
    expectExit(runCli(['start', '--ledger', ledger, '--now', '2026-08-20T09:00:00.000Z'], { git }), 0)
    const starts = loadLedger(ledger).filter((e) => e.event === 'start')
    expect(starts[0].instrument).toBe('piano')
    expect(starts[0].persona).toMatch(/PIANO/)
  })

  it('refuses to start when git itself cannot be read (not a repo, or git unavailable) rather than treating that as a clean tree', () => {
    const notARepo = cleanGit({ statusPorcelain: () => null })
    const result = runCli(['start', '--ledger', tempLedger(), '--now', '2026-08-20T09:00:00.000Z'], { git: notARepo })
    expectExit(result, 1)
    expect(result.stderr.join(' ')).toMatch(/does not look like a git repository/)

    const gitDirFails = cleanGit({ gitDir: () => null })
    const result2 = runCli(['start', '--ledger', tempLedger(), '--now', '2026-08-20T09:00:00.000Z'], { git: gitDirFails })
    expectExit(result2, 1)
    expect(result2.stderr.join(' ')).toMatch(/does not look like a git repository/)
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

    runCli(['start', '--ledger', ledger, '--now', now], { git }) // run1: PIANO
    expectExit(
      runCli(['pick', '--source', '1a', '--instrument', 'piano', '--cost', 'M', '--leader-gap', '0', '--harm', '0', '--thread', 'none',
        '--sum', '8', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['start', '--ledger', ledger, '--now', now], { git }) // run2: DRUMS

    const blocked = runCli(
      ['pick', '--source', '1a', '--instrument', 'drums', '--cost', 'M', '--leader-gap', '9', '--harm', '0', '--thread', 'none',
        '--sum', '8', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(blocked, 1)

    expectExit(
      runCli(['pick', '--source', '1a', '--instrument', 'drums', '--cost', 'M', '--leader-gap', '9', '--harm', '1', '--thread', 'none',
        '--sum', '8', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
  })

  it('excuses a repeated source when the previous run left the named thread open', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'

    runCli(['start', '--ledger', ledger, '--now', now], { git }) // run1: PIANO
    runCli(['pick', '--source', '1b', '--instrument', 'piano', '--cost', 'S', '--leader-gap', '9', '--harm', '0', '--thread', 'continuity',
      '--sum', '5', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git })
    expectExit(runCli(['thread', '--slug', 'continuity', '--state', 'open', '--ledger', ledger, '--now', now], { git }), 0)
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['start', '--ledger', ledger, '--now', now], { git }) // run2: DRUMS

    const excused = runCli(
      ['pick', '--source', '1b', '--instrument', 'drums', '--cost', 'S', '--leader-gap', '9', '--harm', '0', '--thread', 'continuity',
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
    runCli(['start', '--ledger', ledger, '--now', now], { git }) // run1: PIANO

    const cases = [
      { cost: 'S', harm: '0', expected: 'Floor' },
      { cost: 'M', harm: '0', expected: 'M' },
      { cost: 'L', harm: '0', expected: 'L' },
      { cost: 'S', harm: '1', expected: 'L' },
    ]
    for (const c of cases) {
      const result = runCli(
        ['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', c.cost, '--leader-gap', '9', '--harm', c.harm,
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

describe('pick — instrument gate', () => {
  it('refuses when --instrument does not match the run persona instrument, and accepts when it does', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git }) // run1: PIANO

    const mismatch = runCli(
      ['pick', '--source', '1a', '--instrument', 'drums', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(mismatch, 1)
    expect(mismatch.stderr.join(' ')).toMatch(/piano/)
    expect(mismatch.stderr.join(' ')).toMatch(/drums/)

    const match = runCli(
      ['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(match, 0)
  })
})

describe('pick — payoff cap', () => {
  it('caps a capless thread at 3 consecutive same-instrument runs, but a --payoff thread with 4 prereqs (cap 5) survives a 4th and 5th, refusing only the 6th', () => {
    const git = cleanGit()
    const sources = ['1a', '1b', '1c', '1d', '1e']

    // Capless thread: cap stays at the default of 3. Runs are pinned to PIANO via `rewind`
    // after each one, so all 4 attempts are same-instrument and directly comparable.
    const capless = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'
    for (let i = 0; i < 3; i++) {
      runCli(['start', '--ledger', capless, '--now', now], { git })
      const result = runCli(
        ['pick', '--source', sources[i], '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
          '--harm', '0', '--thread', 'no-payoff-thread', '--metric', 'm', '--baseline', '1', '--ledger', capless, '--now', now],
        { git },
      )
      expectExit(result, 0)
      now = isoAt(now, 5)
      runCli(['verdict', '--none', '--ledger', capless, '--now', now], { git })
      now = isoAt(now, 5)
      runCli(['rewind', '--reason', 'pin instrument for test', '--ledger', capless, '--now', now], { git })
      now = isoAt(now, 5)
    }
    runCli(['start', '--ledger', capless, '--now', now], { git })
    const fourthCapless = runCli(
      ['pick', '--source', sources[3], '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'no-payoff-thread', '--metric', 'm', '--baseline', '1', '--ledger', capless, '--now', now],
      { git },
    )
    expectExit(fourthCapless, 1)
    expect(fourthCapless.stderr.join(' ')).toMatch(/default cap/)

    // Payoff thread: 4 unshipped prerequisites -> cap 5. 5 consecutive same-instrument runs
    // all succeed; the 6th is refused.
    const payoffLedger = tempLedger()
    now = '2026-08-20T09:00:00.000Z'
    for (let i = 0; i < 5; i++) {
      runCli(['start', '--ledger', payoffLedger, '--now', now], { git })
      const args = ['pick', '--source', sources[i], '--instrument', 'piano', '--sum', '5', '--cost', 'S',
        '--leader-gap', '9', '--harm', '0', '--thread', 'chord-inversions', '--metric', 'm', '--baseline', '1',
        '--ledger', payoffLedger, '--now', now]
      if (i === 0) args.push('--payoff', 'play-ii-V-I-in-C', '--prereqs', '4')
      const result = runCli(args, { git })
      expectExit(result, 0)
      now = isoAt(now, 5)
      runCli(['verdict', '--none', '--ledger', payoffLedger, '--now', now], { git })
      now = isoAt(now, 5)
      runCli(['rewind', '--reason', 'pin instrument for test', '--ledger', payoffLedger, '--now', now], { git })
      now = isoAt(now, 5)
    }
    const picks = loadLedger(payoffLedger).filter((e) => e.event === 'pick')
    expect(picks).toHaveLength(5)
    expect(picks[0].prereqs).toBe(4)

    runCli(['start', '--ledger', payoffLedger, '--now', now], { git })
    const sixth = runCli(
      ['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'chord-inversions', '--metric', 'm', '--baseline', '1', '--ledger', payoffLedger, '--now', now],
      { git },
    )
    expectExit(sixth, 1)
    expect(sixth.stderr.join(' ')).toMatch(/payoff "play-ii-V-I-in-C"/)
  })

  it('refuses a later run of the same thread that re-passes --payoff or --prereqs', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'

    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(
      runCli(['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'scales-in-thirds', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    ) // opened capless (no --payoff)
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['rewind', '--reason', 'pin instrument for test', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['start', '--ledger', ledger, '--now', now], { git })

    const late = runCli(
      ['pick', '--source', '1b', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'scales-in-thirds', '--payoff', 'some-payoff', '--prereqs', '2',
        '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(late, 1)
    expect(late.stderr.join(' ')).toMatch(/must not be re-passed/)
  })
})

describe('pick — instrument-filtered thread streak', () => {
  it('does not let an intervening drums run break or extend a piano thread\'s streak', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'

    // run1: PIANO (index0) — opens the thread with 1 prereq -> cap 2.
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(
      runCli(['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'left-hand-voicings', '--payoff', 'comp-a-ii-V-I', '--prereqs', '1',
        '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)

    // run2: DRUMS (index1) — unrelated pick; must not touch the piano thread's streak.
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(
      runCli(['pick', '--source', '1b', '--instrument', 'drums', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)

    // run3: PIANO (index2) again — 2nd consecutive PIANO pick of the thread (streak 1 -> allowed).
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(
      runCli(['pick', '--source', '1c', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'left-hand-voicings', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)

    // run4: DRUMS (index3) — another unrelated pick.
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(
      runCli(['pick', '--source', '1d', '--instrument', 'drums', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)

    // run5: PIANO (index4) again — this would be the 3rd consecutive PIANO pick of the thread,
    // exceeding cap 2. A naive calendar-adjacency streak would see run4 (drums, no thread)
    // immediately before it and count 0 — this asserts the instrument-filtered count (2, from
    // run1 and run3) is what actually gates it, proving the intervening drums runs were
    // correctly skipped rather than resetting or silently extending the count.
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    const fifth = runCli(
      ['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'left-hand-voicings', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(fifth, 1)
    expect(fifth.stderr.join(' ')).toMatch(/piano/)
  })
})

describe('panel', () => {
  it('exits 1 when round 2\'s docs/panel/<role>.md template has drifted from round 1\'s, and 0 once it matches again', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const file = panelOutputFile()
    const panelDir = mkdtempSync(join(tmpdir(), 'improve-run-panel-tpl-'))
    const templatePath = join(panelDir, 'skeptic.md')
    writeFileSync(templatePath, '# Skeptic v1\n')
    const now = '2026-08-20T09:00:00.000Z'

    runCli(['start', '--ledger', ledger, '--now', now], { git }) // run1: PIANO
    runCli(['pick', '--source', '1a', '--instrument', 'piano', '--cost', 'M', '--leader-gap', '9', '--harm', '0', '--thread', 'none',
      '--sum', '5', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git })

    expectExit(runPanel(ledger, now, git, { round: 1, role: 'skeptic', panelDir, file }), 0)

    // Template drifts between round 1 and round 2 — this is what the round-2 drift check must
    // catch: the sha is recomputed from disk on every call, never retyped by the caller.
    writeFileSync(templatePath, '# Skeptic v2 — reworded\n')
    const drifted = runPanel(ledger, now, git, { round: 2, role: 'skeptic', panelDir, file })
    expectExit(drifted, 1)
    expect(drifted.stderr.join(' ')).toMatch(/template/)

    // Restored to the exact round-1 content — now it's a genuine re-panel.
    writeFileSync(templatePath, '# Skeptic v1\n')
    expectExit(runPanel(ledger, now, git, { round: 2, role: 'skeptic', panelDir, file }), 0)
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

  it('refuses a --sha that does not resolve to a real commit', () => {
    const git = cleanGit({ verifyCommit: () => false })
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    const result = runCli(['slice', '--sha', 'not-a-real-sha', '--ledger', ledger, '--now', now], { git })
    expectExit(result, 1)
    expect(result.stderr.join(' ')).toMatch(/does not resolve to a real commit/)
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

  it('exits 0 silently when the ledger file does not exist yet — same convention as check-improve-log.mjs', () => {
    const git = cleanGit()
    const dir = mkdtempSync(join(tmpdir(), 'improve-run-noledger-'))
    const ledger = join(dir, 'does-not-exist.ndjson')
    const result = runCli(['audit', '--ledger', ledger], { git })
    expectExit(result, 0)
    expect(result.stderr).toEqual([])
  })
})

describe('finish', () => {
  /** A run with every prerequisite `finish` (for a non-abort outcome) now needs EXCEPT
   * mark 8 and the panel sweep: mark 0, an S-cost/harm=0 (Floor tier) pick, a slice, a verdict,
   * and a spec event whose fake git reports HEAD as touching exactly that spec's expected path. */
  function fullySetUpRun() {
    const ledger = tempLedger()
    const panelDir = panelFixtureDir()
    const file = panelOutputFile()
    const now = '2026-08-20T09:00:00.000Z'
    const specId = 'DR-99'
    const git = cleanGit({ headChangedPaths: () => [`e2e/improve-${specId}.spec.ts`] })

    runCli(['start', '--ledger', ledger, '--now', now], { git })
    runCli(['mark', '0', '--ledger', ledger, '--now', now], { git })
    runCli(
      ['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    runCli(['slice', '--sha', 'abc123', '--ledger', ledger, '--now', now], { git })
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    runCli(['spec', '--id', specId, '--red-exit', '1', '--ledger', ledger, '--now', now], { git })

    return { ledger, now, panelDir, file, git }
  }

  it('exits 1 without mark 8, exits 1 while the round-1 panel sweep is missing, and exits 0 once every gate is satisfied', () => {
    const { ledger, now, panelDir, file, git } = fullySetUpRun()

    const early = runCli(['finish', '--outcome', 'clean', '--clean-round', '1', '--ledger', ledger, '--now', now], { git })
    expectExit(early, 1)
    expect(early.stderr.join(' ')).toMatch(/mark 8/)

    runCli(['mark', '8', '--ledger', ledger, '--now', now], { git })

    const stillMissingPanel = runCli(['finish', '--outcome', 'clean', '--clean-round', '1', '--ledger', ledger, '--now', now], { git })
    expectExit(stillMissingPanel, 1)
    expect(stillMissingPanel.stderr.join(' ')).toMatch(/panel round 1 \(skeptic\)/)
    expect(stillMissingPanel.stderr.join(' ')).toMatch(/panel round 1 \(regression-hunter\)/)

    floorPanelSweep(ledger, now, git, panelDir, file, 1)

    expectExit(runCli(['finish', '--outcome', 'clean', '--clean-round', '1', '--ledger', ledger, '--now', now], { git }), 0)
  })

  it('does not require spec, pick, or a panel sweep when the outcome is abort', () => {
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

  // ---- Round 3 Bar: the six-command speedrun (start / mark 0 / slice / mark 8 / verdict /
  // finish --outcome clean) must now be refused — this is the worst of the six adversarial
  // findings: `finish --outcome clean` used to require no panel review at all.
  it('refuses --outcome clean when no panel event exists at all (the six-command speedrun)', () => {
    const { ledger, now, git } = fullySetUpRun()
    runCli(['mark', '8', '--ledger', ledger, '--now', now], { git })

    const result = runCli(['finish', '--outcome', 'clean', '--clean-round', '1', '--ledger', ledger, '--now', now], { git })
    expectExit(result, 1)
    expect(result.stderr.join(' ')).toMatch(/panel round 1 \(skeptic\)/)
    expect(result.stderr.join(' ')).toMatch(/panel round 1 \(regression-hunter\)/)
  })

  it('refuses --outcome clean when a seat at the clean round reports a MAJOR (or a BLOCKER)', () => {
    const { ledger, now, panelDir, file, git } = fullySetUpRun()
    runCli(['mark', '8', '--ledger', ledger, '--now', now], { git })

    expectExit(runPanel(ledger, now, git, { round: 1, role: 'skeptic', panelDir, file, majors: 1 }), 0)
    expectExit(runPanel(ledger, now, git, { round: 1, role: 'regression-hunter', panelDir, file }), 0)

    const result = runCli(['finish', '--outcome', 'clean', '--clean-round', '1', '--ledger', ledger, '--now', now], { git })
    expectExit(result, 1)
    expect(result.stderr.join(' ')).toMatch(/zero BLOCKER and zero MAJOR/)
    expect(result.stderr.join(' ')).toMatch(/skeptic reported 0 blocker\(s\), 1 major\(s\)/)
  })

  it('accepts --outcome shipped-not-clean with only the round-1 sweep, MAJORs and all — no --clean-round required', () => {
    const { ledger, now, panelDir, file, git } = fullySetUpRun()
    runCli(['mark', '8', '--ledger', ledger, '--now', now], { git })
    floorPanelSweep(ledger, now, git, panelDir, file, 1, { majors: 2 }) // ships, just not "clean"

    expectExit(runCli(['finish', '--outcome', 'shipped-not-clean', '--ledger', ledger, '--now', now], { git }), 0)
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

  it('refuses when the named spec file is empty or has no assertion-shaped call at HEAD, even with a matching path and a nonzero --red-exit', () => {
    const now = '2026-08-20T09:00:00.000Z'

    const emptyFile = cleanGit({ headChangedPaths: () => ['e2e/improve-DR-02.spec.ts'], showFile: () => '' })
    const emptyLedger = tempLedger()
    runCli(['start', '--ledger', emptyLedger, '--now', now], { git: emptyFile })
    const empty = runCli(['spec', '--id', 'DR-02', '--red-exit', '1', '--ledger', emptyLedger, '--now', now], { git: emptyFile })
    expectExit(empty, 1)
    expect(empty.stderr.join(' ')).toMatch(/missing, empty, or has no assertion/)

    const noAssertion = cleanGit({
      headChangedPaths: () => ['e2e/improve-DR-02.spec.ts'],
      showFile: () => 'just some prose describing the test, no calls here',
    })
    const noAssertionLedger = tempLedger()
    runCli(['start', '--ledger', noAssertionLedger, '--now', now], { git: noAssertion })
    const noAssertionResult = runCli(['spec', '--id', 'DR-02', '--red-exit', '1', '--ledger', noAssertionLedger, '--now', now], { git: noAssertion })
    expectExit(noAssertionResult, 1)
    expect(noAssertionResult.stderr.join(' ')).toMatch(/missing, empty, or has no assertion/)
  })
})

describe('status', () => {
  it('reports no run before start, and the run state — including instrument, active thread/cap, and prev pick source — after', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const before = runCli(['status', '--ledger', ledger], { git })
    expectExit(before, 0)
    expect(before.stdout.join(' ')).toMatch(/no run in progress/)

    let now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now, '--budget', '100'], { git })
    const afterStart = runCli(['status', '--ledger', ledger, '--now', isoAt(now, 10)], { git })
    expectExit(afterStart, 0)
    const startText = afterStart.stdout.join(' | ')
    expect(startText).toMatch(/elapsed: 10%/)
    expect(startText).toMatch(/instrument: piano/)
    expect(startText).toMatch(/active thread: none/)
    expect(startText).toMatch(/prev pick source: none/)

    runCli(['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
      '--harm', '0', '--thread', 'metronome-drills', '--payoff', 'play-along-track', '--prereqs', '2',
      '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', isoAt(now, 10)], { git })
    const afterPick = runCli(['status', '--ledger', ledger, '--now', isoAt(now, 10)], { git })
    const pickText = afterPick.stdout.join(' | ')
    expect(pickText).toMatch(/active thread: metronome-drills — run 1 of 3/)
    expect(pickText).toMatch(/payoff "play-along-track", 2 prerequisite\(s\)/)
    // Floor tier (S cost, harm 0) — status should now preview the round-1 panel sweep it needs.
    expect(pickText).toMatch(/panel round 1 \(skeptic/)
    expect(pickText).toMatch(/panel round 1 \(regression-hunter/)
  })
})

describe('--now clock gating', () => {
  it('refuses --now unless IMPROVE_RUN_ALLOW_FAKE_CLOCK=1 is set in the environment', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const previous = process.env.IMPROVE_RUN_ALLOW_FAKE_CLOCK
    delete process.env.IMPROVE_RUN_ALLOW_FAKE_CLOCK
    try {
      const result = runCli(['start', '--ledger', ledger, '--now', '2026-08-20T09:00:00.000Z'], { git })
      expectExit(result, 2)
      expect(result.stderr.join(' ')).toMatch(/IMPROVE_RUN_ALLOW_FAKE_CLOCK/)
    } finally {
      if (previous === undefined) delete process.env.IMPROVE_RUN_ALLOW_FAKE_CLOCK
      else process.env.IMPROVE_RUN_ALLOW_FAKE_CLOCK = previous
    }
  })

  it('accepts --now once IMPROVE_RUN_ALLOW_FAKE_CLOCK=1 is set (the default for every other test in this file)', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    expectExit(runCli(['start', '--ledger', ledger, '--now', '2026-08-20T09:00:00.000Z'], { git }), 0)
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
