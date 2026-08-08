# How to work on this project efficiently

> **2026-08-08: the round protocol described here is superseded by `docs/PROCESS.md`**
> (vertical slices + experience gate + retro). Still live from this file: the telemetry
> (§1–§8, as evidence), and **Appendices A–D** — the agent prompt templates and workflow
> skeleton, which PROCESS.md's delegation rules reference. The "drop-in replacement"
> section at the bottom is historical.

Audience: the orchestrating agent at the start of a session. Grounded in measured telemetry from
the 2026-07-31 → 08-01 session ([efficiency-guide-prompt.md](efficiency-guide-prompt.md)); every
claim cites a numbered fact from it. Where a recommendation goes beyond the telemetry it is marked
**[extrapolation]**. Optimisation target, in order: user wall-clock to a *working* feature, then
tokens.

---

## Do this next session (the one-page checklist)

1. `git status` first. Tree dirty → recover it (see §5) before anything else. The current tree
   holds a whole unverified Phase 2 round (fact 6): verify → slice-commit → review, in that order.
2. Write the module contracts (types + signatures + requirement IDs) *before* spawning builders.
3. Run rounds of **at most 6 modules**, one pipelined chain per module:
   build (Sonnet) → adversarial review (Opus) → fix (Sonnet) — no cross-module barrier.
4. Never run review, fix, or re-review as a separate workflow after a build workflow. Fold them
   into the module's chain. Standalone aftermath cost 100 min of serial wall last session.
5. Paste the context brief (Appendix A) into every agent prompt. Never write "Read CLAUDE.md
   and…" — that habit cost ~71 agents their own re-orientation (fact 4).
6. Every agent prompt names the exact files it owns. Shared files (Shell, routes, store wiring)
   are main-thread-only and serial.
7. Agents run only their scoped tests (`npx vitest run <their dir>`), never the full suite —
   that is what made two agents collide (fact 7).
8. Commit **per module as it lands green**, not per round. A kill then costs ≤ 1 module.
9. Main thread types only integration glue under ~20 lines per file. 48 Writes + 37 Edits +
   666k Opus output (fact 8) is what exhausts the session and causes the kills.
10. End of round: `npm run verify:full`, then run the app and perform the task's **proof
    action** — the UI path that fails if the feature is inert. Screenshot/console evidence.
    Green tests are not proof (fact 2: NoteMatcher shipped inert under 1500 green tests).
11. If a workflow died: read its `journal.jsonl` / agent transcripts and integrate what finished.
    Same session → resume with `resumeFromRunId`. Never re-run completed agents.
12. Meta pass: main thread, ≤ 5 minutes, and its output must be a script/lint/config change or a
    one-line protocol edit — not a new prose rule. The last prose rule failed the same day
    (facts 5–6).

---

## 1. Where the time actually went

Total workflow wall: **278 min across 9 workflows, strictly serial, never overlapping**. Ranked
by cost to user wall-clock:

| # | Cost | Evidence | Size |
|---|---|---|---|
| 1 | **Serial aftermath rounds.** Review → fix → re-review → fix ran as four standalone workflows *after* the build was green. | facts 1–2; workflows `m1-fixes` 19 min, `m1-finish` 39, `phase1-review-fixes` 22, `rereview-fixes` 20 | **100 min wall (36%), ~35% of 3.74M subagent tokens** |
| 2 | **Lost / at-risk rounds.** Two workflows killed by session limits; one full phase of output currently untracked and unreviewed. | facts 5–6 | Up to a whole round's rework each time; unbounded if the tree is lost |
| 3 | **Long-tail agents gating rounds.** Typical agent ~15 min, outlier 24.6 min / 193 turns; the 18-agent round took 78 min because wall tracks the slowest chain. | fact 3 | ~60+ min of round wall spent waiting on stragglers across the session |
| 4 | **Main thread implementing.** 48 Write, 37 Edit, 666k output, 415 turns on Opus. This is not mainly a token problem — it is what fills the context window, hits the session limit, and *causes* cost #2. | fact 8 | Feeds the kills; also the most expensive tokens in the system |
| 5 | **Per-agent re-orientation.** ~71 × "Read CLAUDE.md and do…" → 24M cache writes and exploration turns inside each agent. | fact 4 | Mostly tokens (user accepts that), but it also inflates turn counts and the long tail |

Explicitly **not** the bottleneck: test speed (core 1.1 s, verify ~30 s — fact 9). Do not spend
any effort there.

