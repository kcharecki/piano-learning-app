# DR-02 — E-drum MIDI input: kit mapping, hi-hat, chokes

**Phase:** D0 · **Effort:** L · **Depends on:** DR-04 (pad/voice vocabulary) ·
**Blocks:** DR-07, DR-08, every scored trainer

## Why

The single highest-leverage input path: the user owns an e-kit. Research
(../research-2026-08-15.md §3) says real kits do not agree with GM or each other — Roland
extends far outside GM (hi-hat edge at 22/26, ride bell 53), Yamaha's ride is 83, Alesis has
a GM-mode toggle. Hi-hat truth is CC#4, chokes are polyphonic aftertouch. Hi-hat
mis-triggering is the #1 documented complaint against Melodics — mapping and calibration must
be first-class, not an afterthought.

## What it is

A drum input stack mirroring the piano one (`MidiInput` port → merge layer → consumers):

- **`DrumHit` event** (core type): `{ pad: DrumPad, velocity, timeMs, articulation }` where
  `pad` is the app's own vocabulary (DR-04), never a raw note number.
- **Kit map** (pure, `src/core/drums/kitmap/`): raw MIDI event stream → `DrumHit` stream.
  Handles: note→pad table lookup; CC#4 state machine deciding closed/half/open hi-hat at
  note-on time (configurable closed threshold, default 90 per Roland); poly aftertouch
  (`0xA0`) → choke event; velocity-0 note-on treated as note-off; notes outside 35–81
  accepted; per-pad debounce window (default 20 ms, configurable) against double triggers;
  per-pad minimum-velocity gate (default low — ghosts at velocity 30–50 are signal).
- **Presets** shipped as data: General MIDI, Roland TD family, Alesis (GM mode), Yamaha DTX.
- **MIDI-learn wizard** (app): "Hit your kick… now your snare… snare rim…" captures the
  incoming note per pad, builds a custom map, persists it. This is the real fallback for
  every kit the presets miss.
- Adapter layer: extend `src/adapters/midi/webmidi.ts` event decoding to pass through
  aftertouch and CC messages it may currently drop (verify), keeping the port shape.

## Scope

In: everything above, persisted per-device kit maps, a raw-event debug view (lives in DR-08's
monitor). Out: positional sensing (Roland CC nuance — backlog), BLE-specific handling
(exists via B.2; DR-08 adds the latency caveat), mic input (DR-03/backlog).

## Testing (non-negotiable)

Kit map is pure core with property tests: CC4 interleaving (CC arrives before/after note-on),
choke ordering, debounce boundary, velocity-0, unknown-note passthrough to an "unmapped"
bucket the wizard can observe. Fake MIDI streams from `src/test/fakes.ts` patterns; never
real time.

## Experience-gate proof

With a real or scripted e-kit stream: wizard maps a kit in under a minute; closed vs open
hi-hat classified correctly through a CC4 sweep; a choke mutes the ringing crash in the
monitor; a ghost note at velocity 35 arrives as a hit, not silence; unmapped pads surface
visibly instead of vanishing.
