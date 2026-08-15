# DR-18 — Technique foundations: honest teaching of what MIDI can't see

**Phase:** D2 · **Effort:** S–M (content + diagrams) · **Depends on:** DR-17's lesson
surface (it lives inside lessons + a reference section) · **Blocks:** nothing; D1 lessons
embed it

## Why

Grip, posture, stroke motion, and pedal technique are the foundation — and invisible to
MIDI. The market's documented failure (../research-2026-08-15.md §6) is pretending
otherwise or ignoring it. The app's stance, stated on-screen: *it grades timing and
dynamics; technique is taught, checklisted, and self-checked — never fake-graded.*

## What it is

- **Reference section** (drums nav → Reference, the piano app's reference-panel pattern):
  - Posture & setup: throne height, distances, pedal alignment — annotated SVG diagrams
    (design-system styled, no photos needed).
  - Matched grip: German/American/French with when-each-matters; fulcrum, back fingers.
  - The four strokes (full/down/tap/up) with height diagrams — the vocabulary DR-10's
    accent work builds on.
  - Bass drum: heel-down first, heel-up when and why; hi-hat foot.
  - Moeller: a D6-gated intro page — what it is, why it waits (research: rebound control
    first), first whip exercise.
- **Self-check checklists** embedded in D1/D3/D6 lessons: mirror/phone-video prompts
  ("film 20 seconds of your hands; check: stick height even? fingers on the stick?").
  Completion is self-reported and stored — it feeds the session log, not a score.
- **Proxy signals, labeled as proxies:** where the scorer *can* corroborate technique
  (velocity spread between hands in DR-10 = uneven strokes; timing SD shrinking at higher
  BPM = relaxation), the UI says "this often indicates…" — never "your grip is wrong".

## Experience-gate proof

Reference pages render at both widths/themes with legible diagrams; a D1 lesson embeds
the grip checklist and its self-check state persists across reload; nothing anywhere
presents a technique *grade*; the Moeller page is discoverable but marked D6. Console
clean.
