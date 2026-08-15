# DR-21 — Spaced repetition over rudiments and grooves

**Phase:** D2 · **Effort:** S–M · **Depends on:** core/srs (exists), DR-10, DR-09
attempt records · **Blocks:** DR-22 (planner consumes the due queue)

## Why

The one thing nobody in the market does (../research-2026-08-15.md §6): every competitor's
"smart" feature is a tempo ramp or a stats log; none decides *what to revisit* based on
decay. This app already owns an SRS scheduler with a piano-proven store pattern — applying
it to motor skills is the roadmap's clearest differentiator.

**The motor-skill caveat from the research, honored in the design:** spacing governs
*across-session resurfacing*, not within-session learning. First acquisition needs massed
reps (that's DR-10's ladder and DR-09's looping). SRS here schedules "revisit this, prove
it held", never "do 3 reps now, 3 tomorrow".

## What it is

- **Reviewable item types:** a rudiment at its recorded clean BPM ("single paradiddle @
  90"); a groove at BPM; a fill in context; optionally a learner-authored DR-13 groove
  ("Add to review").
- **The review check** is a short proof, not a practice session: one ladder pass at the
  item's recorded BPM (rudiment) or one clean loop pass (groove). Pass → interval grows
  (existing scheduler policy); fail → item re-enters with the BPM knocked down a step,
  and the trainer offers the full practice loop right there.
- **Grading adapter** (`src/core/drums/srs/`): maps trainer results onto the scheduler's
  quality scale — the only new core logic; the scheduler itself is untouched.
- **"Due today" queue:** its own small panel on the drums Today screen and an input to
  DR-22's planner (review items are the warm-up block — pedagogically sound: proven
  material as warm-up).

## Experience-gate proof

Seed a rudiment record, pass its review: interval visibly grows (scheduler details
disclosure, the piano SrsSummary pattern); fail it: due sooner + BPM stepped down,
driven, not assumed; the due queue on Today lists exactly the seeded-due items and each
opens its trainer preloaded. Export/import round-trips drums SRS state.
