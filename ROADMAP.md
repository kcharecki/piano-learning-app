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

- [ ] 0.1 Project scaffold: Vite + React + TS, path aliases, strict tsconfig
- [ ] 0.2 Test harness: vitest core/ui projects, fast-check, coverage gate, deterministic fakes
- [ ] 0.3 Lint architecture boundary (core purity enforced by eslint)
- [ ] 0.4 Docs: CLAUDE.md, ARCHITECTURE.md, ROADMAP.md, checkpoint script
- [ ] 0.5 Git init + first commit
- [ ] 0.6 `src/core/shared`: `Result`, branded types, invariants + tests
- [ ] 0.7 `src/core/ports`: Clock, Rng, MidiInput, AudioOutput, Store interfaces + test fakes

## Phase 1 — Milestone M1: playable core

Goal: usable for daily practice at the piano. MIDI in, score on screen, playback, loop, wait mode,
metronome.

- [ ] 1.1 ‖ `core/theory/pitch`: MIDI↔name↔spelling, accidentals, enharmonics, transpose (property tests)
- [ ] 1.2 ‖ `core/theory/intervals`: size/quality, inversion, compound intervals (property tests)
- [ ] 1.3 ‖ `core/theory/scales`: major, 3 minor forms, modes, degrees, fingerings
- [ ] 1.4 ‖ `core/theory/keys`: key signatures, circle of fifths, relative/parallel, closely related
- [ ] 1.5 ‖ `core/theory/chords`: triads, inversions, 7ths, spelling, recognition from pitch set
- [ ] 1.6 `core/notation/score`: internal Score model + builders + fixtures
- [ ] 1.7 `core/notation/musicxml`: MusicXML → Score parser (golden-file tests)
- [ ] 1.8 `core/notation/midifile`: SMF → Score parser (REQ-3.2.5)
- [ ] 1.9 `core/timing/tempo`: tick↔ms mapping, tempo changes, tempo scaling 30–200%
- [ ] 1.10 `core/timing/transport`: play/pause/seek/loop range, deterministic tick advance under FakeClock
- [ ] 1.11 `core/timing/metronome`: click scheduling, subdivisions, accents, ramping (REQ-3.9.1)
- [ ] 1.12 `core/practice/matcher`: real-time note matching — correct/wrong/missed/extra + timing (REQ-3.3.2)
- [ ] 1.13 `core/practice/waitmode`: gate transport on required-notes-satisfied (REQ-3.3.3)
- [ ] 1.14 `adapters/midi`: Web MIDI input + output, device hot-plug, port-conformance tests
- [ ] 1.15 `adapters/audio`: MIDI-out-preferred / Web Audio soundfont fallback (REQ-4.7)
- [ ] 1.16 `adapters/store`: IndexedDB store implementing the Store port
- [ ] 1.17 `app`: shell, routing, score viewer with OSMD + cursor highlight (REQ-3.2.4)
- [ ] 1.18 `app`: practice screen — transport controls, loop range, hand mute, tempo, metronome
- [ ] 1.19 e2e smoke: app boots, load bundled score, start playback
- [ ] 1.20 M1 acceptance pass: check §9 criteria reachable at M1; fix gaps

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

- _(nothing yet)_
