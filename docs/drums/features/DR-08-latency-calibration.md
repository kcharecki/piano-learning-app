# DR-08 — Latency calibration and the input monitor

**Phase:** D0 · **Effort:** S · **Depends on:** DR-02, DR-06 · **Blocks:** honest scoring
everywhere (DR-07 consumes the offset)

## Why

USB MIDI is sub-1 ms but the audio the learner plays *against* is not (output latency,
module routing), and BLE-MIDI adds 3–50 ms of jitter (../research-2026-08-15.md §3). With
±40 ms windows at upper levels, an uncalibrated 25 ms constant offset misgrades every hit
the same direction — the exact "scoring feels unfair" failure documented against other apps.

## What it is

- **Calibration flow** (Settings → Drums): steady click at 80 BPM, learner plays along on
  any pad for 16 hits; the median signed deviation becomes the device's stored offset;
  the spread is shown honestly ("your timing spread here was ±18 ms — windows tighter than
  that will feel random"). Re-runnable anytime; stored per input device id.
- **BLE caveat surfaced:** if the active input is the Bluetooth adapter (B.2), the flow
  warns that jitter (not just offset) cannot be calibrated away and recommends USB for
  scored work — stated once, at the right moment, not as a nag.
- **Input monitor** (part of the same screen): live scrolling list of raw events → mapped
  verdicts: note number, mapped pad, velocity, CC4 value, choke events, debounce drops.
  Doubles as the kit-map debugging surface DR-02's wizard links to ("not seeing your pad?
  open the monitor").
- Offset math is core (`src/core/drums/scoring/latency.ts`), trivial and property-tested
  (median robustness against outlier hits); the screen is thin.

## Experience-gate proof

Scripted input stream with a known +30 ms bias: calibration lands within ±3 ms of it, and a
DR-09 run before/after calibration visibly shifts verdicts from "late" to centered. Monitor
shows a CC4 sweep and a choke live. Both widths, both themes, console clean.
