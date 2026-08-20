#!/usr/bin/env node
/**
 * State machine and gatekeeper for the `/improve-app` session loop (docs/PROCESS.md).
 *
 * The loop used to live entirely in `docs/improve-log.md`, a hand-written prose ledger
 * checked after the fact by `scripts/check-improve-log.mjs`. That catches a malformed
 * entry once it is written, but every rule that depends on WHEN something happens — don't
 * start a new run while the last one's metric is still unresolved, drop to the floor once
 * the budget is half gone, don't pick the same candidate two runs running without a reason,
 * a thread can't stay open forever — is a rule an agent under deadline pressure can silently
 * skip, because nothing stops the run from happening in the wrong order in the first place.
 * This project's own retro log says it plainly: a rule that can be violated silently will be.
 *
 * So this script owns the run itself. State lives in ONE append-only file,
 * `runs/ledger.ndjson` — one JSON object per line, keys always `{ts, run, event, ...}`. It
 * is never rewritten: every derived fact (whose turn the persona rotation is on, what the
 * previous run picked, how much budget is left, whether a thread has run three times
 * running) is recomputed by REPLAYING the ledger, never read off a mutable counter. A silent
 * reset means deleting committed lines, which shows up in `git diff` and fails `audit`. Each
 * subcommand below is a gate: it refuses (exit 1) rather than append when a rule is broken,
 * so the loop cannot advance past the part it just skipped.
 *
 *   node scripts/improve-run.mjs start [--budget <minutes, default 240>]
 *   node scripts/improve-run.mjs mark <0|1a|1b|1c|1d|1e|2|3|4|5|6|7|8>
 *   node scripts/improve-run.mjs pick --source <1a|1b|1c|1d|1e> --instrument <piano|drums>
 *       --sum <0-12> --cost <S|M|L> --leader-gap <n> --harm <0|1> --thread <slug|none>
 *       --metric <name> --baseline <value> [--payoff <id> --prereqs <n>]
 *   node scripts/improve-run.mjs thread --slug <slug> --state <open|abandoned|shipped>
 *       [--reason <text>]
 *   node scripts/improve-run.mjs spec --id <id> --red-exit <code>
 *   node scripts/improve-run.mjs panel --round <n> --role <role> --prompt-sha <sha256>
 *       --file <path>
 *   node scripts/improve-run.mjs slice --sha <sha>
 *   node scripts/improve-run.mjs verdict --value <n>|--none [--note <text>]
 *   node scripts/improve-run.mjs rewind --reason <text>
 *   node scripts/improve-run.mjs finish --outcome <clean|shipped-not-clean|abort>
 *       [--blocker <text>]
 *   node scripts/improve-run.mjs audit [--run <id>]
 *   node scripts/improve-run.mjs status
 *
 * Every subcommand also takes `--ledger <path>` (default `runs/ledger.ndjson`) and
 * `--now <iso>` (default the real clock) — the injection points that make this testable
 * without ever touching real time or the real ledger. `git` is not a flag: it is read
 * through `defaultGit` below, and tests inject a fake instead of shelling out to this repo.
 *
 * Exit codes throughout: 0 = pass, 1 = a rule was broken, 2 = bad usage.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_LEDGER = 'runs/ledger.ndjson'

const SECTIONS = ['0', '1a', '1b', '1c', '1d', '1e', '2', '3', '4', '5', '6', '7', '8']
const SOURCES = ['1a', '1b', '1c', '1d', '1e']
const COSTS = ['S', 'M', 'L']
const OUTCOMES = ['clean', 'shipped-not-clean', 'abort']
const THREAD_STATES = ['open', 'abandoned', 'shipped']

// 8 personas, alternating PIANO/DRUMS by table position. The alternation is load-bearing:
// without it, one instrument starves while the other gets every run (this app is two
// instruments in one shell — see DR-01). `personaIndexAt` below derives the next slot by
// replaying the ledger; nothing here is a mutable counter that could drift from it.
const PERSONAS = [
  { name: 'Total beginner', kind: 'PIANO' },
  { name: 'Total beginner', kind: 'DRUMS' },
  { name: 'Rusty returner', kind: 'PIANO' },
  { name: 'Rusty returner', kind: 'DRUMS' },
  { name: 'Confident intermediate', kind: 'PIANO' },
  { name: 'Confident intermediate', kind: 'DRUMS' },
  { name: 'Accessibility-first learner', kind: 'PIANO' },
  { name: 'Accessibility-first learner', kind: 'DRUMS' },
]

// Re-panel budget by tier, in ADDITIONAL rounds past the initial one: Floor gets one
// re-panel (round 2 is the last allowed), M gets two (round 3), L gets three (round 4).
const REPANEL_CAP = { Floor: 1, M: 2, L: 3 }

class UsageError extends Error {}
class RuleViolation extends Error {}

const round2 = (n) => Math.round(n * 100) / 100

function requireFlag(flags, name) {
  const v = flags[name]
  if (v === undefined || v === true) throw new UsageError(`--${name} is required`)
  return v
}

function requireEnum(flags, name, allowed) {
  const v = requireFlag(flags, name)
  if (!allowed.includes(v)) {
    throw new UsageError(`--${name} must be one of ${allowed.join('|')}, got "${v}"`)
  }
  return v
}

function requireInt(flags, name, { min, max } = {}) {
  const raw = requireFlag(flags, name)
  const n = Number(raw)
  if (!Number.isInteger(n)) throw new UsageError(`--${name} must be an integer, got "${raw}"`)
  if (min !== undefined && n < min) throw new UsageError(`--${name} must be >= ${min}, got ${n}`)
  if (max !== undefined && n > max) throw new UsageError(`--${name} must be <= ${max}, got ${n}`)
  return n
}

/** Splits argv (after the subcommand) into positionals and `--flag value` pairs. A flag
 * followed by nothing, or by another flag, is boolean `true` (e.g. `verdict --none`). */
