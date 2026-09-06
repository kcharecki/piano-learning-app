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
 * The persona rotation alternates piano and drums (see PERSONAS below); `start` reports that
 * as a first-class `instrument` field, and `pick` must be told which instrument it is picking
 * FOR and be refused if that disagrees with the run's own persona. Without that gate the
 * alternation is decorative: sources 1b/1e are repo-wide, so a drums run's highest-scoring row
 * is very often a piano row, and picking it "succeeds" while the drums half of the app never
 * gets built. A `pick` can also open a thread against a named `--payoff` — the first thing
 * downstream a learner can actually practise — with `--prereqs <n>` fixing that thread's cap
 * at `n + 1` runs instead of the default 3, because a chain opened by "prerequisites win" on N
 * prerequisites should not get abandoned one item short of anything usable. That cap counts
 * only runs of the thread's OWN instrument, fixed at the run that opened it — an intervening
 * run of the other instrument neither consumes it nor resets it.
 *
 * `finish --outcome clean|shipped-not-clean` is the payoff of the whole loop — the claim that
 * a real adversarial panel ran and (for `clean`) came back with nothing left to fix. Every
 * self-reported value that claim depends on is independently checked rather than taken on
 * faith: `slice --sha` must resolve to a real commit, `spec` must point at a non-trivial,
 * assertion-shaped file that actually exists at HEAD, and `panel` computes its own template
 * hash from `docs/panel/<role>.md` on disk instead of accepting one as a flag, so a caller
 * cannot claim a re-panel by retyping the same string. `finish` itself then requires a `spec`
 * event and a round-1 `panel` event for every seat the run's tier calls for (`clean`
 * additionally requires a full seat sweep at a named `--clean-round`, all reporting zero
 * BLOCKER/MAJOR) — skipping the panel now forces `shipped-not-clean` or `abort`, both visible
 * in the log. `--now` is gated behind `IMPROVE_RUN_ALLOW_FAKE_CLOCK=1` because it exists only
 * so tests can inject a deterministic clock: allowed unconditionally, it would let a live run
 * freeze `elapsedPct` at 0 forever and turn the 25/40/60% budget gates decorative. And `start`
 * refuses outright when git itself cannot be read (not a repo, or git unavailable) rather than
 * treating "git failed" the same as "git says clean" — a run that cannot see a repo cannot
 * verify anything in it.
 *
 *   node scripts/improve-run.mjs start [--budget <minutes, default 240>]
 *   node scripts/improve-run.mjs mark <0|1a|1b|1c|1d|1e|2|3|4|5|6|7|8>
 *   node scripts/improve-run.mjs pick --source <1a|1b|1c|1d|1e|reg|idea> --instrument <piano|drums>
 *       --class <VOID|THIN|BLIND|HARMFUL|MIS-GRADED|MIS-GATED|UNREACHABLE|FLAT>
 *       --sum <0-12> --cost <S|M|L> --leader-gap <n> --harm <0|1> --thread <slug|none>
 *       [--payoff <id> --prereqs <n>] --metric <name> --baseline <value>
 *   node scripts/improve-run.mjs thread --slug <slug> --state <open|abandoned|shipped>
 *       [--reason <text>]
 *   node scripts/improve-run.mjs spec --id <id> --red-exit <code>
 *   node scripts/improve-run.mjs panel --round <n> --role <role> --file <path>
 *       --blockers <n> --majors <n> --minors <n> [--panel-dir <dir, default docs/panel>]
 *   node scripts/improve-run.mjs slice --sha <sha>
 *   node scripts/improve-run.mjs verdict --value <n>|--none [--note <text>]
 *   node scripts/improve-run.mjs rewind --reason <text>
 *   node scripts/improve-run.mjs finish --outcome <clean|shipped-not-clean|abort>
 *       [--clean-round <n>, required iff --outcome clean] [--blocker <text>]
 *   node scripts/improve-run.mjs audit [--run <id>]
 *   node scripts/improve-run.mjs status
 *
 * Every subcommand also takes `--ledger <path>` (default `runs/ledger.ndjson`) and `--now
 * <iso>` (default the real clock; requires `IMPROVE_RUN_ALLOW_FAKE_CLOCK=1`, see above) — the
 * injection points that make this testable without ever touching real time or the real
 * ledger. `git` is not a flag: it is read through `defaultGit` below, and tests inject a fake
 * instead of shelling out to this repo.
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
// 'reg' (the cannot-sense register) and 'idea' (the idea register) are first-class discovery
// sources alongside 1a-1e (docs/improve-log.md "Entry schema", docs/commands/improve-app.md
// §1/§2) — NOT added to SECTIONS, which are the loop's fixed steps, not discovery sources.
const SOURCES = ['1a', '1b', '1c', '1d', '1e', 'reg', 'idea']
const COSTS = ['S', 'M', 'L']
const OUTCOMES = ['clean', 'shipped-not-clean', 'abort']
const THREAD_STATES = ['open', 'abandoned', 'shipped']
const INSTRUMENTS = ['piano', 'drums']
const DEFAULT_THREAD_CAP = 3

// Gap classes, in the order docs/improve/method.md's "Gap classes" table lists them. THIN is
// explicitly "the only non-deficiency class" there — every other class names a defect. VOID and
// THIN are also the two classes that count as new capability / under-served capability rather
// than repair, which is exactly why the innovation quota below keys off them.
const GAP_CLASSES = ['HARMFUL', 'MIS-GRADED', 'MIS-GATED', 'VOID', 'BLIND', 'UNREACHABLE', 'THIN', 'FLAT']

// 8 personas, alternating PIANO/DRUMS by table position. The alternation is load-bearing:
// without it, one instrument starves while the other gets every run (this app is two
// instruments in one shell — see DR-01). `personaIndexAt` below derives the next slot by
// replaying the ledger; nothing here is a mutable counter that could drift from it. The
// lowercase `instrument` a persona maps to (`instrumentOf` below) is what `start` records and
// what `pick`/thread caps are gated against.
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

