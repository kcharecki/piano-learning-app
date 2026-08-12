# WORKTREES.md — running several sessions in parallel

Mechanics follow the official guidance (code.claude.com/docs/en/worktrees): one git worktree
per session, shared `.git`, and Claude Code itself enforces that a worktree session cannot
write to the main checkout or redirect git into it. That enforcement dictates the shape of
everything below: **worktree sessions build; only the main-checkout session merges.**

## The contract

1. Claims come in **two kinds**, both atomic, both visible everywhere via the shared `.git`
   (`node scripts/worktrees.mjs status` shows both):
   - **Worktree session**: its branch, renamed to `task/<roadmap-id>`. The rename fails if
     the branch exists, so a race between two sessions self-resolves — the loser re-runs
     `status` and picks the next task.
   - **Main-checkout session**: `worktrees.mjs claim <id>` (a `refs/claims/<id>` ref,
     create-only). Released with `release <id>` at session end.
2. **One session per checkout.** The main checkout is single-occupancy: `/next` there first
   runs `worktrees.mjs claim main-checkout`; refused means another session owns it — enter a
   worktree (EnterWorktree) and continue as a worktree session instead. (Learned the hard
   way: two /next sessions both landed in the main checkout, both saw "no claims", and both
   started the same triage task.)
3. A worktree session works ONLY its claimed task, on its own branch, never touches master,
   and **skips the ROADMAP Triage section** — triage (red masters, user bugs) is
   integrator work by nature. It runs the full experience gate in its worktree before ticking.
4. Only the **main-checkout** session (the integrator) merges task branches, serially,
   verifying after each.
5. Every worktree runs on its **own port** (`status` prints it) — separate server, separate
   origin, separate IndexedDB. The main checkout keeps 5173.
6. At most **one** active claim may touch the shared app spine (`Shell.tsx`, routes,
   `app/state/*`, `src/design-system/*`, `package.json`). Everything else must be
   screen/module-local, or it is not parallel-safe — pick a different task.

## Starting a parallel session

**Desktop app (the usual way here):** **+ New session** in the sidebar (Ctrl+N), same
project folder — for a git repo the desktop app puts every new session in its own worktree
automatically, under `.claude/worktrees/` (Settings → Claude Code: "Worktree location",
optional branch prefix). Type `/next` in the new session; it detects the worktree and claims
a task. The FIRST session — the one opened directly on the project folder — is the main
checkout and stays the integrator. Ctrl+click a session in the sidebar for a split view;
hover → archive icon removes a session's worktree when its branch is merged. Sessions can
also check on each other ("what is the t2 session doing?") and message each other.

**Terminal CLI:**

```bash
claude --worktree t1
```

**`node_modules` in a worktree (2026-08-12).** Node's resolver walks ancestor directories and
worktrees sit under the repo root, so `npm test`, `tsc` and `eslint` all work in a fresh
worktree with no install — which is why this went unnoticed for a dozen sessions. **`knip` does
not walk**: it classifies dependencies against a `node_modules` directory inside the workspace
it is given, finds none, and exits 1, so `npm run verify:full` — the only gate that runs e2e —
could not pass anywhere except the main checkout. `worktrees.mjs status` now creates a
junction (Windows) / directory symlink (POSIX) back to the main checkout's `node_modules` the
first time it runs inside a worktree, and prints that it did. Since every worktree session runs
`status` before picking up work, no new step is added. Proven both directions in a scratch
worktree: `npm run knip` exits 1 without the link and 0 with it.

Worktree lands in `.claude/worktrees/t1/` (gitignored), branch `worktree-t1`, branched from
local HEAD (`worktree.baseRef: "head"` in `.claude/settings.json` — deliberate: this repo's
master is usually ahead of origin, and the default "fresh" base would branch from a stale
`origin/master`). Then, inside the session, type `/next`. No `npm ci` needed: worktrees sit
under the repo root, so Node's ancestor walk resolves the main checkout's `node_modules`
(verified — the pre-commit vitest run passes in a fresh worktree with zero setup). Run
`npm ci` in the worktree only if a tool misbehaves.

