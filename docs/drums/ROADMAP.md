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

- [x] DR-01 ‖ Instrument switcher — two apps in one shell, `/drums/*` URLs, per-instrument
      nav, persisted choice → [spec](features/DR-01-instrument-switcher.md). Segmented
      Piano/Drums control atop the nav rail; `AppRoute = {instrument, route}` with
      `parseRoute` learning the `/drums` prefix (13 piano routes untouched, still resolve
      — `e2e/routing.spec.ts` green); drums home `/drums/today` placeholder screen; last
      instrument persisted via a Zustand slice + sync localStorage hint. Driven proof:
      switcher visible/functional both widths (1280/1024) and themes, cold deep-link into
      `/drums/today`, reload/bare-root persistence, console clean —
      `e2e/instrument-switcher.spec.ts` (3 new specs). Full suite green: `npm run verify`
      (202 files / 4208 tests) + Playwright (155/155, incl. 3 pre-existing specs updated
      for the switcher's new nav-rail position).
- [x] DR-04 ‖ Drum domain model — pads, `GrooveScore`, grid projection, MusicXML bridge
      → [spec](features/DR-04-drum-domain-model.md). Core-only slice, no screen of its own
      (gate is its consumers'): `src/core/drums/model/**`, 23 files (11 source/12 test),
      134 tests incl. fast-check properties for grid round-trip, MusicXML round-trip on
      generated grooves (incl. randomised `swingUnit`), the voice invariant (feet never
      stems-up), swing tick-sequence reversibility, and swing pairing restarting at every
      measure boundary (odd eighth meters 3/8..9/8, a 5/16 sixteenth meter). The three
      reference grooves (money beat, open-hat variant, ghosted funk bar) parse from
      MusicXML to the exact `GrooveScore` and re-serialize byte-stable. `npm test` ~2.0s
      (76 files/2474 tests); `npm run verify` green (208 files/4275 tests).
      Went through one fix round after adversarial review (FIX FIRST): swing is now
      strictly performance metadata (`swingPercent` + `swingUnit`), never baked into a
      note's `tick` — `GrooveScore`/`gridToScore` always place notes at nominal straight
      positions; `subdivisionCellTick`'s swung positions are kept only for DR-06 playback.
      Also fixed: swing pairing now restarts every measure (was a global cell index, so a
      pair could straddle a barline); a bogus pad string now fails closed through
      `limbOf`/`voiceOf` instead of silently defaulting to `'hand'`; overlapping/duplicate
      hits on one pad are now rejected by `validateGrooveScore` instead of silently
      surviving via an id-suffix hack; `choke` now encodes as the schema-legal
      `<other-technical>choke</other-technical>` instead of the illegal `<damp/>`;
      `<attributes>` children now follow the MusicXML xs:sequence order. Deleted the
      duplicate-id `#2`/`#3` suffixing mechanism in `groove.ts` (superseded by the
      overlap rejection above) and four dead exports from `musicxml/shared.ts`
      (`QUARTERS_BY_TYPE`, `ORNAMENT_ARTICULATIONS`, `TECHNICAL_ARTICULATIONS`,
      `isDynamicsClass` — all zero-usage). Follow-ups for later slices: DR-06 (playback)
      is where `subdivisionCellTick`'s swung positions get an actual caller; DR-13 (grid
      editor) needs to decide how it surfaces `scoreToGrid`'s "note not grid-aligned" /
      "two notes share a cell" `Err` cases in the UI.
      Post-merge verification (2026-08-16, independent Opus pass, verdict MERGE) added
      three DR-13-relevant notes: (a) `GrooveGrid` carries no `swingUnit` — `gridToScore`
      infers it from the subdivision, so a score→grid→score round trip silently rewrites
      the swing feel (`sixteenth`→`eighth` and mirror); harmless while grid→score→grid is
      the only documented invariant, but DR-13's editor does the other direction — put
      `swingUnit` on `GrooveGrid` first. (b) `grid.ts`'s comment overstates why
      `gridToScore` returns `Result`: a `cellsPerMeasure` inconsistent with the time
      signature returns `Ok` on the straight path. (c) `parse.ts` maps an unknown
      `<swing-type>` to `'eighth'` silently — foreign-file leniency, worth a doc line.
- [~] DR-02 E-drum MIDI input — CORE slice landed: `src/core/drums/kitmap/` (note→pad
      table, CC4 hi-hat state machine, choke, debounce, velocity gate, unmapped bucket) +
      GM/Roland TD/Alesis/Yamaha presets + `webmidi.ts` now passes through poly aftertouch
      and CC. App slice landed 2026-09-18 (`bbdf97e`): `useDrumMidiInput` joins
      `useMidiConnection` to the kit-map engine, so a real e-kit stroke lands on the same
      `run.hit` the pads and keys use in both trainers; one status line names the kit and
      map, or the unmapped note a pad just sent. GM map only; MIDI-learn wizard still
      pending → [spec](features/DR-02-edrum-midi-input.md)
- [ ] DR-03 ‖ Fallback inputs — keyboard map with dynamics modifiers, on-screen pads,
      capability banner → [spec](features/DR-03-fallback-inputs.md)
- [x] DR-05 Notation rendering — own SVG groove renderer (trainer surfaces) + OSMD
      strategy for charts → [spec](features/DR-05-drum-notation-rendering.md). Landed
      2026-09-17 (`98c0a9b`, root T.30): `core/drums/engrave/` + `app/drums/notation/`,
      drum key drawn by position and shape; `improve-DR-05.spec.ts` 4/4. OSMD chart
      strategy deferred to DR-28.
- [~] DR-06 ‖ Drum audio — synthesized kit behind a `DrumAudioOutput` port, MIDI-out
      route to the module → [spec](features/DR-06-drum-audio-output.md). Synth landed
      2026-09-17 (`0cf90ed`, root T.32): 16 voices, open hat choked by the next hat strike,
      Opus-reviewed. MIDI-out on channel 10 pending: `MidiOutput` port carries no channel.
- [~] DR-07 Hit timing scorer — matcher, windows, velocity classes, per-limb stats;
      **Opus adversarial review required** → [spec](features/DR-07-hit-timing-scorer.md).
      `core/drums/practice/grade.ts` is the matcher today (greedy pairing, inclusive window,
      articulation slips — Opus-reviewed 2026-09-17, `1ff79e7`). Velocity classes and
      per-level windows still open.
- [~] DR-08 Latency calibration + input monitor → [spec](features/DR-08-latency-calibration.md).
      Calibration landed 2026-09-18 (`77d34f0`): `/drums/latency` plays a one-bar count-in
      then a click at 80 bpm; the learner hits any pad on 16 clicks, each judged against its
      nearest click (`core/drums/scoring/latency.ts`), and the median deviation with a
      median-absolute-deviation spread is offered as the offset. Saved per input — the
      e-kit's device id, or "Pads and keys" — persisted with the other drum slices, and
      subtracted from every graded hit's clock time in both trainers (`useGrooveRun`'s
      `inputOffsetMs`). Still open: input monitor, BLE honesty copy.

