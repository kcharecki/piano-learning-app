# Piano Learning App — agent instructions

Personal single-user app that teaches piano playing, sight reading, and theory.
Full spec: [requirements.md](requirements.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Current state and next work item: **[ROADMAP.md](ROADMAP.md)** — this is the source of truth.

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

Full rationale, telemetry, and agent prompt templates: [docs/efficiency-guide.md](docs/efficiency-guide.md).

## Leave it better (the meta pass)

Every session, alongside the feature work, spend a little of the budget improving the thing that
produces the work. This is not optional tidying; it is what stops a fast-moving generated codebase
from silting up.

- **Delete dead code.** Exports nobody imports, options nobody passes, error branches for inputs that
  cannot occur, abstractions with exactly one implementation and no second one coming. An export used
  only by its own test is dead. Run `npm run knip:prod:all` — it lists production-unreachable files
  and test-only exports; each is either wired, deleted, or consciously kept with a named future task.
- **Compact the docs.** `CLAUDE.md` is a contract, not a wiki — keep it under ~150 lines and make
  every line true. If a rule is not being followed, either enforce it in tooling or delete it. Move
  detail to `docs/` only if something actually reads it. Prune `ARCHITECTURE.md` claims that the code
  no longer honours; a stale doc is worse than no doc, because it is trusted.
- **Prune tests only on evidence.** You may delete a test when you can point to one of: a named test
  that asserts a strict superset of it, or a Stryker mutant that survives it either way. Judgement
  alone is not enough — an agent asked to find tests that "restate the implementation" produced a
  confident false positive, and a wrongly deleted test leaves the suite green, so the mistake is
  invisible. Suite size is a real cost, but a missing test costs more.
- **Improve the process itself.** When something in this file's protocol turned out to be wrong or
  missing, change it in the same commit and say so. Record what actually worked, not what sounded
  good.

State what you deleted in the commit body. "Deleted nothing" is a valid outcome, but say it.

## Model policy

Match the model to the job; do not use one tier for everything.

| Work | Model |
|---|---|
| Orchestration, planning, final review, judgement calls | **Opus** (the main thread) |
| Implementation agents — writing modules and their tests | **Sonnet 5** (`model: 'sonnet'`) |
| Exploration, search, measurement, mechanical sweeps | **Sonnet 5**, or **Haiku** when the task is lookup-shaped |
| Research and summarisation feeding a decision | **Sonnet 5**, with **Opus** reading the summary and deciding |

Opus reviews what Sonnet produced — a summary from a cheaper model is input to an Opus judgement,
never a substitute for one. Adversarial review of correctness-critical code (music theory, timing,
matching) stays on Opus with high effort; that is where the expensive model has repeatedly earned
its cost by finding bugs a 100%-covered suite missed.

## Testing rules (non-negotiable)

- `npm test` runs the **core** suite: pure domain logic, node environment, **must stay under ~3 s**.
  If it gets slower, that is a bug — find what pulled a DOM/IO dependency into `src/core`.
- Every module in `src/core/**` has a co-located `*.test.ts`. No exceptions, no "tested via UI".
- Music-theory and timing code gets **property tests** (`fast-check`), not just examples:
  intervals, transposition, key signatures, scheduler ordering, SRS intervals.
- Never use real time, real randomness, or real IO in a test. `Clock` and `Rng` are injected ports
  (`src/core/ports/`) — pass the deterministic fakes from `src/test/fakes.ts`.
- UI tests (`npm run test:ui`) are thin: render, assert wiring, assert accessibility roles.
  Behaviour belongs in core. E2E (`npm run test:e2e`) is smoke only.
- Coverage gate: 90% lines on `src/core` (`npm run test:cov`). Do not lower it; write the test.

## Architecture boundary (enforced by eslint, not vibes)

```
src/core/      pure TypeScript. No DOM, no React, no IO, no Date.now(), no Math.random().
src/adapters/  the impure edge: Web MIDI, Web Audio, IndexedDB, OSMD rendering.
src/app/       React UI. Reads core via stores; never contains music logic.
src/content/   curriculum, lessons, repertoire metadata, MusicXML assets.
```

`eslint.config.js` fails the build if `src/core` touches `window`, `Date.now()`, `Math.random()`,
React, or `@adapters/*`. If you feel the need to break that, you are putting logic in the wrong layer.

## Conventions

- TypeScript strict, incl. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any`
  in `src/core`. No non-null `!` assertions — narrow properly.
- Pitch is always **MIDI note number** (`60` = middle C) inside core. Convert at the edges only.
- Musical time is always **ticks** (`TICKS_PER_QUARTER = 480`) inside core; milliseconds only in
  adapters and the transport. Never store BPM-dependent ms in domain objects.
- Errors: return `Result<T, E>` from parsers/validators (`src/core/shared/result.ts`); throw only
  for programmer error.
- Files stay under 500 code lines, tests under 1400, the two format parsers under 620 — enforced by
  eslint `max-lines` (blank lines and comments excluded). These are the real current maxima, not an
  aspiration: a rule the codebase openly violates teaches every future agent that the rules are
  negotiable. Split by concept, not by size; if you need to raise a limit, say why in the config.
- Imports use the `@core/ @app/ @adapters/ @content/ @test/` aliases, never deep relative chains.

## Delegation

Fan independent work out to parallel subagents and keep the main thread for integration:
- Separate `src/core/<module>/` directories are independent — one agent each, in parallel.
- Build every agent prompt from the templates in `docs/efficiency-guide.md` (Appendices A–C):
  pasted rules digest, requirement IDs, exact owned file paths, frozen contract. Never tell an
  agent to read CLAUDE.md or to explore.
- Agents run only their scoped tests (`npx vitest run <their dir>`), never the full suite.
- Never let two agents write the same file in one round.

## Commands

```bash
npm test           # fast core suite — run this constantly
npm run verify     # typecheck + lint + all tests — run before every commit
npm run checkpoint # verify, then git commit
npm run dev        # app at http://localhost:5173
```

## Git

- Small commits, one roadmap task each. Conventional Commits (`feat(core/theory): ...`).
- Commit only with a green `npm run verify`. `npm run checkpoint` enforces this.
- Never `--no-verify`.
