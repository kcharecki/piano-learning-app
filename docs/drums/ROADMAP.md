# Drums roadmap — a second app inside the shell

A complete drum-kit learning package: skills, reading, theory, and kit practice from
step 0 to a mid-intermediate player, living behind an instrument switcher as its own app
(own nav, own screens, own curriculum) beside the piano app.

**Scope boundary:** everything up to the researched beginner→intermediate line — ghost
notes and dynamics control, shuffle/funk fluency, compound meter, jazz/latin
*introductions*, chart literacy, Moeller *introduction*. Explicitly out (the advanced
tier): full 4-way independence (*New Breed* territory), odd meters, brush technique,
advanced Moeller, soloing vocabulary.

**Exit condition: every skill in the coverage map below is shipped and drivable, and a
D6-complete profile satisfies every researched beginner→intermediate boundary marker**
(the checklist lives in [DR-16](features/DR-16-curriculum-model.md)).

Research grounding: [research-2026-08-15.md](research-2026-08-15.md) — pedagogy verified
against Drumeo/Rockschool/Trinity/PAS and the canonical method books; tech verified
against the GM spec, real e-kit behavior, MusicXML, and OSMD's actual GitHub state;
market verified against 13 products. Feature specs cite the digest; the digest cites
sources.

## How to work this roadmap

Same rules as the root [ROADMAP.md](../../ROADMAP.md): triage first, then learner impact;
a box ticks only past the experience gate in [docs/PROCESS.md](../PROCESS.md); status
legend `[ ]` `[~]` `[x]` `[-]`; `‖` marks work parallelizable in worktrees (no shared
files with its phase siblings). Each item links its spec — goal, design decisions,
scope, testing rules, and the driven proof that gates it. Specs are the contract;
this file is the index and the order.

Standing rules for this roadmap specifically:

1. **Scoring honesty.** Every grade shows its evidence (pad, signed ms, velocity). No
   black-box verdicts — the market's most-documented failure.
2. **Technique honesty.** MIDI cannot see hands. Teach and checklist technique
   ([DR-18](features/DR-18-technique-foundations.md)); never fake-grade it.
3. **Content is calibrated.** Every level-placement claim in authored content traces to
   the research digest (the piano Phase-5 lesson, adopted from birth).
4. **Timing code gets adversarial review.** The scorer, kit map, and form-flattener are
   correctness-critical: Opus high-effort review before any trainer ships on them
   (existing model policy, applied).
5. **All content bundled and local.** No remote catalog that can vanish (market lesson).

## The level ladder (detail: [DR-16](features/DR-16-curriculum-model.md))

| Level | Name | External calibration |
|---|---|---|
| D1 | First beat | Drumeo L1 · Rockschool Debut |
| D2 | Range | Drumeo L2 · RS 1 |
| D3 | Songs | Drumeo L3 · RS 2 |
| D4 | Speed & subtlety | Drumeo L4 · RS 3 |
| D5 | Groove craft | Drumeo L5–6 · RS 4 |
| D6 | Musician (exit) | Drumeo L6–7 · RS 5 |

## Architecture stance

Existing boundaries, extended — no new layer concepts:

```
src/core/drums/       model, kitmap, scoring, trainer engines, reading/ear/chart logic — pure
src/adapters/midi/    aftertouch + CC passthrough additions to the existing adapters
src/adapters/audio/   drumSynth behind a DrumAudioOutput port
src/app/drums/        drum screens, one Zustand slice per domain, persistence.ts grows slices
src/content/drums/    rudiments, grooves, fills, styles, lessons, theory decks, song etudes
```

Reused as-is: `core/srs`, `core/timing`, `core/curriculum` model, `core/progress`
(levels/streak/export), the store/persistence pattern, the design system. Instrument
split lives above `Route` ([DR-01](features/DR-01-instrument-switcher.md)); piano URLs
and screens untouched.

## Key risks, named now

