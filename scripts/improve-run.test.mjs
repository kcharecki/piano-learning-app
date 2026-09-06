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

  it('does not demand a verdict from a rewound run, and takes prevPickSource from the last live one', () => {
    // A rewound run never reaches section 8, so it records no verdict and no pick. Before this,
    // `start` asked the run at the tip for a verdict it could never have owed, and `rewind`
    // cannot go back and supply one -- so an interrupted run deadlocked every later run.
    const ledger = tempLedger()
    const git = cleanGit()
    const base = '2026-08-20T09:00:00.000Z'

    expectExit(runCli(['start', '--ledger', ledger, '--now', base, '--budget', '120'], { git }), 0)
    expectExit(
      runCli(
        ['pick', '--source', '1d', '--instrument', 'piano', '--class', 'VOID', '--sum', '10',
          '--cost', 'L', '--leader-gap', '2', '--harm', '0', '--thread', 'none',
          '--metric', 'x.y', '--baseline', '0', '--ledger', ledger, '--now', isoAt(base, 1)],
        { git },
      ),
      0,
    )
    expectExit(runCli(['verdict', '--none', '--ledger', ledger, '--now', isoAt(base, 2)], { git }), 0)

    // Second run starts, then dies mid-discovery: no pick, no verdict, then a rewind.
    expectExit(runCli(['start', '--ledger', ledger, '--now', isoAt(base, 3), '--budget', '120'], { git }), 0)
    expectExit(runCli(['rewind', '--reason', 'session interrupted', '--ledger', ledger, '--now', isoAt(base, 4)], { git }), 0)

    const third = runCli(['start', '--ledger', ledger, '--now', isoAt(base, 5), '--budget', '120'], { git })
    expectExit(third, 0)

    const starts = loadLedger(ledger).filter((e) => e.event === 'start')
    // The rewound run had no pick, so a naive `currentRunId` walk would report "none" and
    // silently switch the source-rotation rule off for the run that follows an interruption.
    expect(starts[starts.length - 1].prevPickSource).toBe('1d')
    // The rewind gave the persona back, so run 3 replays run 2's persona.
    expect(starts[starts.length - 1].persona).toBe(starts[1].persona)
    expectExit(runCli(['audit', '--ledger', ledger, '--now', isoAt(base, 6)], { git }), 0)
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
      runCli(['pick', '--source', '1a', '--instrument', 'piano', '--cost', 'M', '--leader-gap', '0', '--harm', '0', '--class', 'VOID', '--thread', 'none',
        '--sum', '8', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['start', '--ledger', ledger, '--now', now], { git }) // run2: DRUMS

    const blocked = runCli(
      ['pick', '--source', '1a', '--instrument', 'drums', '--cost', 'M', '--leader-gap', '9', '--harm', '0', '--class', 'VOID', '--thread', 'none',
        '--sum', '8', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(blocked, 1)

    expectExit(
      runCli(['pick', '--source', '1a', '--instrument', 'drums', '--cost', 'M', '--leader-gap', '9', '--harm', '1', '--class', 'HARMFUL', '--thread', 'none',
        '--sum', '8', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
  })

  it('excuses a repeated source when the previous run left the named thread open', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'

    runCli(['start', '--ledger', ledger, '--now', now], { git }) // run1: PIANO
    runCli(['pick', '--source', '1b', '--instrument', 'piano', '--cost', 'S', '--leader-gap', '9', '--harm', '0', '--class', 'VOID', '--thread', 'continuity',
      '--sum', '5', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git })
    expectExit(runCli(['thread', '--slug', 'continuity', '--state', 'open', '--ledger', ledger, '--now', now], { git }), 0)
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['start', '--ledger', ledger, '--now', now], { git }) // run2: DRUMS

    const excused = runCli(
      ['pick', '--source', '1b', '--instrument', 'drums', '--cost', 'S', '--leader-gap', '9', '--harm', '0', '--class', 'VOID', '--thread', 'continuity',
        '--sum', '5', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(excused, 0)
  })
})

describe('pick — tier derivation', () => {
  it('derives Floor from S, M from M, L from L, forces L when harm=1, and forces L when class=VOID regardless of cost', () => {
    // One pick per run (the pick duplicate-guard forbids a 2nd pick on the same run — see
    // 'pick — duplicate guard' below), so each case gets its own start/pick/verdict/rewind
    // cycle, pinning the persona to piano throughout the same way the B3/B4 tests do. Each
    // case also uses a distinct --source so the unrelated repeat-source gate never fires.
    //
    // The cost-only cases use class THIN rather than VOID: THIN satisfies the innovation
    // quota (so it doesn't trip the unrelated B3 gate across this many consecutive runs) but,
    // per docs/commands/improve-app.md, does NOT force tier L the way VOID does — it derives
    // from cost like any other pick. That keeps this test honest about which class forces L
    // and which doesn't.
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'

    const cases = [
      { source: '1a', cost: 'S', harm: '0', class: 'THIN', expected: 'Floor' },
      { source: '1b', cost: 'M', harm: '0', class: 'THIN', expected: 'M' },
      { source: '1c', cost: 'L', harm: '0', class: 'THIN', expected: 'L' },
      { source: '1d', cost: 'S', harm: '1', class: 'HARMFUL', expected: 'L' },
      { source: '1a', cost: 'S', harm: '0', class: 'VOID', expected: 'L' },
      { source: '1b', cost: 'M', harm: '0', class: 'VOID', expected: 'L' },
    ]
    for (const c of cases) {
      runCli(['start', '--ledger', ledger, '--now', now], { git })
      const result = runCli(
        ['pick', '--source', c.source, '--instrument', 'piano', '--sum', '5', '--cost', c.cost, '--leader-gap', '9', '--harm', c.harm,
          '--class', c.class, '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
        { git },
      )
      expectExit(result, 0)
      now = isoAt(now, 5)
      runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
      now = isoAt(now, 5)
      runCli(['rewind', '--reason', 'pin instrument for test', '--ledger', ledger, '--now', now], { git })
      now = isoAt(now, 5)
    }

    const tiers = loadLedger(ledger)
      .filter((e) => e.event === 'pick')
      .map((e) => e.tier)
    expect(tiers).toEqual(cases.map((c) => c.expected))

    // Replay must agree with what the writer stored for every case above, including the two
    // VOID-forces-L picks — if auditLedger's deriveTier call didn't also receive e.class, this
    // would flag a tier mismatch on those two lines instead of coming back clean.
    const audited = runCli(['audit', '--ledger', ledger, '--now', now], { git })
    expectExit(audited, 0)
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
        '--harm', '0', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(mismatch, 1)
    expect(mismatch.stderr.join(' ')).toMatch(/piano/)
    expect(mismatch.stderr.join(' ')).toMatch(/drums/)

    const match = runCli(
      ['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
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
          '--harm', '0', '--class', 'VOID', '--thread', 'no-payoff-thread', '--metric', 'm', '--baseline', '1', '--ledger', capless, '--now', now],
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
        '--harm', '0', '--class', 'VOID', '--thread', 'no-payoff-thread', '--metric', 'm', '--baseline', '1', '--ledger', capless, '--now', now],
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
        '--leader-gap', '9', '--harm', '0', '--class', 'VOID', '--thread', 'chord-inversions', '--metric', 'm', '--baseline', '1',
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
        '--harm', '0', '--class', 'VOID', '--thread', 'chord-inversions', '--metric', 'm', '--baseline', '1', '--ledger', payoffLedger, '--now', now],
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
        '--harm', '0', '--class', 'VOID', '--thread', 'scales-in-thirds', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
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
        '--harm', '0', '--class', 'VOID', '--thread', 'scales-in-thirds', '--payoff', 'some-payoff', '--prereqs', '2',
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
        '--harm', '0', '--class', 'VOID', '--thread', 'left-hand-voicings', '--payoff', 'comp-a-ii-V-I', '--prereqs', '1',
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
        '--harm', '0', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)

    // run3: PIANO (index2) again — 2nd consecutive PIANO pick of the thread (streak 1 -> allowed).
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(
      runCli(['pick', '--source', '1c', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'VOID', '--thread', 'left-hand-voicings', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)

    // run4: DRUMS (index3) — another unrelated pick.
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(
      runCli(['pick', '--source', '1d', '--instrument', 'drums', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
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
        '--harm', '0', '--class', 'VOID', '--thread', 'left-hand-voicings', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
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
    runCli(['pick', '--source', '1a', '--instrument', 'piano', '--cost', 'M', '--leader-gap', '9', '--harm', '0', '--class', 'VOID', '--thread', 'none',
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

describe('blocker ratchet', () => {
  /** Same shape as `finish`'s `fullySetUpRun`, but reusable from outside that describe block:
   * mark 0, a Floor-tier pick, slice, verdict, spec and mark 8 — everything a non-abort `finish`
   * needs EXCEPT the panel sweeps, which each test records at its own severities. */
  function runReadyForPanels() {
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
        '--harm', '0', '--class', 'THIN', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    runCli(['slice', '--sha', 'abc123', '--ledger', ledger, '--now', now], { git })
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    runCli(['spec', '--id', specId, '--red-exit', '1', '--ledger', ledger, '--now', now], { git })
    runCli(['mark', '8', '--ledger', ledger, '--now', now], { git })

    return { ledger, now, panelDir, file, git }
  }

  it('lets a converging run finish: round 2 with fewer BLOCKERs than round 1 is not a ratchet', () => {
    const { ledger, now, panelDir, file, git } = runReadyForPanels()

    floorPanelSweep(ledger, now, git, panelDir, file, 1, { blockers: 3 })
    floorPanelSweep(ledger, now, git, panelDir, file, 2, { blockers: 0 })

    expect(runCli(['status', '--ledger', ledger, '--now', now], { git }).stdout.join(' ')).not.toMatch(/did not fall/)
    expectExit(
      runCli(['finish', '--outcome', 'clean', '--clean-round', '2', '--ledger', ledger, '--now', now], { git }),
      0,
    )
  })

  it('refuses clean AND shipped-not-clean when the BLOCKER count did not fall, and still allows abort', () => {
    const { ledger, now, panelDir, file, git } = runReadyForPanels()

    // Round 1 totals 4 across two seats; round 2 totals 4 again — equal is enough, the count has
    // to FALL. This is run 2026-08-21-1's shape (5 -> 6 -> 9) with the numbers made minimal.
    floorPanelSweep(ledger, now, git, panelDir, file, 1, { blockers: 2 })
    floorPanelSweep(ledger, now, git, panelDir, file, 2, { blockers: 2 })

    const clean = runCli(['finish', '--outcome', 'clean', '--clean-round', '2', '--ledger', ledger, '--now', now], { git })
    expectExit(clean, 1)
    expect(clean.stderr.join(' ')).toMatch(/did not fall/)

    const shipped = runCli(['finish', '--outcome', 'shipped-not-clean', '--ledger', ledger, '--now', now], { git })
    expectExit(shipped, 1)
    expect(shipped.stderr.join(' ')).toMatch(/did not fall/)

    expectExit(runCli(['finish', '--outcome', 'abort', '--blocker', 'the fixing stopped converging', '--ledger', ledger, '--now', now], { git }), 0)
  })

  it('says so on the panel event that raised it, not only at finish', () => {
    const { ledger, now, panelDir, file, git } = runReadyForPanels()

    floorPanelSweep(ledger, now, git, panelDir, file, 1, { blockers: 1 })
    expectExit(runPanel(ledger, now, git, { round: 2, role: 'skeptic', panelDir, file, blockers: 1 }), 0)
    const second = runPanel(ledger, now, git, { round: 2, role: 'regression-hunter', panelDir, file, blockers: 1 })
    expectExit(second, 0)
    expect(second.stdout.join(' ')).toMatch(/RATCHET/)
    expect(second.stdout.join(' ')).toMatch(/only finish as `abort`/)
  })

  it('does not fire on a round-1-only run, and treats a missing later round as no evidence', () => {
    const { ledger, now, panelDir, file, git } = runReadyForPanels()

    floorPanelSweep(ledger, now, git, panelDir, file, 1, { blockers: 5 })
    expect(runCli(['status', '--ledger', ledger, '--now', now], { git }).stdout.join(' ')).not.toMatch(/did not fall/)

    // One seat short of a full round 2, summing lower than round 1 purely because a seat is
    // absent: the rule is deliberately one-directional and must NOT read that as convergence
    // evidence either way — it simply does not fire.
    expectExit(runPanel(ledger, now, git, { round: 2, role: 'skeptic', panelDir, file, blockers: 4 }), 0)
    expect(runCli(['status', '--ledger', ledger, '--now', now], { git }).stdout.join(' ')).not.toMatch(/did not fall/)
  })

  it('scopes the comparison to one run — the rounds of an earlier run cannot ratchet a later one', () => {
    const { ledger, now, panelDir, file, git } = runReadyForPanels()

    floorPanelSweep(ledger, now, git, panelDir, file, 1, { blockers: 9 })
    floorPanelSweep(ledger, now, git, panelDir, file, 2, { blockers: 9 })
    expectExit(runCli(['finish', '--outcome', 'abort', '--blocker', 'x', '--ledger', ledger, '--now', now], { git }), 0)

    const later = isoAt(now, 600)
    const specId = 'DR-98'
    const git2 = cleanGit({ headChangedPaths: () => [`e2e/improve-${specId}.spec.ts`] })
    runCli(['start', '--ledger', ledger, '--now', later], { git: git2 })
    runCli(['mark', '0', '--ledger', ledger, '--now', later], { git: git2 })
    runCli(
      ['pick', '--source', '1b', '--instrument', 'drums', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'THIN', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', later],
      { git: git2 },
    )
    runCli(['slice', '--sha', 'abc123', '--ledger', ledger, '--now', later], { git: git2 })
    runCli(['verdict', '--none', '--ledger', ledger, '--now', later], { git: git2 })
    runCli(['spec', '--id', specId, '--red-exit', '1', '--ledger', ledger, '--now', later], { git: git2 })
    runCli(['mark', '8', '--ledger', ledger, '--now', later], { git: git2 })
    floorPanelSweep(ledger, later, git2, panelDir, file, 1, { blockers: 1 })
    floorPanelSweep(ledger, later, git2, panelDir, file, 2, { blockers: 0 })

    expectExit(
      runCli(['finish', '--outcome', 'clean', '--clean-round', '2', '--ledger', ledger, '--now', later], { git: git2 }),
      0,
    )
  })
})

describe('finish', () => {
  /** A run with every prerequisite `finish` (for a non-abort outcome) now needs EXCEPT
   * mark 8 and the panel sweep: mark 0, an S-cost/harm=0 (Floor tier) pick, a slice, a verdict,
   * and a spec event whose fake git reports HEAD as touching exactly that spec's expected path.
   * Class is THIN, not VOID — VOID now forces tier L, which would need the full 4-seat sweep
   * instead of the 2-seat `floorPanelSweep` these tests are built around. */
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
        '--harm', '0', '--class', 'THIN', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
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
      '--harm', '0', '--class', 'THIN', '--thread', 'metronome-drills', '--payoff', 'play-along-track', '--prereqs', '2',
      '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', isoAt(now, 10)], { git })
    const afterPick = runCli(['status', '--ledger', ledger, '--now', isoAt(now, 10)], { git })
    const pickText = afterPick.stdout.join(' | ')
    expect(pickText).toMatch(/active thread: metronome-drills — run 1 of 3/)
    expect(pickText).toMatch(/payoff "play-along-track", 2 prerequisite\(s\)/)
    // Floor tier (S cost, harm 0, class THIN — not VOID, which now forces L) — status should
    // now preview the round-1 panel sweep it needs.
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

describe('pick — --class required, and agrees with --harm (B1)', () => {
  it('refuses a pick with no --class, and refuses --harm/--class HARMFUL disagreeing either way', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })

    const missingClass = runCli(
      ['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(missingClass, 2)
    expect(missingClass.stderr.join(' ')).toMatch(/--class is required/)

    const harmWithoutClass = runCli(
      ['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '1', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(harmWithoutClass, 2)
    expect(harmWithoutClass.stderr.join(' ')).toMatch(/--harm 1 and --class HARMFUL must agree/)

    const classWithoutHarm = runCli(
      ['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'HARMFUL', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(classWithoutHarm, 2)
    expect(classWithoutHarm.stderr.join(' ')).toMatch(/--harm 1 and --class HARMFUL must agree/)

    expectExit(
      runCli(['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '1', '--class', 'HARMFUL', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now], { git }),
      0,
    )
    const picks = loadLedger(ledger).filter((e) => e.event === 'pick')
    expect(picks[0].class).toBe('HARMFUL')
  })
})

describe('pick — reg/idea sources (B2)', () => {
  it('accepts --source reg and --source idea, and records them on the pick event', () => {
    const git = cleanGit()

    const regLedger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', regLedger, '--now', now], { git })
    const regResult = runCli(
      ['pick', '--source', 'reg', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'BLIND', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', regLedger, '--now', now],
      { git },
    )
    expectExit(regResult, 0)
    expect(loadLedger(regLedger).filter((e) => e.event === 'pick')[0].source).toBe('reg')

    const ideaLedger = tempLedger()
    runCli(['start', '--ledger', ideaLedger, '--now', now], { git })
    const ideaResult = runCli(
      ['pick', '--source', 'idea', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'BLIND', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ideaLedger, '--now', now],
      { git },
    )
    expectExit(ideaResult, 0)
    expect(loadLedger(ideaLedger).filter((e) => e.event === 'pick')[0].source).toBe('idea')
  })
})

describe('pick — innovation quota (B3)', () => {
  /** Starts a run, picks it, records a --none verdict, then rewinds — the same pin-the-instrument
   * pattern the payoff-cap tests above use, so a sequence of calls all land on consecutive same-
   * instrument (piano) runs. */
  function pianoPick(ledger, now, git, { source, klass, thread = 'none', harm = '0' }) {
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    const result = runCli(
      ['pick', '--source', source, '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', harm, '--class', klass, '--thread', thread, '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    let next = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', next], { git })
    next = isoAt(next, 5)
    runCli(['rewind', '--reason', 'pin instrument for test', '--ledger', ledger, '--now', next], { git })
    return { result, now: isoAt(next, 5) }
  }

  it('refuses a 3rd consecutive non-VOID/THIN/reg/idea pick of the same instrument, and VOID satisfies it', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'

    let step = pianoPick(ledger, now, git, { source: '1a', klass: 'BLIND' })
    expectExit(step.result, 0)
    now = step.now

    step = pianoPick(ledger, now, git, { source: '1b', klass: 'MIS-GATED' })
    expectExit(step.result, 0)
    now = step.now

    // 3rd consecutive piano run: two prior misses already logged (BLIND, MIS-GATED) — a third
    // repair-classed pick must be refused.
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    const refused = runCli(
      ['pick', '--source', '1c', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'FLAT', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(refused, 1)
    expect(refused.stderr.join(' ')).toMatch(/VOID, THIN, reg, or idea/)

    const satisfied = runCli(
      ['pick', '--source', '1c', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(satisfied, 0)
  })

  it('lets a THIN pick, a reg pick, or an idea pick satisfy the quota just as well as VOID', () => {
    const git = cleanGit()
    for (const [klass, source] of [['THIN', '1a'], ['BLIND', 'reg'], ['BLIND', 'idea']]) {
      const ledger = tempLedger()
      let now = '2026-08-20T09:00:00.000Z'
      let step = pianoPick(ledger, now, git, { source: '1a', klass: 'BLIND' })
      expectExit(step.result, 0)
      now = step.now
      step = pianoPick(ledger, now, git, { source: '1b', klass: 'MIS-GATED' })
      expectExit(step.result, 0)
      now = step.now

      runCli(['start', '--ledger', ledger, '--now', now], { git })
      const result = runCli(
        ['pick', '--source', source, '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
          '--harm', '0', '--class', klass, '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
        { git },
      )
      expectExit(result, 0)
    }
  })

  it('does not let the other instrument\'s runs count toward, break, or extend a quota streak', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'

    function pick(source, instrument, klass, expected) {
      runCli(['start', '--ledger', ledger, '--now', now], { git })
      const result = runCli(
        ['pick', '--source', source, '--instrument', instrument, '--sum', '5', '--cost', 'S', '--leader-gap', '9',
          '--harm', '0', '--class', klass, '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
        { git },
      )
      expectExit(result, expected)
      if (expected === 0) {
        now = isoAt(now, 5)
        runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
        now = isoAt(now, 5)
      }
      return result
    }

    pick('1a', 'piano', 'BLIND', 0) // run1 PIANO miss #1
    pick('1b', 'drums', 'BLIND', 0) // run2 DRUMS (first drums run, unaffected)
    pick('1c', 'piano', 'BLIND', 0) // run3 PIANO miss #2 (only 2nd piano miss, still allowed)
    pick('1d', 'drums', 'BLIND', 0) // run4 DRUMS miss #2 (only 2nd drums miss, still allowed)
    // run5 PIANO: would be the 3rd consecutive PIANO miss. If run2/run4 (drums) had counted
    // toward piano's streak this would already have been refused earlier; if they had reset it,
    // this would wrongly succeed. Neither happened — it's refused here, exactly at piano's own
    // 3rd consecutive miss.
    const fifth = pick('1e', 'piano', 'FLAT', 1)
    expect(fifth.stderr.join(' ')).toMatch(/piano/)
  })

  it('flags a quota violation on ledger replay, not only at write time', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'

    let step = pianoPick(ledger, now, git, { source: '1a', klass: 'BLIND' })
    now = step.now
    step = pianoPick(ledger, now, git, { source: '1b', klass: 'MIS-GATED' })
    now = step.now
    step = pianoPick(ledger, now, git, { source: '1c', klass: 'VOID' }) // satisfies — legitimately
    now = step.now

    expectExit(runCli(['audit', '--ledger', ledger, '--now', now], { git }), 0)

    // Hand-edit the 3rd pick's class from VOID (satisfying) to BLIND (not) — this is exactly the
    // ledger shape a bypassed write-time gate would produce.
    const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean)
    const pickLines = lines.map((l, i) => ({ e: JSON.parse(l), i })).filter((x) => x.e.event === 'pick')
    const thirdPick = pickLines[2]
    thirdPick.e.class = 'BLIND'
    lines[thirdPick.i] = JSON.stringify(thirdPick.e)
    writeFileSync(ledger, `${lines.join('\n')}\n`)

    const audited = runCli(['audit', '--ledger', ledger, '--now', now], { git })
    expectExit(audited, 1)
    expect(audited.stderr.join(' ')).toMatch(/innovation quota/)
  })
})

describe('pick — quota outranks the thread rule (B4)', () => {
  it('holds a deferred thread\'s cap rather than resetting it', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'
    const slug = 'deferred-thread'

    function pianoPick(source, thread, klass) {
      runCli(['start', '--ledger', ledger, '--now', now], { git })
      const result = runCli(
        ['pick', '--source', source, '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
          '--harm', '0', '--class', klass, '--thread', thread, '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
        { git },
      )
      now = isoAt(now, 5)
      runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
      now = isoAt(now, 5)
      runCli(['rewind', '--reason', 'pin instrument for test', '--ledger', ledger, '--now', now], { git })
      now = isoAt(now, 5)
      return result
    }

    // run1: opens the thread (default cap 3). Also the 1st quota miss (class BLIND).
    expectExit(pianoPick('1a', slug, 'BLIND'), 0)
    // run2: 2nd consecutive thread pick (streak 1 < cap 3 -> allowed). Also the 2nd quota miss —
    // the quota is now armed for run3.
    expectExit(pianoPick('1b', slug, 'BLIND'), 0)

    // run3 would be the 3rd consecutive quota miss if it repeated the thread with a repair class
    // — confirm the quota actually refuses that before showing the deferral that avoids it.
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    const wouldMiss = runCli(
      ['pick', '--source', '1c', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'BLIND', '--thread', slug, '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(wouldMiss, 1)
    expect(wouldMiss.stderr.join(' ')).toMatch(/VOID, THIN, reg, or idea/)

    // The operator complies with the quota instead: defers the thread (doesn't name it this run)
    // and picks something that satisfies the quota.
    const deferred = runCli(
      ['pick', '--source', '1c', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(deferred, 0)
    now = isoAt(now, 5)
    runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['rewind', '--reason', 'pin instrument for test', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)

    // run4: continue the thread again. Correct (HOLD) reading: this is really the thread's 3rd
    // real consecutive pick (runs 1, 2, 4) with the deferral transparent — streak 2 < cap 3,
    // still allowed.
    expectExit(pianoPick('1d', slug, 'BLIND'), 0)

    // run5: a 4th real consecutive pick of the thread. Held correctly, the thread has now been
    // picked on 3 non-deferred consecutive piano runs (1, 2, 4) and this is the 4th — refused.
    // If the deferral had instead RESET the streak (the bug this test exists to catch), this
    // would wrongly be allowed.
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    const fifth = runCli(
      ['pick', '--source', '1e', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
        '--harm', '0', '--class', 'BLIND', '--thread', slug, '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(fifth, 1)
    expect(fifth.stderr.join(' ')).toMatch(new RegExp(slug))

    expectExit(runCli(['audit', '--ledger', ledger, '--now', now], { git }), 0)
  })
})

describe('audit — corrupt numeric fields are flagged, not silently passed (A1)', () => {
  it('flags a non-finite/missing elapsedPct on a mark event', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    let now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    now = isoAt(now, 5)
    runCli(['mark', '0', '--ledger', ledger, '--now', now], { git })

    const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean)
    const markLineIndex = lines.findIndex((l) => JSON.parse(l).event === 'mark')
    const tampered = JSON.parse(lines[markLineIndex])
    tampered.elapsedPct = null
    lines[markLineIndex] = JSON.stringify(tampered)
    writeFileSync(ledger, `${lines.join('\n')}\n`)

    const result = runCli(['audit', '--ledger', ledger, '--now', now], { git })
    expectExit(result, 1)
    expect(result.stderr.join(' ')).toMatch(new RegExp(`line ${markLineIndex + 1}`))
    expect(result.stderr.join(' ')).toMatch(/elapsedPct/)
  })

  it('flags a non-integer sum, an invalid prereqs on a payoff thread, and a non-integer round on a panel event', () => {
    const git = cleanGit()

    // sum
    const sumLedger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', sumLedger, '--now', now], { git })
    runCli(['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
      '--harm', '0', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', sumLedger, '--now', now], { git })
    const sumLines = readFileSync(sumLedger, 'utf8').split('\n').filter(Boolean)
    const sumPickIndex = sumLines.findIndex((l) => JSON.parse(l).event === 'pick')
    const tamperedSum = JSON.parse(sumLines[sumPickIndex])
    tamperedSum.sum = 'high'
    sumLines[sumPickIndex] = JSON.stringify(tamperedSum)
    writeFileSync(sumLedger, `${sumLines.join('\n')}\n`)
    const sumResult = runCli(['audit', '--ledger', sumLedger, '--now', now], { git })
    expectExit(sumResult, 1)
    expect(sumResult.stderr.join(' ')).toMatch(/sum/)

    // prereqs
    const prereqsLedger = tempLedger()
    runCli(['start', '--ledger', prereqsLedger, '--now', now], { git })
    runCli(['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
      '--harm', '0', '--class', 'VOID', '--thread', 'payoff-thread', '--payoff', 'goal', '--prereqs', '2',
      '--metric', 'm', '--baseline', '1', '--ledger', prereqsLedger, '--now', now], { git })
    const prereqsLines = readFileSync(prereqsLedger, 'utf8').split('\n').filter(Boolean)
    const prereqsPickIndex = prereqsLines.findIndex((l) => JSON.parse(l).event === 'pick')
    const tamperedPrereqs = JSON.parse(prereqsLines[prereqsPickIndex])
    tamperedPrereqs.prereqs = 'lots'
    prereqsLines[prereqsPickIndex] = JSON.stringify(tamperedPrereqs)
    writeFileSync(prereqsLedger, `${prereqsLines.join('\n')}\n`)
    const prereqsResult = runCli(['audit', '--ledger', prereqsLedger, '--now', now], { git })
    expectExit(prereqsResult, 1)
    expect(prereqsResult.stderr.join(' ')).toMatch(/prereqs/)

    // round
    const roundLedger = tempLedger()
    const panelDir = panelFixtureDir()
    const file = panelOutputFile()
    runCli(['start', '--ledger', roundLedger, '--now', now], { git })
    runCli(['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
      '--harm', '0', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', roundLedger, '--now', now], { git })
    runPanel(roundLedger, now, git, { round: 1, role: 'skeptic', panelDir, file })
    const roundLines = readFileSync(roundLedger, 'utf8').split('\n').filter(Boolean)
    const panelIndex = roundLines.findIndex((l) => JSON.parse(l).event === 'panel')
    const tamperedRound = JSON.parse(roundLines[panelIndex])
    tamperedRound.round = 'two'
    roundLines[panelIndex] = JSON.stringify(tamperedRound)
    writeFileSync(roundLedger, `${roundLines.join('\n')}\n`)
    const roundResult = runCli(['audit', '--ledger', roundLedger, '--now', now], { git })
    expectExit(roundResult, 1)
    expect(roundResult.stderr.join(' ')).toMatch(/round/)
  })

  it('flags an invalid class on a pick event (closes report item f2)', () => {
    // requireEnum only guards the write path — a hand-edited ledger can put anything in
    // `class`. Without this check a bad value just fails satisfiesQuota silently (counted
    // as a quota miss by luck, not by rule), the same NaN-masking shape as elapsedPct/sum/
    // prereqs/round above.
    const git = cleanGit()
    const classLedger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', classLedger, '--now', now], { git })
    runCli(['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'S', '--leader-gap', '9',
      '--harm', '0', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', classLedger, '--now', now], { git })
    const classLines = readFileSync(classLedger, 'utf8').split('\n').filter(Boolean)
    const classPickIndex = classLines.findIndex((l) => JSON.parse(l).event === 'pick')
    const tamperedClass = JSON.parse(classLines[classPickIndex])
    tamperedClass.class = 'BANANA'
    classLines[classPickIndex] = JSON.stringify(tamperedClass)
    writeFileSync(classLedger, `${classLines.join('\n')}\n`)
    const classResult = runCli(['audit', '--ledger', classLedger, '--now', now], { git })
    expectExit(classResult, 1)
    expect(classResult.stderr.join(' ')).toMatch(new RegExp(`line ${classPickIndex + 1}`))
    expect(classResult.stderr.join(' ')).toMatch(/BANANA/)
  })
})

describe('--now must parse to a finite timestamp (A1)', () => {
  it('refuses an unparseable --now with a usage error', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const result = runCli(['start', '--ledger', ledger, '--now', 'not-a-real-timestamp'], { git })
    expectExit(result, 2)
    expect(result.stderr.join(' ')).toMatch(/--now/)
  })
})

describe('verdict — duplicate guard (A2)', () => {
  it('refuses a 2nd verdict event for the same run, and audit flags one hand-added to the ledger', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(runCli(['verdict', '--none', '--ledger', ledger, '--now', now], { git }), 0)

    const second = runCli(['verdict', '--value', '5', '--ledger', ledger, '--now', now], { git })
    expectExit(second, 1)
    expect(second.stderr.join(' ')).toMatch(/already has a verdict event/)

    // Write-time refusal alone can be bypassed by hand-editing the ledger — confirm audit catches
    // a second verdict on replay too.
    const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean)
    const verdictLine = lines.find((l) => JSON.parse(l).event === 'verdict')
    lines.push(JSON.stringify({ ...JSON.parse(verdictLine), ts: isoAt(now, 1) }))
    writeFileSync(ledger, `${lines.join('\n')}\n`)
    const audited = runCli(['audit', '--ledger', ledger, '--now', now], { git })
    expectExit(audited, 1)
    expect(audited.stderr.join(' ')).toMatch(/verdict/)
  })
})

describe('pick — duplicate guard', () => {
  it('refuses a 2nd pick event for the same run, and audit flags one hand-added to the ledger', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })
    expectExit(
      runCli(
        ['pick', '--source', '1a', '--instrument', 'piano', '--sum', '5', '--cost', 'M', '--leader-gap', '9',
          '--harm', '0', '--class', 'BLIND', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
        { git },
      ),
      0,
    )

    const second = runCli(
      ['pick', '--source', '1c', '--instrument', 'piano', '--sum', '5', '--cost', 'M', '--leader-gap', '9',
        '--harm', '0', '--class', 'VOID', '--thread', 'none', '--metric', 'm', '--baseline', '1', '--ledger', ledger, '--now', now],
      { git },
    )
    expectExit(second, 1)
    expect(second.stderr.join(' ')).toMatch(/already has a pick event/)
    expect(second.stderr.join(' ')).toMatch(/source "1a"/)
    expect(second.stderr.join(' ')).toMatch(/class "BLIND"/)

    // Write-time refusal alone can be bypassed by hand-editing the ledger — confirm audit catches
    // a second pick on replay too.
    const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean)
    const pickLine = lines.find((l) => JSON.parse(l).event === 'pick')
    lines.push(JSON.stringify({ ...JSON.parse(pickLine), ts: isoAt(now, 1) }))
    writeFileSync(ledger, `${lines.join('\n')}\n`)
    const audited = runCli(['audit', '--ledger', ledger, '--now', now], { git })
    expectExit(audited, 1)
    expect(audited.stderr.join(' ')).toMatch(/already had a pick event/)
  })
})

describe('mark — usage message names the positional and --section specifically (A3)', () => {
  it('says the section is positional, and calls out --section when that was passed instead', () => {
    const git = cleanGit()
    const ledger = tempLedger()
    const now = '2026-08-20T09:00:00.000Z'
    runCli(['start', '--ledger', ledger, '--now', now], { git })

    const noArg = runCli(['mark', '--ledger', ledger, '--now', now], { git })
    expectExit(noArg, 2)
    expect(noArg.stderr.join(' ')).toMatch(/positional/)

    const flagged = runCli(['mark', '--section', '0', '--ledger', ledger, '--now', now], { git })
    expectExit(flagged, 2)
    expect(flagged.stderr.join(' ')).toMatch(/--section.*is not a flag/)
    expect(flagged.stderr.join(' ')).toMatch(/mark 0/)
  })
})