## What `/next` does, by location

**In a worktree** (`git rev-parse --git-common-dir` differs from `--git-dir`):
1. Branch already `task/<id>` → that is this session's task; continue it.
2. Otherwise claim: run `node scripts/worktrees.mjs status`, pick the highest-priority
   OPEN task (ROADMAP order: Triage → impact) that is (a) unclaimed and (b) parallel-safe
   per rule 5, then `git branch -m task/<id>` and mark the ROADMAP box `[~] (session: t1)`
   on this branch. State what was skipped because of a claim or an overlap.
   **Race guard (2026-08-11):** an `EnterWorktree`-created path is locked against other
   sessions of this same tool, but a worktree that already existed (desktop-app "+ New
   session", or a prior `claude --worktree`) is NOT — a second, differently-launched session
   can be actively using it with no lock visible to `status` or `git worktree list`. Before
   any edit, re-run `git status` / `git branch --show-current` once; if the branch name or
   dirty-file set has moved since you entered, another live session owns this path — do not
   rename its branch, do not edit, back out (`EnterWorktree` isn't required to leave; just
   stop touching it) and pick a different worktree. No work is lost either way, since the
   other session's edits are its own uncommitted state, but racing it wastes both sessions'
   turns.
3. Build slices as normal; run the gate with this worktree's port:
   `npm run dev -- --port <port> --strictPort`, `$env:E2E_PORT=<port>` for playwright,
   `node scripts/visual-pass.mjs <dest> --url http://localhost:<port>`.
4. Tick `[x]` on the branch only after the gate passes. Commit per slice, on the branch.
5. Never edit on a task branch: `docs/PROCESS.md`, `docs/retro-log.md`, ROADMAP lines other
   than your own task's, `.claude/*`, `package.json` (rule 5's spine list needs the
   exclusive claim). The integrator owns those; the retro for a parallel round is written
   once, at merge time.
6. Session ends: leave the branch and worktree in place. Done = branch ahead of master with
   the box ticked; `status` will show it as mergeable.

**In the main checkout:**
1. RECOVER as usual (PROCESS.md step 0).
2. INTEGRATE before new work: `node scripts/worktrees.mjs status`, then for each branch
   whose task is ticked (or whose worktree is gone with commits ahead):
   `git merge --no-ff task/<id>` → resolve conflicts (ROADMAP task-line conflicts are
   line-local and trivial) → `npm run verify` → if the merge touched the app spine or had
   conflicts, re-run the task's proof action → `git branch -d task/<id>` →
   `git worktree remove .claude/worktrees/<name>` (add `--force` only for a worktree the
   branch of which is fully merged). One branch at a time; verify between merges, never batch.
3. A `STALE` branch claim in `status` (no worktree, no commits) → delete the branch, freeing
   the task. A main-checkout ref claim (including `main-checkout` itself) that outlived its
   session → `worktrees.mjs release <id>`; the desktop sidebar shows whether that session is
   still live — when unsure, ask the user before releasing.
4. Then the normal session loop for its own work, skipping claimed tasks, and writing the
   round's retro entry (including what each merged branch shipped).

## Conflict posture

Merges stay boring because ownership is disjoint by construction: rule 5 keeps the spine
single-writer, tasks are screen/module-scoped, and ROADMAP edits are each session's own task
lines. If a merge still conflicts anywhere outside ROADMAP.md, treat it as a process failure
worth a retro line: two claims overlapped and the claim rules need tightening, not the merge.

## Limits

2–3 parallel sessions is the practical ceiling worth supervising. Every extra session costs
an `npm ci`, a dev server, and integrator attention; past three, merge review becomes the
bottleneck and quality drops back to what the old process shipped. Scale only when `status`
is clean and the last round's merges were conflict-free.
