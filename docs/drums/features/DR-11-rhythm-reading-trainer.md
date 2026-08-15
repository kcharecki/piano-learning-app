# DR-11 — Rhythm reading trainer: notation to hands, Reed-style

**Phase:** D1 · **Effort:** M · **Depends on:** DR-04, DR-05, DR-07 (+DR-06 for playback)
· **Blocks:** DR-17 reading exercises, DR-28

## Why

Reading rhythm is the drummer's literacy, and the verified progression is strict
(../research-2026-08-15.md §1): quarters → 8ths → 8th rests → 16ths → dotted → triplets →
syncopation. *Syncopation* (Reed) is the canonical book precisely because it drills this
ladder as one-line reading. The piano app's generator+levels architecture
(`core/generator`, levelDefaults) is the template — including its 5.53/5.54 lesson:
level parameters must encode pedagogy, not implementation convenience.

## What it is

- **Reading generator** (`src/core/drums/reading/`): produces one-line (single-voice)
  reading exercises per level from a rhythm-cell vocabulary. Level ladder mirrors the
  verified order; each level's cell set is data, monotonic (a level's vocabulary is a
  superset of the previous), and property-tested for exactly that — the 5.53 defect class,
  pre-empted.
- **Display:** one-line percussion staff (DR-05 handles `staff-lines: 1`), 2–4 measures,
  count-in, optional "hear it first" playback.
- **Play it:** tap on any pad/key — pad identity is ignored, onset timing is the graded
  thing (DR-07 in single-voice mode).
- **Two-voice extension (upper levels):** hands-line over a fixed kick pulse, then written
  kick+snare reading — the bridge from "reading rhythm" to "reading kit notation", feeding
  directly into DR-09's grooves.
- **Progression:** accuracy-gated level advance, same adaptive shape as
  `core/sightreading`; level descriptions authored from day one (the U.1 lesson).

## Scope

In: above. Out: full drum-chart reading (DR-28), odd meters (out of curriculum scope,
generator supports 3/4 and 6/8 where the curriculum asks).

## Experience-gate proof

Level 1 exercise engraves only quarters/rests (driven, engraved output inspected — the
5.54 proof pattern); syncopation level produces tied off-beats; a scripted tap stream
grades per onset with signed ms; level advance triggers at the documented threshold and
the header describes the new level in human words. Both widths/themes.
