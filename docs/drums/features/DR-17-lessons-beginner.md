# DR-17 — Beginner lessons: D1–D3 authored content

**Phase:** D2 · **Effort:** L (content-heavy) · **Depends on:** DR-16, and the D1 trainers
its exercises open (DR-09/10/11/14/15) · **Blocks:** the app being a *course* rather than
a toolbox

## Why

Trainers without a syllabus are a gym without a coach. The piano app shipped a dozen inert
features under green suites before its curriculum wired them together — drums starts with
the lessons in the plan from day one.

## What it is

Authored content (`src/content/drums/lessons/`), ~36 lessons across D1–D3, each:
explanation prose (short — the active loop is the teacher), optional diagram, exercises
opening real trainers with real params. Unit sketch (final structure at authoring time,
progression order fixed by ../research-2026-08-15.md §1):

- **D1 (12 lessons):** sitting at the kit, throne height, matched grip (photos/diagrams,
  German-leaning start) · holding time: quarters on hats · first strokes: full/down/tap/up
  on snare · reading quarters+rests (DR-11 L1) · kick technique heel-down · the money
  beat, built limb by limb (DR-15 layer mode) · backbeat consistency · single stroke roll
  + buzz roll (DR-10 tier 1) · first fill: four on the floor…snare 8ths (DR-14 isolation →
  context) · 8ths reading (DR-11 L2) · first full play-through (DR-09, 8 bars) ·
  D1 checkpoint (exit criteria run).
- **D2 (12 lessons):** double stroke roll + single paradiddle · kick variations (8th
  patterns) · moving 8th fills around the toms · hats↔ride transitions · 16ths reading
  intro (DR-11 L3) · crash on 1 after fills · two-bar phrases: groove+fill discipline ·
  song form: verse/chorus (first DR-19 tie-in) · dynamics: accent vs normal (DR-25's
  classes, timing-graded until D3) · full simple song at tempo · flam intro · D2
  checkpoint.
- **D3 (12 lessons):** four-on-the-floor styles · first ghost notes (velocity classes now
  graded) · half-time feel · dotted rhythms + first triplets (DR-11 L4) · hi-hat foot on
  2&4 (DR-15) · flams in context · 12-bar blues form + first shuffle exposure · dynamics
  in fills · tier-1 rudiment consolidation at target BPM · verse/chorus song with fills at
  turns · rimshot intro · D3 checkpoint.

Authoring pipeline: grooves/fills authored in DR-13, exported as data; diagrams follow the
piano lesson-diagram pattern. Every pedagogical ordering claim in the content must trace to
the digest (the Phase-5 lesson: content calibration claims get sources, and re-reviews
check them).

## Experience-gate proof

Content test: every exercise resolves (kind registered, referenced groove/rudiment/fill
exists) — build fails on a dangling reference. Driven: a learner path D1L1→D1L12 in the
browser opens each trainer with the stated content; the D1 checkpoint flips the level when
its criteria are genuinely met (seeded records) and not before. Visual pass on 4
representative lessons, both widths/themes.