export function parseArgs(argv) {
  const positionals = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      positionals.push(a)
    }
  }
  return { positionals, flags }
}

// ---- Ledger IO ----------------------------------------------------------------------------
// Reading and appending are the only impure operations in this file; every rule they enforce
// is computed by the pure derivation functions below, over the events they load.

function readLedgerLines(ledgerPath) {
  if (!existsSync(ledgerPath)) return []
  return readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
}

/** Parses every line, throwing with the ledger path and 1-based line number on the first bad
 * one. Fine for the commands, which need a valid ledger to reason about at all — `audit` uses
 * its own tolerant parse below so it can report every bad line, not just the first. */
export function loadLedger(ledgerPath) {
  return readLedgerLines(ledgerPath).map((line, i) => {
    try {
      return JSON.parse(line)
    } catch (err) {
      throw new Error(`${ledgerPath}:${i + 1}: invalid JSON (${err.message})`)
    }
  })
}

function buildEvent(now, run, eventName, rest) {
  const event = { ts: now, run: run ?? null, event: eventName }
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) event[k] = v
  }
  return event
}

function appendEvent(ledgerPath, event) {
  mkdirSync(dirname(ledgerPath), { recursive: true })
  appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`)
}

// ---- Pure derivation ------------------------------------------------------------------------
// Nothing below reads a file or the clock. Every one of these replays `events` (already
// parsed) plus whatever the caller passed in — that is what makes them fast to unit test.

function currentRunId(events) {
  let last
  for (const e of events) if (e.event === 'start') last = e.run
  return last
}

function previousRunId(events, currentRun) {
  const runsInOrder = events.filter((e) => e.event === 'start').map((e) => e.run)
  const idx = runsInOrder.lastIndexOf(currentRun)
  return idx > 0 ? runsInOrder[idx - 1] : undefined
}

const eventsForRun = (events, runId) => events.filter((e) => e.run === runId)
const startEventFor = (events, runId) =>
  events.find((e) => e.event === 'start' && e.run === runId)
const pickEventFor = (events, runId) => eventsForRun(events, runId).find((e) => e.event === 'pick')
const hasSlice = (events, runId) => eventsForRun(events, runId).some((e) => e.event === 'slice')

function personaIndexAt(events) {
  let starts = 0
  let rewinds = 0
  for (const e of events) {
    if (e.event === 'start') starts++
    else if (e.event === 'rewind') rewinds++
  }
  return starts - rewinds
}

function personaAt(index) {
  const i = ((index % PERSONAS.length) + PERSONAS.length) % PERSONAS.length
  return PERSONAS[i]
}

const formatPersona = (persona) => `${persona.name} (${persona.kind})`

function nextRunId(events, now) {
  const day = now.slice(0, 10)
  const countToday = events.filter(
    (e) => e.event === 'start' && typeof e.run === 'string' && e.run.startsWith(`${day}-`),
  ).length
  return `${day}-${countToday + 1}`
}

function elapsedPct(events, runId, now) {
  const startEv = startEventFor(events, runId)
  if (!startEv) throw new RuleViolation(`no \`start\` event found for run ${runId}`)
  const minutes = (Date.parse(now) - Date.parse(startEv.ts)) / 60_000
  return round2((minutes / startEv.budgetMin) * 100)
}

