# DR-12 — Metronome suite: gap click, subdivisions, mute games

**Phase:** D1 · **Effort:** M · **Depends on:** core/timing (exists), DR-06 sounds ·
**Blocks:** DR-10 ladder (uses ramp), DR-22 timing blocks

## Why

Timing is the product a drummer sells. The verified practice methods
(../research-2026-08-15.md §1, §6): tempo ladder, gap click (the single highest-leverage
internal-clock exercise — Benny Greb's tool is built on nothing else), subdivision clicks,
click-on-2&4, random mute. PolyNome is the category benchmark; we need its core five, not
its sequencer maximalism.

## What it is

Extends the existing `core/timing` metronome (piano's metronome screen keeps working; the
drums nav gets its own screen over the same engine):

- **Subdivision click:** quarter / 8th / 16th / triplet voices, accent on the beat,
  distinct downbeat accent. Per-subdivision volume so the learner can fade the crutch out.
- **Click placement:** all beats / 2&4 only ("hi-hat feel") / 1 only / first-of-bar every N
  bars.
- **Gap click:** N bars on, M bars silent, cycling. **With DR-07 attached and any input
  active, the return bar measures drift** ("you came back +38 ms ahead") — the
  measurement no metronome app can make without an instrument, and this app has one.
- **Random mute:** each bar silenced with probability p (PolyNome's read-first/listen-first
  simplification: fixed probability only).
- **Tempo ramp:** +N BPM every M bars, bounded — shared engine with DR-10's ladder
  (which adds success-gating on top).
- **Speed presets per exercise:** every trainer's "practice this at..." hands a config to
  this engine; the metronome screen is also directly reachable as a tool.

All engine logic pure in `core/timing` extensions (injected clock, property tests: gap
schedule periodicity, ramp bounds, mute distribution determinism under fake Rng); screen
thin.

## Experience-gate proof

Gap click 4-on/2-off audibly cycles and, with the fake input playing straight 8ths shifted
+40 ms, reports the drift at re-entry within tolerance; 2&4 mode clicks exactly on 2&4
(recorded AudioOutput calls asserted); ramp 60→100 over the set bars then holds; existing
piano metronome screen unaffected (its spec green). Both widths/themes, console clean.
