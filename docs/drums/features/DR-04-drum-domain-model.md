# DR-04 — Drum domain model: pads, voices, grooves, articulations

**Phase:** D0 · **Effort:** M · **Depends on:** nothing (first core module) ·
**Blocks:** DR-02, DR-05, DR-06, DR-07, DR-13 — everything

## Why

Every other feature speaks this vocabulary. The piano app's discipline holds: pitch was
always MIDI number in core; here the invariant is **pad identity and tick time**, with raw
MIDI note numbers confined to the kit-map edge (DR-02) and staff positions confined to the
renderer edge (DR-05).

## What it is

Pure TypeScript in `src/core/drums/model/`:

- **`DrumPad`** — the app's pad vocabulary: `kick, snare, snareRim, crossStick, hhClosed,
  hhOpen, hhPedal, tomHigh, tomMid, tomFloor, rideBow, rideBell, rideEdge, crash1, crash2,
  splash` (+ `unmapped`). Derived groupings: limb (hand/foot), staff position, GM playback
  note.
- **`DrumHit`** — a live input event: pad, velocity, time (ms at the edge, ticks once
  aligned), articulation flags.
- **`GrooveScore`** — the notated thing trainers play: measures in ticks
  (`TICKS_PER_QUARTER = 480`, shared constant), time signature, swing (`swingPercent` 50..75
  + `swingUnit` eighth/sixteenth) — performance metadata only, never baked into a note's
  `tick`; a note's tick is always its nominal (straight) notated position, standard MusicXML
  practice (written straight, a `<sound><swing>` directive tells the reader how to swing it
  in performance) — per-note: pad, tick, duration (display only — drums are onset events),
  voice (hands/feet, the stems-up/stems-down convention from research §2), dynamics class
  (`accent | normal | ghost`), articulations (`flam, drag, buzz, open, choke`), optional
  sticking (`R | L`).
- **Grid projection** — `GrooveScore` ⇄ subdivision grid (rows = pads, columns = 8th/16th/
  triplet cells) for the editor (DR-13) and grid-style trainer displays, both directions
  returning a `Result` — a grid can carry an invalid swing/meter combination, and a score can
  have notes that do not land on the grid. Grid cells always sit at NOMINAL (straight) tick
  positions, matching `GrooveScore`'s own straight-tick convention above; swing is carried as
  metadata alongside, never used to place a cell, so this is a straight-notation <-> grid
  mapping, not a swung-position one (swung playback positions are `subdivisionCellTick`'s
  job, kept for DR-06). Property: round-trip identity (grid -> score -> grid) for any
  grid-representable score — not a claim that an arbitrary `GrooveScore` survives the trip.
- **MusicXML bridge** — parse/serialize drum parts: `<unpitched>` + `<instrument>` +
  `<notehead>` + voice/stem per research §5, mapping to/from `DrumPad`. Extends
  `core/notation` alongside `parseMusicXml`, reusing its `Result` error style. Playback
  instrument read from `<midi-unpitched>`, never display position.

## Conventions locked here

- Time in ticks inside core; ms only at adapters/transport (existing rule, restated because
  drums are pure onsets — durations exist only for engraving).
- Velocity classes are named (`accent/normal/ghost`), thresholds live in one place and are
  calibration-adjustable (DR-08), never scattered magic numbers.

## Testing

Property tests (fast-check): grid round-trip; MusicXML round-trip on generated grooves
(including a randomised `swingUnit`); voice assignment invariant (feet never stems-up);
swing tick sequence strictly increasing (reversible); swing pairing restarts at every
measure boundary, proven across odd eighth-subdivision meters (3/8..9/8) and a 5/16
sixteenth-subdivision meter, so a pair never straddles a barline. Example tests: the
reference grooves from research §1 encode and re-serialize byte-stable, plus their own
domain-level checks (`referenceGrooves.test.ts`).

## Experience-gate proof

Core-only slice: `npm test` stays under 3 s with the new suite; a bundled reference groove
(money beat with open-hat variant, ghosted funk bar) parses from MusicXML to the exact
expected `GrooveScore` and back. Driven proof arrives with DR-05/DR-09 (this module has no
screen of its own — the gate is its consumers').
