# DR-16 — Drum curriculum model and the D1–D6 level ladder

**Phase:** D2 · **Effort:** M · **Depends on:** core/curriculum (exists), DR-04 ·
**Blocks:** DR-17, DR-27, DR-21, DR-22, DR-23

## Why

The container every lesson and exit criterion lives in. The piano app's
levels→units→lessons→exercises model (`core/curriculum/types.ts`) fits drums as-is —
exercises are data with a `kind` and a params bag; drums adds kinds, not structure.

## The ladder (calibration: ../research-2026-08-15.md §1)

| Level | Name | Headline skills | External calibration |
|---|---|---|---|
| D1 | First beat | Setup/grip/strokes, quarters+8ths reading, money beat, 1-beat fills, tier-1 rudiments started | Drumeo L1 · RS Debut |
| D2 | Range | 8th fills around kit, kick variations, 16ths intro, hats transitions, full simple song | Drumeo L2 · RS 1 |
| D3 | Songs | Four-on-floor, flams, first ghosts, dynamics, verse/chorus playing, half-time | Drumeo L3 · RS 2 |
| D4 | Speed & subtlety | 16th fluency, kick permutations, cross-stick, hh openings, shuffle, dotted/triplet reading | Drumeo L4 · RS 3 |
| D5 | Groove craft | 6/8+12/8, kit paradiddles, rimshots, ghost-note funk, gap-click competence, tier-2 rudiments | Drumeo L5–6 · RS 4 |
| D6 | Musician | Syncopation fluency, jazz swing + comping intro, latin/bossa intro, chart reading, Moeller intro, improvised fills | Drumeo L6–7 · RS 5 |

**Exit condition of the whole roadmap = D6 exit criteria**, which encode the researched
beginner→intermediate boundary: comfortable ghosts + consistent dynamics classes at the
scorer, groove vocabulary across 4+ styles, gap-click drift under threshold, learns a new
D6 song chart to 85% inside a session.

## What it is

- **Track(s):** a `drums` track family in the curriculum model — likely three tracks
  mirroring piano's shape: `drums-playing` (grooves/fills/coordination), `drums-reading`,
  `drums-theory` — decided finally when DR-17 content is authored; the model change is the
  same either way.
- **Exercise kinds added:** `groove`, `rudiment`, `drum-reading`, `fill`, `coordination`,
  `drum-ear`, `drum-quiz` — each resolvable by the screens shipped in D1/D3 (the piano
  4.9c lesson: kind routing must be real, not one deck for everything).
- **Exit criteria per level:** measurable, drawn from trainer records (best clean BPM per
  rudiment, groove accuracy at BPM, reading level reached) — the piano
  `core/progress/levels` advancement-check pattern reused, with manual override kept.
- **Level state:** per-track drums levels in the levels store; export/import (4.6) grows
  the drums slice.

## Experience-gate proof

Core: model validates the authored curriculum (every exercise kind has a registered
consumer screen — a content test that fails on a dangling kind). App: a D1 exercise opens
its trainer with the right content; completing its criteria advances the level on the
drums dashboard, driven; export round-trips drums level state (extend the 4.6b pass).
