---
description: Run the session loop — recover, triage by impact, ship proven slices, retro
---

Run the session loop in `docs/PROCESS.md`, autonomously, without asking for confirmation:

0. RECOVER — `git status` even if the tree looks clean; dirty → verify → slice-commit or fix.
1. TRIAGE — `ROADMAP.md`: Triage section first, then highest learner impact. State the pick
   and why in one sentence. The old "first unchecked box" rule is dead.
2. SLICES — up to 3–4 vertical slices, each through the FULL experience gate before its tick:
   verify green → driven in the running app on real content → visual pass per `docs/DESIGN.md`
   (both widths, both themes, screenshots) → console clean → states handled → no perf
   regression. Commit each slice as it lands. Bare-minimum passes are the failure mode this
   protocol replaced: if the screen you touched still fails the DESIGN checklist, the slice is
   not done, whatever the tests say.
3. RETRO — before ending, always: entry in `docs/retro-log.md` (metrics included), verdicts on
   any due experiments, and one process improvement (edit `docs/PROCESS.md` or add
   automation) or an argued "no change".

$ARGUMENTS
