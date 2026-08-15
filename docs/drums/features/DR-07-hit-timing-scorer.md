# DR-07 — Hit timing scorer: matching, windows, velocity classes

**Phase:** D0 · **Effort:** L · **Depends on:** DR-02, DR-04 · **Blocks:** DR-09, DR-10,
DR-14, DR-15, DR-20, DR-25, DR-26

## Why

The engine every scored feature runs on. Correctness-critical timing code — this project's
CLAUDE.md routes its review to Opus at high effort, and its piano matcher history says a
100%-covered suite still missed bugs. Research grounding (../research-2026-08-15.md §4):
learning apps should start ~±100 ms full credit and tighten with level toward ±40–50 ms;
scoring must expose the signed ms, the pad, and the velocity received — opaque grades are
the most-complained-about failure in this market.

## What it is

Pure core, `src/core/drums/scoring/`:

- **Matcher:** expected onsets (from `GrooveScore`, per pad, in ticks→ms at session BPM) vs
  the live `DrumHit` stream. Per expected onset: `hit (signed deviation ms) | missed`; per
  played hit: `matched | extra | wrong-pad` (right time, wrong drum — a distinct verdict,
  because "you hit the mid tom, chart says floor tom" teaches; "miss" does not).
  Hi-hat leniency rule: open-vs-closed mismatch is its own verdict, not a wrong-pad, and
  its strictness is level-configurable (budget kits blur this line — research §3).
- **Windows:** `{ perfect, good }` signed windows, defaults ±40/±100 ms, tightening preset
  per curriculum level (D1 generous → D6 tight). Device latency offset from DR-08
  subtracted before classification.
- **Velocity classes:** `accent/normal/ghost` classification against per-kit calibrated
  bands (defaults from research: ghost ≲ 50, accent ≳ 100). Dynamics-scored exercises
  (DR-25) grade class match; ordinary grooves ignore dynamics below the level that
  introduces them.
- **Aggregates:** per-run accuracy %, mean/SD of deviation (tightness), per-limb bias
  ("kick rushes by 12 ms"), per-beat heatmap. These feed DR-23's dashboard.
- **Loop semantics:** matching windows wrap across loop boundaries; a hit just before the
  bar-1 downbeat belongs to the next pass, not "extra".

## Testing

Property tests (fast-check), not just examples: every expected onset gets exactly one
verdict; no played hit double-matched; deviation antisymmetry (shifting the hit stream by
+d shifts mean deviation by +d); wrong-pad never steals a same-time match from the correct
pad; loop-boundary wrap. Adversarial Opus review before any trainer ships on it.

## Experience-gate proof

No screen of its own — proven through DR-09's first slice: a deliberately early backbeat
shows orange with "-32 ms" on that notehead; an extra hit and a wrong tom show their
distinct verdicts; per-limb bias line on the results panel matches a scripted input stream
built to rush the kick.
