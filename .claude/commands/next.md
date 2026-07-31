---
description: Pick up the roadmap where the last session stopped and implement the next task(s)
---

Continue building the piano learning app. Work autonomously — do not ask for confirmation.

1. Read `ROADMAP.md`. The first `[ ]` box top-to-bottom is the next task. Read `CLAUDE.md` and
   `docs/ARCHITECTURE.md` if they are not already in context.
2. Run `git log --oneline -8` and `npm run verify`. If verify fails, fixing it is the next task.
3. Implement the next task. If the next few tasks are marked `‖` (independent), fan them out to
   parallel subagents — one module directory each, never two agents in one file.
4. Tests ship in the same change: co-located `*.test.ts`, deterministic (FakeClock / seededRng from
   `@test/fakes.ts`), property tests via `fast-check` for anything with an algebraic law.
5. Review the diff for music correctness and for tests that would pass against a broken
   implementation. Fix what you find.
6. `npm run checkpoint -- "<conventional commit subject>"`, then tick the roadmap box, append a line
   to the session notes, and commit that.
7. Repeat while there is budget. Finish with: what landed, test count and runtime, what is next.

$ARGUMENTS
