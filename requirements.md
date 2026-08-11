# Requirements Document — Personal Piano Learning Application

**Version:** 1.0
**Audience:** Single user (the author). Personal, non-commercial use.
**Goal:** Take one learner from complete beginner to upper-intermediate piano playing, with strong sight-reading and working knowledge of music theory and harmony.

---

## 1. Introduction

### 1.1 Purpose
This document describes the requirements for a personal application that teaches piano playing, sight reading, and music theory in one integrated environment. Because the app has a single user, requirements favor practical learning value and simplicity over multi-user features, monetization, accounts, or polish that only matters for a product.

### 1.2 Scope
The application covers three intertwined tracks that progress together:

1. **Playing** — physical keyboard skills, technique, and repertoire, from first notes to upper-intermediate pieces.
2. **Sight reading** — reading and playing unfamiliar notation fluently at sight.
3. **Theory & harmony** — intervals, scales, keys, chords, progressions, rhythm, and basic analysis, taught in the context of what is being played.

### 1.3 Definitions
- **Upper-intermediate** — roughly ABRSM Grade 5–6 / RCM Level 6–7. Comfortable with pieces like Bach two-part inventions, easier Chopin waltzes, Clementi sonatinas; fluent in all major and most minor scales; can sight-read about two grades below playing level.
- **MIDI keyboard** — a digital piano or controller that sends note data over USB/Bluetooth. Assumed available (see §6).
- **MusicXML** — an open, standard file format for sheet music, used as the app's score format.

---

## 2. Learner Model and Skill Progression

The app organizes everything around a level ladder. Each level defines what the learner can play, read, and explain before moving on.

| Level | Playing | Sight reading | Theory |
|-------|---------|---------------|--------|
| 1 — Beginner | Five-finger positions, hands separately, simple hands-together | Note names in treble/bass around middle C, quarter/half/whole notes | Staff, note names, basic rhythm values, time signatures 4/4 and 3/4 |
| 2 — Elementary | Simple pieces hands together, legato/staccato, basic dynamics | One octave range each hand, eighth notes, simple key signatures (0–1 sharps/flats) | Major scales C/G/F, tonic and dominant chords, intervals up to a 5th |
| 3 — Late elementary | Scales hands together (2 octaves), broken chords, pedal basics | Keys up to 2 sharps/flats, dotted rhythms, simple two-hand coordination | All intervals, major/minor triads and inversions, circle of fifths, relative minors |
| 4 — Intermediate | All major scales, arpeggios, easier sonatinas, voicing melody over accompaniment | Keys to 4 accidentals, 6/8 time, syncopation, leaps and position shifts | Seventh chords, primary progressions (I–IV–V–I, ii–V–I), cadence types, minor scale forms |
| 5 — Upper-intermediate | Harmonic/melodic minors, faster tempi, ornaments, polyphony (inventions), rubato basics | All keys, moderate polyphony, reading roughly 2 levels below playing level at tempo | Secondary dominants, modulation to close keys, chord–scale relationships, basic Roman-numeral analysis of real pieces |

**REQ-2.1** — The app SHALL maintain the learner's current level per track (playing, sight reading, theory) independently, since these advance at different speeds.

**REQ-2.2** — Advancement SHALL be based on measurable checks (assessment pieces, sight-reading tests, theory quizzes), not just time spent.

