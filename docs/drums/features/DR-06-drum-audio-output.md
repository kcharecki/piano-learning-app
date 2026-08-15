# DR-06 — Drum audio output: kit voices for playback and preview

**Phase:** D0 · **Effort:** M · **Depends on:** DR-04 · **Blocks:** DR-09, DR-12, DR-13,
DR-20, DR-26

## Why

Every trainer needs to *sound* the groove: demonstration playback, count-in, ear-training
prompts, beat-builder preview. The existing `webaudio.ts` synth is pitched-note-shaped;
drums need percussive voices.

## What it is

- **`DrumAudioOutput` port** (`src/core/ports/`): `play(pad, velocity, atTime)` — mirrors
  the existing `AudioOutput` port discipline; core schedules in ticks, adapter converts.
- **Web Audio drum synth** (`src/adapters/audio/drumSynth.ts`): synthesized kit — sine-drop
  kick, noise-burst snare with tonal body, filtered-noise hats (closed/open/pedal
  differentiated by decay), ride/crash from shaped noise, toms as pitched sine-drops.
  Synthesis, not samples, as the default: zero licensing risk, tiny bundle, and the piano
  app's precedent (its synth is synthesized too). Quality bar: articulations audibly
  distinct, ghosts audibly quieter, chokes cut the tail.
- **Sample pack option** (backlog DR-B5): a recorded/CC0 kit behind the same port if synth
  quality grates. Port shape makes the swap invisible.
- **MIDI-out route:** the existing `midiout.ts` adapter pattern lets the e-kit module itself
  voice playback (channel 10, GM notes from `DrumPad`). Wire it through the same
  `selectAudioOutput`-style chooser — and note U.2's lesson: only ship the control if it is
  wired for real. Solves the "two sounds" complaint (research §6): learner can silence the
  app side or route everything to the module.
- Metronome click stays in the existing `core/timing` metronome — DR-12 extends it; this
  task only gives it drum-flavored accent sounds if wanted.

## Testing

Adapter tested like `webaudio.ts` is today (scheduling against fake clock, no real audio
assertions); core scheduling property-tested: a `GrooveScore` playback schedule hits every
onset exactly once at the right tick→ms conversion for a given BPM, swing applied to
off-beats only.

## Experience-gate proof

Beat-builder (or a temporary dev harness if DR-13 is not landed) plays a groove: kick,
snare, closed/open hats audibly distinct, ghost quieter than backbeat, choke audibly cuts;
tempo change mid-loop stays in time (no drift against the transport over 60 s — reuse the
audio-clock-drift spec pattern); route-to-module option plays the kit's own voices when a
module is connected.
