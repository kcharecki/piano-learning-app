# Piano Learning App — agent instructions

Personal single-user app that teaches piano playing, sight reading, and theory.
Full spec: [requirements.md](requirements.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Current state and next work item: **[ROADMAP.md](ROADMAP.md)** — this is the source of truth.

## The "Proceed with next steps" protocol

When the user says *"proceed with next steps"* (or anything equivalent), do this, in order,
without asking for confirmation:

1. **Orient** — read `ROADMAP.md`. The first task that is not `[x]` is the next task.
   Run `git log --oneline -8` to see where the last session stopped.
2. **Verify the base is green** — `npm run verify`. If it fails, fixing that is the next task,
   ahead of anything in the roadmap.
3. **Implement** the next unchecked task (or the next 2–4 if they are small and independent —
   fan them out to parallel subagents; see *Delegation* below).
4. **Test** — every task ships with tests in the same commit. See *Testing rules*.
5. **Review** — run `/code-review`-style self review on the diff (or spawn `cavecrew-reviewer`).
   Fix what it finds before committing.
6. **Checkpoint** — `npm run checkpoint` (runs verify, then commits with a conventional message).
   Then tick the task in `ROADMAP.md` and commit that too.
7. **Report** — one short paragraph: what landed, test counts/timing, what is next.

Loop steps 3–6 while there is budget. Never leave the tree red at the end of a turn.

**Checkpoint before you fan out.** Commit the green tree *before* launching a round of parallel
agents, not after. A round that dies half-finished (session limit, crash) otherwise leaves edited
files with no clean state to return to — this has already happened once.

## Leave it better (the meta pass)

Every session, alongside the feature work, spend a little of the budget improving the thing that
produces the work. This is not optional tidying; it is what stops a fast-moving generated codebase
from silting up.

- **Delete dead code.** Exports nobody imports, options nobody passes, error branches for inputs that
  cannot occur, abstractions with exactly one implementation and no second one coming. An export used
  only by its own test is dead. Run `npx knip` if configured; otherwise grep before you assume.
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
- Give each agent: the requirement IDs it must satisfy, the file paths it owns, and the rule that
  it must write tests and leave `npm test` green.
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
