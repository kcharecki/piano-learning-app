# DR-09 — Groove trainer: the core practice loop

**Phase:** D1 · **Effort:** L · **Depends on:** DR-04, DR-05, DR-06, DR-07 (+DR-02/03 input)
· **Blocks:** DR-14, DR-15, DR-17 exercises, DR-24

## Why

The drums equivalent of the piano Practice screen — the single surface where most practice
minutes happen. The active loop (play → per-hit feedback → retry) is what the market's
video-led products lack and what its listener-led products prove works
(../research-2026-08-15.md §6: Melodics' colors/wait/loop/BPM slider are the copied core).

## What it is

Screen `src/app/drums/groove/`:

- **Load a groove** — from curriculum exercise, styles library (DR-24), beat builder
  (DR-13), or SRS queue (DR-21).
- **Display** — GrooveStaff (DR-05) with the transport cursor; per-hit overlay colors:
  perfect (green), early (orange, "-32 ms"), late (purple, "+41 ms"), miss, wrong-pad,
  extra — the exact Melodics color language, plus the numbers Melodics hides.
- **Transport** — count-in (1 bar, voiced), loop (whole groove or measure range), BPM
  slider (30–260) with the groove's target BPM marked, per-limb mute (play the kick line
  only; the app voices the rest — Drum School's isolation feature), metronome overlay
  on/off.
- **Wait mode** — playhead advances only on the correct next hit (Melodics' Wait Mode;
  the piano app already has the pattern in `core/practice` wait-mode).
- **Results panel** — score /100, accuracy %, tightness (SD ms), per-limb bias, per-beat
  heatmap, "worst beat" callout with a one-tap "loop that measure".
- **Attempt history** — per groove: best score, best clean BPM; feeds DR-16 exit criteria,
  DR-21 scheduling, DR-23 charts.

Engine is core (`src/core/drums/trainer/`): session state machine (idle → count-in →
running → done), reusing `core/timing` transport; the screen is wiring. Same split the
piano practice engine uses.

## Scope

In: everything above. Out: fills-in-context (DR-14 layers on this), dynamics grading
(DR-25 flips it on), highway view (backlog DR-B4).

## Experience-gate proof

Drive the money beat end to end on the fake input: count-in sounds, deliberate early
backbeat shows orange with signed ms, wait mode holds until the right pad, per-limb mute
silences and un-grades the muted limb, loop of measure 2 wraps verdicts correctly
(DR-07's wrap property driven, not assumed), results panel numbers match a scripted
stream's known stats. Both widths/themes, console clean, no perf regression against the
existing perf-spec pattern.
