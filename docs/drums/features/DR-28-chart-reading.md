# DR-28 — Chart reading: slashes, repeats, the working drummer's map

**Phase:** D3 · **Effort:** M · **Depends on:** DR-19 (symbols taught), DR-05/OSMD
(rendering repeats/slashes), DR-26 (charts to read), DR-09 engine · **Blocks:** D6 exit

## Why

Intermediate reality (../research-2026-08-15.md §1): real gig charts are not note-for-note
transcriptions — they are form maps: slash bars ("keep time"), repeats, 1st/2nd endings,
%, D.S. al Coda, ensemble figures. Reading them is a named intermediate skill in every
syllabus, and no trainer in the surveyed market teaches it interactively.

## What it is

- **Navigation drills** (`src/core/drums/charts/`): given a chart with repeats/D.S./coda,
  the learner follows the form — the app plays the band (DR-26 backing), the learner
  plays time, and the *graded thing is being in the right bar*: the expected-onset
  stream is the flattened form, so a learner who misses the D.S. lands measurably wrong.
  Form-flattening is pure and property-tested (round-trip against authored linear
  expansions — repeat/jump semantics are exactly the kind of logic that ships wrong
  silently).
- **Slash-bar semantics:** during slash bars, grading relaxes to time-keeping (any
  groove-consistent hits, beat-aligned) and tightens at written figures — the "kicks
  over time" discipline: hold the groove, catch the figure.
- **Figure reading:** one-bar ensemble-figure charts (the horn-hit exercise): groove +
  catch the marked accents with crash/kick.
- **Chart literacy course content** (in DR-27's D6 unit): symbol walkthroughs (DR-19
  decks preloaded), then graded navigation drills of growing length, ending with a full
  DR-26 etude played from its *chart form* (repeats un-expanded) rather than the
  linear score.
- Rendering: repeats/endings/segno/coda are standard engraving — this is OSMD's home
  turf (DR-05's chart lane), slashes via notehead style.

## Experience-gate proof

Form-flattener property tests green (including nested repeat + D.S. al Coda cases);
driven: a chart with a D.S. al Coda plays correctly when followed and shows the "you
went straight through the repeat" divergence when a scripted take does; slash bars
accept a valid groove and still catch a written figure miss; the D6 full-etude-from-form
run grades end to end. Both widths/themes.