const threadLeftOpenByRun = (events, runId, slug) =>
  runId !== undefined &&
  eventsForRun(events, runId).some((e) => e.event === 'thread' && e.slug === slug && e.state === 'open')

/** How many consecutive runs, ending at (and including) `beforeRunId` and walking backward,
 * picked `slug` as their thread. Zero if `beforeRunId` is undefined or didn't. */
function consecutiveThreadStreak(events, beforeRunId, slug) {
  const runsInOrder = [...new Set(events.filter((e) => e.event === 'start').map((e) => e.run))]
  let streak = 0
  for (let i = runsInOrder.indexOf(beforeRunId); i >= 0; i--) {
    const pick = pickEventFor(events, runsInOrder[i])
    if (pick && pick.thread === slug) streak++
    else break
  }
  return streak
}

const deriveTier = (cost, harm) => (harm ? 'L' : { S: 'Floor', M: 'M', L: 'L' }[cost])

const tierForRun = (events, runId) => pickEventFor(events, runId)?.tier
const roundOnePanel = (events, runId, role) =>
  eventsForRun(events, runId).find((e) => e.event === 'panel' && e.round === 1 && e.role === role)

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

// ---- git (injectable) -----------------------------------------------------------------------
// The only impure reads that are NOT `--ledger`/`--now`. Tests inject a fake `git` object
// into `runCli` rather than exercising this against the real repo.

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export const defaultGit = {
  statusPorcelain: () => {
    try {
      return git(['status', '--porcelain'])
    } catch {
      return ''
    }
  },
  gitDir: () => {
    try {
      return git(['rev-parse', '--absolute-git-dir'])
    } catch {
      return ''
    }
  },
  gitCommonDir: () => {
    try {
      return git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    } catch {
      return ''
    }
  },
  headSha: () => {
    try {
      return git(['rev-parse', 'HEAD'])
    } catch {
      return ''
    }
  },
  headChangedPaths: () => {
    try {
      return git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
        .split('\n')
        .filter(Boolean)
    } catch {
      return []
    }
  },
}

// ---- Commands --------------------------------------------------------------------------------
// Each is wrapped in `runCommand`: a UsageError becomes exit 2 (bad args), anything else (a
// RuleViolation, or a broken ledger) becomes exit 1 (a rule was broken).

const ok = (message) => ({ exitCode: 0, stdout: [message], stderr: [] })

function runCommand(fn) {
  return (args, ctx) => {
    try {
      return fn(args, ctx)
    } catch (err) {
      if (err instanceof UsageError) {
        return { exitCode: 2, stdout: [], stderr: [`usage: ${err.message}`] }
      }
      return { exitCode: 1, stdout: [], stderr: [err.message] }
    }
  }
}

