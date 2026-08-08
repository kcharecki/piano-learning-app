---
description: Run the session loop — recover, triage by impact, ship proven slices, retro
---

Run the session loop in `docs/PROCESS.md`, autonomously, without asking for confirmation:

0. LOCATE + LOCK — `git rev-parse --git-dir --git-common-dir`.
   MAIN checkout (paths match): `node scripts/worktrees.mjs claim main-checkout` FIRST.
   Refused → another session already owns this checkout: do NOT work here — enter a worktree
   (EnterWorktree) and continue as a worktree session below. Claimed → this session is the
   integrator: `worktrees.mjs status`, INTEGRATE mergeable task branches (serially, verify
   between merges), clear STALE claims, then continue at step 1. Claim your chosen task too
   (`worktrees.mjs claim <id>`).
   WORKTREE (paths differ): follow `docs/WORKTREES.md` — continue the branch's claimed task,
   or claim the next unclaimed parallel-safe task with `git branch -m task/<id>` (rename
   refused = lost a race, pick the next task). SKIP the ROADMAP Triage section — triage
   belongs to the integrator. Own port for every server; never touch master, PROCESS.md,
   retro-log, or other tasks' ROADMAP lines.
1. RECOVER — `git status` even if the tree looks clean; dirty → verify → slice-commit or fix.
2. TRIAGE — `ROADMAP.md`: Triage section first (integrator only), then highest learner
   impact, skipping claimed tasks. State the pick and why in one sentence. The old "first
   unchecked box" rule is dead.
3. SLICES — up to 3–4 vertical slices, each through the FULL experience gate before its tick:
   verify green → driven in the running app on real content → visual pass per `docs/DESIGN.md`
   (both widths, both themes, screenshots) → console clean → states handled → no perf
   regression. Commit each slice as it lands. Bare-minimum passes are the failure mode this
   protocol replaced: if the screen you touched still fails the DESIGN checklist, the slice is
   not done, whatever the tests say.
4. RETRO — before ending, always: entry in `docs/retro-log.md` (metrics included), verdicts on
   any due experiments, and one process improvement (edit `docs/PROCESS.md` or add
   automation) or an argued "no change". Integrator: release every claim you hold
   (`worktrees.mjs release <id>` and `release main-checkout`) as the very last step.

$ARGUMENTS
