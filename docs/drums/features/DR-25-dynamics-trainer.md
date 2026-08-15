# DR-25 — Dynamics trainer: accents, ghosts, rimshot, cross-stick

**Phase:** D3 · **Effort:** M · **Depends on:** DR-07 velocity classes, DR-08 calibration,
DR-09/10 engines · **Blocks:** D5/D6 exit criteria (ghosts are *the* intermediate marker)

## Why

Research (../research-2026-08-15.md §1): "comfortable ghost notes and consistent
rimshots" is the literal beginner→intermediate boundary in both Drumeo's and the
community's definitions. Dynamics are also where MIDI genuinely *can* coach — velocity is
data, unlike grip. No surveyed competitor grades dynamics seriously (Melodics tracks
timing only; Beatlii claims "dynamics feedback" without published detail).

## What it is

- **Velocity calibration** (extends DR-08): learner plays 10 accents, 10 normals, 10
  ghosts per instruction; the app fits per-kit class bands (kits and pads differ wildly —
  fixed thresholds are wrong on someone's kit). Bands stored with the kit map; a live
  velocity meter with the bands drawn makes the classes tangible.
- **Accent studies** (DR-10 surface): Stick Control-style accent patterns on single
  strokes and paradiddles — grade = timing (as before) + accent placement (right notes
  louder) + separation (accent band vs tap band gap). Ladder: accents on the beat →
  off-beat accents → moving accents.
- **Ghost-note grooves** (DR-09 surface): the D5 funk set with ghosts graded as ghosts —
  a ghost played at backbeat volume is a dynamics miss even though timing was perfect.
  Verdict language is coaching, not gaming: "ghosts too loud (avg 72, band < 55)".
- **Rimshot & cross-stick:** technique prose in DR-18's style; practice pieces here.
  Detection honesty: kits with distinct rim notes (DR-02's map) grade articulation match;
  kits without → the exercise says so and grades timing only (capability-gated, the
  InputCapabilityBanner philosophy).
- **Dynamic-range meter** on results: velocity histogram per hand — visible spread
  shrinkage over weeks is the technique proxy DR-18 promised.

## Experience-gate proof

Calibration fits bands from a scripted three-cluster stream; an accent study grades a
scripted wrong-accent pass down with the right per-note flags; ghost groove marks a
loud ghost as dynamics-miss with its velocity shown; on a map without rim notes the
rimshot exercise visibly degrades to timing-only with the honest label. Both
widths/themes.