function requireCurrentRun(events) {
  const run = currentRunId(events)
  if (run === undefined) throw new RuleViolation('no run in progress — call `start` first')
  return run
}

const cmdStart = runCommand((args, ctx) => {
  let budgetMin = 240
  if (args.flags.budget !== undefined) {
    const raw = args.flags.budget
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) {
      throw new UsageError(`--budget must be a positive integer (minutes), got "${raw}"`)
    }
    budgetMin = n
  }

  if (ctx.git.statusPorcelain()) {
    throw new RuleViolation(
      'start refused: the working tree is dirty (`git status --porcelain` is non-empty). ' +
        'Commit or stash before starting a run.',
    )
  }
  if (ctx.git.gitDir() !== ctx.git.gitCommonDir()) {
    throw new RuleViolation(
      'start refused: this checkout is a git worktree, not the main checkout. ' +
        '/improve-app runs only in the main checkout (docs/WORKTREES.md).',
    )
  }

  const events = loadLedger(ctx.ledgerPath)
  const prevRun = currentRunId(events)
  if (prevRun !== undefined && !eventsForRun(events, prevRun).some((e) => e.event === 'verdict')) {
    throw new RuleViolation(
      `start refused: previous run ${prevRun} has no \`verdict\` event — a skipped metric ` +
        `verdict must block the next run. Resolve it first: ` +
        `node scripts/improve-run.mjs verdict --value <n>|--none --ledger ${ctx.ledgerPath}`,
    )
  }

  const personaIndex = personaIndexAt(events)
  const persona = personaAt(personaIndex)
  const run = nextRunId(events, ctx.now)
  const prevPickSource =
    prevRun !== undefined ? (pickEventFor(events, prevRun)?.source ?? 'none') : 'none'

  appendEvent(
    ctx.ledgerPath,
    buildEvent(ctx.now, run, 'start', {
      commit: ctx.git.headSha(),
      budgetMin,
      persona: formatPersona(persona),
      personaIndex,
      prevPickSource,
    }),
  )
  mkdirSync(join(dirname(ctx.ledgerPath), run), { recursive: true })

  return ok(
    `run ${run} started — persona: ${formatPersona(persona)}, budget ${budgetMin}m, ` +
      `prevPickSource: ${prevPickSource}`,
  )
})

const cmdMark = runCommand((args, ctx) => {
  const section = args.positionals[0]
  if (!section || !SECTIONS.includes(section)) {
    throw new UsageError(`mark requires a section from {${SECTIONS.join(',')}}, got "${section ?? ''}"`)
  }

  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  const pct = elapsedPct(events, run, ctx.now)

  if (section === '2' && pct > 25) {
    throw new RuleViolation(
      `mark 2 refused: ${pct}% of budget elapsed — past the 25% discovery cap. Narrow discovery and move on.`,
    )
  }
  const sliced = hasSlice(events, run)
  if (pct >= 60 && !sliced) {
    throw new RuleViolation(
      `mark ${section} refused: ${pct}% of budget elapsed with no \`slice\` event — the ABORT ` +
        `threshold. Ship the smallest defensible slice now, or \`finish --outcome abort\`.`,
    )
  }

  appendEvent(ctx.ledgerPath, buildEvent(ctx.now, run, 'mark', { section, elapsedPct: pct }))

  const stdout = [`mark ${section} recorded at ${pct}% elapsed`]
  if (pct >= 40 && !sliced) {
    stdout.push(
      '',
      `⚠ DROP TO FLOOR — ${pct}% of budget spent with no \`slice\` event yet. ` +
        'Scope down to the smallest defensible change and ship it.',
      '',
    )
  }
  return { exitCode: 0, stdout, stderr: [] }
})