## 2. Round structure

**Verdict: review as a separate post-build workflow is the wrong shape. The review itself is not.**
It found ~30 real M1 defects, 9 more on re-review, and an inert headline feature (fact 2) — the
spend was justified; the *serialization* was not. Keep the adversarial pass, delete the barrier.

The "tests green but feature inert" defect class (NoteMatcher implemented but never rendered;
e2e passing against dead code) implies two things about *when* and *what*:

- Review must run **per module, immediately after that module is built**, and its first question
  must be **reachability**: what non-test code imports this, and what UI path executes it? A
  reviewer looking only at module internals can bless dead code.
- No round is finished until someone **runs the app** and exercises the feature. The 1500-test
  suite repeatedly failed to notice inert features; a driven UI flow caught them.

**The round template** (this replaces build-workflow → review-workflow → fix-workflow):

```
Round = up to 6 modules. Contracts written first by the main thread.
Per module, one chain, pipelined (module B builds while module A is in review):
  BUILD  (Sonnet)            module + co-located tests, from the brief, scoped test run only
  REVIEW (Opus, high effort) adversarial; checks: reachability → correctness → test strength
  FIX    (Sonnet, low)       applies findings in the same chain; empty-findings → skip
Then, serially on the main thread, per module as each chain completes:
  INTEGRATE  wire shared files (Shell/routes/stores) — main thread only
  COMMIT     npm run verify → git commit (one commit per module)
End of round, once:
  PROVE      npm run verify:full, then drive the app through the task's proof action; capture evidence
```

Estimated effect **[extrapolation]**: M1's 100 min of serial aftermath collapses into the build
round's own wall — review/fix of module A overlaps build of modules B–F. Expect round wall ≈
build wall + one module's review-fix tail (~15–20 min), instead of build wall + 100 min.

## 3. Agent sizing and fan-out

- **One agent = one module directory + its tests.** Target ≤ 12 min, ≤ 80 turns. The 24.6-min /
  193-turn outlier (fact 3) had too much scope and no pre-digested context; with a contract and a
  brief there is nothing to explore. If the spec needs more than ~2 paragraphs or ~2 implementation
  files, split it into two contracted modules.
- **Round size ≤ 6.** Two reasons: the harness caps concurrent agents (≈ 10–16
  **[extrapolation — harness property, not telemetry]**), so an 18-agent round already queues into
  waves; and a small round keeps the commit cadence tight, so a kill costs at most one round.
- **Collision prevention is ownership, not luck.** Every prompt lists the exact files the agent may
  write. Two agents never share a file (this is already the CLAUDE.md rule; last session violated
  it — fact 7). Shared integration points — `Shell.tsx`, routes, store registration — are written
  only by the main thread, serially, at INTEGRATE time.
- **Scoped test runs.** Agents run `npx vitest run src/core/<their-module>` and nothing wider. The
  fact-7 collision was an agent running a suite-wide test and seeing a sibling's half-written file.
  The full suite runs exactly twice per module: main-thread `verify` at commit, `verify:full` at
  round end.
- **What stays serial:** contract writing, integration glue, commits, `ROADMAP.md` edits, and any
  edit to a file two future agents will both read as a dependency.

## 4. Cutting re-orientation cost

Each of ~71 agents re-derived the project from `CLAUDE.md` plus its own exploration (fact 4,
24M cache writes). Replace all of it with two pieces of text the main thread already has:

1. **The standing brief** — a ~25-line digest of the rules an implementer actually needs (Appendix
   A). Written once, pasted verbatim into every builder prompt. It ends with "do NOT read CLAUDE.md,
   do NOT explore beyond your files" — exploration is the turn-sink that produced the 193-turn agent.
2. **The per-module pack** — task spec + requirement IDs, owned file list, the frozen contract, and
   the *signatures only* of dependencies. The agent gets what it needs and nothing else; it never
   opens a file outside its ownership list.

Copy-pasteable templates: Appendix A (builder), B (reviewer), C (fixer), D (workflow script).

## 5. Never losing a round

The prose rule "checkpoint before you fan out" was added after the first kill and did not survive
contact with the second (facts 5–6). Prose failed; make the protocol structurally kill-proof:

- **Commit per module, as each chain lands green.** Not at round end. The uncommitted-work window
  is then one module, not one phase.
