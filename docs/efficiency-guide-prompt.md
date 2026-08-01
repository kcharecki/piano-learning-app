# Prompt: produce a working-efficiency guide for this project

Paste everything below the line into a fresh LLM chat.

---

You are an expert on agentic software-engineering workflows (Claude Code / multi-agent
orchestration). I run a solo hobby project with an LLM agent doing nearly all the coding, and the
throughput is too low. Below is measured telemetry from the last session, not impressions. Read it,
diagnose where the wall-clock and token budget actually went, and write me an **operating guide**
that makes the next sessions materially faster at the same or better quality.

## The project

- Personal single-user piano-learning web app. TypeScript strict, Vite + React, Vitest, Playwright.
- Layered and lint-enforced: `src/core` is pure TS (no DOM, no `Date.now`, no `Math.random`),
  `src/adapters` is the impure edge (Web MIDI, Web Audio, IndexedDB, OSMD), `src/app` is React,
  `src/content` is curriculum data.
- Contract file `CLAUDE.md` (~150 lines) states: every `src/core` module has a co-located test,
  music-theory/timing code gets `fast-check` property tests, no real time/randomness/IO in tests,
  90% line coverage gate on core, files under 500 code lines, commit only on green
  `npm run verify`, and "fan independent work out to parallel subagents".
- `ROADMAP.md` is the source of truth for what's next; the user's normal instruction is literally
  "proceed with next steps" and the agent is expected to run autonomously from there.
- Scripts: `test` (core suite, 1.1 s), `verify` = typecheck + lint + all tests (~30 s),
  `verify:full` = verify + knip + Playwright e2e, `checkpoint` = verify:full then commit.
- Current size: 114 source files, 50 test files, ~1567 tests, core suite ~1 s. Phase 1 of 4 done.

## Measured telemetry from the last session

Session wall clock: 2026-07-31 17:50 → 2026-08-01 09:59 (~16 h, including long user-away gaps of
77 / 181 / 472 / 58 / 71 min). Only ~5 real user prompts; everything else was autonomous.

Orchestration shape: **9 sequential workflow runs**, ~71 subagents total, never overlapping.

| Workflow | Agents | Wall | Subagent output tokens | Purpose |
|---|---|---|---|---|
| piano-m1-core | 18 | 78 min | 1198k | build the M1 core domain |
| piano-phase1-finish | 11 | 72 min | 737k | adapters, shell, viewer, practice screen, e2e |
| piano-m1-fixes | 14 | 19 min | 509k | fix review findings |
| piano-phase2 | 6 | 18 min | 511k | build M2 modules |
| piano-m1-finish (re-review) | 5 | 39 min | 307k | re-review the fix round |
| piano-phase1-review-fixes | 5 | 22 min | 194k | fix findings again |
| piano-m1-rereview-fixes | 4 | 20 min | 165k | fix nine more findings |
| piano-approach-review | 8 | 10 min | 116k | research/meta review of the process itself |

Totals: subagent output **3.74M tokens**, cache reads **528M**, cache writes **24M**.
Main thread on top: 415 turns, **666k output**, 100M cache reads, 78 Bash + 48 Write + 37 Edit calls.

Other measured facts:

1. Roughly **35% of subagent output tokens** went to review→fix→re-review rounds that ran *after*
   the code was already written and the suite was green — not to first-pass implementation.
2. Those rounds were not wasted: they found ~30 real defects in M1, 9 more in the re-review, and
   several in Phase 1 including a headline feature (`NoteMatcher`) that was implemented but never
   rendered by the UI, and e2e/unit tests that passed against dead code. Tests being green was
   repeatedly *not* evidence the thing worked.
3. Individual agents ran long: several 14–17 min, one **24.6 min / 193 turns**. Phase wall clock
   tracked the slowest agent, so 18-agent phases took 78 min while typical agents took 15.
4. Every subagent prompt began "Read CLAUDE.md and do…" — each of ~71 agents paid its own
   re-orientation and codebase-exploration cost from scratch (hence 24M cache writes).
5. One workflow's journal ends on `started` with no result: it was **killed mid-run** by a session
   limit. Per the roadmap this happened at least twice, and a rule ("checkpoint the green tree
   *before* you fan out") was added after the first time.
6. It happened again anyway: the last workflow's output — 4 new core modules
   (`generator/`, `srs/`, `progress/`, `practice/assessment.ts`, `practice/recorder.ts`) — is still
   sitting **untracked, unverified and unreviewed** in the working tree.
7. Two agents in the same round collided: one reported a failing test in "a file I don't own —
   likely a concurrent agent's in-progress work."
8. The main Opus thread did a lot of hands-on implementation itself (48 Write, 37 Edit, 666k output)
   rather than orchestrating, including a whole fix round.
9. Test-suite speed is *not* the bottleneck: core is ~1 s, full verify ~30 s. Agent turn count and
   round serialization are.

## What I want from you

Write **"How to work on this project efficiently"** — an operating guide aimed at the orchestrating
agent, that a future session reads and follows. Ground every recommendation in the telemetry above;
where you are extrapolating beyond it, say so. Optimise for *my* wall-clock time-to-working-feature
first and token cost second — I am willing to spend tokens, not hours.

Cover at least:

1. **Where the time actually went.** A short, quantified diagnosis: serialization, rework rounds,
   long-tail agents, per-agent re-orientation, lost mid-round work. Rank them by cost.
2. **Round structure.** Should review be a separate workflow after a build round, or folded into the
   build round per module (pipeline instead of barrier)? What does the "tests green but feature
   inert" class of defect imply about *when* review must happen and what it must actually check?
   Give a concrete recommended round template.
3. **Agent sizing and fan-out.** How big should one agent's scope be, given a 24-min/193-turn
   outlier and phases gated by the slowest agent? How to prevent two agents colliding on shared
   files or a shared test run. Which work must stay serial.
4. **Cutting re-orientation cost.** Concrete mechanisms — a compact pre-digested context brief
   passed into agent prompts, a per-module "here is what you need and nothing else" pack, agent
   prompt templates. Show me actual reusable prompt text, not principles.
5. **Never losing a round.** Checkpoint discipline that survives a session limit or crash mid-fan-out:
   what to commit, when, and how to make resumption cheap. Include how the currently-untracked
   Phase 2 work should be recovered.
6. **Model tiering and effort.** Where cheap models are enough, where the expensive one has provably
   earned its cost (adversarial review of timing/matching code found bugs a 100%-coverage suite
   missed), and where the main thread should orchestrate instead of type.
7. **Verification that proves a feature works**, not that the suite is green: what to run and what
   evidence to demand at the end of a round, given that running the actual app found defects the
   1500-test suite did not.
8. **What to stop doing.** Name practices in the telemetry that cost more than they returned, and
   say what to delete or downgrade. Include whether the "meta pass / process review" habit is worth
   its slot.

Format: Markdown. Lead with a one-page **"do this"** checklist for the next session, then the
detailed sections, then an appendix with copy-pasteable prompt and workflow-script templates.
Finish with a **drop-in replacement for the "Proceed with next steps" protocol section of
`CLAUDE.md`** — under 60 lines, every line an instruction, no philosophy.

Be concrete and opinionated. Prefer one clear recommendation over a menu of options. If a rule in my
current setup is wrong, say it is wrong and say what replaces it. Do not pad.