## Phase D1 — The trainers: where practice happens

- [~] DR-09 Groove trainer — the core loop: per-hit feedback, loop, BPM, per-limb mute,
      wait mode, results → [spec](features/DR-09-groove-trainer.md). `/drums/groove` has
      staff, Listen through the synth, graded results with articulation sentences, result
      retired on groove change (`3960a5c`). Loop mode landed 2026-09-18 (`e8e3ee7`): one
      count-in, then the graded window repeats back-to-back, each pass graded on its own
      (`core/drums/practice/loop.ts` files a boundary hit to the pass whose expected instant
      is nearer), a pass tally in the result card, one history attempt per loop run (the
      last graded pass), and a stalled frame drops the passes it slept through instead of
      replaying their clicks. Per-hit live feedback landed 2026-09-18 (`21ac269`): every
      accepted hit reads on time / early / late / extra with its signed ms, as a status
      line and as a colour on the struck pad (`core/drums/practice/liveHit.ts`, nearest
      unclaimed instant on that pad, provisional — `grade.ts` stays the marking; one
      verdict per pad so unison strokes keep both). Per-limb mute landed 2026-09-18
      (`02e555d`): a Play switch per pad; a pad switched off is voiced by the app on the
      grader's own instants (`mutedVoices.ts`, one pass ahead in loop mode) and dropped from
      the grading plan (`core/drums/practice/mute.ts`), so it gets no result row and no
      live verdict, while a tap on it still sounds and flashes. The last switch on cannot
      be switched off. Wait mode landed 2026-09-18 (`ce06836`): a Wait switch (exclusive
      with Loop) replaces the clock with a playhead that advances only when the learner has
      played every pad of the current step (`core/drums/practice/wait.ts`); the required
      pads are ringed, extra strokes sound but do not advance, and the status line names
      what is still owed and where in the bar it sits. Nothing is graded or recorded — it is
      a learning mode, not a scoring mode. DR-09 UI is now feature-complete against its spec.