- **Recovery is step 0 of every session**, before the roadmap: `git status`; dirty tree → verify,
  slice-commit, review. This makes leftover work self-healing instead of relying on the previous
  session having behaved.
- **A killed workflow is not lost work.** Its agents' outputs are on disk. Same session: relaunch
  with `resumeFromRunId` — completed agents return cached results instantly. Session died (the
  usual kill mode): read the run's `journal.jsonl` and `agent-*.jsonl` transcripts, take the
  completed results, and integrate them. Never re-run an agent whose output already exists.

**Recovering the current untracked Phase 2 work (do this before any new roadmap item):**

1. `npm run verify` on the tree as it stands.
2. Green → commit in module-sized slices, core first: `core/generator`, `core/srs`,
   `core/progress`, `core/practice` (assessment/recorder/review), `core/sightreading`,
   `core/drills`, then the app layer (`app/state` stores, `app/practice` panels,
   `app/sightreading`, `app/drills`, Shell/Practice modifications, e2e). Red → smallest fixes to
   green first, then slice-commit.
3. If the killed workflow's journal still exists, read it — agent reports may carry test evidence
   and known issues that shortcut the review.
4. The code is committed but **unreviewed** (fact 6): run the per-module REVIEW → FIX chain from §2
   over the committed diff, commit the fixes, then run the §7 proof.

Commit-before-review is deliberate: an unreviewed commit is recoverable and revisable; an
unreviewed working tree is one session limit away from archaeology.

## 6. Model tiering and effort

The existing policy is mostly right; the telemetry sharpens it:

| Work | Model / effort | Why (evidence) |
|---|---|---|
| Orchestration, contracts, integration, judgement | **Opus main thread** — orchestrates, does not type | fact 8: typing on the main thread burns the window that session survival depends on |
| Building modules + tests | **Sonnet** | 71 agents' worth of build work needed no Opus |
| Adversarial review of correctness-critical code | **Opus, `effort: 'high'`** | proven: found bugs a 100%-coverage suite missed (fact 2) — the one place the expensive model has measurably earned its cost |
| Applying enumerated fix findings | **Sonnet, `effort: 'low'`** | mechanical; the finding already contains the diagnosis |
| Lookup / search / mechanical sweeps | **Haiku** | lookup-shaped work |

Main-thread hard rule: it may write integration glue under ~20 lines per file; anything larger is
a delegated Sonnet agent. Last session it did a whole fix round by hand (fact 8) — that round
belonged to Sonnet agents with Opus only reading the findings.

## 7. Verification that proves a feature works

Green tests were repeatedly not evidence (fact 2). A round produces three layers of proof, two of
them mechanical:

1. **`npm run verify:full`** — typecheck, lint, all tests, knip, knip production mode, e2e.
   `npm run knip:prod` (in the gate) runs knip in production mode: files and dependencies not
   reachable from `src/main.tsx` fail the build — tests are excluded from the production graph,
   so "implemented, tested, never imported" is now a hard failure. First run found 7 unreachable
   files including the entire IndexedDB persistence adapter. `npm run knip:prod:all` additionally
   lists exports used only by tests — 58 on first run — which is meta-pass triage material
   (delete or wire), not a gate. Neither catches imported-but-never-rendered; that is what the
   proof action below is for.
2. **A proof action per roadmap task.** When a task is written into `ROADMAP.md`, it names the UI
   path that fails if the feature is inert — e.g. *"open Practice, play 3 notes via the fake MIDI
   input, see per-note feedback appear"*. Vague tasks get vague proof; name it up front.
3. **Drive it.** At round end, run the dev server and perform the proof action — via the browser
   tools or a Playwright spec that asserts the feature's observable output, not that a page
   mounted. NoteMatcher's e2e passed because it asserted presence, not behaviour. Capture the
   evidence (screenshot, console, driven-flow output) and put it in the round report.

## 8. What to stop doing

- **Standalone re-review workflows.** `m1-finish` (39 min / 307k) + `phase1-review-fixes` +
  `rereview-fixes` existed only because fixes were applied outside the chain that found the
  problems. The FIX stage verifies inside the chain; delete the habit.
- **"Read CLAUDE.md and do…" prompts.** Replaced by the brief (§4). Never again.
- **14–18-agent mega-rounds.** They queue at the concurrency cap, their wall tracks the slowest
  straggler (78 min vs 15 typical, fact 3), and they hold a whole phase uncommitted.
