# Retro log — one entry per session, newest first

Written by the session's RETRO step (`docs/PROCESS.md`). Template:

```
## YYYY-MM-DD — <one-line session summary>
- user-reported defects since last session: <n, listed briefly>
- slices proven / started: <a>/<b>
- gate catches before commit: <n, what>
- docs budget (ROADMAP+CLAUDE+PROCESS lines): <n>
- cost note: <where the session's cost went, one line>
- hypothesis: <weakest part of the process right now>
- change: <the experiment + review-by date | "none because …">
- experiment verdicts due: <keep / extend / revert for any past review-by dates>
```

---

## 2026-08-08 (third session) — Parallel sessions via worktrees

- user-reported defects since last session: 0. User asked for a capability: several sessions
  in parallel, with `/next` aware of what other sessions claimed, plus merge discipline.
- slices proven / started: 1 / 1 (process tooling, not app code).
- gate catches before commit: n/a (no UI change). Tooling itself was proven, not asserted:
  `worktrees.mjs status` driven through all three claim states (active/clean, AWAITING
  MERGE, freed); smoke e2e 9/9 green on `E2E_PORT=5544` while another live session held 5173.
- cost note: web research (official worktrees doc + community practice) + design + tooling.
  A real port collision existed before this: playwright's `reuseExistingServer` on hardcoded
  5173 would have tested against whichever session's server answered first.
- what shipped: claim registry = `task/<id>` branch names (shared .git makes it visible to
  every session, nothing to go stale); `scripts/worktrees.mjs status` with per-branch
  deterministic ports; `E2E_PORT` in playwright config (+`--strictPort`);
  `worktree.baseRef: "head"` (master here is usually ahead of origin);
  `docs/WORKTREES.md` contract (worktrees build, ONLY main checkout merges — Claude Code's
  own isolation enforces the boundary); location-aware `/next`; spine rule (at most one
  active claim touches Shell/routes/state/design-system/package.json).
  Found free: worktrees under the repo root resolve the main checkout's node_modules via
  Node's ancestor walk — no npm ci per worktree.
- hypothesis: the untested half is the INTEGRATE step under real conflicts; rules make
  conflicts unlikely but the first real parallel round will tell.
- change: this whole entry is the change (docs/PROCESS.md "Parallel sessions" section +
  WORKTREES.md + tooling). **Review-by: after the first round with 2+ real parallel
  sessions** — keep if merges stay boring; tighten the spine rule if not.
- experiment verdicts due: none yet (visual-pass and redesign review ~2026-08-22).

## 2026-08-08 (second session) — Triage cleared; the gate caught a dead feature on its first run

- user-reported defects since last session: 0 new. The standing one (T.1, `verify` exit 1) is fixed.
- slices proven / started: 4 / 4 — T.1 (verify green), 3.14, 3.18a, 3.23 (+3.19b ticked on
  existing evidence). All four boxes T.1 was blocking passed the gate.
- gate catches before commit: **7**, none of which a test would have found.
  1. **3.18a was completely inert.** `buildMeasureLabels`, `ScoreViewer`'s `measureLabels` prop
     and the engraver's `setMeasureLabels` all shipped tested last session, and *no caller ever
     passed the prop*. Driving the Practice screen returned an empty label list. This is the
     defect class the gate was written for, caught on its first real session.
  2–5. 3.14's engraving had a playback cursor on a score nothing plays, a `♩=120` on a scale, a
     title duplicating the heading beside it, and a synthetic `8/4` meter in 360px of empty paper.
  6. Every retention stat printed its label twice ("Cards 0 CARDS") on two screens.
  7. `.keyboard-diagram { width: 100% }` at ≤1024px drew the 5-key dictation pad against ~700px
     of empty frame.
  Also found, recorded, not silently fixed: 3.14a (per-note spelling — F# major's E# engraves as
  F♮) and T.2 (`audio-clock-drift` e2e red on a clean tree, ~5994 ms/min vs a 150 budget).
