# Testing

The rule that makes any of this worth reading: **a test must be able to fail.** If you can't
describe the bug it would catch, it isn't a test, it's decoration.

## Layers

| Command            | Environment           | What it's for                                                                                   |
| ------------------ | --------------------- | ----------------------------------------------------------------------------------------------- |
| `npm test`         | node                  | Fast core suite — pure domain logic. Runs constantly, must stay ~ms.                            |
| `npm run test:ui`  | happy-dom             | Thin render/wiring/accessibility checks for `src/app`, `src/adapters`. Behaviour stays in core. |
| `npm run test:e2e` | Playwright + Chromium | Smoke only: app boots, screens are reachable. Not the place for depth.                          |
| `npm run test:cov` | node                  | Core suite with the 90%-lines coverage gate.                                                    |
| `npm run verify`   | —                     | Typecheck + lint + all of the above. The gate before every commit.                              |

## Dead-code detection — knip

```bash
npm run knip
```

Finds exports, files, and dependencies nothing references. Runs in CI (non-blocking today —
findings are reviewed, not auto-failed). **Do not delete what it reports without evidence and an
owner** — a knip hit can mean genuinely dead code, or a public surface staged ahead of the module
that will consume it (this project has several: `core/generator`, `core/srs`, `core/curriculum`
are "planned" per `docs/ARCHITECTURE.md` and their future adapters aren't built yet, so their
dependencies and exports look unused today). Treat the output as a list to triage, not a todo list
to clear.

## Mutation testing — Stryker

```bash
npm run mutate                                   # whole src/core, slow
npx stryker run --mutate "src/core/practice/*.ts"  # one module, minutes not hours
```

Coverage tells you code ran during a test. It does not tell you whether the test would notice if
that code were wrong. Stryker mutates `src/core` (flips conditionals, boundary operators, literals,
...) and reruns the tests that covered each mutant; a mutant that **survives** means every test that
touched that line would still pass if the logic were broken there.

**Reach for it when:**

- Landing correctness-critical logic (matching, timing, scheduling, theory) that a 100%-covered
  suite might still get wrong in a way examples didn't think to check.
- A bug shipped through green tests — mutation testing tells you which line the suite was blind to.
- Before trusting a refactor of `src/core/practice`, `theory`, or `timing` module tests as adequate.

**Not for:** CI (`thresholds.break: null` on purpose — manual, per-module tool, not a merge gate)
or gating on a score. Survivors are the deliverable: each is a line the tests can't tell right from
wrong. Read them, then decide whether to add a test or accept the branch is inconsequential.

Scope `--mutate` to the module you're working on. A full `src/core` run is a coffee-break-or-longer
job; a single module is minutes.

## Adding this to README.md

`README.md` is owned by another workstream in this repo — someone should add a link to this page
from its command table when they next touch it.