- **Main-thread fix rounds.** Fact 8. Delegate; relay only conclusions back.
- **Full-suite test runs inside parallel agents.** Caused the fact-7 collision report.
- **E2e that asserts presence.** A smoke that passes against dead code is negative value: it
  manufactures false confidence. Every e2e asserts a feature-specific observable.
- **The meta pass as a workflow.** `piano-approach-review` (8 agents, 10 min, 116k) produced a
  prose rule that failed the same day (facts 5–6). Verdict: keep the habit, downgrade the slot —
  main thread, ≤ 5 min, and the output must be *enforcement* (a script, a lint rule, a hook, a
  one-line protocol edit) or it isn't recorded. This matches the standing rule "enforce hard rules
  in automation, not prose", which the telemetry has now confirmed twice.

---

## Appendix A — builder prompt template

Everything in `[brackets]` is filled by the main thread. Paste whole; do not link.

```text
You are building one module of a piano-learning app. Everything you need is below.
Do NOT read CLAUDE.md. Do NOT open any file outside YOUR FILES and DEPENDENCIES.

RULES (complete digest — there are no others you need):
- TypeScript strict; no `any`, no non-null `!`. `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` are on — narrow properly.
- src/core is pure: no DOM, no React, no IO, no Date.now(), no Math.random().
  Clock/Rng are injected ports; in tests use the deterministic fakes from `@test/fakes`.
- Pitch is MIDI note number (60 = middle C). Musical time is ticks (TICKS_PER_QUARTER = 480).
  Milliseconds never appear in core domain objects.
- Fallible parsing/validation returns Result<T,E> from `@core/shared/result`; throw only for
  programmer error.
- Imports use @core/ @app/ @adapters/ @content/ @test/ aliases only.
- Co-located <name>.test.ts. Music-theory/timing invariants get fast-check property tests,
  not just examples. Files < 500 code lines.
- Run ONLY `npx vitest run [module dir]`. Never run the full suite — other agents are working.
- Then run `npm run typecheck` and fix every error in YOUR files (ignore errors in files you do
  not own — another agent is mid-edit). `vitest` does not typecheck, so a green scoped run says
  NOTHING about types: do not claim "no type errors" without having run it.
  It MUST be `npm run typecheck` (i.e. `tsc -b --noEmit`). `npx tsc --noEmit` silently checks
  NOTHING here — the root `tsconfig.json` is a solution file holding only project references, so
  bare `tsc` compiles an empty program and exits 0. A whole round once reported "tsc clean" and
  landed nine type errors.

TASK: [requirement IDs + spec, 1–2 paragraphs]
YOUR FILES (write these and nothing else): [exact paths]
CONTRACT (implement exactly; if it is wrong, report it — do not change it):
[pasted types + signatures]
DEPENDENCIES (import freely, never modify; signatures follow):
[signatures only]

RETURN: files written; scoped test output (count + time); any contract ambiguity you hit
(never resolve one silently).
```

## Appendix B — reviewer prompt template

```text
Adversarial review of one freshly built module. Your job is to refute it, not confirm it.
Files: [paths]. Contract: [pasted]. Requirements: [IDs].

Check in this order:
1. REACHABILITY: what non-test code imports this module? What user-visible path executes it?
   If it is core-only by design, name the roadmap task that will wire it and confirm that task
   exists. "Green tests, never executed" is this project's most expensive defect class.
2. CORRECTNESS against the contract and these invariants: [named music-theory/timing invariants].
   Hunt boundary values: enharmonics, octave edges, tick rounding, empty/degenerate input.
3. TEST STRENGTH: would each test fail if the implementation were replaced by a plausible stub?
   Name one concrete mutant per key test that the test kills. Flag tests that restate the
   implementation.
4. BOUNDARY RULES: core purity, ticks-vs-ms, MIDI-vs-note-name, Result-vs-throw.

RETURN: findings only, `path:line — severity — problem — smallest fix`. No praise, no summary
of what the code does. An empty list is an acceptable answer.
```

## Appendix C — fixer prompt template

```text
Apply these review findings to one module. Do NOT re-review, restructure, or improve anything
not named in a finding.

FILES YOU OWN: [paths]
FINDINGS: [pasted list from the reviewer]
RULES DIGEST: [same digest as Appendix A]

For each finding: fix it, or report exactly why it is a false positive (evidence, not opinion).
Run ONLY `npx vitest run [module dir]`; leave it green. Then `npm run typecheck` (NOT `npx tsc
--noEmit`, which silently checks nothing here — see Appendix A) and fix every error in YOUR
files — vitest does not typecheck, and the integration step is blocked by any type error you
leave behind.
RETURN: per finding — fixed (with the diff hunk) or rejected (with the evidence).
```