const cmdPick = runCommand((args, ctx) => {
  const { flags } = args
  const source = requireEnum(flags, 'source', SOURCES)
  const sum = requireInt(flags, 'sum', { min: 0, max: 12 })
  const cost = requireEnum(flags, 'cost', COSTS)
  const leaderGap = requireInt(flags, 'leader-gap')
  const harm = requireInt(flags, 'harm', { min: 0, max: 1 })
  const thread = requireFlag(flags, 'thread')
  const metric = requireFlag(flags, 'metric')
  const baseline = requireFlag(flags, 'baseline')

  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  const prevRun = previousRunId(events, run)
  const prevSource = prevRun !== undefined ? pickEventFor(events, prevRun)?.source : undefined

  if (prevSource !== undefined && prevSource === source) {
    const threadWasOpen = thread !== 'none' && threadLeftOpenByRun(events, prevRun, thread)
    if (!(harm === 1 || leaderGap <= 2 || threadWasOpen)) {
      throw new RuleViolation(
        `pick refused: source "${source}" repeats the previous run's pick with no exception ` +
          `(harm=0, leader-gap=${leaderGap} > 2, and thread "${thread}" was not left open by ` +
          'the previous run). Pick a different source, or justify the repeat with --harm 1, ' +
          '--leader-gap <= 2, or a thread the previous run left open.',
      )
    }
  }

  if (thread !== 'none') {
    const streak = consecutiveThreadStreak(events, prevRun, thread)
    if (streak >= 3) {
      throw new RuleViolation(
        `pick refused: thread "${thread}" has already been picked for ${streak} consecutive ` +
          'runs. Ship or abandon it in writing first: ' +
          `node scripts/improve-run.mjs thread --slug ${thread} --state shipped|abandoned --ledger ${ctx.ledgerPath}`,
      )
    }
  }

  const tier = deriveTier(cost, harm)
  appendEvent(
    ctx.ledgerPath,
    buildEvent(ctx.now, run, 'pick', { source, sum, cost, tier, harm, thread, metric, baseline }),
  )
  return ok(`pick recorded: source ${source}, tier ${tier}${harm ? ' (harm forces L)' : ''}`)
})

const cmdThread = runCommand((args, ctx) => {
  const { flags } = args
  const slug = requireFlag(flags, 'slug')
  const state = requireEnum(flags, 'state', THREAD_STATES)
  const reason = typeof flags.reason === 'string' ? flags.reason : undefined

  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  appendEvent(ctx.ledgerPath, buildEvent(ctx.now, run, 'thread', { slug, state, reason }))
  return ok(`thread ${slug} -> ${state}`)
})

const cmdSpec = runCommand((args, ctx) => {
  const { flags } = args
  const id = requireFlag(flags, 'id')
  const redExit = requireInt(flags, 'red-exit')

  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  const changed = ctx.git.headChangedPaths()
  const expected = `e2e/improve-${id}.spec.ts`
  const touchesExactlyOne = changed.length === 1 && changed[0] === expected

  if (!(touchesExactlyOne && redExit !== 0)) {
    throw new RuleViolation(
      `spec refused: HEAD must touch exactly one path (${expected}) — touched ` +
        `[${changed.join(', ')}] — and --red-exit must be non-zero (a spec that was never RED ` +
        `proves nothing); got ${redExit}.`,
    )
  }

  const sha = ctx.git.headSha()
  appendEvent(ctx.ledgerPath, buildEvent(ctx.now, run, 'spec', { sha, redExit }))
  return ok(`spec ${id} recorded (sha ${sha}, redExit ${redExit})`)
})