// Which seats `finish` requires a round-1 (and, for `clean`, a clean-round) panel event from,
// by tier. Floor is the two seats that catch "this is broken" and "this used to work"; M adds
// the seat that catches "a learner would not understand this"; L — high-harm or genuinely
// large changes — adds the seat whose only job is to argue the change is wrong.
const SEATS_BY_TIER = {
  Floor: ['skeptic', 'regression-hunter'],
  M: ['skeptic', 'regression-hunter', 'teacher'],
  L: ['skeptic', 'regression-hunter', 'teacher', 'rival'],
}

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

const isRewound = (events, runId) => eventsForRun(events, runId).some((e) => e.event === 'rewind')

// The last run that still counts for the *next* run's sake. A rewound run gave its persona back
// and never reached section 8, so it answered no metric verdict and recorded no pick source: asking it
// for either deadlocks the ledger, because the one thing `rewind` cannot do is go back and
// record the verdict the run never owed. Walk back past every rewound run to the last live one.
// `currentRunId` is deliberately left alone -- `mark`/`pick`/`verdict` still address the run at
// the tip, and `rewind` doubles as the instrument pin the tests rely on.
function lastLiveRunId(events) {
  const runsInOrder = events.filter((e) => e.event === 'start').map((e) => e.run)
  for (let i = runsInOrder.length - 1; i >= 0; i -= 1) {
    const run = runsInOrder[i]
    if (run !== undefined && !isRewound(events, run)) return run
  }
  return undefined
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
// Mirrors hasSlice: a run gets exactly one metric verdict, the same way it gets exactly one
// slice — two verdicts on one run would mean the ledger has two answers for what the run's
// metric did and cannot say which is authoritative.
const hasVerdict = (events, runId) => eventsForRun(events, runId).some((e) => e.event === 'verdict')
// Same shape again: a run gets exactly one pick — this is the one `pickEventFor`'s `.find()`
// semantics make dangerous to skip, since a second pick wouldn't error, it would just be
// silently ignored by every reader that calls `pickEventFor` and gets the first one back.
const hasPick = (events, runId) => eventsForRun(events, runId).some((e) => e.event === 'pick')

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
const instrumentOf = (persona) => persona.kind.toLowerCase()

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

/** The pick event that OPENED thread `slug` — the first run (in ledger order) that named it —
 * or undefined if it has never been picked. The cap is fixed there and read back from that one
 * event, never recomputed anywhere else: 3 by default, or `prereqs + 1` when a `payoff` was
 * named at that opening pick. */
function threadCapInfo(events, slug) {
  const opening = events.find((e) => e.event === 'pick' && e.thread === slug)
  if (!opening) return undefined
  return {
    cap: opening.payoff !== undefined ? opening.prereqs + 1 : DEFAULT_THREAD_CAP,
    openingRun: opening.run,
    instrument: startEventFor(events, opening.run)?.instrument,
    payoff: opening.payoff,
    prereqs: opening.prereqs,
  }
}

const describeCapOrigin = (info) =>
  info.payoff !== undefined
    ? `payoff "${info.payoff}", ${info.prereqs} prerequisite(s), opened at run ${info.openingRun}`
    : `default cap, opened at run ${info.openingRun}`

// A pick "satisfies the innovation quota" (docs/commands/improve-app.md §2) iff it is new
// capability (class VOID), an under-served capability the app already has (class THIN), or came
// from one of the two registers that exist specifically to surface what the other four discovery
// sources structurally cannot (source reg = cannot-sense register, source idea = idea register).
// Every other class is a repair, however well it scores — the quota's whole job is to stop a
// process that can legitimately rank repairs highest every single run from doing that forever.
const satisfiesQuota = (pick) =>
  pick.class === 'VOID' || pick.class === 'THIN' || pick.source === 'reg' || pick.source === 'idea'

/** How many consecutive runs OF `instrument`, walking backward from just before `currentRunId`
 * through same-instrument runs only, picked a gap that did NOT satisfy the innovation quota
 * (`satisfiesQuota` above) — returned as the run ids themselves (most-recent-first), not a bare
 * count, so a refusal message can name them. Shape mirrors `consecutiveThreadStreak` below
 * exactly (same-instrument runs only, walked backward, an other-instrument run skipped over
 * entirely) with the match condition inverted: this counts MISSES and stops at the first run
 * that satisfies the quota, where `consecutiveThreadStreak` counts MATCHES and stops at the
 * first run that doesn't name the thread.
 *
 * A run with no `pick` event at all (an abort) counts as a MISS, not a stop. The quota's rule is
 * "no instrument goes three consecutive runs of its own without a VOID/THIN/reg/idea pick" — a
 * run that picked nothing picked no VOID/THIN/reg/idea either, and treating an abort as a free
 * pass would let an instrument dodge the quota forever by aborting every third run instead of
 * ever picking something that satisfies it. */
function consecutiveQuotaMissRuns(events, currentRunId, instrument) {
  const sameInstrumentRuns = [
    ...new Set(
      events.filter((e) => e.event === 'start' && e.instrument === instrument).map((e) => e.run),
    ),
  ]
  const missRuns = []
  for (let i = sameInstrumentRuns.indexOf(currentRunId) - 1; i >= 0; i--) {
    const pick = pickEventFor(events, sameInstrumentRuns[i])
    if (pick && satisfiesQuota(pick)) break
    missRuns.push(sameInstrumentRuns[i])
  }
  return missRuns
}

/** True iff `runId` is the run docs/commands/improve-app.md §2 describes as deferred: "A thread
 * the quota defers waits one run of its instrument, cap not advancing." Detected from the
 * ledger's own shape (the quota was already two misses deep going into this run, and this run's
 * pick satisfied it) rather than from a caller-supplied "I deferred" flag, so it can't be faked
 * and `audit` can recompute it exactly like everything else. */
function threadDeferredByQuota(events, runId, instrument) {
  const pick = pickEventFor(events, runId)
  if (!pick || !satisfiesQuota(pick)) return false
  return consecutiveQuotaMissRuns(events, runId, instrument).length >= 2
}

/** How many consecutive runs OF `instrument`, walking backward from just before
 * `currentRunId` through same-instrument runs only, picked `slug` as their thread. A run of
 * the OTHER instrument is skipped over entirely — it neither breaks nor extends the streak, so
 * an intervening drums run can't starve (or secretly advance) a piano thread's cap.
 *
 * A same-instrument run that names a DIFFERENT thread (or none) is normally where the count
 * stops — continuing a thread must be genuinely consecutive. The one exception is a run the
 * innovation quota deferred it away from (`threadDeferredByQuota` above): the quota outranks the
 * thread rule (docs/improve/method.md, "the three rules that override the table"), so complying
 * with it can't also cost the thread its cap. That run is transparent too — neither counted nor
 * a reason to stop counting further back — which is what "cap not advancing" means: held, not
 * reset. A rule that reset the streak on every deferral would let a thread run forever by
 * deferring once per cap. */
function consecutiveThreadStreak(events, currentRunId, slug, instrument) {
  const sameInstrumentRuns = [
    ...new Set(
      events.filter((e) => e.event === 'start' && e.instrument === instrument).map((e) => e.run),
    ),
  ]
  let streak = 0
  for (let i = sameInstrumentRuns.indexOf(currentRunId) - 1; i >= 0; i--) {
    const runId = sameInstrumentRuns[i]
    const pick = pickEventFor(events, runId)
    if (pick && pick.thread === slug) {
      streak++
      continue
    }
    if (threadDeferredByQuota(events, runId, instrument)) continue
    break
  }
  return streak
}

// `gapClass` participates in tier because `docs/commands/improve-app.md`'s tier table forces L
// for HARMFUL (harm) or VOID, not just for cost L: VOID is new capability, and L is the only
// tier that keeps a held-out goal, the one test that a new capability actually generalises.
// Without this, the innovation quota (which exists to force VOID/THIN picks) would route new
// capability to the CHEAPEST review instead of the most rigorous one. THIN is deliberately left
// out — it is under-serving something the app already does, not new capability, so it derives
// from cost like any other pick.
const deriveTier = (cost, harm, gapClass) => (harm || gapClass === 'VOID' ? 'L' : { S: 'Floor', M: 'M', L: 'L' }[cost])

const tierForRun = (events, runId) => pickEventFor(events, runId)?.tier
const roundOnePanel = (events, runId, role) =>
  eventsForRun(events, runId).find((e) => e.event === 'panel' && e.round === 1 && e.role === role)

/**
 * BLOCKER counts per panel round for one run, oldest round first, plus the first round (if any)
 * where the count failed to fall. A re-panel exists to check a fix; a round that comes back with
 * as many BLOCKERs as the one before it is evidence the fixing is producing faults faster than it
 * closes them, and the run has stopped converging. Run 2026-08-21-1 went 5 -> 6 -> 9 across three
 * rounds and spent 214% of its budget before a human called it: five of round 3's eight distinct
 * faults were CREATED by the round-2 fix, one of them re-opening a BLOCKER round 2 had closed.
 *
 * Deliberately conservative in one direction: an incomplete round sums fewer seats and so looks
 * like a fall, which lets it through. The rule is only ever asserted on a count that ROSE, never
 * inferred from one that dropped.
 */
function blockerRatchet(events, runId) {
  const byRound = new Map()
  for (const e of eventsForRun(events, runId)) {
    if (e.event !== 'panel' || !Number.isInteger(e.round)) continue
    const row = byRound.get(e.round) ?? { round: e.round, blockers: 0, seats: 0 }
    row.blockers += Number.isInteger(e.blockers) ? e.blockers : 0
    row.seats += 1
    byRound.set(e.round, row)
  }
  const rounds = [...byRound.values()].sort((a, b) => a.round - b.round)
  let rising
  for (let i = 1; i < rounds.length; i++) {
    if (rounds[i].blockers >= rounds[i - 1].blockers) {
      rising = { prev: rounds[i - 1], curr: rounds[i] }
      break
    }
  }
  return { rounds, rising }
}

/** The sentence both `panel` and `finish` print for a run whose BLOCKER count stopped falling. */
const describeRatchet = ({ prev, curr }) =>
  `round ${curr.round} reported ${curr.blockers} BLOCKER(s) across ${curr.seats} seat(s) and ` +
  `round ${prev.round} reported ${prev.blockers} across ${prev.seats} — the count did not fall, ` +
  `so the fixing is not converging`

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

// ---- git (injectable) -----------------------------------------------------------------------
// The only impure reads that are NOT `--ledger`/`--now`. Tests inject a fake `git` object
// into `runCli` rather than exercising this against the real repo.

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

// `null` from statusPorcelain/gitDir/gitCommonDir is a distinct sentinel from `''`: `''` means
// "git ran and said nothing" (a clean tree; a dir that equals itself), `null` means "git could
// not be asked" (no repo, or git missing). Collapsing those two into the same `''` is exactly
// what let a non-repo directory sail through `start`'s gates — see cmdStart below.
export const defaultGit = {
  statusPorcelain: () => {
    try {
      return git(['status', '--porcelain'])
    } catch {
      return null
    }
  },
  gitDir: () => {
    try {
      return git(['rev-parse', '--absolute-git-dir'])
    } catch {
      return null
    }
  },
  gitCommonDir: () => {
    try {
      return git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    } catch {
      return null
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
  verifyCommit: (sha) => {
    try {
      git(['rev-parse', '--verify', `${sha}^{commit}`])
      return true
    } catch {
      return false
    }
  },
  showFile: (ref, path) => {
    try {
      return git(['show', `${ref}:${path}`])
    } catch {
      return undefined
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

  const status = ctx.git.statusPorcelain()
  if (status === null) {
    throw new RuleViolation(
      'start refused: `git status --porcelain` failed — this does not look like a git ' +
        'repository (or git is unavailable). A run that cannot see a repo cannot verify ' +
        'anything in it and must not start.',
    )
  }
  if (status) {
    throw new RuleViolation(
      'start refused: the working tree is dirty (`git status --porcelain` is non-empty). ' +
        'Commit or stash before starting a run.',
    )
  }
  const gitDir = ctx.git.gitDir()
  const gitCommonDir = ctx.git.gitCommonDir()
  if (gitDir === null || gitCommonDir === null) {
    throw new RuleViolation(
      'start refused: git repo info is unavailable (`git rev-parse` failed) — this does not ' +
        'look like a git repository. A run that cannot see a repo cannot verify anything in ' +
        'it and must not start.',
    )
  }
  if (gitDir !== gitCommonDir) {
    throw new RuleViolation(
      'start refused: this checkout is a git worktree, not the main checkout. ' +
        '/improve-app runs only in the main checkout (docs/WORKTREES.md).',
    )
  }

  const events = loadLedger(ctx.ledgerPath)
  const prevRun = lastLiveRunId(events)
  if (prevRun !== undefined && !eventsForRun(events, prevRun).some((e) => e.event === 'verdict')) {
    throw new RuleViolation(
      `start refused: previous run ${prevRun} has no \`verdict\` event — a skipped metric ` +
        `verdict must block the next run. Resolve it first: ` +
        `node scripts/improve-run.mjs verdict --value <n>|--none --ledger ${ctx.ledgerPath}`,
    )
  }

  const personaIndex = personaIndexAt(events)
  const persona = personaAt(personaIndex)
  const instrument = instrumentOf(persona)
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
      instrument,
      prevPickSource,
    }),
  )
  mkdirSync(join(dirname(ctx.ledgerPath), run), { recursive: true })

  return ok(
    `run ${run} started — persona: ${formatPersona(persona)}, instrument: ${instrument}, ` +
      `budget ${budgetMin}m, prevPickSource: ${prevPickSource}`,
  )
})

const cmdMark = runCommand((args, ctx) => {
  const { positionals, flags } = args
  const section = positionals[0]
  if (!section || !SECTIONS.includes(section)) {
    // `section` is positional (`mark 0`), not a flag. `mark --section 0` leaves `positionals`
    // empty — parseArgs consumes "0" as --section's value — so the operator who typed exactly
    // that sees `got ""` and is told they passed nothing, when they very much did. Say the
    // section is positional always, and call out --section by name when that's what happened.
    const sectionFlagNote =
      flags.section !== undefined
        ? ' `--section` is not a flag here — the section is positional: `mark 0`.'
        : ''
    throw new UsageError(
      `mark requires a section from {${SECTIONS.join(',')}} as its positional argument (e.g. ` +
        `\`mark 0\`), got "${section ?? ''}".${sectionFlagNote}`,
    )
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
  const instrumentFlag = requireEnum(flags, 'instrument', INSTRUMENTS)
  // `class` is a reserved word — it's fine as a property key (`e.class`, `{ class: ... }`) but
  // not as a bare binding, so the local is named `gapClass`.
  const gapClass = requireEnum(flags, 'class', GAP_CLASSES)
  const sum = requireInt(flags, 'sum', { min: 0, max: 12 })
  const cost = requireEnum(flags, 'cost', COSTS)
  const leaderGap = requireInt(flags, 'leader-gap')
  const harm = requireInt(flags, 'harm', { min: 0, max: 1 })
  const thread = requireFlag(flags, 'thread')
  const metric = requireFlag(flags, 'metric')
  const baseline = requireFlag(flags, 'baseline')
  const payoffGiven = flags.payoff !== undefined
  const payoff = payoffGiven ? requireFlag(flags, 'payoff') : undefined
  const prereqsGiven = flags.prereqs !== undefined

  // --harm 1 and --class HARMFUL are two spellings of the same claim: docs/improve/method.md
  // defines the harm gate as requiring exactly the HARMFUL class's evidence bar (a missing guard
  // named at file:line, plus a cited source calling the habit a defect), so a pick invoking one
  // without the other is asserting two different things about the same gap. Require them to
  // agree both ways — harm=1 under a milder class would smuggle the ranking override in behind a
  // label that hides what happened, and class=HARMFUL with harm=0 claims the evidence bar was
  // met but declines the one override it exists to grant, which is not a claim an auditor reading
  // the ledger later can make sense of either.
  if ((harm === 1) !== (gapClass === 'HARMFUL')) {
    throw new UsageError(
      `--harm 1 and --class HARMFUL must agree (got --harm ${harm} with --class ${gapClass}) — ` +
        'pass both together (the pick is HARMFUL and invokes the harm gate) or neither.',
    )
  }

  if (payoffGiven && thread === 'none') {
    throw new UsageError('--payoff requires --thread (a payoff caps a thread, not a threadless pick)')
  }
  if (prereqsGiven && !payoffGiven) {
    throw new UsageError('--prereqs requires --payoff')
  }

  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)

  // Mirrors the `slice` guard's shape exactly: a run gets exactly one gap, so a second `pick`
  // for the same run is refused rather than silently accepted. This matters more than it looks —
  // `pickEventFor` is a `.find()`, first match wins, so every consumer of a run's pick (tier,
  // the innovation quota, thread streaks, the next run's prevPickSource, `finish`'s panel-seat
  // requirements) would silently keep reading the FIRST pick forever while the ledger's own text
  // said the operator had moved on to a second one.
  const existingPick = pickEventFor(events, run)
  if (existingPick) {
    throw new RuleViolation(
      `pick refused: run ${run} already has a pick event (source "${existingPick.source}", ` +
        `class "${existingPick.class}") — exactly one gap per run. Rewind if this run's pick ` +
        'was a mistake and needs to be redone, or finish the run: reconsidering a gap belongs to ' +
        "the next run's pick, not a second one on this run.",
    )
  }

  const startEv = startEventFor(events, run)

  if (instrumentFlag !== startEv.instrument) {
    throw new RuleViolation(
      `pick refused: --instrument ${instrumentFlag} does not match run ${run}'s persona ` +
        `instrument "${startEv.instrument}". Pass --instrument ${startEv.instrument}, or pick ` +
        'nothing this run.',
    )
  }

  // Innovation quota (docs/commands/improve-app.md §2): no instrument goes three consecutive
  // runs of its own without a VOID, THIN, reg, or idea pick. This is checked independent of
  // --thread and ahead of the repeat-source/thread-continuation logic below because it outranks
  // the thread rule — prerequisites-win and continue-then-rotate can each be won by a repair, but
  // the quota firing is not an exception either of them can buy their way past. If this pick
  // would be the instrument's 3rd consecutive miss, it must satisfy the quota itself; naming an
  // open thread is not, on its own, an excuse (that thread's cap is protected instead — see
  // `threadDeferredByQuota` above — by deferring it, not by exempting this pick).
  const quotaMissRuns = consecutiveQuotaMissRuns(events, run, instrumentFlag)
  if (quotaMissRuns.length >= 2 && !satisfiesQuota({ class: gapClass, source })) {
    const [mostRecent, secondMostRecent] = quotaMissRuns
    throw new RuleViolation(
      `pick refused: ${instrumentFlag} would go a 3rd consecutive run without a VOID, THIN, reg, ` +
        `or idea pick — runs ${secondMostRecent} and ${mostRecent} already missed it. Satisfy the ` +
        'quota this run with --class VOID, --class THIN, --source reg, or --source idea — or, if ' +
        'you meant to continue an open thread instead, defer it: its cap will not advance for ' +
        'this run.',
    )
  }

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

  let cap
  let capInstrument
  let eventPayoff
  let eventPrereqs
  if (thread !== 'none') {
    const existing = threadCapInfo(events, thread)
    if (existing === undefined) {
      capInstrument = startEv.instrument
      if (payoffGiven) {
        eventPrereqs = requireInt(flags, 'prereqs', { min: 0 })
        eventPayoff = payoff
        cap = eventPrereqs + 1
      } else {
        cap = DEFAULT_THREAD_CAP
      }
    } else {
      if (payoffGiven || prereqsGiven) {
        throw new RuleViolation(
          `pick refused: thread "${thread}" was already opened at run ${existing.openingRun} ` +
            `(cap ${existing.cap}, ${describeCapOrigin(existing)}) — --payoff/--prereqs must ` +
            'not be re-passed on a later run.',
        )
      }
      cap = existing.cap
      capInstrument = existing.instrument
    }

    const streak = consecutiveThreadStreak(events, run, thread, capInstrument)
    if (streak >= cap) {
      const origin = existing ?? { payoff: eventPayoff, prereqs: eventPrereqs, openingRun: run }
      throw new RuleViolation(
        `pick refused: thread "${thread}" has already been picked for ${streak} consecutive ` +
          `${capInstrument} run(s) — its cap is ${cap} (${describeCapOrigin(origin)}). Ship or ` +
          `abandon it in writing first: node scripts/improve-run.mjs thread --slug ${thread} ` +
          `--state shipped|abandoned --ledger ${ctx.ledgerPath}`,
      )
    }
  }

  const tier = deriveTier(cost, harm, gapClass)
  appendEvent(
    ctx.ledgerPath,
    buildEvent(ctx.now, run, 'pick', {
      source,
      instrument: instrumentFlag,
      class: gapClass,
      sum,
      cost,
      tier,
      harm,
      thread,
      payoff: eventPayoff,
      prereqs: eventPrereqs,
      metric,
      baseline,
    }),
  )
  const tierForcedBy = harm ? 'harm' : gapClass === 'VOID' ? 'VOID class' : null
  return ok(`pick recorded: source ${source}, class ${gapClass}, tier ${tier}${tierForcedBy ? ` (${tierForcedBy} forces L)` : ''}`)
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

  // This can only prove a real, non-trivial spec file with an assertion-shaped call exists at
  // HEAD — it cannot prove the test genuinely went RED before this commit. --red-exit plus a
  // human/agent honestly running the test is still what carries that half of the claim.
  const content = ctx.git.showFile('HEAD', expected)
  const nonTrivial = typeof content === 'string' && content.trim().length > 0
  const hasAssertion = nonTrivial && /\b(expect|assert)\s*\(/.test(content)
  if (!nonTrivial || !hasAssertion) {
    throw new RuleViolation(
      `spec refused: ${expected} is missing, empty, or has no assertion-shaped call ` +
        '(expect(...)/assert(...)) at HEAD.',
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
  const file = requireFlag(flags, 'file')
  const panelDir = typeof flags['panel-dir'] === 'string' ? flags['panel-dir'] : 'docs/panel'
  const blockers = requireInt(flags, 'blockers', { min: 0 })
  const majors = requireInt(flags, 'majors', { min: 0 })
  const minors = requireInt(flags, 'minors', { min: 0 })

  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  const tier = tierForRun(events, run)
  if (!tier) throw new RuleViolation(`panel refused: run ${run} has no \`pick\` event yet, so its tier is unknown.`)

  // The template hash is COMPUTED, not accepted as a flag: a caller who just retypes the same
  // string for round 2 no longer counts as a re-panel. This is what makes round-2 drift
  // detection (below, and in auditLedger) about the actual contents of docs/panel/<role>.md
  // rather than about whether the caller was consistent with themselves.
  const templatePath = join(panelDir, `${role}.md`)
  const templateSha = sha256File(templatePath)

  const round1 = roundOnePanel(events, run, role)
  if (round > 1) {
    if (!round1) {
      throw new RuleViolation(
        `panel refused: round ${round} for role "${role}" has no round-1 panel event to compare its template against.`,
      )
    }
    if (round1.templateSha !== templateSha) {
      throw new RuleViolation(
        `panel refused: round ${round}'s docs/panel/${role}.md template hash differs from role ` +
          `"${role}"'s round-1 template hash. A weaker round is not a re-panel.`,
      )
    }
  }

  const maxRound = 1 + REPANEL_CAP[tier]
  if (round > maxRound) {
    throw new RuleViolation(`panel refused: round ${round} exceeds tier ${tier}'s re-panel cap (max round ${maxRound}).`)
  }

  // The ratchet stops the polish loop, not just the outcome. Once a round has failed to fall, the
  // only outcome `finish` will accept is `abort`, so every later round reviews a fix that cannot
  // change the result -- and run 2026-09-06-1 spent its whole back half proving that: the latch
  // fired at round 2, a fix commit followed anyway, and round 3's unique yield was two faults IN
  // THAT FIX, both deleted by the revert an hour later. Printing the advice at the latch was not
  // enough; this is the same sentence as a gate.
  //
  // Bounded to rounds AFTER the latched one so a partially-recorded round can always be finished:
  // the sum that raises the ratchet is reached mid-round, and refusing the remaining seats would
  // leave the ledger holding half a round forever.
  const { rising: latched } = blockerRatchet(events, run)
  if (latched && round > latched.curr.round) {
    throw new RuleViolation(
      `panel refused: ${describeRatchet(latched)}, so this run can only finish as \`abort\` and ` +
        `round ${round} cannot change that. Revert the implementation commits, keep the spec ` +
        'commit, file the findings already on disk as `T.<n>`, then `finish --outcome abort`.',
    )
  }

  const renderedSha = sha256File(file)
  appendEvent(
    ctx.ledgerPath,
    buildEvent(ctx.now, run, 'panel', { round, role, templateSha, renderedSha, blockers, majors, minors }),
  )
  const lines = [
    `panel round ${round} (${role}) recorded, tier ${tier}, ${blockers} blocker(s)/${majors} major(s)/${minors} minor(s)`,
  ]
  // Said HERE, not only at `finish`: the point of the ratchet is to stop the NEXT fix round from
  // being started, and by `finish` that budget is already spent.
  const { rising } = blockerRatchet(loadLedger(ctx.ledgerPath), run)
  if (rising) {
    lines.push(
      `RATCHET: ${describeRatchet(rising)}. This run can now only finish as \`abort\` — ` +
        `revert the implementation commits, keep the spec commit, file the BLOCKERs as \`T.<n>\`.`,
    )
  }
  return { exitCode: 0, stdout: lines, stderr: [] }
})

const cmdSlice = runCommand((args, ctx) => {
  const sha = requireFlag(args.flags, 'sha')
  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  if (hasSlice(events, run)) {
    throw new RuleViolation(`slice refused: run ${run} already has a slice event — exactly one gap per run.`)
  }
  if (!ctx.git.verifyCommit(sha)) {
    throw new RuleViolation(
      `slice refused: --sha "${sha}" does not resolve to a real commit (git rev-parse --verify failed).`,
    )
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
  // Mirrors the `slice` guard: one verdict per run, because two verdicts on the same run would
  // give the ledger two answers for what the run's metric did with no way to say which counts.
  if (hasVerdict(events, run)) {
    throw new RuleViolation(
      `verdict refused: run ${run} already has a verdict event — exactly one metric answer per ` +
        'run. The ledger is append-only, so a wrong first verdict cannot be edited here; note ' +
        'the correction in the next run instead of recording a second verdict for this one.',
    )
  }
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

  // `--clean-round` is required (not optional/inferred) for `clean` specifically: "clean" is a
  // claim about ONE named round having come back with nothing left to fix, so the caller must
  // say which round that was rather than the check picking "the highest round it can find".
  let cleanRound
  if (outcome === 'clean') cleanRound = requireInt(flags, 'clean-round', { min: 1 })

  const events = loadLedger(ctx.ledgerPath)
  const run = requireCurrentRun(events)
  const runEvents = eventsForRun(events, run)
  const pick = pickEventFor(events, run)
  const tier = pick?.tier

  const missing = []
  if (!runEvents.some((e) => e.event === 'mark' && e.section === '0')) missing.push('mark 0')
  if (!runEvents.some((e) => e.event === 'mark' && e.section === '8')) missing.push('mark 8')
  if (!runEvents.some((e) => e.event === 'verdict')) missing.push('verdict')
  if (outcome !== 'abort' && !runEvents.some((e) => e.event === 'slice')) missing.push('slice')

  // Anything other than `abort` claims real engineering happened, which means a spec that went
  // RED-then-GREEN and a full round-1 panel sweep for the run's tier — skipping either now
  // forces `shipped-not-clean` or `abort` instead, both visible in the ledger as exactly that.
  if (outcome !== 'abort') {
    if (!runEvents.some((e) => e.event === 'spec')) missing.push('spec')
    if (!pick) {
      missing.push('pick (tier unknown — required to determine which panel seats are mandatory)')
    } else {
      const seats = SEATS_BY_TIER[tier]
      for (const seat of seats) {
        if (!runEvents.some((e) => e.event === 'panel' && e.round === 1 && e.role === seat)) {
          missing.push(`panel round 1 (${seat})`)
        }
      }
      // cleanRound === 1 is already fully covered by the round-1 loop above — a single sweep
      // can satisfy both requirements, so this only runs (and only reports) the extra rounds.
      if (outcome === 'clean' && cleanRound !== 1) {
        for (const seat of seats) {
          if (!runEvents.some((e) => e.event === 'panel' && e.round === cleanRound && e.role === seat)) {
            missing.push(`panel round ${cleanRound} (${seat})`)
          }
        }
      }
    }
  }

  if (missing.length > 0) {
    throw new RuleViolation(`finish refused: run ${run} is missing ${missing.join(', ')}.`)
  }

  if (outcome !== 'abort') {
    const { rising } = blockerRatchet(events, run)
    if (rising) {
      throw new RuleViolation(
        `finish refused: --outcome ${outcome} is not available on a run whose BLOCKER count stopped ` +
          `falling — ${describeRatchet(rising)}. Finish as \`abort\`: revert the implementation ` +
          `commits, keep the spec commit, and file the BLOCKERs as \`T.<n>\` triage items.`,
      )
    }
  }

  if (outcome === 'clean') {
    const seats = SEATS_BY_TIER[tier]
    const cleanRoundPanels = seats.map((seat) =>
      runEvents.find((e) => e.event === 'panel' && e.round === cleanRound && e.role === seat),
    )
    const failing = cleanRoundPanels.filter((p) => p.blockers > 0 || p.majors > 0)
    if (failing.length > 0) {
      throw new RuleViolation(
        `finish refused: --outcome clean requires zero BLOCKER and zero MAJOR at round ${cleanRound} — ` +
          failing.map((p) => `${p.role} reported ${p.blockers} blocker(s), ${p.majors} major(s)`).join('; ') +
          '. Fix the findings (or ship shipped-not-clean / abort) rather than editing the numbers.',
      )
    }
  }

  appendEvent(ctx.ledgerPath, buildEvent(ctx.now, run, 'finish', { outcome, blocker, cleanRound }))
  return ok(`run ${run} finished: ${outcome}`)
})

/** Replays the whole ledger, re-deriving personaIndex/persona/instrument/prevPickSource on
 * every `start`, tier/instrument on every `pick`, elapsedPct on every `mark` (from its own
 * `ts`, so this needs no injected clock), thread caps and instrument-scoped streaks on every
 * threaded `pick` (including whether a later run of a thread illegally re-passes or disagrees
 * with the payoff/prereqs its opening run recorded), and round-1 template-sha agreement on every
 * re-panel — comparing each against what was actually written. Also checks that every line
 * parses as JSON with `ts, run, event` as its first three keys, and that no run has two
 * `slice` events. Pure function of the ledger's own contents. */
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
      const expectedPersonaObj = personaAt(expectedIndex)
      const expectedPersona = formatPersona(expectedPersonaObj)
      const expectedInstrument = instrumentOf(expectedPersonaObj)
      if (e.personaIndex !== expectedIndex) {
        problems.push(`line ${e.__line}: start ${e.run} stores personaIndex ${e.personaIndex}, replay derives ${expectedIndex}`)
      }
      if (e.persona !== expectedPersona) {
        problems.push(`line ${e.__line}: start ${e.run} stores persona "${e.persona}", replay derives "${expectedPersona}"`)
      }
      if (e.instrument !== expectedInstrument) {
        problems.push(`line ${e.__line}: start ${e.run} stores instrument "${e.instrument}", replay derives "${expectedInstrument}"`)
      }
      const prevRun = lastLiveRunId(running)
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
        // `Math.abs(expectedPct - e.elapsedPct) > 0.01` is FALSE whenever e.elapsedPct is
        // non-numeric (null, a string, absent) — `NaN > 0.01` is false, so a corrupt value used
        // to sail through as "clean" instead of being reported. Guard the type first.
        if (!Number.isFinite(e.elapsedPct)) {
          problems.push(`line ${e.__line}: mark ${e.section} stores a non-finite/missing elapsedPct (${JSON.stringify(e.elapsedPct)}), replay derives ${expectedPct}`)
        } else if (Math.abs(expectedPct - e.elapsedPct) > 0.01) {
          problems.push(`line ${e.__line}: mark ${e.section} stores elapsedPct ${e.elapsedPct}, replay derives ${expectedPct}`)
        }
      }
    }
    if (e.event === 'pick') {
      if (hasPick(running, e.run)) {
        problems.push(`line ${e.__line}: run ${e.run} already had a pick event — exactly one gap per run`)
      }
      const expectedTier = deriveTier(e.cost, e.harm, e.class)
      if (e.tier !== expectedTier) {
        problems.push(`line ${e.__line}: pick stores tier "${e.tier}", replay derives "${expectedTier}" from cost=${e.cost} harm=${e.harm} class=${e.class}`)
      }
      const expectedInstrument = startEventFor(running, e.run)?.instrument
      if (e.instrument !== expectedInstrument) {
        problems.push(`line ${e.__line}: pick stores instrument "${e.instrument}", run ${e.run}'s persona instrument is "${expectedInstrument}"`)
      }
      // A hand-edited ledger can put anything in `class` — requireEnum only guards the write
      // path. Validate it against GAP_CLASSES here the same way sum/prereqs/round are validated
      // below, so a bad value is reported rather than just quietly failing satisfiesQuota (which
      // would count it as a quota miss by luck, not by rule).
      if (!GAP_CLASSES.includes(e.class)) {
        problems.push(`line ${e.__line}: pick stores an invalid class (${JSON.stringify(e.class)}) — must be one of ${GAP_CLASSES.join('|')}`)
      }
      // Same NaN-masking shape as elapsedPct above: `sum` feeds nothing derived today, but an
      // out-of-range or non-numeric value should still be caught on replay rather than only at
      // write time (where requireInt already bounds it 0-12).
      if (!Number.isInteger(e.sum) || e.sum < 0 || e.sum > 12) {
        problems.push(`line ${e.__line}: pick stores a non-integer/out-of-range sum (${JSON.stringify(e.sum)})`)
      }
      const quotaMissRuns = consecutiveQuotaMissRuns(running, e.run, expectedInstrument)
      if (quotaMissRuns.length >= 2 && !satisfiesQuota(e)) {
        const [mostRecent, secondMostRecent] = quotaMissRuns
        problems.push(
          `line ${e.__line}: pick violates the innovation quota — ${expectedInstrument} runs ` +
            `${secondMostRecent} and ${mostRecent} already missed it, and this pick (class ` +
            `${e.class}, source ${e.source}) does not satisfy VOID/THIN/reg/idea either`,
        )
      }
      if (e.thread !== 'none') {
        const existing = threadCapInfo(running, e.thread)
        const isFirstRun = existing === undefined
        if (!isFirstRun && (e.payoff !== undefined || e.prereqs !== undefined)) {
          const agrees = e.payoff === existing.payoff && e.prereqs === existing.prereqs
          problems.push(
            agrees
              ? `line ${e.__line}: pick re-passes payoff/prereqs for thread "${e.thread}" on a later run (opened at run ${existing.openingRun}) — must not be re-passed`
              : `line ${e.__line}: pick's payoff/prereqs for thread "${e.thread}" (payoff ${e.payoff}, prereqs ${e.prereqs}) disagree with the values recorded when it opened at run ${existing.openingRun} (payoff ${existing.payoff}, prereqs ${existing.prereqs})`,
          )
        }
        // A corrupt `prereqs` on the opening pick of a payoff thread would otherwise feed
        // straight into `e.prereqs + 1` (NaN, or string concatenation) and make `streak >= cap`
        // silently false forever — the same shape of bug as elapsedPct, just reached through cap
        // arithmetic instead of a threshold comparison. Report it and skip the cap/streak check
        // for this line rather than let a corrupt cap "pass".
        const prereqsCorrupt =
          isFirstRun && e.payoff !== undefined && !(Number.isInteger(e.prereqs) && e.prereqs >= 0)
        if (prereqsCorrupt) {
          problems.push(`line ${e.__line}: pick opens thread "${e.thread}" with a non-integer/negative prereqs (${JSON.stringify(e.prereqs)}) — its cap cannot be derived`)
        } else {
          const cap = isFirstRun ? (e.payoff !== undefined ? e.prereqs + 1 : DEFAULT_THREAD_CAP) : existing.cap
          const capInstrument = isFirstRun ? expectedInstrument : existing.instrument
          const streak = consecutiveThreadStreak(running, e.run, e.thread, capInstrument)
          if (streak >= cap) {
            problems.push(`line ${e.__line}: pick names thread "${e.thread}" for its ${streak + 1}th consecutive ${capInstrument} run — exceeds its cap of ${cap}`)
          }
        }
      }
    }
    if (e.event === 'panel') {
      // Same NaN-masking shape again: `e.round > 1` is false for a non-numeric round, which
      // would silently skip the round-2+ template-drift check below rather than flag the
      // corruption.
      if (!Number.isInteger(e.round) || e.round < 1) {
        problems.push(`line ${e.__line}: panel stores a non-integer/invalid round (${JSON.stringify(e.round)})`)
      } else if (e.round > 1) {
        const round1 = roundOnePanel(running, e.run, e.role)
        if (round1 && round1.templateSha !== e.templateSha) {
          problems.push(`line ${e.__line}: panel round ${e.round} (${e.role}) template-sha diverges from its round-1 sha`)
        }
      }
    }
    if (e.event === 'slice' && hasSlice(running, e.run)) {
      problems.push(`line ${e.__line}: run ${e.run} already had a slice event — exactly one gap per run`)
    }
    if (e.event === 'verdict' && hasVerdict(running, e.run)) {
      problems.push(`line ${e.__line}: run ${e.run} already had a verdict event — exactly one metric answer per run`)
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

  let threadLine = 'active thread: none'
  if (pick && pick.thread && pick.thread !== 'none') {
    const info = threadCapInfo(events, pick.thread)
    const k = consecutiveThreadStreak(events, run, pick.thread, info.instrument) + 1
    threadLine = `active thread: ${pick.thread} — run ${k} of ${info.cap} (${describeCapOrigin(info)})`
  }

  const failing = []
  if (pct >= 60 && !sliced) failing.push('any further `mark` would be refused (>=60% elapsed, ABORT threshold, no slice)')
  const need = []
  if (!marksDone.includes('0')) need.push('mark 0')
  if (!marksDone.includes('8')) need.push('mark 8')
  if (!verdicted) need.push('verdict')
  if (!sliced) need.push('slice (unless outcome is abort)')
  if (!runEvents.some((e) => e.event === 'spec')) need.push('spec (unless outcome is abort)')
  // Clean-round-specific panel requirements are deliberately omitted here: status doesn't know
  // ahead of time whether the caller intends `clean` or `shipped-not-clean`, so it previews
  // only the round-1 sweep every non-abort outcome shares.
  if (!pick) {
    need.push('pick (unless outcome is abort) — tier unknown, so required panel seats unknown')
  } else {
    const seats = SEATS_BY_TIER[pick.tier]
    for (const seat of seats) {
      if (!runEvents.some((e) => e.event === 'panel' && e.round === 1 && e.role === seat)) {
        need.push(`panel round 1 (${seat}, unless outcome is abort)`)
      }
    }
  }
  if (need.length > 0) failing.push(`finish --outcome clean|shipped-not-clean would be refused: missing ${need.join(', ')}`)
  const ratchet = blockerRatchet(events, run)
  if (ratchet.rising) {
    failing.push(`finish --outcome clean|shipped-not-clean would be refused: ${describeRatchet(ratchet.rising)}`)
  }

  return {
    exitCode: 0,
    stdout: [
      `run: ${run}`,
      `persona: ${startEv.persona}`,
      `instrument: ${startEv.instrument}`,
      `tier: ${pick ? pick.tier : 'not picked yet'}`,
      threadLine,
      `prev pick source: ${startEv.prevPickSource}`,
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
  try {
    let now = new Date().toISOString()
    if (typeof args.flags.now === 'string') {
      if (process.env.IMPROVE_RUN_ALLOW_FAKE_CLOCK !== '1') {
        // --now exists ONLY so tests can inject a deterministic clock (see
        // scripts/improve-run.test.mjs). Allowing it unconditionally would let a live run
        // freeze elapsedPct at 0 forever, making the 25%/40%/60% budget gates decorative — so
        // it requires this explicit, unmissable opt-in rather than just being a flag anyone
        // can pass.
        throw new UsageError(
          '--now requires IMPROVE_RUN_ALLOW_FAKE_CLOCK=1 in the environment; it exists for tests only.',
        )
      }
      now = args.flags.now
      // A bad --now (unparseable, or parseable to a non-finite timestamp) would corrupt every
      // elapsedPct derived from it downstream, silently, since Date.parse of garbage is NaN and
      // arithmetic on NaN never throws — it just produces more NaN. Catch it here, at the one
      // place a caller-supplied clock value enters the system, rather than at every place it's
      // later used.
      if (!Number.isFinite(Date.parse(now))) {
        throw new UsageError(`--now must parse to a valid ISO timestamp, got "${now}"`)
      }
    }
    const ctx = {
      ledgerPath: typeof args.flags.ledger === 'string' ? args.flags.ledger : DEFAULT_LEDGER,
      now,
      git: gitImpl,
    }
    return cmd(args, ctx)
  } catch (err) {
    if (err instanceof UsageError) return { exitCode: 2, stdout: [], stderr: [`usage: ${err.message}`] }
    return { exitCode: 1, stdout: [], stderr: [err.message] }
  }
}

function main(argv) {
  const result = runCli(argv)
  for (const line of result.stdout) console.log(line)
  for (const line of result.stderr) console.error(line)
  return result.exitCode
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) process.exit(main(process.argv.slice(2)))