| Risk | Mitigation | Where |
|---|---|---|
| OSMD percussion gaps (ghost parens, hh symbols, flams — issue #887) | Own SVG renderer for trainer surfaces; OSMD only for full charts, with `CustomNoteheadVFCode`; alphaTab decision gate if charts still fail | [DR-05](features/DR-05-drum-notation-rendering.md), [DR-26](features/DR-26-song-playalong.md) |
| E-kits disagree with GM and each other; hi-hat is a CC, chokes are aftertouch | Presets + MIDI-learn wizard + CC4 state machine as core, property-tested | [DR-02](features/DR-02-edrum-midi-input.md) |
| Uncalibrated latency misgrades everything one direction | Calibration flow, per-device offset, BLE honesty | [DR-08](features/DR-08-latency-calibration.md) |
| Scoring windows feel unfair | Researched defaults (±100→±40 ms by level), signed ms always visible | [DR-07](features/DR-07-hit-timing-scorer.md) |
| Content-heavy phases stall (36+36 lessons, ~48 grooves, 12 etudes) | DR-13 is the authoring tool and lands early; content tests fail builds on dangling references | [DR-13](features/DR-13-beat-builder.md), [DR-17](features/DR-17-lessons-beginner.md) |

## Phase D0 — Foundation: two apps, input, sound, notation, scoring

The slice discipline: D0 has no learner-visible value until DR-01's switcher shows a
drums home, and DR-09 (first D1 item) is the first real payoff — sequence D0 so each
item lands inside a slice that drives something (specs state their proof surface).

- [ ] DR-01 ‖ Instrument switcher — two apps in one shell, `/drums/*` URLs, per-instrument
      nav, persisted choice → [spec](features/DR-01-instrument-switcher.md)
- [x] DR-04 ‖ Drum domain model — pads, `GrooveScore`, grid projection, MusicXML bridge
      → [spec](features/DR-04-drum-domain-model.md). Core-only slice, no screen of its own
      (gate is its consumers'): `src/core/drums/model/**`, 21 files (11 source/10 test),
      102 tests incl. fast-check properties for grid round-trip, MusicXML round-trip on
      generated grooves, the voice invariant (feet never stems-up), and swing-application
      reversibility. The three reference grooves (money beat, open-hat variant, ghosted
      funk bar) parse from MusicXML to the exact `GrooveScore` and re-serialize
      byte-stable. `npm test` 2.1s (75 files/2442 tests); `npm run verify` green (207
      files/4243 tests).
- [ ] DR-02 E-drum MIDI input — kit maps, presets, MIDI-learn wizard, CC4 hi-hat state
      machine, chokes, debounce → [spec](features/DR-02-edrum-midi-input.md)
- [ ] DR-03 ‖ Fallback inputs — keyboard map with dynamics modifiers, on-screen pads,
      capability banner → [spec](features/DR-03-fallback-inputs.md)
- [ ] DR-05 Notation rendering — own SVG groove renderer (trainer surfaces) + OSMD
      strategy for charts → [spec](features/DR-05-drum-notation-rendering.md)
- [ ] DR-06 ‖ Drum audio — synthesized kit behind a `DrumAudioOutput` port, MIDI-out
      route to the module → [spec](features/DR-06-drum-audio-output.md)
- [ ] DR-07 Hit timing scorer — matcher, windows, velocity classes, per-limb stats;
      **Opus adversarial review required** → [spec](features/DR-07-hit-timing-scorer.md)
- [ ] DR-08 Latency calibration + input monitor → [spec](features/DR-08-latency-calibration.md)

## Phase D1 — The trainers: where practice happens

- [ ] DR-09 Groove trainer — the core loop: per-hit feedback, loop, BPM, per-limb mute,
      wait mode, results → [spec](features/DR-09-groove-trainer.md)
- [ ] DR-10 ‖ Rudiment trainer — the 40 in Wooton tiers, tempo ladder, evenness, PRs
      → [spec](features/DR-10-rudiment-trainer.md)
- [ ] DR-11 ‖ Rhythm reading trainer — Reed-ordered generator, one-line staff, tap-graded
      → [spec](features/DR-11-rhythm-reading-trainer.md)
- [ ] DR-12 ‖ Metronome suite — subdivisions, 2&4, gap click with measured drift, random
      mute, ramp → [spec](features/DR-12-metronome-suite.md)
- [ ] DR-13 ‖ Beat builder — GrooveScribe-style grid ⇄ live notation, library, share-URL;
      the content-authoring tool → [spec](features/DR-13-beat-builder.md)
- [ ] DR-15 Coordination trainer — limb layering, kick permutations, hh foot/openings,
      jazz intro → [spec](features/DR-15-coordination-trainer.md)

## Phase D2 — The learning system: curriculum, planning, memory

- [ ] DR-16 Curriculum model + D1–D6 ladder with measurable exit criteria
      → [spec](features/DR-16-curriculum-model.md)
- [ ] DR-17 Beginner lessons D1–D3 (~36, content-heavy) → [spec](features/DR-17-lessons-beginner.md)
- [ ] DR-18 ‖ Technique foundations — reference diagrams, self-check checklists, proxy
      signals labeled as proxies → [spec](features/DR-18-technique-foundations.md)
- [ ] DR-19 ‖ Theory for drummers — values/meter/form/chart-symbol decks + audio items
      → [spec](features/DR-19-theory-for-drummers.md)
- [ ] DR-21 ‖ SRS over rudiments and grooves — the market gap; review-proof checks, not
      rep scheduling → [spec](features/DR-21-srs-drums.md)
- [ ] DR-22 Session planner — researched 30-min template, budgets, weakness-aware
      candidates → [spec](features/DR-22-session-planner.md)
- [ ] DR-23 Drums dashboard — PRs, tightness trends, per-limb bias, coverage, milestones;
      every panel seeded-e2e from birth → [spec](features/DR-23-drums-dashboard.md)

## Phase D3 — Musicianship and the intermediate package

- [ ] DR-24 Styles library — ~48 graded grooves: rock, shuffle/blues, funk, jazz, latin,
      compound (content-heavy) → [spec](features/DR-24-styles-library.md)
- [ ] DR-14 ‖ Fill trainer — groove→fill→re-entry-on-1, graded fill vocabulary, improvise
      slot → [spec](features/DR-14-fill-trainer.md)
- [ ] DR-25 ‖ Dynamics trainer — velocity calibration, accent studies, ghost grooves,
      rimshot/cross-stick → [spec](features/DR-25-dynamics-trainer.md)
- [ ] DR-20 ‖ Drummer's ear training — groove/fill recall, notate-back, feel ID, internal
      clock → [spec](features/DR-20-ear-training-drums.md)
- [ ] DR-26 Song play-along — 12 style etudes with synthesized backing, full charts,
      section grading, chart import → [spec](features/DR-26-song-playalong.md)
- [ ] DR-28 Chart reading — slash semantics, repeats/D.S./coda navigation drills, catch
      the figures → [spec](features/DR-28-chart-reading.md)
- [ ] DR-27 Intermediate lessons D4–D6 (~36, content-heavy); D6 checkpoint = the roadmap's
      exit condition → [spec](features/DR-27-lessons-intermediate.md)

## Backlog / optional (no spec files until promoted)

- [ ] DR-B1 Mic "tap along" input — Web Audio onset detection, generous windows, own
      calibration (research §7: ~55–67 ms browser latency).
- [ ] DR-B2 Acoustic kit via mic — per-drum classification, Melodics-style calibration.
      ML-sized; never fold into B1.
- [ ] DR-B3 MusicXML export from the beat builder + print stylesheet.
- [ ] DR-B4 Falling-notes highway view for DR-09 — piano-roll precedent makes it cheap;
      Beatlii proves the toggle is valued.
- [ ] DR-B5 Sampled kit audio behind the DR-06 port (CC0/own-recorded), if synth grates.
- [ ] DR-B6 User-audio backing sync for DR-26 (tempo-map problem; Moises-style stems).
- [ ] DR-B7 Roland positional sensing + brush technique support — advanced-tier hardware
      nuance.

## Coverage map — every skill from step 0 to mid-intermediate, owned

The roadmap's completeness check: each researched skill (digest §1) has an owner.
A skill with no shipped owner means the roadmap is not done, whatever the boxes say.

| Skill | Owner |
|---|---|
| Posture, kit setup, throne height | DR-18, D1 lessons |
| Matched grip (German/American/French) | DR-18 |
| Four stroke types, rebound | DR-18 taught · DR-10 drilled |
| Heel-down → heel-up, hi-hat foot | DR-18, DR-15 |
| Moeller introduction | DR-18 (D6-gated), DR-27 |
| Rudiments tier 1–2, tempo ladders, PRs | DR-10, DR-21 |
| Rhythm reading: quarters → syncopation | DR-11 |
| Kit notation literacy (staff, voices, articulations) | DR-05, DR-13's live grid⇄staff |
| First beat, limb-by-limb | DR-15 layer mode, D1 lessons |
| Kick permutations (16th coordination) | DR-15 |
| Hi-hat openings | DR-15, DR-24 grooves |
| Ghost notes | DR-25, DR-24 funk set |
| Accents, rimshot, cross-stick | DR-25 |
| Jazz ride + comping introduction | DR-15, DR-24, DR-27 |
| Grooves: rock/half-time/16th | DR-24 (D1–D3 sets) |
| Shuffle + 12/8 blues | DR-24, DR-27 |
| Funk/R&B | DR-24, DR-25 |
| Latin/bossa/samba introduction | DR-24, DR-27 |
| Compound meter (6/8, 12/8) | DR-24, DR-19, DR-27 |
| Fills + re-entry discipline, improvised fills | DR-14 |
| Timing methods: ladder, gap click, subdivisions, 2&4 | DR-12, DR-10 |
| Internal clock (measured) | DR-12 + DR-20's graded ladder |
| Song form (verse/chorus, 12-bar, AABA) | DR-19, DR-26 etude structure |
| Chart reading (slashes, repeats, D.S./coda, figures) | DR-28, DR-19 |
| Polyrhythm 3:2 (identify) | DR-19 (D6) |
| Ear: groove/fill recall, dictation, feel ID | DR-20 |
| Full-song performance | DR-26 |
| Practice-session structure, daily habit | DR-22, shared streak |
| Progress visibility, milestones | DR-23 |
| Playing without hardware (tablet/no-kit days) | DR-03 |

Deliberately unowned (advanced tier, stated in DR-27's final lesson): full 4-way
independence, odd meters, brushes, soloing.

## Ordering and dependency notes

- D0 order within phase: DR-01 and DR-04 first (independent ‖); DR-02/05/06 fan out from
  DR-04; DR-07 needs DR-02+DR-04; DR-08 closes the phase. DR-03 anytime after DR-02.
- DR-09 is the keystone: first learner-visible payoff, and DR-14/15/25/26 all extend its
  engine. Land it before spreading.
- DR-13 lands early in D1 deliberately — it authors D2/D3's content.
- DR-16 before any lesson content; DR-17 before DR-27 (numbering is identity, not order —
  DR-14 sits in D3 because fills-in-context want DR-24's grooves).
- Content items (DR-17/24/26/27) are the schedule risk, not the code items — they
  parallelize well across sessions once DR-13 exists.

## Session notes

Append here as drum sessions land (same convention as the root roadmap).