**REQ-2.3** — The learner SHALL be able to manually override level placement (it's a personal tool — no gatekeeping).

---

## 3. Functional Requirements

### 3.1 Curriculum and Lessons

**REQ-3.1.1** — The app SHALL provide a structured curriculum: levels → units → lessons → exercises, with each lesson combining a short explanation, a demonstration, and hands-on tasks at the keyboard.

**REQ-3.1.2** — Every theory concept SHALL be introduced together with a playing task that uses it (e.g., learning the dominant chord means playing a I–V–I cadence, not just reading about it).

**REQ-3.1.3** — Lessons SHALL include text and diagrams; short embedded audio demonstrations of the target exercise are required, video is optional.

**REQ-3.1.4** — The app SHALL suggest a daily practice session assembled from: warm-up/technique (~20%), sight reading (~20%), current lesson or repertoire (~40%), theory/ear training (~20%), adjustable by the user and scalable to session lengths of 15, 30, or 60 minutes.

### 3.2 Interactive Score Viewer

**REQ-3.2.1** — The app SHALL render standard notation from MusicXML files, including both staves, key/time signatures, dynamics, articulation, fingering numbers, and pedal marks.

**REQ-3.2.2** — Score playback SHALL be supported with adjustable tempo (30–100% and beyond of written tempo) without pitch change.

**REQ-3.2.3** — The user SHALL be able to select and loop any measure range, and mute or attenuate either hand (left hand only, right hand only, both).

**REQ-3.2.4** — During playback, the current position SHALL be highlighted in the score, with an optional falling-note ("piano roll") view synchronized with the notation for beginners transitioning to reading.

**REQ-3.2.5** — The user SHALL be able to import arbitrary MusicXML (and ideally MIDI) files so any downloaded score can be practiced in the app.

**REQ-3.2.6** — The viewer SHALL support annotations: fingering edits, highlighting, and text notes saved per piece.

### 3.3 Interactive Playing with Real-Time Feedback

This is the core "interactive way of playing" feature.

**REQ-3.3.1** — The app SHALL receive input from a MIDI keyboard (USB and, if feasible, Bluetooth MIDI) and detect note pitch, timing, velocity, and duration.

**REQ-3.3.2** — In **practice mode**, the app SHALL compare played notes against the score in real time and mark each note as correct, wrong pitch, missed, or extra, with timing feedback (early/late). This judges onset pitch and timing only: note duration is not scored, so a note released the instant it is struck, or held far past its written value, is still marked correct. The app SHALL state this limitation somewhere reachable from the Practice screen in one click, rather than implying the accuracy percentage is a complete judgement of what was played.

**REQ-3.3.3** — A **wait mode** SHALL be available in which playback pauses until the correct note(s) are played — essential for beginners learning hands together.

**REQ-3.3.4** — An **assessment mode** SHALL play through at a fixed tempo and produce a score (accuracy %, timing consistency, per-measure breakdown) used for level checks and progress history.

**REQ-3.3.5** — After a run-through, the app SHALL show a review overlay on the score identifying problem measures and SHALL offer one-click loops on the worst sections.

**REQ-3.3.6** — Latency from key press to feedback SHALL be low enough not to disturb playing (target under ~20 ms for sound, under ~100 ms for visual feedback).

**REQ-3.3.7 (optional)** — If no MIDI device is connected, a fallback using microphone pitch detection MAY be provided for single-note exercises, clearly marked as less accurate.

### 3.4 Sight Reading Trainer

**REQ-3.4.1** — The app SHALL provide a dedicated daily sight-reading exercise: a short piece the user has never seen, matched to their sight-reading level, played once without stopping.

**REQ-3.4.2** — Sight-reading material SHALL be generated or selected with controllable parameters: key, range, rhythm complexity, hand independence, and accidental density, increasing gradually with level.

**REQ-3.4.3** — Exercises SHALL be **unrepeatable by design**: once read, a piece is retired from the sight-reading pool (it may move to repertoire).

**REQ-3.4.4** — The trainer SHALL enforce sight-reading discipline: a short preview period (e.g., 30 seconds to scan key, time, patterns), then continuous play with the metronome — no stopping to fix mistakes.

**REQ-3.4.5** — Supporting drills SHALL be included: flash-card note naming (staff → key press), interval recognition on the staff, rhythm-only tapping exercises, and "read ahead" drills where notation is progressively hidden behind the playback cursor.

**REQ-3.4.6** — The app SHALL track sight-reading level separately and adapt difficulty based on recent accuracy (target ~80–90% accuracy; harder if above, easier if below).

### 3.5 Music Theory Module

**REQ-3.5.1** — The theory curriculum SHALL cover, in progressive order: staff notation and rhythm; intervals (quality and size); major and minor scales and key signatures; the circle of fifths; triads and inversions; seventh chords; diatonic harmony and Roman numerals; cadences; common progressions (I–IV–V–I, ii–V–I, I–vi–IV–V); minor scale forms; secondary dominants; and modulation to closely related keys.

**REQ-3.5.2** — Every theory topic SHALL have three interaction types: a readable explanation with diagrams, interactive drills answered **on the MIDI keyboard** (e.g., "play a D minor triad in first inversion"), and quiz questions answered on screen.

**REQ-3.5.3** — The app SHALL include an interactive circle-of-fifths and an interactive keyboard/staff diagram where the user can explore scales and chords and hear them.

**REQ-3.5.4** — A **chord and scale reference** SHALL be available at all times: look up any chord or scale, see it on staff and keyboard with fingering, and hear it.

**REQ-3.5.5** — The app SHALL offer light **applied analysis** at levels 4–5: showing Roman-numeral annotations on repertoire pieces the user is playing, so theory connects to real music.

**REQ-3.5.6** — Theory drills SHALL use spaced repetition (see §3.9) so facts like key signatures and chord spellings stay retained.

### 3.6 Ear Training

Ear training is a supporting track that strongly accelerates both theory and sight reading.

**REQ-3.6.1** — The app SHALL provide graded ear-training drills: interval recognition (melodic and harmonic), chord quality recognition (major/minor/diminished/augmented, later sevenths), scale/mode recognition, and short melodic dictation (play back a 2–8 note phrase on the keyboard).

**REQ-3.6.2** — Rhythm training SHALL include clap/tap-back exercises and rhythm dictation using any key on the MIDI keyboard.

**REQ-3.6.3** — Ear-training difficulty SHALL adapt to performance like the sight-reading trainer.

### 3.7 Technique and Exercises

**REQ-3.7.1** — The app SHALL include a technique library organized by level: five-finger patterns, scales (all majors, harmonic/melodic minors), chords and inversions, arpeggios, and classic exercise sets in the public domain (e.g., Hanon, selected Czerny) with recommended fingerings shown in the score.

**REQ-3.7.2** — Technique drills SHALL run against the metronome with MIDI evaluation of evenness (timing consistency between notes) and target tempo tracking over time (e.g., "C major scale, 2 octaves, currently clean at ♩=88, target ♩=120").

**REQ-3.7.3** — The app SHALL surface a per-drill tempo history graph so progress on technique is visible.

### 3.8 Repertoire Library

**REQ-3.8.1** — The app SHALL ship (or link) a graded repertoire list per level drawn from public-domain music (e.g., IMSLP/Mutopia sources): folk arrangements and easy classics at levels 1–2 through Bach inventions, Clementi/Kuhlau sonatinas, easier Chopin/Schumann pieces at level 5.

**REQ-3.8.2** — Each repertoire piece SHALL have a status (learning / polishing / performance-ready / maintained) and store practice history, annotations, and best assessment result.

**REQ-3.8.3** — The user SHALL be able to add any imported score to the repertoire and assign it a level manually.

**REQ-3.8.4** — The app SHALL periodically prompt review of "maintained" pieces so finished repertoire doesn't decay.

### 3.9 Practice Tools

**REQ-3.9.1 Metronome** — Configurable tempo, time signature, accent pattern, subdivision, and gradual tempo ramping (e.g., +2 BPM per clean repetition). Available standalone and inside every practice screen.

**REQ-3.9.2 Recorder** — One-tap MIDI recording of any practice; recordings are replayable against the score and stored with date and piece. Audio recording is optional.

**REQ-3.9.3 Looper** — Measure-range looping with per-loop tempo, integrated with the "worst measures" output of assessment mode.

**REQ-3.9.4 Spaced repetition engine** — A shared SRS scheduler used by theory drills, ear training, note-reading flashcards, and repertoire maintenance prompts.

**REQ-3.9.5 Practice timer & log** — Automatic logging of what was practiced, for how long, and at what tempo/accuracy; a manual note field per session.

### 3.10 Progress Tracking and Motivation

**REQ-3.10.1** — A dashboard SHALL show: current level per track, practice streak and weekly time, sight-reading accuracy trend, technique tempo trends, theory retention stats, and repertoire status.

**REQ-3.10.2** — The app SHALL define clear, checkable goals per level (the exit criteria from §2) and show completion progress toward the next level.

**REQ-3.10.3** — Light gamification MAY be included (streaks, milestones like "all major scales at ♩=100"), but no social features, leaderboards, or engagement-bait — this is a personal tool.

**REQ-3.10.4** — All progress data SHALL be exportable (JSON/CSV) and owned locally by the user.

---

## 4. Non-Functional Requirements

**REQ-4.1 Latency** — End-to-end audio latency for MIDI playing under ~20 ms; UI feedback under ~100 ms. This constrains technology choices (native audio APIs or well-configured Web Audio/WebMIDI).

**REQ-4.2 Offline-first** — All core features SHALL work without internet. Content lives locally.

**REQ-4.3 Data ownership** — All user data stored locally (single-user), with simple backup/restore (copy a folder or export a file). No accounts, no telemetry.

**REQ-4.4 Platform** — Desktop is the primary target (practice happens at the piano with a laptop/tablet). One platform is sufficient; a browser-based app using Web MIDI is an acceptable and low-effort option, provided REQ-4.1 is met.

**REQ-4.5 Open formats** — Scores in MusicXML/MIDI; progress data in JSON; no proprietary lock-in, so content and history survive rewrites of the app.

**REQ-4.6 Simplicity over polish** — Given the single-user scope, prefer boring, maintainable solutions; skip onboarding flows, settings screens for hypothetical users, and visual polish that doesn't aid learning.

**REQ-4.7 Sound** — Playback SHALL use a decent piano sound (sampled soundfont is fine). When a digital piano is connected, the app SHOULD send MIDI to it and let the instrument produce the sound, avoiding latency and quality issues entirely.

---

## 5. Content Requirements

**REQ-5.1** — All bundled scores SHALL be public domain or openly licensed (IMSLP, Mutopia Project, OpenScore) to avoid any rights issues even for personal use.

**REQ-5.2** — Minimum initial content: ~30 lessons covering levels 1–2, ~100 sight-reading snippets (or a generator), technique library through level 3, and ~20 graded repertoire pieces. Later levels' content can be added incrementally while the user is still working through early levels.

**REQ-5.3** — A sight-reading **generator** (parameterized random melodies/progressions per §3.4.2) is strongly preferred over a fixed snippet pool, since it never runs out.

---

## 6. Assumptions and Dependencies

- A MIDI-capable keyboard (61+ keys for levels 1–3; 88 weighted keys recommended from level 3 up) is available and connectable via USB.
- The user practices at least ~4 sessions per week; the curriculum pacing assumes roughly 30–45 minutes per session.
- Notation rendering will rely on an existing engraving library (e.g., VexFlow, Verovio, or OpenSheetMusicDisplay) rather than custom rendering.
- The app supplements, not replaces, occasional human feedback (a teacher check-in, online communities) for posture and hand technique, which software cannot reliably evaluate.

---

## 7. Out of Scope

- Multi-user support, accounts, cloud sync, mobile-first design.
- Video-based posture/hand-position analysis via camera.
- Composition and notation-editing tools (viewing and annotating only).
- Advanced repertoire (ABRSM 7+), jazz improvisation curriculum, and non-piano instruments — possible future extensions, not requirements.

---

## 8. Suggested Delivery Milestones

**M1 — Playable core:** MIDI input, score viewer with playback and looping, wait mode, metronome. *Already usable for daily practice.*

**M2 — Feedback & reading:** practice/assessment modes with note-level feedback, sight-reading trainer with generator, note-name flashcards, practice log.

**M3 — Theory & ears:** theory lessons and keyboard-answered drills with SRS, chord/scale reference, interactive circle of fifths, ear training.

**M4 — Progression:** level system with exit checks, dashboard, technique tempo tracking, repertoire statuses and maintenance prompts, applied analysis overlays.

---

## 9. Acceptance Criteria (Summary)

The application succeeds if, using it as the primary learning tool, the user can: pass each level's exit checks in order; sight-read a never-seen level-appropriate piece at ~85% note accuracy without stopping; play all major and harmonic minor scales hands together at ♩=100+; perform at least three upper-intermediate pieces to "performance-ready" status; and correctly analyze the chords and cadences of a simple classical piece using Roman numerals.