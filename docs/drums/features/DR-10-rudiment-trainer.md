# DR-10 — Rudiment trainer: the 40, tiered, with a tempo ladder

**Phase:** D1 · **Effort:** M · **Depends on:** DR-04, DR-05, DR-06, DR-07 ·
**Blocks:** DR-17/DR-27 technique exercises, DR-21 items

## Why

Rudiments are the hands' vocabulary. Pedagogy (../research-2026-08-15.md §1): teach in
Wooton's four tiers, not PAS list order — six rudiments cover the whole beginner phase.
Tempo ladders with success-gated increments are the practice mechanic the whole rudiment-app
category is built on; per-rudiment tempo PRs make progress visible for months.

## What it is

- **Library** (`src/content/drums/rudiments.ts`): all 40 PAS rudiments as data — sticking
  pattern (R/L per note), rhythm, accent structure, tier (1–4), target-BPM band, short
  "how it transfers to the kit" line. Tiers 1–2 fully surfaced in curriculum; 3–4 present
  in the library, labeled advanced.
- **Practice surface** (reuses the DR-09 engine): rudiment rendered with sticking letters
  (DR-05), played on snare/pad — a single-pad mode so a practice pad w/ one trigger, the
  keyboard, or the snare alone all work. Hand-tracking when the kit reports distinct
  zones is out of scope (MIDI cannot see hands) — sticking is displayed, evenness is
  measured.
- **Tempo ladder** (core, `src/core/drums/trainer/tempoLadder.ts`): start BPM, +5 on a
  clean pass of N cycles (default 8 bars, ~the "60 consecutive clicks" heuristic), drop -5
  on a failed pass, session ends on time budget or plateau. "Up-then-down" mode ramps past
  the PR and back down for control at the edge. Pure, property-tested (ladder never skips,
  PR monotone in history).
- **Evenness + dynamics scoring:** DR-07 aggregates per hit-pair alternation — timing
  evenness (SD of inter-onset intervals), volume evenness (velocity spread), accent
  placement match for accented rudiments (flams/accents graded once DR-25's classes exist;
  before that, timing only). The piano `core/technique` evenness scoring is prior art.
- **Per-rudiment record:** clean-BPM history chart (the piano tempoHistory pattern), PR
  surfaced on the library list.

## Experience-gate proof

Drive single stroke roll from 60 BPM: two clean passes auto-bump to 70, a scripted sloppy
pass drops back, PR recorded and visible in the library list; paradiddle renders correct
RLRR LRLL sticking; buzz roll's grading states what it measures (onset only, not bounce
quality — honesty rule). Library shows all 40 with tiers; both widths/themes.
