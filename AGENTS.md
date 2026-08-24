# Piano Learning App — agent instructions

Personal single-user app that teaches piano playing, sight reading, and theory.
Full spec: [requirements.md](requirements.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
What to work on: **[ROADMAP.md](ROADMAP.md)** (triage first, then learner impact).
How to work: **[docs/PROCESS.md](docs/PROCESS.md)** — the model owns and evolves that file;
this one holds only the invariants, which move only with user consent.

## The process, in one paragraph

`/next` (or "proceed") runs the session loop in `docs/PROCESS.md`: recover the tree, triage
by learner impact, ship up to 3–4 vertical slices, retro. A slice counts as done only when it
passes the **experience gate**: `npm run verify` green, driven in the running app on real
content, visual pass against `docs/DESIGN.md` (both widths, both themes), console clean,
states handled, no perf regression. Green tests alone are not done — this project has shipped
a dozen inert features under green suites. Every session ends with a retro entry in
`docs/retro-log.md` and at most one process change.

`/improve-app` is the other loop, in [docs/commands/improve-app.md](docs/commands/improve-app.md).
`/next` triages a backlog somebody already wrote; `/improve-app` **writes the backlog itself**
from five evidence sources — ask the learner, mine their history, drive as them, diff a cited
syllabus, scan for captured-but-unread signals — then builds one gap, puts it through a
four-seat adversarial panel, and proves it closed. Use it when the question is *what is this app
missing*, not *what is next on the list*. Main checkout only; its gates are scripts
(`scripts/improve-run.mjs`), not prose.

## Parallel sessions

Multiple sessions run in parallel via git worktrees (`claude --worktree <name>`, then `/next`
inside it). The claim registry is branch names: `task/<roadmap-id>` = claimed; check
`node scripts/worktrees.mjs status` before picking work. Worktree sessions build on their own
branch and port; **only the main-checkout session merges**, serially, verify between merges
(Claude Code's worktree isolation enforces the write boundary). Full contract:
[docs/WORKTREES.md](docs/WORKTREES.md).

## Model policy

Match the model to the job; do not use one tier for everything.

| Work | Model |
|---|---|
| Orchestration, judgement, evidence, final review | **Opus** (the main thread) |
| Implementation agents — modules and their tests | **Sonnet** |
| Exploration, search, mechanical sweeps | **Sonnet**, or **Haiku** when lookup-shaped |
| Adversarial review of correctness-critical code (theory, timing, matching) | **Opus, high effort** — it has repeatedly found bugs a 100%-covered suite missed |

## Testing rules (non-negotiable)

- `npm test` runs the **core** suite: pure domain logic, node environment, **must stay under
  ~3 s**. If it gets slower, find what pulled a DOM/IO dependency into `src/core`.
- Every module in `src/core/**` has a co-located `*.test.ts`. No exceptions.
- Music-theory and timing code gets **property tests** (`fast-check`), not just examples.
- Never real time, real randomness, or real IO in a test. `Clock` and `Rng` are injected
  ports (`src/core/ports/`) — use the deterministic fakes from `src/test/fakes.ts`.
- UI tests are thin: render, wiring, accessibility roles. Behaviour belongs in core.
  E2E asserts feature-specific observables, never presence.
- Coverage gate: 90% lines on `src/core` (`npm run test:cov`). Do not lower it.
- Prune tests only on evidence: a named superset test or a surviving Stryker mutant.

## Architecture boundary (enforced by eslint, not vibes)

```
src/core/           pure TypeScript. No DOM, no React, no IO, no Date.now(), no Math.random().
src/adapters/       the impure edge: Web MIDI, Web Audio, IndexedDB, OSMD rendering.
src/app/            React UI. Reads core via stores; never contains music logic.
src/content/        curriculum, lessons, repertoire metadata, MusicXML assets.
src/design-system/  tokens + primitives. All UI styling flows from here (docs/DESIGN.md).
```

`eslint.config.js` fails the build if `src/core` touches `window`, `Date.now()`,
`Math.random()`, React, or `@adapters/*`. If you feel the need to break that, the logic is in
the wrong layer.

## Conventions

- TypeScript strict, incl. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  No `any` in `src/core`. No non-null `!` assertions — narrow properly.
- Pitch is always **MIDI note number** (`60` = middle C) inside core. Convert at the edges.
- Musical time is always **ticks** (`TICKS_PER_QUARTER = 480`) inside core; milliseconds only
  in adapters and the transport. Never store BPM-dependent ms in domain objects.
- Errors: `Result<T, E>` from parsers/validators (`src/core/shared/result.ts`); throw only
  for programmer error.
- File size limits enforced by eslint `max-lines`; raise a limit only with a reason in the
  config. Split by concept, not by size.
- Imports use `@core/ @app/ @adapters/ @content/ @test/` aliases, never deep relative chains.
- UI: tokens and primitives from `src/design-system/` only — no raw hex, no ad-hoc controls.

## Delegation

- Build agent prompts from `docs/efficiency-guide.md` Appendices A–C: pasted rules digest,
  exact owned files, frozen contract. Never tell an agent to read AGENTS.md or to explore.
- No two agents ever write the same file. Shared files (Shell, routes, stores) are
  main-thread-only, serial.
- Agents run only their scoped tests (`npx vitest run <their dir>`), never the full suite.

## Commands

```bash
npm test           # fast core suite — run constantly
npm run verify     # docs budget + typecheck + lint + all tests — before every commit
npm run checkpoint # verify, then git commit
npm run dev        # app at http://localhost:5173
```

### Running the app (do this, not `npm run dev` in a shell)

`.claude/launch.json` already defines the servers. Never start a dev server with Bash.

1. `preview_start` with `{name: "dev"}` — port 5173. In a worktree session use
   `{name: "dev-alt"}` (port 5273) so you do not fight the main checkout for the port.
2. The tab opens blank. `navigate` it to `http://localhost:5173` before anything else —
   `read_page` on the fresh tab errors with "No site is open in this tab".
3. Drive it with `read_page` / `computer` / `get_page_text`, and check
   `read_console_messages` and `preview_logs`. Screenshots need the Browser pane visible;
   if it is not, `screenshot` fails with "the Browser pane is not displayed" — fall back to
   `get_page_text` for evidence and say so, do not treat it as a broken app.

Cold-start state is a fresh learner: a first-run setup card ("Not now" dismisses it) and
Today's session with five items. "Start session" is the fastest path to real content.

## Git

- Small commits, one slice each. Conventional Commits (`feat(core/theory): ...`).
- Commit only with a green `npm run verify`. Never `--no-verify`.
- State what you deleted in the commit body ("deleted nothing" is valid, but say it).
