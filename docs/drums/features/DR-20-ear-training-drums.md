# DR-20 — Drummer's ear training: hear it, play it, name it

**Phase:** D3 · **Effort:** M · **Depends on:** DR-06, DR-07, DR-09 engine, DR-13 grid
(for notate-back) · **Blocks:** DR-27 exercises

## Why

The graded syllabi test exactly this (../research-2026-08-15.md §1): Rockschool's ear
tests are *fill playback* and *groove recall* from Grade 1. "Learns a new song quickly by
ear" is a named beginner→intermediate boundary skill. The piano app's ear-training
architecture (prompt → answer → verdict → explanation, SRS-levels per kind) transfers
whole.

## What it is

Exercise kinds (`src/core/drums/ear/`), each with its own level ladder:

- **Groove recall (play-back):** hear 1–2 bars (DR-06 voices it, count-in, 2 listens) →
  play it back on the kit → DR-07 grades pads + rhythm (dynamics too at upper levels).
  Ladder: kick+snare only, 1 bar (D2) → full kit with opens/ghosts, 2 bars (D6).
- **Fill recall:** same loop for fills — the RS test, literally.
- **Notate-back (dictation):** hear a groove → enter it on the DR-13 grid → exact-match
  diff shown on the staff. The drummer's dictation; bridges ear to reading. Per-level
  bounds authored against the RS/Trinity calibration in the digest (the 5.58 lesson:
  ladder bounds trace to the syllabus, in the module doc).
- **Feel identification:** straight vs swung; shuffle vs straight blues; 8th vs 16th
  groove; half-time vs normal (quiz-style, audio prompts).
- **Tempo stability check:** the gap-click drift measurement (DR-12) surfaced here as a
  graded exercise ("internal clock" ladder).

All prompts synthesized from data — no audio assets; the same groove renders, sounds, and
grades from one `GrooveScore`.

## Experience-gate proof

Recorded AudioOutput calls prove the prompt voices the exact groove (the 5.55 pattern:
assert the calls, not the projection); a scripted correct play-back passes and a
one-pad-wrong play-back shows the diff on the staff; notate-back diff highlights the
wrong cell; feel-ID plays audibly swung vs straight prompts (schedule asserted). SRS
levels advance per kind independently. Both widths/themes.
