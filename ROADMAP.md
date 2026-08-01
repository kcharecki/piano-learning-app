# Roadmap — single source of truth for "what's next"

Rules for whoever (human or agent) works on this:

- The **first unchecked `[ ]` box, top to bottom, is the next task.** No cherry-picking.
- Tick a box only when: code + tests are written, `npm run verify` is green, and it is committed.
- Tasks marked `‖` in the same group are independent and should be fanned out to parallel agents.
- If you discover work that must happen first, insert it *above* as a new task rather than doing it
  silently — the roadmap is how the next session knows what happened.

Status legend: `[ ]` todo · `[~]` in progress (leave a note) · `[x]` done · `[-]` dropped (say why)

---

## Phase 0 — Foundation

- [x] 0.1 Project scaffold: Vite + React + TS, path aliases, strict tsconfig
- [x] 0.2 Test harness: vitest core/ui projects, fast-check, coverage gate, deterministic fakes
- [x] 0.3 Lint architecture boundary (core purity enforced by eslint)
- [x] 0.4 Docs: CLAUDE.md, ARCHITECTURE.md, ROADMAP.md, checkpoint script
- [x] 0.5 Git init + first commit
- [x] 0.6 `src/core/shared`: `Result`, branded types, invariants + tests
- [x] 0.7 `src/core/ports`: Clock, Rng, MidiInput, AudioOutput, Store interfaces + test fakes

## Phase 1 — Milestone M1: playable core

Goal: usable for daily practice at the piano. MIDI in, score on screen, playback, loop, wait mode,
metronome.

- [x] 1.1 ‖ `core/theory/pitch`: MIDI↔name↔spelling, accidentals, enharmonics, transpose (property tests)
- [x] 1.2 ‖ `core/theory/intervals`: size/quality, inversion, compound intervals (property tests)
- [x] 1.3 ‖ `core/theory/scales`: major, 3 minor forms, modes, degrees, fingerings
- [x] 1.4 ‖ `core/theory/keys`: key signatures, circle of fifths, relative/parallel, closely related
- [x] 1.5 ‖ `core/theory/chords`: triads, inversions, 7ths, spelling, recognition from pitch set
- [x] 1.6 `core/notation/score`: internal Score model + builders + fixtures
- [x] 1.7 `core/notation/musicxml`: MusicXML → Score parser (golden-file tests)
- [x] 1.8 `core/notation/midifile`: SMF → Score parser (REQ-3.2.5)
- [x] 1.9 `core/timing/tempo`: tick↔ms mapping, tempo changes, tempo scaling 30–200%
- [x] 1.10 `core/timing/transport`: play/pause/seek/loop range, deterministic tick advance under FakeClock
- [x] 1.11 `core/timing/metronome`: click scheduling, subdivisions, accents, ramping (REQ-3.9.1)
- [x] 1.12 `core/practice/matcher`: real-time note matching — correct/wrong/missed/extra + timing (REQ-3.3.2)
- [x] 1.13 `core/practice/waitmode`: gate transport on required-notes-satisfied (REQ-3.3.3)
- [x] 1.13b `core/practice/waitmode`: rebuilt on the new Transport barrier — parks exactly on the onset,
      cannot walk past owed notes in a long pump, and derives its waiting flag from the transport
- [x] 1.13c Re-review of the M1 fix round: every fix confirmed by reverting it and watching the new
      tests fail. Nine follow-up findings raised and fixed, including a live 1-in-15 suite flake.
- [x] 1.14 `adapters/midi`: Web MIDI input + output, device hot-plug, port-conformance tests
- [x] 1.15 `adapters/audio`: MIDI-out-preferred / Web Audio soundfont fallback (REQ-4.7)
- [x] 1.16 `adapters/store`: IndexedDB store implementing the Store port
- [x] 1.17 `app`: shell, routing, score viewer with OSMD + cursor highlight (REQ-3.2.4)
- [x] 1.18 `app`: practice screen — transport controls, loop range, hand mute, tempo, metronome
- [x] 1.19 e2e smoke: app boots, load bundled score, start playback
- [x] 1.20 M1 acceptance pass: reviewed; gaps found and fixed (see below)
- [ ] 1.21 UX: the transport controls sit below a long scrolling score, so they are off-screen while
      reading. Make the control strip sticky, or put it above the score.
- [ ] 1.22 `core/practice/matcher`: add a way to start matching from a tick other than the first note.
      Looping a sub-range currently reports every note before the loop start as `missed` in one batch
      on the wrap, because `reset()` always rewinds to the first expected note.

## Phase 2 — Milestone M2: feedback & reading