## Appendix D — workflow script skeleton

```js
export const meta = {
  name: 'round-<milestone>-<n>',
  description: 'Build, adversarially review, and fix up to 6 modules as pipelined chains',
  phases: [{ title: 'Build' }, { title: 'Review' }, { title: 'Fix' }],
}
// args.modules: [{ id, dir, buildPrompt, reviewPrompt }] — prompts pre-built from Appendices A/B.
const FINDINGS = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      path: { type: 'string' }, line: { type: 'number' },
      severity: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' },
    }, required: ['path', 'severity', 'problem', 'fix'] } },
  },
  required: ['findings'],
}
const results = await pipeline(
  args.modules,
  m => agent(m.buildPrompt, { label: `build:${m.id}`, phase: 'Build', model: 'sonnet' }),
  (built, m) => agent(m.reviewPrompt + `\n\nBUILDER REPORT:\n${built}`,
    { label: `review:${m.id}`, phase: 'Review', effort: 'high', schema: FINDINGS }),
  (review, m) => review.findings.length === 0
    ? { module: m.id, findings: 0 }
    : agent(
        `Apply these review findings to ${m.dir}. Fix or refute each with evidence; ` +
        `run only 'npx vitest run ${m.dir}'; leave it green.\n` +
        JSON.stringify(review.findings, null, 2),
        { label: `fix:${m.id}`, phase: 'Fix', model: 'sonnet', effort: 'low' },
      ).then(r => ({ module: m.id, findings: review.findings.length, fixReport: r })),
)
return results
// Review agent inherits the main-loop model (Opus) — deliberate, per the model policy.
// pipeline(): module B builds while module A reviews. Main thread integrates + commits each
// module when the workflow returns; if the run dies, journal.jsonl holds completed results.
```

---

## Drop-in replacement for the "Proceed with next steps" section of CLAUDE.md

```markdown
## The "Proceed with next steps" protocol

When the user says *"proceed with next steps"* (or equivalent), do this without asking:

0. **Recover.** `git status`. Tree dirty → `npm run verify`; green → commit the leftovers in
   module-sized slices now; red → fixing it is the next task. Never start new work on a dirty
   tree. A killed workflow's results live in its journal — integrate them, never re-run them.
1. **Orient.** Read `ROADMAP.md` — the first unchecked task is next. `git log --oneline -8`.
2. **Contracts first.** Before spawning anything, write each module's interface (types +
   signatures) and requirement IDs. Builders code to the contract; only the main thread changes it.
3. **Round = up to 6 modules, one pipelined chain per module** — build → review → fix, no
   cross-module barrier, no standalone review/fix/re-review workflows afterwards:
   - BUILD (Sonnet): module + co-located tests, from the pasted brief
     (`docs/efficiency-guide.md` Appendix A). Never tell an agent to read CLAUDE.md.
   - REVIEW (Opus, high effort): adversarial, per module; checks reachability first
     ("what non-test code executes this?"), then correctness, then test strength.
   - FIX (Sonnet, low effort): applies findings inside the same chain.
   - Every agent prompt lists the exact files it owns; no two agents share a file.
   - Agents run only `npx vitest run <their dir>`, never the full suite.
4. **Integrate + commit per module.** Main thread wires shared files (Shell, routes, stores)
   itself, serially; runs `npm run verify`; commits that module. One commit per module, as it
   lands — never hold a round uncommitted.
5. **Prove the feature.** `npm run verify:full`. Then run the app and perform the task's proof
   action — the UI path that fails if the feature is inert — and capture evidence (screenshot,
   console, or a driven e2e asserting behaviour, not presence). Green tests alone are not done.
6. **Tick + report.** Tick the task in `ROADMAP.md`, commit, report one paragraph with the
   evidence and what is next.

Loop 2–6 while budget remains. Standing rules:
- Main thread writes only integration glue (< ~20 lines per file); anything larger is delegated.
- Every new roadmap task states its proof action when written, not when tested.
- Meta pass: main thread, ≤ 5 min; its output must be enforcement (script/lint/hook/one-line
  protocol edit), or it is not recorded.
```
