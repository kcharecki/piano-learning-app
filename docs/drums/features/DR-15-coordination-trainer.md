# DR-15 — Coordination trainer: limb layering and independence

**Phase:** D1 · **Effort:** M · **Depends on:** DR-09 engine, DR-04/05/06/07 ·
**Blocks:** DR-17/DR-27 coordination exercises

## Why

Coordination is *the* drum-specific learning problem — piano has no equivalent of "your
limbs each own a rhythm". The verified teaching method (../research-2026-08-15.md §1) is
strict layering: ostinato first, add one limb at a time. The beginner→intermediate ladder
runs: first beat built limb-by-limb → 16th kick permutations → hi-hat foot → hi-hat
openings → ghost layering → jazz ride + comping intro.

## What it is

A guided exercise type on the DR-09 engine, plus a generator:

- **Layer mode:** any groove decomposes into an ordered limb build (hats alone → +kick →
  +snare). The trainer walks the stack: each layer must pass clean (accuracy threshold at
  current level's window) before the next appears. Decomposition is pure
  (`src/core/drums/coordination/`): voice → limb split already exists in DR-04.
- **Kick permutation drills:** the classic grid — a constant hats+backbeat pattern over
  all 16 one-kick-per-16th placements, then two-kick combinations, generated (not
  authored) with a deterministic Rng port, ordered easy→hard by syncopation weight.
- **Hi-hat foot exercises:** foot on 2&4 under grooves; pedal-hat as the graded voice
  (DR-02's hhPedal pad).
- **Opening drills:** open-on-the-"&", close-on-1 patterns (D4) — grades the open/closed
  articulation match specifically (DR-07's hi-hat verdict).
- **Jazz intro (D6):** swung ride ostinato + hats 2&4, snare comp figures from a small
  authored set (Reed-derived one-bar figures) layered under it. Full 4-way independence
  is explicitly out of scope (the *New Breed* boundary — advanced tier).

## Experience-gate proof

Drive a layer build of the money beat: layer 2 refuses to unlock on a scripted sloppy
pass and unlocks on a clean one; permutation drill #7 engraves the kick exactly on its
grid slot; an open-hat drill marks a closed-played open as the articulation verdict, not
wrong-pad; jazz intro exercise swings the ride (recorded schedule asserts swung
off-beats). Both widths/themes.