const cmdPanel = runCommand((args, ctx) => {
  const { flags } = args
  const round = requireInt(flags, 'round', { min: 1 })
  const role = requireFlag(flags, 'role')
  const promptSha = requireFlag(flags, 'prompt-sha')
  const file = requireFlag(flags, 'file')

  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  const tier = tierForRun(events, run)
  if (!tier) throw new RuleViolation(`panel refused: run ${run} has no \`pick\` event yet, so its tier is unknown.`)

  const round1 = roundOnePanel(events, run, role)
  if (round > 1) {
    if (!round1) {
      throw new RuleViolation(
        `panel refused: round ${round} for role "${role}" has no round-1 panel event to compare its prompt against.`,
      )
    }
    if (round1.promptSha !== promptSha) {
      throw new RuleViolation(
        `panel refused: round ${round}'s --prompt-sha differs from role "${role}"'s round-1 sha. ` +
          'A weaker round is not a re-panel.',
      )
    }
  }

  const maxRound = 1 + REPANEL_CAP[tier]
  if (round > maxRound) {
    throw new RuleViolation(`panel refused: round ${round} exceeds tier ${tier}'s re-panel cap (max round ${maxRound}).`)
  }

  const fileSha = sha256File(file)
  appendEvent(ctx.ledgerPath, buildEvent(ctx.now, run, 'panel', { round, role, promptSha, fileSha }))
  return ok(`panel round ${round} (${role}) recorded, tier ${tier}`)
})

const cmdSlice = runCommand((args, ctx) => {
  const sha = requireFlag(args.flags, 'sha')
  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  if (hasSlice(events, run)) {
    throw new RuleViolation(`slice refused: run ${run} already has a slice event — exactly one gap per run.`)
  }
  appendEvent(ctx.ledgerPath, buildEvent(ctx.now, run, 'slice', { sha }))
  return ok(`slice ${sha} recorded for run ${run}`)
})

const cmdVerdict = runCommand((args, ctx) => {
  const { flags } = args
  const hasValue = flags.value !== undefined
  const hasNone = flags.none !== undefined
  if (hasValue === hasNone) throw new UsageError('verdict requires exactly one of --value <n> or --none')

  let value = null
  if (hasValue) {
    const n = Number(flags.value)
    if (Number.isNaN(n)) throw new UsageError(`--value must be a number, got "${flags.value}"`)
    value = n
  }
  const note = typeof flags.note === 'string' ? flags.note : undefined

  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  appendEvent(ctx.ledgerPath, buildEvent(ctx.now, run, 'verdict', { value, note }))
  return ok(`verdict recorded for run ${run}: ${hasNone ? 'none' : value}`)
})

const cmdRewind = runCommand((args, ctx) => {
  const reason = requireFlag(args.flags, 'reason')
  const events = loadLedger(ctx.ledgerPath)
  appendEvent(ctx.ledgerPath, buildEvent(ctx.now, currentRunId(events), 'rewind', { reason }))
  return ok(`rewind recorded: ${reason}`)
})

const cmdFinish = runCommand((args, ctx) => {
  const { flags } = args
  const outcome = requireEnum(flags, 'outcome', OUTCOMES)
  let blocker
  if (outcome === 'abort') blocker = requireFlag(flags, 'blocker')
  else if (typeof flags.blocker === 'string') blocker = flags.blocker

  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  const runEvents = eventsForRun(events, run)
  const missing = []
  if (!runEvents.some((e) => e.event === 'mark' && e.section === '0')) missing.push('mark 0')
  if (!runEvents.some((e) => e.event === 'mark' && e.section === '8')) missing.push('mark 8')
  if (!runEvents.some((e) => e.event === 'verdict')) missing.push('verdict')
  if (outcome !== 'abort' && !runEvents.some((e) => e.event === 'slice')) missing.push('slice')
  if (missing.length > 0) {
    throw new RuleViolation(`finish refused: run ${run} is missing ${missing.join(', ')}.`)
  }

  appendEvent(ctx.ledgerPath, buildEvent(ctx.now, run, 'finish', { outcome, blocker }))
  return ok(`run ${run} finished: ${outcome}`)
})

/** Replays the whole ledger, re-deriving personaIndex/persona/prevPickSource on every
 * `start`, tier on every `pick`, elapsedPct on every `mark` (from its own `ts`, so this needs
 * no injected clock), thread streaks on every threaded `pick`, and round-1 prompt-sha
 * agreement on every re-panel — comparing each against what was actually written. Also checks
 * that every line parses as JSON with `ts, run, event` as its first three keys, and that no
 * run has two `slice` events. Pure function of the ledger's own contents. */
