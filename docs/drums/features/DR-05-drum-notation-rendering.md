# DR-05 — Drum notation rendering: groove renderer + OSMD strategy

**Phase:** D0 · **Effort:** L · **Depends on:** DR-04 · **Blocks:** DR-09, DR-11, DR-13,
DR-26

## Why

Research (../research-2026-08-15.md §5) settled the risk: OSMD renders percussion staves,
but its documented open gaps are exactly the marks a drum trainer lives on — ghost-note
parentheses ignored, open-hi-hat "o" not recognized, "+" misplaced, flam grace notes
dropped (issue #887). Betting every trainer surface on OSMD means betting on upstream fixes.

## Decision

**Two renderers, each where it is strong:**

1. **Own SVG groove renderer** (`src/app/drums/notation/GrooveStaff.tsx`, geometry pure in
   `src/core/drums/engrave/`): the primary surface for trainers (DR-09/10/11/13/14/15).
   Scope is deliberately narrow — 1–8 measures, one percussion staff, the Weinberg
   conventions from research §2: x/oval/diamond noteheads, parenthesized ghosts, o/+ hi-hat
   marks, flam grace note, sticking letters under the staff, accents, hands-up/feet-down
   stems, beam groups per beat. Pure geometry function `GrooveScore → SVG primitives`
   (same pattern as `core/notation/pianoRoll.ts`), so it is property-testable without DOM.
2. **OSMD for full charts** (DR-26 play-along, imported MusicXML): multi-system layout,
   repeats, dynamics — the work our renderer must never grow into. Use
   `CustomNoteheadVFCode` (OSMD ≥ 1.9.4) to patch notehead gaps.

**Decision gate written down now:** if driving DR-26 shows #887-class gaps (ghosts/flams)
make real charts unreadable and the escape hatch cannot cover them, evaluate alphaTab for
the chart surface only — never for the trainer surfaces, which stay on our renderer.

## What it is

- Groove renderer as above, theme-aware via design-system tokens only.
- Per-hit feedback overlay: each rendered notehead addressable by id so DR-09 can color it
  (hit/early/late/miss/wrong-pad) without re-engraving — the piano app's cursor/feedback
  split, kept.
- A falling-lane "highway" alternative view is **not** this task (Beatlii proves togglable
  dual view is valued; our piano roll precedent makes it cheap later — backlog DR-B4).

## Testing

Property tests on the geometry: no two noteheads of one voice collide; stems direction by
voice; ghost parens present exactly when dynamics class is ghost; beam grouping never
crosses a beat boundary at simple meters. Visual pass against reference grooves compared
with the digest's notation table.

## Experience-gate proof

The reference set (money beat, open-hat groove, ghosted funk bar, flam rudiment line,
sticking-annotated paradiddle) renders on screen matching research §2 conventions at both
widths/themes; a rendered ghost is visibly parenthesized; feedback overlay colors one
notehead without re-render (measured: no engrave in the profiler on hit).