- [~] DR-10 ‖ Rudiment trainer — the 40 in Wooton tiers, tempo ladder, evenness, PRs
      → [spec](features/DR-10-rudiment-trainer.md). Core landed 2026-09-17 (`17e4b4f`):
      `content/drums/rudiments*.ts` (40 PAS), `core/drums/rudiment/` score conversion +
      tempo ladder. Screen landed 2026-09-18 (`4084575`, wired `1a68f51`): the 40 in four
      tiers with their stickings, sticking letters under the staff (`897c05f`), Practise →
      tempo ladder up / up-then-down over the groove run, per-rudiment PRs persisted
      (`drumsRudiments`). Evenness landed 2026-09-18: the trainer records each stroke on
      the engine's clock and a pass is clean only when it is steady, complete AND even
      (worst gap vs median, the piano side's `evennessOf`, clean bar 0.8); the same slice
      fixed the verdict being retired in the commit it was graded whenever the ladder
      stepped the tempo. Open: `ladderText` hard-codes the ladder's default pass/fail
      counts (`tempoLadder.ts` does not export them); six tier-3/4 stickings still
      unverified against PAS; the stroke record reads the engine's phase through a
      render-mirrored ref, so a stroke in the first frame of the window (or any stroke
      while the tab is hidden and frames are paused) is graded but not scored for
      evenness.
- [x] DR-11 ‖ Rhythm reading trainer — Reed-ordered generator, one-line staff, tap-graded
      → [spec](features/DR-11-rhythm-reading-trainer.md). Core landed 2026-09-17
      (`17e4b4f`): `core/drums/reading/` cells, 7 levels, generator, accuracy-gated
      adapter. Screen landed 2026-09-18 (`1a68f51`): the five-line staff with the snare voice
      instead of the spec's one-line staff (spec adjusted — one engraver, not two), count-in,
      Listen, Tap pad, graded result, level adapted over the newest same-level streak of
      runs, level + last 30 runs persisted (`drumsReading`). Opus-reviewed: five majors
      fixed before commit (level lost on direct load, rest-only level-1 exercise, stale
      "Run finished", ping-pong on demotion, untested reverse).
- [x] DR-12 ‖ Metronome suite — subdivisions, 2&4, gap click with measured drift, random
      mute, ramp → [spec](features/DR-12-metronome-suite.md). Core landed 2026-09-17
      (`17e4b4f`): `core/timing/clickFilters.ts`. Screen landed 2026-09-18 (`8687e4c`):
      subdivision 1–4, click placement, gap bars with measured return drift, random mute,
      tempo ramp as appended `TempoMark`s. Opus timing review before commit: clicks were
      dispatched in the past (collapsed by the synth's clamp) and a hidden tab replayed up
      to 512 bars — now look-ahead scheduling and a one-bar backlog skip, with the bar
      arithmetic moved to `core/timing/metronomeRun.ts`. Open: `everyNBars` is not
      count-in aware; MIDI-out.
- [ ] DR-13 ‖ Beat builder — GrooveScribe-style grid ⇄ live notation, library, share-URL;
      the content-authoring tool → [spec](features/DR-13-beat-builder.md)
- [~] DR-15 Coordination trainer — limb layering, kick permutations, hh foot/openings,
      jazz intro → [spec](features/DR-15-coordination-trainer.md). `/drums/coordination`
      landed 2026-09-18 (`a3eacab`): layer build (cymbals → + feet → + snare family, each
      layer a real score subset on the staff, a steady pass unlocks the next) and the 16
      single-kick permutations ordered by syncopation weight, both graded by `useGrooveRun`
      and recorded to history. Two-kick drills landed 2026-09-18 (`cb66ee5`): a third mode
      draws 12 distinct pairs from the 120 (partial Fisher–Yates over the weight-sorted
      table) and orders them easy → hard; changing tempo now keeps step progress. Still
      open: hi-hat foot and openings, the jazz ride introduction.

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
- [~] DR-23 Drums dashboard — PRs, tightness trends, per-limb bias, coverage, milestones;
      every panel seeded-e2e from birth → [spec](features/DR-23-drums-dashboard.md). MVP at
      `/drums/progress` landed 2026-09-18 (`04e5918`): rudiment tiers at target / started,
      best steady tempo per groove, matched-weighted limb bias over the last ten runs,
      reading level with the last three accuracies — four panels, each seeded-e2e with an
      exclusion trap. Tightness trends landed 2026-09-18 (`a5bbbe8`): per groove, the
      worst-limb mean deviation of the last eight runs in play order, a direction verdict
      (tightening / loosening / flat within 2 ms / too few runs) from the first-half vs
      second-half means, and the steady count (`core/drums/progress/trend.ts`). Still open:
      coverage, milestones.

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

### 2026-09-17 — orchestrated drum session, wave 1 + 2

Five slices (`1ff79e7`…`17e4b4f`): root T.30–T.34 closed, DR-05 done, DR-06/07/09
advanced, DR-10/11/12 core-only. Open notes a later slice must pick up:

- `deriveArticulations` appends `open` at the end while the parser's canonical order is
  flam/drag → buzz → open → choke; two test files carry a `withCanonicalOpen()` shim for it.
  Fix at the source (sort once in `makeGrooveScore`) and delete both shims.
- `clickFilters.everyNBars` is not count-in aware; a screen with a count-in must offset it.
- Six rudiment stickings are flagged uncertain in `rudiments.tier34.ts` — check against PAS.
- MIDI-out on channel 10 needs a channel on the `MidiOutput` port first.
- `webaudio.ts` and `drumSynth.ts` duplicate the epoch-anchor drift filter; extract when a
  third caller appears.
- Engraver renders no sticking letters (R/L under noteheads) — DR-10's screen needs them.

### 2026-09-18 — orchestrated drum session, wave 3

Four slices (`897c05f`, `4084575`, `1a68f51`, `8687e4c`) plus `3986178`: DR-10/11/12 each got
their screen, the engraver its sticking row. Closed from the list above: the
`deriveArticulations` order (one canonical sort in `groove.ts`, both shims deleted) and the
sticking letters. Still open: `everyNBars` count-in awareness, the six unverified
stickings, MIDI-out channel, the duplicated epoch-anchor filter. New notes:

- Two reviews earned their cost: Opus found five majors in the reading hook and two
  blockers in the metronome scheduler under green suites, and the main thread's read of
  the reading fix found that the fix itself (a decision boundary keyed on store length)
  would have stopped adaptation for good once the 30-run cap was reached. Review-driven
  fixes to timing or grading code get read on the main thread before commit.
- `persistence.ts` and `Shell.tsx` both crossed the 500-line limit this wave; the drum
  slices now live in `persistence.drums.ts` / `persistenceSlice.ts` and `drumsShell.tsx`.
  The next Drums screen goes into those, not the spine files.
- The Drums Today screen still links only to the groove trainer; reading, rudiments and
  the metronome are reachable from the nav rail only.

### 2026-09-18 — orchestrated drum session, wave 4

Three slices (`57bb514`, `6966868`, `e8e3ee7`): the Drums Today hub, rudiment evenness,
groove loop mode. Closed from the list above: Drums Today now opens all four trainers
with a status line per store. Still open: `everyNBars` count-in awareness, the six
unverified stickings, MIDI-out channel, the duplicated epoch-anchor filter. New notes:

- The rudiment trainer never showed a failed verdict: it keyed the plan's grooveId on the
  bpm so a tempo step read as a chart change, and the ladder steps on every fail. Found
  in the builder's own "contract ambiguity" note, which described the symptom as a test
  obstacle. Fixed on the main thread (`6966868`); a builder note that says "could never be
  observed" is a defect report.
- Loop mode's stalled-frame rule is the metronome's: a pass whose grading instant is more
  than one pass old when the frame arrives is dropped, not graded, and the click track
  resumes at the current pass. Third time this class appeared (piano metronome, drum
  metronome, loop) — any per-frame scheduler needs a stall test before review.
- A loop run is one history attempt (its last graded pass), not one per pass; the hook
  has `onPassGraded` for per-pass consumers.
- Evenness reads the engine's phase through a render-mirrored ref: a stroke in the first
  frame of the window, or any stroke while the tab is hidden, is graded but not scored.
- `tempoLadder.ts` does not export its default pass/fail counts; `ladderText` still
  hard-codes 2 and 3.

### 2026-09-18 — orchestrated drum session, wave 5

Three slices (`21ac269`, `04e5918`, `a3eacab`): per-hit live feedback, the progress
screen, the coordination trainer. Prep refactor `ece3963` moved the pad, tempo stepper
and pad hooks out of the groove screen so both new screens reuse them. Still open from
above: `everyNBars` count-in awareness, the six unverified stickings, MIDI-out channel,
`ladderText`'s hard-coded counts. New notes:

- The live verdict is arrival-order and provisional by design: `judgeLiveHit` commits
  the instant a stick lands, `grade.ts` pairs the whole pass later, and the two can
  disagree on a hit that arrives out of notated order. The result panel is the marking.
- The live line carries `aria-live="off"`: at sixteenths it updates six times a second
  and would bury the run-state announcements a screen reader queues politely.
- `twoKickPermutations` shipped with a `while (b === a)` redraw; under a degenerate rng
  (a scripted fake cycling an all-equal list) it never returns, and the builder's own
  property test hung the whole coordination suite. Any "redraw until distinct" loop in
  core needs a bound or a loop-free draw — the Rng port promises nothing about variety.
- The coordination screen offers single-kick drills only; `twoKickPermutations` has no
  screen yet. Changing tempo resets step progress to layer 1 (contract choice, revisit).
  Both reversed in wave 6 — see below.
- The reading store is newest-first; the progress screen reverses the last three runs so
  an improving learner reads the climb left to right. Builder C filed this as an
  ambiguity; it was a defect.

### 2026-09-18 — orchestrated drum session, wave 6

Three slices plus one adapter fix: e-kit input into the trainers (`bbdf97e`), two-kick
drills with tempo-keeps-progress (`cb66ee5`), per-limb mute (`02e555d`), and the synth's
open-hat choke against a hat scheduled ahead of it (`093de46`). Still open from above:
`everyNBars` count-in awareness, the six unverified stickings, MIDI-out channel,
`ladderText`'s hard-coded counts, wait mode. New notes:

- Tempo change no longer resets coordination progress. The wave-5 note called it a
  contract choice; driving it, a learner who earned layer 3 at 60 bpm and nudged to 64
  was sent back to layer 1. The run stops and the latched result clears; the step and
  the unlocked count stay.
- `twoKickPermutations` first shipped its screen with draws with replacement — 12 titles,
  duplicates among them, seen in the browser before any test. Now a partial Fisher–Yates
  over the weight-sorted table, clamped to 120, sorted back easy → hard.
- The synth choked open hats only against hats already registered when the choker was
  struck. The mute slice pre-schedules a whole pass of hats, so a live open hat struck
  after a scheduled closed hat but ringing before it was never released. The synth now
  keeps the pending hi-hat instants and chokes a late-registering open hat at the
  earliest one strictly after its start (same instant = unison).
- The mute grading plan is frozen at `start()` like `loop`; the loop boundary rule
  (`passOfHit`) reads the grader's plan, not the full one, so a muted pad's instant
  cannot pull a boundary hit toward a pass nobody grades it in. Muting everything is
  treated as muting nothing rather than thrown.
- Three property tests restated their implementation (rebuilt the expected list with
  the same filter and compared). Rewritten as independent membership and count checks.

### 2026-09-18 — orchestrated drum session, wave 7

Three slices: tightness trends on the progress screen (`a5bbbe8`), groove wait mode
(`ce06836`), and latency calibration with the offset wired into both trainers
(`77d34f0`). Still open from above: `everyNBars` count-in awareness, the six
unverified stickings, MIDI-out channel, `ladderText`'s hard-coded counts, the input
monitor, hi-hat foot and openings, the jazz ride introduction. New notes:

- The calibration slice shipped inert: the store, the screen, the hook option on
  `useGrooveRun` and the persistence all landed green, and nothing passed the stored
  offset to a run. The reviewer found it by grepping for production callers of
  `offsetFor` (zero). Wired on the main thread; the e-kit hook now mounts before the run
  hook in both trainer screens so the device id can pick the offset, with the run's
  `hit` reaching the kit through a ref.
- Calibration hits were gated on the frame loop's phase, not on the clock — a dead zone
  of one frame after the collecting downbeat and a first-sample bias toward late. Now
  judged by the clock with a half-beat window before the first collecting click.
- Reaching "done" in calibration stopped scheduling clicks but did not silence the bar
  already in the audio graph; up to seven clicks after the screen said Done.
- Wait mode's step boundaries come from the plan's absolute tick positions, so unison
  strokes (kick + hat on one instant) are one step with two required pads, and a swung
  or off-beat pad reads its position from the subdivision, not from a beat guess.
- The wait-mode e2e failed on its own indexing (1-based step number fed to a 0-based
  helper), not on the app. Found by logging every click's DOM event on the main thread;
  the spec now asserts the exact status line after every click.