export function auditLedger(ledgerPath, { runFilter } = {}) {
  const rawLines = readLedgerLines(ledgerPath)
  if (rawLines.length === 0) {
    return { exitCode: 0, stdout: ['audit: no ledger file (or an empty one) — nothing to check.'], stderr: [] }
  }

  const problems = []
  const events = []
  rawLines.forEach((line, i) => {
    const lineNumber = i + 1
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch (err) {
      problems.push(`line ${lineNumber}: invalid JSON (${err.message})`)
      return
    }
    const keys = Object.keys(parsed)
    if (keys[0] !== 'ts' || keys[1] !== 'run' || keys[2] !== 'event') {
      problems.push(`line ${lineNumber}: keys must start with ts, run, event — got ${keys.slice(0, 3).join(', ')}`)
    }
    events.push({ ...parsed, __line: lineNumber })
  })

  const running = []
  for (const e of events) {
    if (e.event === 'start') {
      const expectedIndex = personaIndexAt(running)
      const expectedPersona = formatPersona(personaAt(expectedIndex))
      if (e.personaIndex !== expectedIndex) {
        problems.push(`line ${e.__line}: start ${e.run} stores personaIndex ${e.personaIndex}, replay derives ${expectedIndex}`)
      }
      if (e.persona !== expectedPersona) {
        problems.push(`line ${e.__line}: start ${e.run} stores persona "${e.persona}", replay derives "${expectedPersona}"`)
      }
      const prevRun = currentRunId(running)
      const expectedPrevSource =
        prevRun !== undefined ? (pickEventFor(running, prevRun)?.source ?? 'none') : 'none'
      if (e.prevPickSource !== expectedPrevSource) {
        problems.push(
          `line ${e.__line}: start ${e.run} stores prevPickSource "${e.prevPickSource}", replay derives "${expectedPrevSource}"`,
        )
      }
    }
    if (e.event === 'mark') {
      const startEv = startEventFor(running, e.run)
      if (startEv) {
        const expectedPct = round2(((Date.parse(e.ts) - Date.parse(startEv.ts)) / 60_000 / startEv.budgetMin) * 100)
        if (Math.abs(expectedPct - e.elapsedPct) > 0.01) {
          problems.push(`line ${e.__line}: mark ${e.section} stores elapsedPct ${e.elapsedPct}, replay derives ${expectedPct}`)
        }
      }
    }
    if (e.event === 'pick') {
      const expectedTier = deriveTier(e.cost, e.harm)
      if (e.tier !== expectedTier) {
        problems.push(`line ${e.__line}: pick stores tier "${e.tier}", replay derives "${expectedTier}" from cost=${e.cost} harm=${e.harm}`)
      }
      if (e.thread !== 'none') {
        const prevRun = previousRunId(running, e.run)
        const streak = consecutiveThreadStreak(running, prevRun, e.thread)
        if (streak >= 3) {
          problems.push(`line ${e.__line}: pick names thread "${e.thread}" for its ${streak + 1}th consecutive run — exceeds the 3-run cap`)
        }
      }
    }
    if (e.event === 'panel' && e.round > 1) {
      const round1 = roundOnePanel(running, e.run, e.role)
      if (round1 && round1.promptSha !== e.promptSha) {
        problems.push(`line ${e.__line}: panel round ${e.round} (${e.role}) prompt-sha diverges from its round-1 sha`)
      }
    }
    if (e.event === 'slice' && hasSlice(running, e.run)) {
      problems.push(`line ${e.__line}: run ${e.run} already had a slice event — exactly one gap per run`)
    }
    running.push(e)
  }

  if (problems.length > 0) return { exitCode: 1, stdout: [], stderr: problems }

  const runIds = [...new Set(events.filter((e) => e.event === 'start').map((e) => e.run))]
  const latest = runIds[runIds.length - 1]
  const summary = [`audit: ${events.length} event(s) across ${runIds.length} run(s) — clean`]
  if (latest !== undefined) summary.push(`latest run: ${latest}`)
  if (runFilter !== undefined && runFilter !== true) {
    summary.push(`run ${runFilter}: ${eventsForRun(events, runFilter).length} event(s)`)
  }
  return { exitCode: 0, stdout: summary, stderr: [] }
}