- docs budget (ROADMAP+CLAUDE+PROCESS lines): 773 + 92 + 100 = **965**
- cost note: the visual pass dominated. The Browser pane could not composite frames, so every
  screenshot went through a hand-written Playwright script — six of them written and deleted
  across four slices, each re-deriving the same drawer-opening, theme-setting, error-collecting
  boilerplate. The slices themselves were small and serial; no subagent was warranted and none
  was used.
- hypothesis: the experience gate is the right gate and is working, but it had **no tooling**.
  A gate that must be re-implemented from scratch every session is a gate that will get skipped
  on a session that feels rushed — and skipping it is exactly how 3.18a shipped dead.
- change: added `scripts/visual-pass.mjs` — one command per destination, both widths, both
  themes, exits 1 on any console error, with `--level`/`--select` for state-gated screens.
  `docs/PROCESS.md` step 3 now names it and forbids hand-rolled drivers. **Review-by 2026-08-22
  (or 4 sessions):** keep if the next sessions' visual passes run through it; revert if it turns
  out screens need so much bespoke setup that the flags grow faster than the value.
- experiment verdicts due: none — the 2026-08-08 redesign experiments are reviewed ~2026-08-22.
- note for the next session: T.2 is the triage item, then Phase 5's "playable content" group
  (5.1/5.2), the highest-impact unstarted work.

## 2026-08-08 — Process redesign (baseline entry)

User verdict on the old round protocol, verbatim intent: too many bugs reaching them; long,
costly sessions with mediocre output despite workflows; UI "looks bad, feels bad"; `/next`
doing the bare minimum to advance a box. Root causes found in evidence:

1. Proof was test-and-fixture-shaped. The roadmap archive records 12+ "tests green, feature
   inert in the browser" defects; milestone audits returned NOT MET verdicts on ticked boxes.
2. "First unchecked box, top to bottom" buried the highest-impact work: the 2026-08-06 UX
   review scored the product 4.5/10 and its fixes (Phase 5) sat below Phase 3/4 minutiae.
3. No design step and no visual gate existed anywhere in the process.
4. Cost silting: ROADMAP.md had grown to 1685 lines (~54k tokens) of proof prose, re-read
   every session; 6-module workflow rounds were the default shape regardless of need.
5. The meta pass was capped at 5 minutes and enforcement-only, so process *assumptions* were
   never revisited.

Changes landed this session (review-by 5 sessions from now, ~2026-08-22):
- `docs/PROCESS.md` created — model-owned, self-modifying process: triage by learner impact,
  vertical slices, experience gate (browser proof on real content + visual pass + console +
  states + perf), mandatory retro with metrics.
- `docs/DESIGN.md` created — composition rules + visual pass checklist over the existing
  design-system tokens.
- `ROADMAP.md` slimmed: done-task prose archived to `docs/roadmap-archive-2026-08-08.md`;
  ordering rule replaced with triage + impact; Triage section added (T.1: WIP 3.14 tree red —
  9 unhandled OSMD errors under `npm run verify`).
- `CLAUDE.md` slimmed to invariants + pointer to PROCESS.md; `/next` rewritten to run the
  session loop; SessionStart hook message updated.
- `scripts/check-docs-budget.mjs` added to `verify` — hard line budgets so the docs cannot
  silt up silently again.

Baseline metrics:
- user-reported defects at redesign time: 4 themes (bugs leaking, cost, UI quality, shallow /next)
- product score: 4.5/10 overall (2026-08-06 review), 17 aspects, worst: playable content 2/10,
  first-run 2/10, rhythm drill 2/10, practice usability 3/10, IA 3/10, input access 3/10
- verify at session start: exit 1 (9 unhandled OSMD errors, WIP 3.14)
- next re-review of the 17 aspects due: within ~5 sessions
