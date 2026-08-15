# DR-03 — Fallback inputs: computer keyboard and on-screen pads

**Phase:** D0 · **Effort:** S · **Depends on:** DR-02 (emits the same `DrumHit` stream) ·
**Blocks:** nothing (but keeps every trainer usable without the kit)

## Why

The piano app's own rule (roadmap 5.4/5.5, REQ-4.4.1): every trainer must be drivable
without hardware — that is also what makes e2e tests and tablet use possible. Established
web-drum convention maps QWERTY rows to pad groups; keystrokes carry no velocity, so
dynamics need a synthetic channel.

## What it is

- **Keyboard map:** home-row-centric defaults (e.g. `J` snare, `F` kick, `K` closed hi-hat,
  `L` ride, `U/I/O` toms, `Space` crash), editable in Settings. Modifier for dynamics:
  `Shift+key` = accent, plain = normal, `Alt+key` = ghost — synthetic velocities (e.g.
  110/85/40) chosen to land in DR-07's velocity classes.
- **On-screen pad grid:** a tap surface with kick/snare/hats/toms/cymbals, 44 px+ targets
  (existing tablet rule), visible on trainer screens when no MIDI device is present — same
  presence logic as the piano's on-screen keyboard and `InputCapabilityBanner`.
- Both wrap into the same merged input the hardware uses — the drum equivalent of
  `playableInput.ts`: one `DrumHit` stream, consumers cannot tell sources apart.

## Scope

In: the two inputs, remapping UI, dynamics modifiers, capability banner wiring.
Out: mic onset detection (backlog DR-B1 — feasible per research §7, ~55–67 ms browser audio
latency needs its own calibration and generous windows; "which drum was hit" classification
is a separate ML-sized feature).

## Experience-gate proof

Unplug MIDI: banner states what is degraded; a full groove in DR-09 is playable and graded
from the keyboard alone including an accented backbeat and a ghost; on a tablet-width
window the pad grid passes the 44 px sweep and a tap grades a hit (extend the existing
`tablet-touch-targets` pattern).