- [ ] 2.1 `core/practice/assessment`: fixed-tempo run, accuracy %, timing consistency, per-measure (REQ-3.3.4)
- [ ] 2.2 `core/practice/review`: worst-measure detection → suggested loops (REQ-3.3.5)
- [ ] 2.3 ‖ `core/generator/melody`: parameterised sight-reading generation (key, range, rhythm, hands, accidentals) (REQ-3.4.2)
- [ ] 2.4 ‖ `core/generator/rhythm`: rhythm-only patterns for tapping drills
- [ ] 2.5 `core/sightreading/session`: preview timer, no-stopping rule, retirement pool (REQ-3.4.1/3/4)
- [ ] 2.6 `core/sightreading/adaptive`: difficulty adaptation to 80–90% accuracy band (REQ-3.4.6)
- [ ] 2.7 `core/srs`: spaced repetition scheduler, deterministic, shared by all drill types (REQ-3.9.4)
- [ ] 2.8 ‖ `core/drills/flashcards`: staff→key note naming, interval recognition on staff (REQ-3.4.5)
- [ ] 2.9 ‖ `core/progress/log`: practice session log, timer, what/how long/tempo/accuracy (REQ-3.9.5)
- [ ] 2.10 `core/practice/recorder`: MIDI capture, replay against score (REQ-3.9.2)
- [ ] 2.11 `app`: feedback overlay on score (correct/wrong/missed colouring), review overlay
- [ ] 2.12 `app`: sight-reading trainer screen, flashcard drill screen
- [ ] 2.13 M2 acceptance pass

## Phase 3 — Milestone M3: theory & ears

- [ ] 3.1 `core/theory/harmony`: diatonic function, roman numerals, cadences, progressions (REQ-3.5.1)
- [ ] 3.2 `core/theory/analysis`: roman-numeral analysis of a Score (REQ-3.5.5)
- [ ] 3.3 ‖ `core/drills/theory`: keyboard-answered theory drills, quiz items, SRS-backed (REQ-3.5.2)
- [ ] 3.4 ‖ `core/eartraining/intervals`: melodic/harmonic interval recognition, adaptive (REQ-3.6.1)
- [ ] 3.5 ‖ `core/eartraining/chords`: chord quality + scale/mode recognition
- [ ] 3.6 ‖ `core/eartraining/dictation`: melodic and rhythmic dictation grading (REQ-3.6.2)
- [ ] 3.7 `content/theory`: theory lesson content for levels 1–3 with diagrams + play tasks
- [ ] 3.8 `app`: interactive circle of fifths, keyboard/staff explorer (REQ-3.5.3)
- [ ] 3.9 `app`: chord & scale reference, always available (REQ-3.5.4)
- [ ] 3.10 `app`: ear-training screens
- [ ] 3.11 M3 acceptance pass

## Phase 4 — Milestone M4: progression

- [ ] 4.1 `core/curriculum`: levels → units → lessons → exercises model + exit criteria (REQ-3.1.1, 2.2)
- [ ] 4.2 `core/curriculum/session`: daily practice session builder, 15/30/60 min budgets (REQ-3.1.4)
- [ ] 4.3 `core/progress/levels`: per-track levels, advancement checks, manual override (REQ-2.1–2.3)
- [ ] 4.4 ‖ `core/technique`: technique library, evenness scoring, tempo history (REQ-3.7.x)
- [ ] 4.5 ‖ `core/repertoire`: statuses, practice history, maintenance prompts (REQ-3.8.x)
- [ ] 4.6 `core/progress/export`: JSON/CSV export + restore round-trip (REQ-3.10.4, 4.3)
- [ ] 4.7 `app`: dashboard — levels, streak, trends, repertoire status (REQ-3.10.1/2)
- [ ] 4.8 `app`: annotations (fingering edits, highlights, notes) persisted per piece (REQ-3.2.6)
- [ ] 4.9 `content`: 30 lessons L1–2, technique library through L3, 20 graded repertoire pieces (REQ-5.2)
- [ ] 4.10 M4 acceptance pass — full §9 acceptance criteria review

## Backlog / optional

- [ ] B.1 Microphone pitch-detection fallback (REQ-3.3.7, optional)
- [ ] B.2 Bluetooth MIDI (REQ-3.3.1, if feasible)
- [ ] B.3 Falling-note piano-roll view (REQ-3.2.4 optional half)
- [ ] B.4 Light gamification: streaks, milestones (REQ-3.10.3)
- [ ] B.5 Audio recording alongside MIDI recording (REQ-3.9.2 optional)

---

## Session notes

Append one line per session: date, what landed, anything the next session must know.

- 2026-07-31 — Phase 0 done. Scaffold, dual vitest projects, eslint core-purity gate, ports + deterministic fakes, shared Result/invariant/units. 66 tests, <1s.
- 2026-08-01 - Phase 1 core domain landed (theory, notation, timing, practice): 1328 tests, core suite 1.1s. Two adversarial review rounds; ~30 real defects fixed, several found despite 100% line coverage. Outstanding: 1.13b (wait-mode barrier rewrite) and 1.13c (re-review of the fix round, which died on a session limit). Next up after those: adapters (1.14-1.16).
- 2026-08-01 - M1 core domain complete and hardened through three review rounds (build, fix, re-review + fix). 1367 tests, core suite ~0.9s, 0 failures in 12 consecutive runs. Next: adapters 1.14-1.16 (Web MIDI, audio, IndexedDB), then the app shell and score viewer 1.17-1.19.
- 2026-08-01 - Phase 1 complete. Adapters, shell, OSMD viewer, practice screen, note feedback, e2e. Opus review found the practice screen was built but never rendered by the shell, and that `checkpoint` did not run e2e (the only suite that caught it) - `checkpoint` now runs `verify:full`. Also fixed: stop/pause left notes ringing forever on MIDI-out, the pump discarded every time the domain computed, the two AudioOutputs disagreed on clock epoch, hand mute mid-playback rewound to bar 1, and the seam tests survived deleting the tempo map (9 of 10 passed). 1567 tests + 6 e2e.
