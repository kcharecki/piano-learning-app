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