const cmdAudit = runCommand((args, ctx) => auditLedger(ctx.ledgerPath, { runFilter: args.flags.run }))

const cmdStatus = runCommand((args, ctx) => {
  const events = loadLedger(ctx.ledgerPath)
  const run = currentRunId(events)
  if (run === undefined) return ok('no run in progress — `start` has never been called against this ledger')

  const startEv = startEventFor(events, run)
  const pct = elapsedPct(events, run, ctx.now)
  const pick = pickEventFor(events, run)
  const runEvents = eventsForRun(events, run)
  const marksDone = SECTIONS.filter((s) => runEvents.some((e) => e.event === 'mark' && e.section === s))
  const sliced = hasSlice(events, run)
  const verdicted = runEvents.some((e) => e.event === 'verdict')

  const failing = []
  if (pct >= 60 && !sliced) failing.push('any further `mark` would be refused (>=60% elapsed, ABORT threshold, no slice)')
  const need = []
  if (!marksDone.includes('0')) need.push('mark 0')
  if (!marksDone.includes('8')) need.push('mark 8')
  if (!verdicted) need.push('verdict')
  if (!sliced) need.push('slice (unless outcome is abort)')
  if (need.length > 0) failing.push(`finish --outcome clean|shipped-not-clean would be refused: missing ${need.join(', ')}`)

  return {
    exitCode: 0,
    stdout: [
      `run: ${run}`,
      `persona: ${startEv.persona}`,
      `tier: ${pick ? pick.tier : 'not picked yet'}`,
      `elapsed: ${pct}% of ${startEv.budgetMin}m budget`,
      `marks done: ${marksDone.length ? marksDone.join(',') : 'none'}`,
      `gates that would currently fail: ${failing.length ? failing.join(' | ') : 'none'}`,
    ],
    stderr: [],
  }
})

// ---- CLI --------------------------------------------------------------------------------------

const COMMANDS = {
  start: cmdStart,
  mark: cmdMark,
  pick: cmdPick,
  thread: cmdThread,
  spec: cmdSpec,
  panel: cmdPanel,
  slice: cmdSlice,
  verdict: cmdVerdict,
  rewind: cmdRewind,
  finish: cmdFinish,
  audit: cmdAudit,
  status: cmdStatus,
}

const USAGE = `usage: node scripts/improve-run.mjs <${Object.keys(COMMANDS).join('|')}> [options]`

/** The whole CLI surface as one function: parses argv, resolves --ledger/--now from it (or
 * their defaults), and dispatches. `git` is the one thing NOT read from argv — inject a fake
 * here in tests rather than shelling out to the real repo. */
export function runCli(argv, { git: gitImpl = defaultGit } = {}) {
  const [sub, ...rest] = argv
  const cmd = COMMANDS[sub]
  if (!cmd) return { exitCode: 2, stdout: [], stderr: [USAGE] }

  const args = parseArgs(rest)
  const ctx = {
    ledgerPath: typeof args.flags.ledger === 'string' ? args.flags.ledger : DEFAULT_LEDGER,
    now: typeof args.flags.now === 'string' ? args.flags.now : new Date().toISOString(),
    git: gitImpl,
  }
  return cmd(args, ctx)
}

function main(argv) {
  const result = runCli(argv)
  for (const line of result.stdout) console.log(line)
  for (const line of result.stderr) console.error(line)
  return result.exitCode
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) process.exit(main(process.argv.slice(2)))
