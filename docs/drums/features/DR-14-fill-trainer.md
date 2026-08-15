# DR-14 — Fill trainer: leave the groove, come back on 1

**Phase:** D3 · **Effort:** M · **Depends on:** DR-09 (extends its engine), DR-04/05/06/07
· **Blocks:** DR-17/DR-27 fill exercises

## Why

Pedagogy (../research-2026-08-15.md §1): fills start right after the first solid groove,
and the actual skill is not the fill — it is leaving the groove and **re-entering on beat
1**, usually with a crash. Practicing fills in isolation trains the wrong thing; every
method book drills groove → fill → groove.

## What it is

- **Fill library** (`src/content/drums/fills.ts`): graded fill vocabulary as data —
  1-beat snare fills (D1) → 1-bar 8th fills across toms (D2) → 16th-note fills (D4) →
  triplet and syncopated fills (D5–D6). Each tagged with level, source rhythm, and
  voicing, following the PAS two-axis vocabulary model (one rhythm many voicings / one
  voicing many rhythms) so the library reads as a system, not a heap.
- **Context mode** (the default): N bars of a chosen groove (from DR-24/DR-13) → the fill
  bar → back to the groove with crash on 1, looping. Scoring weights the re-entry: the
  bar-1 downbeat after the fill is called out separately in the results ("fill accuracy
  84% · re-entry +6 ms — solid").
- **Isolation mode:** just the fill, looped, for first learning — explicitly labeled as
  the warm-up step, with the UI nudging toward context mode once clean.
- **Improvise slot (upper levels):** the fill bar accepts *any* hits — no per-note
  grading; graded only on filling the bar (density floor) and nailing re-entry. This is
  the app's honest version of "make something up over the barline", and the bridge to
  real musicianship the syllabi test as improvisation.

Engine: a small extension of DR-09's session machine (sectioned expectations per bar);
scorer unchanged (DR-07 already understands per-bar sections and the improvise slot is a
grading policy, not a new matcher).

## Experience-gate proof

Drive groove→fill→groove on the fake input: fill hits graded per note, re-entry verdict
separately displayed, a late re-entry (+80 ms scripted) flags exactly that; improvise
slot accepts an arbitrary busy bar and grades only density + re-entry; library filters by
level. Both widths/themes, console clean.
