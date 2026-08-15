# DR-23 — Drums dashboard: progress a drummer can feel

**Phase:** D2 · **Effort:** M · **Depends on:** DR-16 levels, DR-09/10 records, DR-21 ·
**Blocks:** nothing; closes the motivation loop

## Why

Long-horizon motor learning needs visible trend lines — per-rudiment BPM history is the
classic drummer's progress artifact (every rudiment app ships it; drummers photograph
their PR charts). The piano dashboard's architecture (persisted stores → derived panels,
driven e2e with seeded IndexedDB — the M4 lesson that three of its panels once had zero
coverage) is the template *and* the warning.

## What it is

Drums Progress screen, panels:

- **Levels:** per-drum-track level + next exit criteria with live progress against each
  (the piano criterion panel pattern).
- **Rudiment PRs:** per-rudiment clean-BPM history sparkline; tier completion map
  (tier 1: 6/6 at target, tier 2: 3/10…).
- **Timing quality:** tightness trend (SD ms across recent graded runs), per-limb bias
  trend ("kick −8 ms mean, improving"), gap-click drift ladder.
- **Groove/style coverage:** grooves at target BPM per style (DR-24 grid), worst-recent
  list with one-tap reopen.
- **Ear & theory retention:** the piano SRS/retention panels, drums decks.
- **Streak & milestones:** shared streak (one habit); drum milestones derived, not
  awarded (the B.4 philosophy): first clean money beat at 100, tier 1 complete, first
  full song chart, gap-click drift under 20 ms, all-styles-at-D5.
- **Export:** drums data joins the existing JSON/CSV export/restore round-trip.

All derivations pure in `core/drums/` + `core/progress`; panels read stores; every panel
gets a seeded-IndexedDB e2e from birth (the M4 rule: no panel passes on a code reading).

## Experience-gate proof

Seed real records behind the app's back, reload: every panel shows the exact seeded
values, with one exclusion trap per panel (a dirty ladder run that must not count as a
PR; a piano-side record that must not leak into drums panels); rewrite stored values and
watch the screen follow (the dashboard-sections spec pattern, reused). Both
widths/themes, console clean.
