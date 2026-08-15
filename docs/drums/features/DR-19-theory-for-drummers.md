# DR-19 — Theory for drummers: rhythm, meter, form

**Phase:** D2 · **Effort:** M · **Depends on:** DR-16 (quiz exercise kind), core/drills +
core/srs (exist) · **Blocks:** DR-28 (chart symbols taught here first)

## Why

The user asked for a package that teaches music theory, drum-flavored. The verified scope
(../research-2026-08-15.md §1): note values and meter from day one; song form as soon as
songs appear; blues form with shuffle; compound meter mid-way; chart symbols and AABA at
intermediate; polyrhythm 3:2 at the top edge. Pitch-side theory (keys, chords) stays
piano-side — a drummer needs form and rhythm, not voice leading.

## What it is

- **Quiz decks** (reusing the piano flashcard/drill engine + SRS, drum-flavored content in
  `src/content/drums/theory.ts`):
  - Note values & rests, dotted values, tuplets (D1–D4) — including *audio* items: hear a
    bar, pick its notation (DR-06 renders the prompt).
  - Meter: 4/4, 3/4, 6/8 vs 3/4 distinction, 12/8 (D3–D5).
  - Form: verse/chorus/bridge labeling, 12-bar blues structure, AABA (D3–D6) — items use
    mini form-maps, not prose alone.
  - Chart symbols: repeats, 1st/2nd endings, %, D.S./D.C., coda, fine (D6, feeds DR-28).
  - Polyrhythm intro: what 3:2 is, hear-and-identify (D6, identify-only — playing
    polyrhythms is advanced tier, out of scope).
- **Concept pages** in lessons where a deck needs grounding (why 6/8 isn't 3/4 — one
  diagram beats ten cards).
- SRS-scheduled like every piano deck; retention feeds DR-23.

## Experience-gate proof

Each deck opens from its lesson exercise with the right `kind` routing (the 4.9c lesson);
an audio item plays its bar and grades the pick; the 6/8-vs-3/4 item family drives the
distinction with grouped-beat playback, not text; SRS reschedules a failed card visibly
sooner. Both widths/themes.
