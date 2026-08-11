# Roadmap — the open work, ordered by learner impact

How to pick work (the old "first unchecked box, top to bottom" rule is dead):

1. **Triage first.** Anything in the Triage section below — user-reported bugs, red build
   states, disproven claims — before any feature.
2. **Then learner impact.** Phase 5 groups are already ranked by learner impact per unit of
   effort; work them in that order. A Phase 3/4 item is picked only when it gates an impact
   item, or is a genuine < 30-min fix. State what you picked and why.
3. Discovered prerequisite work is inserted as a new task where it belongs, with a proof
   action, never done silently.
4. Tick a box only when the slice passed the experience gate in docs/PROCESS.md (verify green,
   driven in the browser on real content, visual pass, committed).

Status legend: `[ ]` todo · `[~]` in progress (leave a note) · `[x]` done · `[-]` dropped (say why)
Full histories of completed tasks: docs/roadmap-archive-2026-08-08.md and git history.

## Triage — before any feature work

- [x] T.1 OSMD `TypeError` false-red in `npm run verify` (happy-dom canvas gap) — fixed by mocking
      `ScoreViewer` in the two screen tests that hit real OSMD (33fabaa). Full history: archive.
- [x] T.2 `audio-clock-drift.spec.ts` false-red on a starved-timer null sink — spec now asserts the
      adapter's tracking RATIO instead of raw clock slopes, holds on any machine. Full history: archive.
- [x] T.3 main-checkout `eslint .` walked into other sessions' worktrees and could turn master's
      verify red — root-anchored globs + `worktree-isolation.test.mjs` (623ac1b). Full history: archive.
- [x] T.4 `npm run verify:full` was red on `knip`: "Unresolved imports (1) /src/adapters/audio/webaudio.ts
      e2e/audio-clock-drift.spec.ts:202". The spec's `page.evaluate` dynamic-imports that adapter by an
      absolute browser URL path, which knip's Node-side static resolver tried and failed to resolve —
      it only ever resolves at runtime inside the page. Fixed by building the path from a string
      concatenation instead of a literal, so knip's import scanner can't statically match it; runtime
      behaviour in the page is unchanged. Proof: `npm run knip` clean, `npx playwright test
      e2e/audio-clock-drift.spec.ts` still passes (adapter anchor holds, driftPpm -271.76).

## Phases 0-2 — Foundation, M1 playable core, M2 feedback & reading — all done

Every box in these three phases is `[x]`. Moved to
[docs/roadmap-archive-2026-08-08.md](docs/roadmap-archive-2026-08-08.md) 2026-08-11 to stay
under this file's line budget; full task list and proof prose there, and in git history.

## Phase 3 — Milestone M3: theory & ears

Every core module here is built ahead of the screen that consumes it. The screens (3.8–3.10) are
therefore not optional polish: until they land, all of 3.1–3.6 is production-unreachable and
`knip:prod` says so. Do not tick a core task until its named consumer task also exists.

- [x] 3.1 `core/theory/harmony`: diatonic function, roman numerals, cadences, progressions (REQ-3.5.1)
- [x] 3.2 `core/theory/analysis`: roman-numeral analysis of a Score (REQ-3.5.5) — core only
- [x] 3.2a `app/score`: show the roman-numeral analysis under the score — the only consumer `core/theory/analysis` will have.
- [x] 3.3 ‖ `core/drills/theory`: keyboard-answered theory drills, quiz items, SRS-backed (REQ-3.5.2)
- [x] 3.4 ‖ `core/eartraining/intervals`: melodic/harmonic interval recognition, adaptive (REQ-3.6.1)
- [x] 3.5 ‖ `core/eartraining/chords`: chord quality + scale/mode recognition
- [x] 3.6 ‖ `core/eartraining/dictation`: melodic and rhythmic dictation grading (REQ-3.6.2)
- [x] 3.7 `content/theory`: theory lesson content for levels 1–3 with diagrams + play tasks
- [x] 3.8 `app`: interactive circle of fifths, keyboard/staff explorer (REQ-3.5.3)
- [x] 3.9 `app`: chord & scale reference, always available (REQ-3.5.4)
- [x] 3.10 `app`: ear-training screens — the only consumers 3.4/3.5/3.6 will have
- [x] 3.11 M3 acceptance pass — three-reviewer audit against REQ-3.5.x/3.6.x; accepted with 3.11a–3.11c landed as the blockers that were defects rather than unbuilt features.
- [x] 3.11a `app/state`: persist ear-training state (REQ-3.6.3) — `earTraining` is a real field on
      core's `ProgressSnapshot`, and absence means "leave alone", never "wipe".
- [x] 3.11b `app/eartraining`: dictation answerable on screen and over MIDI (REQ-3.6.1/3.6.2)
- [x] 3.11c `app/drills,content`: each lesson quiz opens the deck its title promises (REQ-3.5.2)

The M3 gaps that are unbuilt features rather than defects. Each states its proof action.

- [x] 3.12 `app`: route the topic quizzes no flashcard deck covers to the MIDI-answered `TheoryDrillPanel`.
- [x] 3.13 `app/theory`: hear it (REQ-3.5.3, 3.5.4)
- [x] 3.14 `app/theory`: the staff half of "see it on staff and keyboard" (REQ-3.5.3, 3.5.4).
      *Proof: `e2e/screens.spec.ts` drives the reference, asserts the OSMD svg past the 50-element
      discriminator, and reads the six-sharp key signature off the engraving after switching to F#
      major.* Its visual pass added a `'reference'` presentation to `osmdEngraver` (no cursor, no
      `♩=120`, no duplicated title, no synthetic `8/4`, tight margins) and dropped the "Piano" part
      label app-wide, which is 5.13's part-name half.
- [x] 3.14a `core/notation`: gave `ScoreNote`/`ScoreNoteInput` an optional per-note `spelling: SpelledPitch`
      field (validated to sound as the note's own `midi`), and `musicxmlwriter`'s `pitchXml` uses it
      when present instead of re-deriving a spelling from `midi` + the measure's single `preferFlats`
      bit, which could never represent E#/B#/Cb/Fb or a per-note choice that disagrees with the
      measure's bias. `accidentalName` now names the full alter range (double-sharp/flat-flat
      included). `ScaleStaff.tsx` wires `scaleNotes`' already-correct `SpelledPitch` straight through
      instead of collapsing it to a bare midi number first.
      *Proof: `musicxmlwriter.test.ts`/`score.test.ts`/`ScaleStaff.test.tsx` assert the written
      MusicXML step/alter matches `scaleNotes` exactly, incl. F# major's 7th degree as E# (not F♮) and
      G harmonic minor's raised 7th as F# (not Gb) — both previously-flagged cases now pass; every
      existing musicxml/writer round-trip fixture still passes (`npm run verify` green, 3420 tests).
      Driven live: Theory → Chord & scale reference, F# major and G harmonic minor both render an
      8-note engraving whose on-screen degree table reads E#5/F#5 respectively, console clean.*
- [x] 3.15 `app/theory`: look up ANY chord (REQ-3.5.4) — any root × quality × inversion, with symbol, figured bass, spelled tones and keyboard highlight.
- [x] 3.15a `app/theory`: extract the duplicated chord/scale audio helpers (play, panic, the shared
      `AudioContext`) out of `ChordScaleReference.tsx` and `ChordLookup.tsx` into a leaf module.
      Raised by 3.15's review and correctly refused there — a file-scoped fix agent should not be
      creating new modules. Not urgent; it is duplication, not a defect.
      *Proof: `playScaleAscending`/`playChordTones`, the lazy-`AudioOutput` accessor
      (`useSharedAudioOutput`), `ROOT_OPTIONS` and `noteLabel` now live only in the new
      `src/app/theory/chordScaleAudio.ts`; both components import them and neither declares its
      own copy. The one thing deliberately NOT hoisted: the two panic-on-change `useEffect`s
      themselves, since `ChordScaleReference`'s panics unconditionally on every root/scale/seventh
      change while `ChordLookup`'s only panics when *it* started the ringing performance
      (`ringingRef`) — unifying them would change one or the other's behaviour, so only the one
      line genuinely shared between them (`stopRingingAudio`) is hoisted. All 3.13's audio
      assertions (exact pitches, exact timestamps, a note-off per note-on, velocity above zero)
      still pass unchanged (`ChordScaleReference.test.tsx` 37 tests, `ChordLookup.test.tsx` 19
      tests), plus 11 new tests on the extracted module itself. Driven live at
      `http://localhost:5302`: Theory → Chord & scale reference, Play buttons on the scale and on
      chord rows in both components still sound, console clean at both widths/both themes.*
- [ ] 3.16 `core/theory`: fingering for the minor forms (REQ-3.5.4) — `scaleFingering` returns
      `null` unless the type is major/ionian, and the circle's whole inner ring lands the user on
      `naturalMinor`, i.e. half the advertised flow reaches a fingering-less reference.
      **Re-scoped by roadmap 5.37**: the mode half of this task (dorian/phrygian/lydian/
      mixolydian/aeolian/locrian, plus chromatic/pentatonics/blues/whole tone) is deliberately NOT
      shipped — RCM's 2022 chart has zero hits for any of them, so the reference now says so
      instead of promising a table that was never going to exist (`NO_STANDARD_FINGERING_TYPES`,
      `scales.ts`). What remains here is the minor forms only, tracked and shipped by **5.35**, a
      narrower table-based approach — see that task rather than the derivation below.
      **ATTEMPTED 2026-08-04 AND REVERTED — read this before trying again.** Tables for the minor
      forms and chromatic plus a thumb-placement rule for the other ten types were built, passed a
      green 526-test suite, and were reverted after adversarial review found: 11 of 108 derived
      fingerings anatomically impossible (thumb under the 5th, or a finger repeated on consecutive
      keys) and 55 of 108 with at least one hard defect, because the rule forced a thumb landing on
      every white key after a black one; the chromatic table was the standard pattern with 2 and 3
      transposed; two hand-written minor rows were unplayable; and the claim that the rule
      reproduced `MAJOR_FINGERINGS` was false (LH differs on 5 of 12) and had no test.
      The lesson: the three properties the suite checked (fingers 1-5, one per degree, no thumb on
      black) are satisfiable by fingerings no pianist would use. Write these FIRST, for all 16
      types × 12 tonics, both hands: (a) no finger repeats on consecutive degrees; (b) no 5→1 or
      1→5 transition; (c) RH increases by exactly 1 between thumb landings, LH decreases; (d) every
      group between landings is 3 or 4 notes. Those four kill every blocker above except the
      chromatic swap. A black key must PERMIT a landing, not require one. For 5- and 6-note scales
      (pentatonics, blues, whole tone) the answer is one finger per note, not a grouped major-scale
      walk. The derivation must reproduce `MAJOR_FINGERINGS` in a real, exported test first.
      *Proof: the four properties above, plus named both-hand examples for A/E natural minor,
      A harmonic minor, C chromatic, C♯ and F♯ minor, and one per derived family.*
- [ ] 3.17 `app/shell`: the chord/scale reference "available at all times" (REQ-3.5.4) — today it is
      a destination you leave your place for; `Shell` renders exactly one screen.
      *Proof: open it from the practice screen without losing the loaded score.*
- [x] 3.18 `app/score`: gate applied analysis to theory level 4+ (REQ-3.5.5)
- [x] 3.18a `app/score`: put the numerals ON the engraving (REQ-3.5.5's second half). 7829b8d had
      built the whole path — `buildMeasureLabels`, `measureLabels`, `setMeasureLabels` — and wired it
      to NOTHING, so the numerals were absent under a green suite. Found by driving the screen, not
      by a test. Now passed through `ScoreScreen`, under the same theory-level-4 gate as the panel,
      with the panel's duplicated per-measure list moved behind a `<details>`.
      *Proof: `e2e/round6.spec.ts` reads every numeral's box off the SVG and asserts each is centred
      under a different bar, below its staff.*
- [x] 3.19 `core/theory/analysis`: make the minor-key leading-tone vote positional
- [x] 3.19a `core/theory/analysis`: the `>= 2` vote threshold itself.
- [x] 3.19b `core/theory/analysis`: `plagalMotionIntoFinalMeasure` sampled the final measure's bass
      at its `startTick`, so a final bar whose left hand enters late sampled no bass and dropped the
      vote. Raised by 3.19a's review as SUSPECTED and rejected there for the right reason — no
      failing fixture. The failing score was written first this time, as demanded
      (`analysis.test.ts`, "LATE LEFT-HAND ENTRY"), so it was a real defect and not the speculative
      rewrite the task warned against.
      *Proof: that score reads minor, and every 3.19/3.19a fixture still reads what it read.*
- [x] 3.20 `app/theory`: SRS that re-serves the actual due fact (REQ-3.5.6)
- [ ] 3.21 `app/eartraining`: clap/tap-back (REQ-3.6.2) — there is no call-and-response anywhere.
      The Rhythm screen shows the pattern for the whole run and silences the audio deliberately, so
      it is rhythm SIGHT-READING; "hear a phrase and clap it back" has never been built.
      *Proof: the pattern is heard and never shown, and the tapped answer is graded.*
- [x] 3.22 `core/eartraining`: delete the inert band; give the dashboard an honest ear level
- [x] 3.26 `core/eartraining`: give an attempt a real accuracy, then a band means something.
- [x] 3.23 `app/eartraining`: dictation has a tempo reference (REQ-3.6.1) — `gradeDictation` fits a
      tempo scale over the answer's onset gaps, and the screen states the pulse and count-in.
      *Proof, both sides of the seam deliberately: "same phrase, different tempo, still correct" over
      900 generated cases in `dictation.test.ts` (a browser spec cannot know the generated phrase),
      plus `e2e/screens.spec.ts` driving the real screen.* Its visual pass also fixed two defects:
      every retention stat printed its label twice ("Cards 0 CARDS"), and a ≤1024px
      `.keyboard-diagram { width: 100% }` override drew the 5-key pad against ~700px of empty frame.
- [x] 3.24 `content`: the six REQ-3.5.1 topics with no authored lesson at any level — seventh
      chords, cadences, the common progressions (I–IV–V–I, ii–V–I, I–vi–IV–V), minor scale forms,
      secondary dominants, and modulation to closely related keys. They live at levels 4–5, which
      do not exist. Diatonic harmony and roman numerals are named only in passing. This is the
      single largest gap between the app and REQ-3.5.1, and it is authoring, not code.
      *Proof: each topic has a lesson that validates, opens in the app, and carries a diagram and a
      quiz that tests that topic.* New `lessonsLevel4.ts`/`lessonsLevel5.ts` (3 lessons each) plus
      two new `CurriculumLevel`s in `curriculum.ts`; every quiz opens a real `TheoryQuizKind`/
      `FlashcardKind` deck at a level whose pool genuinely contains what its title names (see each
      exercise's own comment). No demo score exists for any of the six topics specifically
      (`src/content/scores/demoScores.ts` is another task's file) — each lesson points at the
      closest on-topic existing demo instead, named as a gap in its own comment. `curriculum.test.ts`
      pins all six lesson ids, their diagram kind and their quiz presence; driven live via
      `e2e/lesson-staff-rhythm-diagrams.spec.ts` (both new tests green) and a 4-config visual pass
      (console clean).
- [x] 3.25 `app/lessons`: staff and rhythm diagrams (REQ-3.5.2) — `LessonBody` can render only
      `KeyboardDiagram`, so the 7 level-1 lessons about staff notation and rhythm are structurally
      incapable of having one, and 11 of 19 theory lessons have no diagram.
      *Proof: a staff-notation lesson renders a real staff diagram inline.* `LessonDiagram` widened
      to a `kind`-discriminated union (`keyboard` | `staff` | `rhythm`); `staff`/`rhythm` diagrams
      carry a real `Score` (new `diagramScores.ts`) engraved through the same read-only
      `ExerciseScore` + `createOsmdEngraver({ presentation: 'reference' })` pipeline
      `ScaleStaff.tsx` already uses — no third rendering path. Closed the class, not just the 7
      named instances: all 11 of 19 undiagrammed theory lessons across levels 1–3 now carry a
      staff or rhythm diagram, plus the 6 new level 4–5 lessons from 3.24. Driven live: e2e proof
      shows a real engraved `<svg>` inline on `l1-staff-and-clefs`, and a visual pass (both widths,
      both themes, console clean) on that lesson and on the new `l4-seventh-chords` lesson.

## Phase 4 — Milestone M4: progression

- [x] 4.1 `core/curriculum`: levels → units → lessons → exercises model + exit criteria (REQ-3.1.1, 2.2)
- [x] 4.2 `core/curriculum/session`: daily practice session builder, 15/30/60 min budgets (REQ-3.1.4)
- [x] 4.3 `core/progress/levels`: per-track levels, advancement checks, manual override (REQ-2.1–2.3)
- [x] 4.4 ‖ `core/technique`: technique library, evenness scoring, tempo history (REQ-3.7.x) — core only; `evenness`/`tempoHistory` are read by the dashboard, the drill LIBRARY still has no screen (4.4a).
- [x] 4.4a `app/technique`: the technique drill screen — pick a drill from `techniqueLibrary`, play it against the metronome, store the attempt.
- [x] 4.5 ‖ `core/repertoire`: statuses, practice history, maintenance prompts (REQ-3.8.x)
- [x] 4.6 `core/progress/export`: JSON/CSV export + restore round-trip (REQ-3.10.4, 4.3)
- [x] 4.6a `app`: the export/import screen — a download button and a file picker over `core/progress/export`, the only consumer it will have (REQ-3.10.4)
- [x] 4.7 `app`: dashboard — levels, streak, trends, repertoire status (REQ-3.10.1/2)
- [x] 4.7a `app`: today's practice session screen — calls planSession with real curriculum candidates, renders PlannedSession, each item opens the drill it names (REQ-3.1.4)
- [x] 4.7b `app`: drive the dashboard end to end with real data.
- [x] 4.7c `app/dashboard`: a repertoire assessment's accuracy has no home anywhere on the dashboard.
- [x] 4.8 `app`: annotations (fingering edits, highlights, notes) persisted per piece (REQ-3.2.6)
- [x] 4.4b `app/technique`: drive a whole technique drill through the fake MIDI keyboard and watch the tempo history gain a point.
- [x] 4.6b `app`: the full export → wipe → restore pass in a browser.
- [x] 4.8a `app/score`: click a notehead to select it, so fingering and highlight annotations are editable.
- [x] 4.9 `content`: 30 lessons L1–2, technique library through L3, 20 graded repertoire pieces (REQ-5.2)
- [x] 4.9a `app/repertoire`: seed an empty repertoire library from `GRADED_PIECES`
- [x] 4.9b `app/lessons`: the lesson screen — the only consumer the authored curriculum, the demo score registry and `core/curriculum/model.ts` will ever have.
- [x] 4.9c `app/drills`: every `theory-quiz` exercise in the authored curriculum opened the same note-naming deck regardless of its title — gave `FlashcardScreen` an `initialKind` prop routed from `params.drillKind`.
- [ ] 4.10 M4 acceptance pass — full §9 acceptance criteria review

## Phase 5 — Milestone M5: teachable product

Source: [docs/ux-pedagogy-review-2026-08-06.md](docs/ux-pedagogy-review-2026-08-06.md) — the app driven
screen by screen as an adult beginner, cross-checked against source, with the pedagogy claims verified
against RCM 2022, ABRSM 2025–26, Faber/Alfred and the Taubman literature. It scored **17 aspects** and
rated the whole **4.5/10 as a teaching product**: "an impressive engine wrapped around almost no
content, aimed at nobody in particular."

**Exit condition for M5: every aspect in that table scores ≥ 9/10 on a re-run of the same review.**
Each group below names its aspect, its measured score, and the specific defects that hold it there —
the group is done when all of its boxes are ticked *and* the named defect is gone in the running app.
Groups are ordered by the review's own "learner impact per unit of effort" ranking, not by module, so
the first unchecked box is still the next task.

Two standing rules for this phase, both learned from the review:
- **A score does not move because a task was ticked.** Every task here states the observable thing a
  re-review would check. Prose fixes count only if the prose is on screen.
- **Do not duplicate Phase 3.** Several M3 gaps (3.14, 3.15, 3.16, 3.21, 3.23, 3.24, 3.25, 3.26) are
  the same defects seen from the requirements side; those tasks are referenced, not restated, and the
  aspect they gate cannot reach 9 until they land too.

### Playable content — **2/10 → 9**

`src/content/scores/` holds exactly one score, `twinkle-twinkle-little-star.musicxml`. The 20-piece
graded library is metadata with no music behind it: adding *Für Elise* gives a row with a status
dropdown and **no way to open, view or play it**. Everything else in the app — matcher, wait mode,
assessment, read-ahead, loop practice, tempo ramp — exists to be used on a piece.

- [x] 5.1 `content/scores`: bundled a real hand-authored `.musicxml` for all 20 `GRADED_PIECES`
      entries (`gradedScoreFiles.ts`, untrusted parse) — MuseScore/IMSLP download was out of scope,
      so 11 are research-verified note-for-note and the rest a flagged stylistic excerpt (7d0721d).
      Full history: git log.
- [x] 5.2 `app/repertoire`: an "Open in Practice" control per piece row (shown only when
      `canOpenInPractice` resolves the piece's `scoreId` to a bundled file — a manually
      "Add loaded score"-d piece gets no dead control) loads the score into `scoreStore` and
      navigates, the same `openDemoScore`/`onOpenDemo` split 4.9b/5.9b established.
      *Proof: `e2e/repertoire-open-practice.spec.ts` — add Greensleeves (level 3) from the catalogue,
      open it from a different score already loaded (the default Twinkle), assert the Practice
      heading and engraving are Greensleeves', then play its first beat and see it graded correct.
      Visual pass both widths/themes, console clean.* Extended `scripts/visual-pass.mjs` with
      `--click <label>` to reach a post-interaction state (e.g. an added piece's row) for a screenshot.
- [x] 5.3 `content`: widened the catalogue toward the 40 Piece Challenge shape — `GRADED_PIECES` now
      has 40 entries (was 20), all 20 new ones at level 1–2, every one resolving to a real bundled
      `.musicxml` (19 newly authored + `twinkle-twinkle-little-star.musicxml` newly added to the
      catalogue), giving 31 of 40 at level ≤ 2. Melodies for 6 (Row Row Row Your Boat, Old MacDonald,
      Yankee Doodle, Oh! Susanna, Auld Lang Syne, When the Saints Go Marching In) were fetched from
      noobnotes.net letter-note transcriptions this session, not just recalled; the remaining 14 are
      this app's own rendition of a single universally-known melody, flagged as such rather than
      claimed as source-verified — see `LICENSE.md`'s new "Roadmap 5.3" section for the full
      per-piece breakdown. Added a "Below my level" checkbox to the Repertoire screen's Graded
      library, filtering to `piece.level < playingLevel` (strictly below, so a level-1 learner
      correctly sees an honest empty state, not a silently-empty list).
      *Proof: `gradedPieces.test.ts` asserts ≥ 40 entries and ≥ 25 at level ≤ 2, plus every scoreId
      resolves to a real parsed Score. Driven in the browser on this worktree's own dev server: all
      40 catalogue rows render; raising the playing track level to 3 via the dashboard's own override
      and checking "Below my level" shows exactly the 31 level 1–2 pieces and hides Für Elise
      (level 3) and above; unchecking restores all 40. Visual pass (`scripts/visual-pass.mjs
      Repertoire --level playing=3`) at both widths, both themes: console clean, no layout
      regression.*

### Input accessibility — **3/10 → 9**

`PracticeScreen` takes `midiInput` and nothing else. On Safari, Firefox or an iPad — no Web MIDI —
note matching, feedback colouring, wait mode, assessment, timing feedback, recording and the tempo
ramp are all inert. Flashcards, Theory and Dictation *do* render the 37-key `OnScreenKeyboard`; the
one screen where playing matters is the one that refuses non-MIDI input.

- [x] 5.4 `app/practice`: render `OnScreenKeyboard` on Practice when no MIDI device is present (behind
      a toggle when one is); gave `waitmode.ts` a real press/release mode plus a "Hold keys down" latch
      so a mouse's one pointer can still clear a chord barrier. Gate caught a render-time state-update
      bug and a no-hardware default keyed off the wrong signal. Full history: git log.
- [x] 5.5 `app/keyboardInput`: computer-keyboard note input as a first-class second input
      (`qwertyNoteMap.ts`), shared by Practice, Flashcards, Theory and Dictation. `KeyA` climbs from the
      bottom of whatever range is in view (A S D F G H J K L ; white, W E T Y U O P black), anchored at
      the range's own low note, not middle C. Spans 17 semitones — a wide Practice range is only partly
      reachable by typing, a real keyboard limit, not a bug. Found, not fixed: Technique has no
      `OnScreenKeyboard` to hang this on (5.5a). Full history: git log.
- [x] 5.5a `app/technique`: `useTechniqueDrill` fed its `NoteMatcher` straight from `midi.input.onEvent`,
      with no on-screen fallback for 5.5's computer-keyboard mapping to attach to. Reused the
      `PlayableMidiInput` wrapper roadmap 5.4 already built (`@app/practice/playableInput.ts`) rather
      than a second one, and reused `PracticeKeyboard` itself (already generic over any `Score` +
      press/release pair) rather than duplicating its toggle/latch UI. `useTechniqueDrill` now exposes
      `press`/`release`; `TechniqueScreen` renders the same on-screen keyboard + qwerty hint Practice
      does, directly under the engraving. Driven in the browser: a level-1 drill run entirely through
      clicked on-screen keys, no MIDI at all, scores clean and lands in the tempo history — same proof
      as a unit test driving `press()`/`release()` directly. Both widths/themes, console clean.
- [x] 5.6 `app/shell`: `InputCapabilityBanner` — one-line, dismissible, mounted once in `Shell`,
      naming Web MIDI's absence and what it costs (see B.7's platform reality). Gated on
      `isWebMidiSupported` (feature detection), deliberately distinct from `MidiDeviceStatus`'s
      per-screen "nothing plugged in yet" line, which still fires on its own for a permission
      denial or no hardware on a browser that does have the API.
      *Proof: `e2e/input-capability-banner.spec.ts` — with `navigator.requestMIDIAccess` stubbed
      absent the banner names the limitation and dismisses; with it present (this repo's headless
      Chromium ships the API) the banner stays hidden even though `smoke.spec.ts` still shows the
      unrelated "no MIDI keyboard connected" line. Visual pass both widths/themes, console clean.*
- [x] 5.7 **Promoted B.1** (microphone pitch detection) into this phase. Three-layer build: pure
      YIN pitch detection (`core/audio/pitchDetection.ts` — difference function, cumulative-mean
      normalisation, first-dip selection to avoid octave errors, parabolic interpolation) feeding a
      pure onset/offset debounce state machine (`core/audio/noteOnsetDetector.ts`, hysteresis so a
      struck-note transient or a decaying tail can't flicker into spurious notes), wrapped by the
      DOM edge (`adapters/audio/micPitchInput.ts`, `getUserMedia` + `AnalyserNode` on a schedule)
      implementing the same `MidiInput` port `webmidi.ts` does — so a sung/played-acoustically note
      goes through the exact matcher, wait-mode and recording path a MIDI note does. Practice screen
      gets a `useMicInput` connection (opt-in — requesting the mic holds the browser's recording
      indicator lit, so it never fires without an explicit toggle) and a `MicInputControl` status
      line next to `MidiDeviceStatus`.
      *Proof: `core/audio/pitchDetection.test.ts` — 200-run property test recovers every piano note
      A0–C8 from a synthesised sine within 10 cents, plus an explicit harmonic-rich-tone test that
      the first-dip rule doesn't octave-error. `core/audio/noteOnsetDetector.test.ts` and
      `adapters/audio/micPitchInput.test.ts` drive the debounce state machine and the adapter's tick
      loop with synthetic buffers end-to-end (onset after N clean frames, release after silence,
      dispose stops the track and the loop). Driven in the browser: the toggle renders, connecting
      surfaces a real permission-denied error without crashing (this sandbox has no mic hardware to
      grant), and disabling tears the connection down cleanly — the actual "a sung note grades"
      path is proven by the algorithm/state-machine property tests above, not by a screenshot, since
      no real microphone was available to drive end-to-end here. Caught and fixed one real defect in
      the process: `.status-group`'s row had no `flex-wrap`, so adding this control pushed the
      practice-controls bar past both required widths (1024px and 1280px) into horizontal overflow —
      fixed with a `flex-wrap: wrap` matching the pattern its own parent `.practice-controls` already
      uses. Console clean, dark and light both checked (computed style, not screenshot — the preview
      pane's screenshot capture was unavailable this session).

### Lesson content quality — **6/10 → 9**

The G major lesson teaches one sharp and then plays a demonstration with none: all three scale lessons
set `demoScoreId: demo('demo-c-major-scale-one-octave-rh')`, and `demoScores.ts` contains no G or F
major scale at all — 14 demos, all in C except the two rhythm ones. The prose is good, which makes the
mismatch worse: the audio wins and a beginner cannot tell which one is lying.

- [x] 5.8 `content/demoScores`: authored real G/F major scale demos and pointed those lessons at them.
      Root cause a layer down: `techniqueScore` defaulted `keyFifths` to 0, so all 12 technique-library
      tonics engraved in C regardless — `keySignatureForTonic` now supplies it. Full history: git log.
- [x] 5.9 `content`: audited all 40 `demoScoreId` lessons on five dimensions (key, hand, octave, note
      values, concept) — **11 mismatches, not the 2 reported**. The 4 key ones fixed by 5.8; the other
      7 real but a different fix shape, tracked as 5.9a. Full table in the commit body.
- [x] 5.9a `content`: authored a real demo for each of the 7 non-key mismatches (hand/octave, eighth
      notes, dotted rhythm, I-IV-I progression, circle of fifths, relative minors, contrary motion) —
      all via `@core/notation/score.ts` builders, no verbatim transcription. `demoScores.ts` split into
      `demoScores.ts` + `harmonyDemoScores.ts` + `demoScoreTypes.ts` on file-size grounds. Each fix has
      a content assertion reading the demo's actual notes, not its title; all 7 driven live (a0f985f).
      Full history: git log.
- [x] 5.9b `app/lessons`: "Open demonstration" now navigates to Practice after loading the demo score
      (`LessonsScreen`'s new `onOpenDemo` → `Shell`'s `goTo('practice')`), instead of leaving the
      learner on the Lessons screen. Driven in a browser: one click, no second step (ec91440).
- [ ] 5.10 Lesson quality also depends on **3.24** (six REQ-3.5.1 topics with no lesson at any level)
      and **3.25** (`LessonBody` can render only `KeyboardDiagram`, so 7 staff/rhythm lessons are
      structurally incapable of having a diagram). Both are referenced here, not restated: this aspect
      cannot reach 9 with 11 of 19 theory lessons undiagrammed.

### Sight reading — **5/10 → 9**

The rules are exactly right — 30-second silent preview matching ABRSM's "up to half a minute", a
forced start, no stopping, unrepeatable exercises, an 80–90% adaptive band. The ladder is wrong.
`melody.ts:626 LEVEL_ROWS` resolves to: level 1 C major with a **7-semitone leap** permitted; level 4
**E major (4♯)**; level 5 **D♯ minor (6♯)**.

- [x] 5.11 `core/generator/melody`: rebuilt `LEVEL_ROWS` into six levels (was five) — level 1 is a
      genuine stepwise-one-direction run (`stepwiseLine.ts`, new), no level below the top exceeds 2
      accidentals (old E-major/D♯-minor bug moved to level 6, on purpose). Opus review caught two real
      regressions, both fixed (`doubleHand` unison octave fold, `dictation.ts`'s leap budget). Proof:
      monotonic-ladder property test, 500-seed level-1 assertion; browser: level 1 renders a real
      4-note ascending run (5e3d8be). Full history: git log.
- [x] 5.12 `app/sightreading`: exposed the generator parameters `core/generator/melody.ts` already
      supported (REQ-3.4.2: key, range, rhythm, hands, accidentals, independence) behind a closed-by-
      default "Customize exercise" panel (`customization.ts`'s pure merge over a level's own
      `defaultParamsForLevel`, applied only when at least one field is actually set — the ordinary
      auto-drawn, retirement-aware path is unchanged). Bars/time signature/max leap stay level-governed;
      range is a register shift (±1 octave, clamped to the real piano) rather than a free-form width,
      so a custom range can never break the generator's own leap-vs-width invariant.
      *Proof: `e2e/sight-reading-customizer.spec.ts` sets key = G, hands = left only, no accidentals,
      and reads the rendered SVG — one `.vf-keysignature` sharp, one `.vf-clef` (single staff, not a
      grand staff with an empty half), and every `.vf-modifiers` group empty. Visual pass both widths/
      themes, console clean — caught and fixed one real defect: the unstyled control row wrapped
      mid-label ("No" / "accidentals" split across lines) at 1024px, fixed with a `domain.css` rule
      that wraps each label+control as one atomic unit.*
- [x] 5.13 `core/generator`: generated exercises engraved with the title "Untitled Score" — the part
      name half ("Piano" above the staff) was already fixed app-wide as a side effect of 3.14. Gave
      `generateMelody` a `Sight Reading — <key>` title and `techniqueScore` the drill's own title
      (all four drill kinds: five-finger, scale, arpeggio, chord-inversions). Driven in the browser:
      Sight reading renders "Sight Reading — C major", Technique renders "C major five-finger
      pattern, right hand". Full history: git log.

### Progress & motivation — **4/10 → 9**

`practiceLog.start(...)` has **exactly one call site** in the whole app — `PracticeScreen.tsx:267`,
hardcoded to `'repertoire'`. Sight reading, Flashcards, Ear training, Rhythm, Technique, Theory and
Lessons log nothing, so a learner who follows the Today plan and skips the repertoire segment records
**0 minutes and breaks their streak**. `'warmup'` is a declared category, is rendered on the Progress
screen, and is written by nothing. The review's verdict: a practice log that silently drops 6/7 of the
work is worse than none, because it will be trusted.

- [x] 5.14 `app`: log practice time from all seven activity screens through the existing
      `usePracticeLog` hook (2.24/@app/practice/usePracticeLog.ts), reused across screens rather than
      copied — Sight reading, Ear training and Technique log on their own explicit start/stop; Rhythm
      shares `'technique'` (a tapping drill is the same physical/timing family); Flashcards and Theory
      share `'theory'` (recall practice, and `FlashcardScreen` already doubles as the theory-quiz deck
      per 4.9c); Lessons logs on `selected` lesson changes. Deleted `'warmup'` from `ActivityKind`
      rather than writing it — nothing wrote it, and the real warm-up SEGMENT feature is 5.45, out of
      scope here — so this is six `ActivityKind`s from seven screens, not seven from seven. Mount-driven
      starts (Flashcards/Theory/Lessons) defer their `start()` one macrotask and cancel it in cleanup:
      un-deferred, React 18 StrictMode's synchronous mount→cleanup→remount double-invoke stored a real,
      near-zero-duration phantom entry on every fresh mount, caught by this task's own e2e before it
      shipped — a `PracticeTimer` session is not the idempotent kind of resource that pattern is usually
      applied to.
      *Proof: `e2e/practice-log-all-screens.spec.ts` drives all seven screens for real in one session
      (never seeded) and reads the resulting rows back from the real IndexedDB `practiceLog` store,
      cross-checked against `totalMinutes` (the 4.7b pattern). Deviates from the proof as originally
      written in two ways, both explained in the spec's own module doc: six non-empty `ActivityKind`
      buckets, not seven (per the `'warmup'` deletion above), and per-kind duration is asserted exact
      and positive from IndexedDB rather than demanding every individual on-screen row round to a
      visible non-zero minute (the display rounds to the nearest whole minute; six real per-screen
      interactions each meeting that bar would cost 3+ minutes of real wait for no stronger a proof).
      The six controlled interactions do sum past that rounding threshold, so the Progress screen's
      aggregate "This week" figure is asserted as a genuine visible non-zero number too, matching
      `totalMinutes` run over the real stored rows. Visual pass (Progress screen, the only one whose
      rendering changed — the `'warmup'` row is gone): both widths, both themes, console clean.
- [x] 5.15 `core/progress`: found already correct, not a code defect — `currentStreakDays`/
      `longestStreakDays` never read `PracticeEntry.kind` at all, and `useDashboard.ts` already passed
      the full, unfiltered `practiceEntries` through (confirmed by `useDashboard.test.ts`'s own fixture,
      which already mixed technique/sightreading/repertoire/theory/warmup days). The review's finding
      was real in EFFECT — the streak only ever moved because repertoire was the one screen that logged
      anything (5.14) — but not in the streak function itself. Closed the actual gap: no browser-driven
      proof existed (the 4.7b pattern this project holds itself to — "a screen re-deriving a plausible
      number cannot pass" cuts the other way too: code proven only by inspection cannot pass either).
      *Proof: `log.test.ts` gained an explicit eartraining-only-day case plus an all-`ACTIVITY_KINDS`
      property test; `e2e/streak-any-activity.spec.ts` seeds IndexedDB directly with a
      technique+eartraining two-day streak (no repertoire at all), reads "2 day(s)" off the live
      dashboard, then removes the earlier day and reads "1 day(s)" — the gap breaking it. Console clean.*
- [x] 5.16 `app/dashboard`: the Progress screen prints raw category keys — `warmup / technique /
      sightreading / repertoire / lesson / theory / eartraining`. Give them display names, from one
      mapping that a new category cannot silently bypass.
      *Proof: the screen shows "Sight reading", not `sightreading`, and a type-level exhaustiveness
      check fails the build if a `PracticeCategory` is added without a display name.*

### Practice screen usability — **3/10 → 9**

30 controls in 13 labelled groups across ~5100px of scroll, nothing collapsed, nothing marked "start
here". *Tempo ramp*, *Read ahead*, *Assessment* and the annotation editors sit at the same visual
weight as Play. The app already tracks a per-track level and does not use it to decide what to show —
except for the analysis panel, correctly gated to theory level 4+ (3.18). That pattern should be the
rule, not the exception.

- [x] 5.17 `app/practice`: progressive disclosure gated by the `playing` track's level. A level-1
      learner sees transport, tempo, hands, metronome, loop range and record — everything the screen
      showed before this task. Curriculum content (`curriculum.ts`) never names "wait mode" or
      "assessment" against a level number (it is lesson prose, not a skills-per-level table), so the
      two thresholds are a judgement call, documented in `PracticeScreen.tsx`'s own comment: wait mode
      unlocks at level 2 (REQ-3.3.3 ties it to hands-together, level 1's own last unit); Assessment,
      tempo ramp, Read ahead and the annotation panel unlock at level 3, behind a collapsed "More
      tools" `<details>` (the 5.12/3.18a convention) that is entirely ABSENT below the gate, not
      merely closed. "Manual override for the learner who wants everything" is the dashboard's own
      existing per-track level override (2.36/4.3) — no second toggle was added. Each gate also stays
      open once its own feature is already active (wait mode/read-ahead/the ramp/a running assessment),
      so a dashboard override dropping the level mid-session can never strand a control the learner has
      no way left to turn off.
      *Proof: `PracticeScreen.test.tsx`'s new "progressive disclosure" describe block — level 1 hides
      both tiers (ABSENT, via `queryBy`, not collapsed), level 2 reveals wait mode only, level 3 reveals
      "More tools" (closed by default), the hydration race shows neither at a qualifying level while
      unsettled, and an active Read ahead survives a level drop. Driven in the real app: seeded
      `playing: 3` into IndexedDB, confirmed via the accessibility tree that Wait mode and a collapsed
      More tools (Tempo ramp, Read ahead, Assessment, Fingering, Highlight, Measure note) appear, and
      confirmed via `scripts/visual-pass.mjs` that level 1 and level 3 are each console-clean at both
      widths/themes. Eight e2e specs that drove the now-gated controls directly (`waitmode`,
      `practice-onscreen-keyboard`, `assessment`, `assessment-locked`, `dashboard-assessment`,
      `read-ahead`, `notehead-select`, `round6`'s measure-note test) updated to seed a qualifying level
      first — real regressions this task would otherwise have introduced into the existing suite, all
      now green.*
- [x] 5.18 `app/practice`: give the remaining controls a hierarchy — primary transport pinned, related
      groups collapsed into sections rather than one flat column. Loop range, hand mute, metronome,
      wait mode and record/replay (5.17's ungated level-1 groups) move into one new collapsible
      "Practice setup" `<details>`, styled like "More tools" (previously unstyled) via new rules in
      `feature-practice-sections.css`. Defaults OPEN unlike "More tools" (5.17 promises these with no
      extra click, and nine e2e specs outside this boundary reach them directly — all re-run green,
      untouched); still real and closable, which the proof exercises.
      *Proof: Playwright, 1280px, level 3, the real bundled piece — 6 controls visible without
      scrolling (≤10), 874.5px practice column with both closed (<2000px), Play visible after
      scrolling 2000px (1.21 holds). `visual-pass.mjs` clean both widths/themes; 270 `vitest` green.*

### Rhythm drill — **2/10 → 9**

A complexity-1 drill renders `Bar 1: half, half / Bar 2: whole / Bar 3: whole rest / Bar 4: half rest,
half`. No notation. This is the identical defect 2.20 fixed for sight reading and never applied here —
it trains reading the word "half". Two further problems in that same screenshot: the lowest complexity
opens on whole and half **rests** (Faber puts the quarter rest last, at unit 10), and "complexity 1 =
whole and half notes" inverts the order Faber and Alfred agree on, **quarter → half → whole**.

- [x] 5.19 `app/rhythm`: engrave the pattern — reused `rhythmToScore` (already built for silent
      transport playback) and `@app/sightreading/ExerciseScore.tsx` (already reused by Technique)
      instead of a third MusicXML-writer wiring. Deleted `PatternPreview.tsx`'s text stand-in
      ("Bar 1: half, half…"), the same precedent 2.20 set deleting `NoteListPreview`.
      *Proof: `e2e/rhythm.spec.ts` — a real OSMD svg (83 elements, past the 50-element discriminator),
      no "half"/"whole" text, `[data-note-id]` count equals matched+missed. Driven live, both themes/
      widths, console clean.*
- [x] 5.20 `core/generator/rhythm`: reorder complexity — level 1 is quarters and halves with **no rests**;
      rests enter after note values are secure, quarter rest first. Gave complexity 1 a `QUARTER`
      floor (was `HALF`) plus a new `HALF` ceiling (`mergePulses`'s optional-merge pass otherwise
      folds a whole bar into one whole note), and made `REST_PROBABILITY` complexity-keyed (0 at
      complexity 1, unchanged 0.25 elsewhere) instead of one flat constant — complexity 2 inherits
      `QUARTER` as its existing floor, so it is automatically also the first complexity whose rests
      can't be shorter than a quarter, with no second table to keep in sync.
      *Proof: `rhythm.test.ts` — 500-run property confirms zero rests and quarter-to-half-only notes
      at complexity 1, plus two mutant checks (broken floor, broken ceiling) and two complexity-2
      rest-ordering tests. Browser: `visual-pass.mjs Rhythm --click Start` on real generated content
      reads "Bar 1: quarter, quarter, half" / "Bar 2: quarter, quarter, quarter, quarter" / etc. —
      quarters and halves only, no rests, no wholes. `e2e/rhythm.spec.ts` updated for the new
      quarter-note grid (was hardcoded to the old half-note-only assumption) and passes against the
      real dev server. Console clean, `npm run verify` green.*
- [ ] 5.21 Rhythm also needs **3.21** (clap/tap-back — the Rhythm screen shows the pattern for the
      whole run and silences the audio deliberately, so it is rhythm *sight-reading*; "hear a phrase
      and clap it back" has never been built). Referenced, not restated.

### Technique — **5/10 → 9**

The content is right and was verified note by note: pentascales before scales before two-octave
hands-together, and the fingerings are exactly standard including B♭ major, descending included. The
presentation destroys it — that fingering is rendered as **58 numbers on one line with both hands
interleaved and unlabelled**. Fingering numbers belong above the noteheads, which is where every
printed edition puts them and which OSMD renders natively.

- [x] 5.22 `app/technique` + `core/notation`: put fingering numbers on the staff, above their own
      noteheads, per hand. Deleted the interleaved string. The gap was the writer, not OSMD or the
      adapter: `ScoreNote.fingering` was already correct end to end (`techniqueScore` →
      `makeScore`), and OSMD's `RenderFingerings`/`FingeringPositionFromXML` default to exactly what
      this needed — `writeMusicXml` (`musicxmlwriter.ts`) just never emitted the
      `<technical><fingering>` notation. Now writes it with an explicit `placement` (`above` for the
      right hand, `below` for the left), so OSMD's own above/below heuristic is never in play.
      *Proof: `e2e/technique-fingering.spec.ts` drives the real C major two-octave drill, reads the
      first 8 right-hand fingering glyphs off the rendered SVG (not the model) matched to their OWN
      notehead by nearest x, and asserts each reads `1 2 3 1 2 3 4 1`, is horizontally centred on
      that notehead (±4px) and sits above it; the left hand gets the same per-note check, below.
      Visual pass both widths/themes, console clean, screenshotted.*
- [x] 5.23 `app/technique`: say what MIDI cannot see. Wrist height and collapse, forearm alignment,
      finger curl, *which* finger was actually used, shoulder tension, bench height, posture — the
      Taubman/Golandsky literature names dropped wrists and isolated finger motion as direct causes of
      tendonitis. A clean tempo history implies technical validation the app cannot perform. Say so
      once on the screen, and prompt periodically for a human check.
      *Proof: the statement is on the Technique screen (asserted by an e2e reading it, so it cannot be
      deleted silently), and a periodic posture prompt fires on a schedule driven by the injected
      `Clock`, never real time.*
      Done: a standing statement (`technique-safety-statement`) sits directly under the "Technique"
      heading, always rendered, not behind a disclosure — `e2e/technique-safety.spec.ts` reads it off
      the running app. The posture prompt's schedule (`src/app/technique/posturePromptSchedule.ts`) is
      pure, has no React/Clock/`Date.now()` dependency of its own, and fires once EITHER 10 minutes of
      cumulative drill-running time OR 6 completed attempts (clean or not) have passed since the last
      acknowledgement — argued in the module's own comment: static-tension injury builds with time,
      isolated-finger-motion injury builds with reps, and a short fixed-interval timer (rejected) trains
      the learner to dismiss it by reflex. 8 property tests (`posturePromptSchedule.test.ts`) plus 4
      `useTechniqueDrill.test.ts` cases prove both triggers fire from a `FakeClock` alone, never real
      time; `e2e/technique-posture-prompt.spec.ts` drives 6 real on-screen-keyboard attempts in a
      browser to the prompt-visible state and back. Visual pass (dark/light × 1280/1024, plus the
      prompt-visible state at 1280) console-clean in every configuration; screenshots reviewed by hand.
      Deleted nothing.

### Accessibility — **7/10 → 9** · visual design system — **8/10 → 9**

Contrast was measured live from the CSSOM and every pair passes AA; the one that fails is commented as
deliberately decorative. One real defect: `colors.css` states the rule in its own comment — *"Color is
NEVER the only signal"* — `domain.css` implements `.note-missed { stroke-dasharray: 2 2 }`, and
**nothing ever applies those classes**. `osmdEngraver` writes `NoteheadColor`/`StemColor` only, from
three hardcoded hexes duplicated out of the token file (`useNoteFeedback.ts:136-138`). So correct
(#1c7c3c) vs wrong (#c22f2c) is distinguished **by hue alone** — the worst pair for red-green CVD.

- [ ] 5.24 `adapters/osmd`: apply `.note-correct` / `.note-wrong` / `.note-missed` to the rendered
      noteheads so shape carries the signal, and read the three colours from the design tokens instead
      of the duplicated hexes. The CSS is already written; it just needs to be reached. Must not
      regress 2.32's fast path (`GraphicalNote.setColor` without re-render) or the resize-safety of
      the model-property writes.
      *Proof: e2e — after a wrong note, the SVG element carries `class="note-wrong"` AND the dashed
      stroke computes non-empty under a simulated greyscale (assert `stroke-dasharray`, not colour);
      `perf-large-score.spec.ts` still records zero long tasks.*
- [x] 5.25 `app`: `OnScreenKeyboard` keys were labelled `"Key 48"`, `"Key 49"` — MIDI numbers read out
      loud. The default (sharp) spelling from `core/theory/pitch.ts`'s `midiToName` now backs the
      `aria-label`; the key stays visually unlabelled (a real piano prints nothing either, and the
      module doc's whole point is that a flashcard printing the answer would test nothing). Nine
      consumers across four unit-test files and four e2e specs asserted the old `"Key N"` string —
      `e2e/qwerty-note-input.spec.ts` derived the lowest playable MIDI note by PARSING that string, so
      it gained the inverse of `midiToName` (sharps-only, matching the default) rather than reading a
      number off the label.
      *Proof: `OnScreenKeyboard.test.tsx`'s new case reads the middle-C key's accessible name as "C4"
      through Testing Library's role query (which resolves the real accname algorithm, not
      `textContent`); confirmed live — `document.querySelector('[aria-label="C4"]')` finds the key.
      All four rewritten e2e specs pass unchanged in behaviour. Console clean, no visual change (the
      change is accessibility-tree only).*
- [x] 5.26 `app/flashcards`: clef glyphs are Unicode `U+1D11E`/`U+1D122` rendered in `system-ui` with
      no bundled music font, so they depend entirely on OS font fallback. Bundled Bravura (SIL OFL
      1.1) — `src/design-system/fonts/bravura/Bravura.woff2`, 323,528 bytes, fetched from the official
      `steinbergmedia/bravura` GitHub release (`bravura-1.481`) since neither `opensheetmusicdisplay`
      nor `vexflow` ship an actual font file in `node_modules` (only the string "Bravura" as a
      fallback name, plus their own JS glyph-path data for canvas engraving). Verified with `fontTools`
      that plain `Bravura` (not `BravuraText`) already covers every codepoint this app uses as text —
      no SMuFL remapping needed. Not subset (would need a new build-time dependency, out of this
      task's scope); shipped unsubsetted, size stated above. `feature-music-font.css` declares the
      `@font-face` and a `.music-glyph` class; `StaffNote.tsx`'s clef and accidental `<text>` nodes
      (the only glyph-as-text usages in the file this task owns) now carry it. Found 2 more instances
      of the same defect outside this task's owned files — `KeySignatureAnswerPad.tsx` and
      `NoteNameAnswerPad.tsx` also render `♯`/`♭`/`\u{1D12A}`/`\u{1D12B}` as plain button-label text —
      reported, not fixed (out of scope: `src/app/drills/**` other than `StaffNote.tsx` was explicitly
      not owned by this session).
      *Proof: self-hosted confirmed live — the running app fires a real network request for
      `http://localhost:5307/src/design-system/fonts/bravura/Bravura.woff2` (same origin as the page,
      captured via Playwright's request log), never a third-party host. `e2e/music-font.spec.ts` drives
      the actual Flashcards screen (no fixture), confirms `document.fonts.check('34px Bravura')` is
      true, reads the real clef glyph's live `getBBox()` (width 24px, height 137px — non-zero on both
      axes) and compares it against a control element rendered with the pre-fix `system-ui` fallback
      stack in the same fontless Chromium (18px × 46px) — bundled rendered area is ~3.7x the control's,
      proving the font swap changed what actually painted, not merely that `font-family` was declared.
      Visual pass (`visual-pass.mjs Flashcards`, both widths, both themes) shows a correctly engraved
      treble/bass clef seated on the staff lines with the right baseline, console clean in all four.*
- [ ] 5.27 `app`: confirm the ≤1024px responsive drawer **by hand in a real browser at tablet width**.
      The review could not verify it — the automation pane does not composite frames, so the nav's
      `translateX(-100%)` transition sits frozen at t=0. That is an environment artefact, not a defect,
      and it is the one claim in the review that is unchecked. Folds into **B.6**.
      *Proof: at 768×1024, the drawer opens and closes on tap, the scrim dismisses it, no control is
      under 44px, and the page does not scroll horizontally — screenshotted, not asserted from CSS.*

### Ear training — **4/10 → 9**

Level 1 plays an interval **cold** and offers four buttons. Both exam boards do the opposite,
explicitly: RCM states the key and plays the tonic triad first; ABRSM plays the key-chord and the
tonic and counts in two bars — **at Grade 1**. Karpinski: tonic inference is the first and most
fundamental process a listener carries out. ABRSM's aural tests contain **no interval-identification
test at any grade**. Feedback is "Correct" — a learner who guesses right learns exactly as much as one
who guesses wrong.

- [x] 5.28 `app/eartraining` + `core/eartraining`: a tonic+fifth drone plays before every item that has
      a real tonic to anchor on — the item's own root/lower note for interval/chord/scale items, the
      generated `Key`'s tonic for melodic dictation; rhythmic dictation gets none (rhythm has no scale,
      `dictation.ts`'s own doc). A screen-local checkbox ("Play tonal context before each item",
      defaulted on) is the context-free override. Driven in the browser: interval and melodic-dictation
      drills play, grade and toggle correctly; console clean both widths/themes. Full history: git log.
      *Proof: the recorded `AudioOutput` calls carry the key chord's pitches at the right timestamps
      BEFORE the item's first note (the 3.13 pattern — assert the calls, not the projection), and the
      drill still grades the same answers.*
- [ ] 5.29 `app/eartraining`: reveal the answer. Replay with the answer named, the pitches shown on a
      staff and on the keyboard, and a reference tune for the interval.
      *Proof: after a wrong answer the screen names the two pitches (not just "perfect fifth"),
      renders them, and replays on request — asserted through the DOM and the audio calls.*
- [ ] 5.30 `core/eartraining/intervals`: stage the interval set by level rather than offering m3, M3,
      P5 and P8 all at level 1. RCM introduces m3/M3 at Level 1, P5 at 2, P4 at 3, and the octave only
      at 4. (Sources genuinely disagree on ordering — Trinity introduces 2nd–6th together, Musical U
      argues 2nds first — so pick RCM and say in the code comment that it is a choice among defensible
      orderings, not the only one.)
      *Proof: a test asserts the level-1 answer set is exactly {m3, M3} and that each later level adds
      rather than replaces; the on-screen answer pad matches the level's set.*
- [ ] 5.31 `app`: the SRS panel exposes Anki's internal vocabulary to a piano beginner — *Cards / Due /
      Young / Mature / Average ease 2.50* — on Ear training, Flashcards and Theory. Nobody learning
      piano knows what a mature card is. Replace with learner-facing language; keep the raw numbers
      behind a details toggle if they are wanted for debugging.
      *Proof: none of "Young", "Mature" or "ease" appears in the default view of any of the three
      screens; the underlying scheduler is untouched (its tests unchanged and still green).*
- [ ] 5.32 `app/eartraining`: say on screen that the app cannot hear you sing. Vocal reproduction is
      the response modality in ABRSM Grade 1 aural, Kodály, Dalcroze and Berklee; a multiple-choice
      button is recognition, not internalisation — you can click an answer you cannot imagine. There
      is no mic path until 5.7/B.1, so this is structural and should be *stated*, not hidden. (RCM is
      the partial exception: it accepts keyboard playback as an equivalent response, so a
      MIDI-answered drill is not unprecedented — say that too.)
      *Proof: the statement is on the screen and asserted by a test, and it names the singing practice
      the learner should do away from the app.*
- [ ] 5.33 Copy bug: *"Not quite — it was perfect fifth, ascending"* is missing an article.
      *Proof: the string reads "it was a perfect fifth"; a test covers the article for a vowel-initial
      interval name too ("an augmented fourth").*
- [ ] 5.34 Ear training also depends on **3.23** (dictation has no tempo reference — a phrase replayed
      8% slow grades incorrect in 416 of 900 measured cases) and **3.26** (`EarAttempt.correct` is a
      boolean, so dictation's already-computed `pitchAccuracy`/`rhythmAccuracy` are thrown away at the
      attempt boundary). Dictation's 2–8 note bound is *correct* and worth keeping — RCM runs 3 notes
      at Preparatory A to 9 at Level 6 — the refinement is scaling that bound with level rather than
      using one window for everything.
      *Proof: level 1 dictation prompts are 2–3 notes and level 5 prompts are 7–8, asserted over 200
      generated items per level.*

### Theory reference — **6/10 → 9**

Verified correct: both rings of the circle of fifths including every enharmonic pairing, C major
fingering, mode-aware degree names (C Dorian correctly shows *subtonic* B♭), diatonic triads. The gaps
are half-finished features, and one of them is a real teaching blocker: **minor scales show `—` in
both fingering columns**, and minor scales are required from RCM Preparatory B onward.

- [x] 5.35 `core/theory`: shipped **minor** scale fingerings as a lookup table (`MINOR_FINGERINGS`,
      shared by natural/harmonic; `MELODIC_MINOR_RIGHT_HANDS` overrides exactly C♯/F♯ minor's right
      hand) — narrower and safer than 3.16's reverted full 16-type derivation. Adversarial re-review
      confirmed every row against relative-major rotation and found one real defect one layer down:
      `technique/library.ts`'s multi-octave descent reused natural minor's OWN fingering rather than
      the ascent's, repeating a finger at the top in exactly C♯/F♯ melodic minor (latent — no shipped
      drill reached it); fixed to mirror the ascent's fingers, pitches unchanged. 3.16's four
      properties hold over all 12 tonics × 3 forms × both hands (exhaustive, not sampled), plus a
      score-level property test over every shipped scale drill. Driven in the browser: A harmonic
      minor reads RH 1 2 3 1 2 3 4 5 / LH 5 4 3 2 1 3 2 1 (leading tone never a thumb), Db melodic
      minor reads the C♯ exception, Ab natural minor reads its forced two-white-key fingering —
      real numbers where the reference showed `—`. Full history: git log.
- [x] 5.36 `app/theory`: **Major** and **Ionian** are separate dropdown entries, as are **Natural
      minor** and **Aeolian**. They are the same scales, and a beginner reads two entries as two
      things. Merge, with the alternative name shown as a subtitle.
      *Proof: `#reference-scale-select` now has 14 options, not 16 — no separate "Ionian" or
      "Aeolian" row (`SCALE_TYPE_OPTIONS` filters them out of the local `SCALE_TYPE_LABEL` map,
      the picker's own source of truth; `scales.ts`'s core `TYPE_NAMES` — which feeds the
      `scaleName()` header, a different concern — is untouched and unowned this round). Selecting
      "Major" or "Natural minor" shows a `<small>` subtitle under the picker ("Also known as
      Ionian"/"Aeolian"); every other scale type shows none. A `scaleType` prop of literally
      `'ionian'`/`'aeolian'` (the type still carries both, unedited) still lands the picker on its
      merged option rather than showing nothing selected. 5 new tests in
      `ChordScaleReference.test.tsx`. Driven live at `http://localhost:5302`:
      `node scripts/visual-pass.mjs Theory --url http://localhost:5302 --select
      "#reference-scale-select=Major"` and `...=Natural minor`, both widths, both themes, console
      clean, subtitle visible in every shot.*
- [x] 5.37 `—` for the modes is defensible and should be *labelled*, not filled. RCM's 2022 technical
      requirements chart returns **zero hits** for dorian/phrygian/lydian/mixolydian/aeolian/locrian/
      whole-tone/blues/pentatonic at any level; modes appear only in ABRSM's Jazz syllabus. Replaced the
      bare `—` with "no standard fingering — modes are not in the graded syllabi" for exactly those
      11 types (`NO_STANDARD_FINGERING_TYPES`, `core/theory/scales.ts`) — deliberately EXCLUDING the
      three minor forms, which still read a bare dash: they lack a table today too, but they ARE in
      the graded syllabi (RCM Preparatory B on), so the sentence would be false for them. That gap is
      5.35's, not this one's.
      *Proof: the Dorian row reads that sentence rather than a dash (both fingering cells merged into
      one, roadmap-`ChordScaleReference.test.tsx`), a natural-minor row still reads a bare dash
      unchanged, and 3.16 is re-scoped in the same commit to say the mode half is deliberately not
      shipped. Driven live: Theory reference, Dorian selected, sentence visible; console clean.*
- [ ] 5.38 The rest of this aspect is **3.14** (no staff rendering in the theory layer — `osmdEngraver`
      is never imported there), **3.15** (no chord picker, no sevenths, and the chord section vanishes
      entirely for the 10 modal/exotic types) and **3.17** (reference is a destination you leave your
      place for). Referenced, not restated; the aspect cannot reach 9 without them, because "you
      cannot look up D♭ diminished seventh" is what a reference is *for*.

### First-run experience — **2/10 → 9**

The app opens on Practice (`Shell.tsx:185`) showing Twinkle, with 30 controls below it. There is no
onboarding, no first-run state, and no "start here". The front door is the most intimidating screen in
the app.

- [ ] 5.39 `app/shell`: the default destination is **Today**, not Practice.
      *Proof: a cold boot with an empty IndexedDB lands on Today; asserted in e2e against a fresh
      profile, not a warm one.*
- [ ] 5.40 `app/onboarding`: a first-run flow — a few questions (experience, goal, practice minutes), a
      MIDI/input check that tells the truth about this browser (5.6), starting track levels set from
      the answers, and a first session ready to start. Skippable, and re-runnable from settings.
      *Proof: e2e from an empty IndexedDB — complete onboarding, assert the chosen levels are what the
      dashboard shows after a reload, and that Today's plan is non-empty and matches the chosen
      minutes.*
- [ ] 5.41 `app`: honest first-run empty states on every screen that can be reached with no data —
      what this screen is for, and the one action that starts it. Today's dashboard renders zeros
      correctly (proved in 4.7); the other screens were not checked for this.
      *Proof: each of the 12 destinations, visited with an empty store, renders a named starting
      action; asserted by one e2e that walks all 12 rather than 12 specs.*

### Information architecture — **3/10 → 9**

12 flat nav buttons with no grouping. Navigation is `useState`, not routing: the URL never changes,
there are no deep links, a refresh returns you to Practice, and **the browser Back button exits the
app**.

- [ ] 5.42 `app/shell`: real routing — a URL per destination, deep links into a lesson/piece/drill,
      Back and Forward doing what they say, and a refresh returning you where you were. This also
      makes every future e2e able to start where it means to instead of clicking through.
      *Proof: e2e — navigate Practice → Lessons → a named lesson, assert the URL changed at each step,
      press browser Back twice and land back on Practice with the same score loaded, then reload the
      lesson URL directly and get that lesson.*
- [ ] 5.43 `app/shell`: group the nav — Practice / Learn / Drills / Progress — so a learner can see
      that Flashcards, Ear training, Rhythm, Technique and Theory are all drills, and that Today is the
      entry point. 12 equal buttons hide the structure the app already has.
      *Proof: the nav renders labelled groups with correct landmark roles, Today is visually primary,
      and the keyboard tab order follows the visual order.*

### Curriculum & session planning — **6/10 → 9**

The lesson sequence is sound and matches Faber's order, including the deliberate choice to put reading
after keyboard geography and rhythm. The planner's 15/30/60 presets are a defensible synthesis (no
source gives an evidence-based split — these are conventions, and worth saying so). What is missing is
that **the plan doesn't run**: each item is an "Open" button that navigates away, with no timer, no
next item, no completion state, no sense of being 3 of 5 through today.

- [ ] 5.44 `app/session`: make the plan runnable — a timer per segment driven by the injected `Clock`,
      an explicit next-item step, completion state per item, and a visible "3 of 5". The plan is
      currently a list of links to elsewhere.
      *Proof: e2e — start a 15-minute plan, complete two items, reload, and assert the session resumes
      at item 3 with the first two marked done and their minutes in the `practiceLog` (5.14).*
- [ ] 5.45 `core/curriculum/session` + `content`: add the **warm-up** segment. Every source puts
      warm-up first, and Juilliard's guide starts it *away from the keys* — jaw, shoulders, posture,
      stretch — before any note. The app declares a `warmup` category, schedules nothing into it and
      writes it never (5.14).
      *Proof: `planSession` emits a warm-up segment at every budget, it is first, it opens something
      real, and completing it writes a `warmup` row the Progress screen shows non-zero.*
- [x] 5.46 `content/curriculum`: recalibrated level 1's playing exit criterion (`l1-exit-assessment`)
      off the hands-together `demo-lh-root-rh-melody-simple-piece` and onto the hands-separate
      `demo-five-finger-c-major-hands-separately` (RH bars 1-3, LH bars 4-6, genuinely hands-alone).
      `l2-exit-assessment` was already, deliberately, the hands-together gate (own pre-existing
      comment says so). Faber and Alfred both spend book 1 on hands-alone playing, introducing real
      hands-together only in book 2 — level 1 was demanding a skill neither method teaches yet.
      *Proof: `curriculum.test.ts` unchanged and green; the two dashboard tests seeding a level-1
      assessment updated to the new piece id, same met/unmet split.*
- [x] 5.47 `app/progress`: a teacher/parent output — a printable practice sheet or assignment view.
      Export is JSON/CSV of raw logs, which is a backup format, not something anyone reads.
      *Proof: a week's practice renders as a printable summary (categories, minutes, pieces, what was
      assessed) and prints to one page in a browser.* DONE: `PracticeSheet` (`src/app/progress/`),
      toggled from the Progress screen, reduces `useProgressStore` (via `usePracticeSheet`) into
      by-category minutes/sessions, per-item sessions/minutes/last-practiced, and any repertoire
      assessments in the trailing 7 days, with an honest "no practice recorded" empty state and an
      explicit caveat on what the accuracy % does/does not cover (pitch+timing only, no tone,
      posture). `e2e/practice-sheet-print.spec.ts` seeds a genuine week into IndexedDB, reloads,
      asserts the real numbers on screen, then measures the printed PDF's own page count via
      `page.pdf()` — exactly 1 page for both a populated and an empty week.

### Overall honesty — **the review's #14**

- [x] 5.48 `app` + `docs`: say once, visibly, what the app does not assess. `matcher.ts` judges
      **onsets only** — its own comment says `durationTicks` is never read, so a note released early
      or held over still counts as written. That is exactly the hole reviewers name in Skoove and
      Yousician, and the app currently implies otherwise by reporting a bare accuracy percentage.
      Combined with 5.23's technique blind spot: supplement, not replacement, stated on screen.
      Re-verified onsets-only against `matcher.ts` first — its comment still says it plainly. A
      closed-by-default `<details>` sits under the sticky strip, above the score, not buried in
      5.18's disclosures. REQ-3.3.2 in `requirements.md` states it too.
      *Proof: one click from Practice; `e2e/practice-accuracy-caveat.spec.ts` (new) drives the click
      and asserts the revealed text; matching `PracticeScreen.test.tsx` block; REQ-3.3.2 records it.*
- [ ] 5.49 M5 acceptance pass — re-run the 2026-08-06 review's method (drive all 12 destinations as a
      beginner, measure contrast from the live CSSOM, verify pedagogy claims against the same primary
      sources) and re-score all 17 aspects. Any aspect still under 9 gets its own task here rather
      than a softened score.
      *Proof: a dated review doc alongside the first one, with the score table and a per-aspect diff
      against 2026-08-06.*

## Backlog / optional

- [ ] B.1 Microphone pitch-detection fallback (REQ-3.3.7, optional). **Promoted in importance by
      B.6's finding:** this is the ONLY way the practice loop works on an iPad at all, because
      WebKit ships no Web MIDI (see B.6). On iPadOS it is not a fallback, it is the input.
- [ ] B.2 Bluetooth MIDI (REQ-3.3.1, if feasible)
- [ ] B.3 Falling-note piano-roll view (REQ-3.2.4 optional half)
- [ ] B.4 Light gamification: streaks, milestones (REQ-3.10.3)
- [ ] B.5 Audio recording alongside MIDI recording (REQ-3.9.2 optional)
- [ ] B.6 `app`: make the UI usable on a tablet (REQ-4.4 names "a laptop/tablet" as where practice
      happens, so this is in scope, not a new ambition). Measured in a real browser at 768x1024 on
      2026-08-06, against the running app:
      * **All 62 controls are below Apple's 44px minimum touch target.** Nav buttons are 192x34 —
        survivable. The on-screen piano keys are **16x6 px**, which no finger can hit.
      * `src/styles.css` is 133 lines with **zero `@media` queries**. Nothing breaks and the page
        does not scroll horizontally (scrollWidth === clientWidth === 753), but it is the desktop
        layout squeezed, with the nav still holding a 192px column.
      * Taps do register — `OnScreenKeyboard` uses `onClick`, which browsers synthesise from
        touch — so this is sizing and layout work, not an input-plumbing rewrite. There is no
        `PointerEvent`/`onTouchStart` handling anywhere if finer control is ever wanted.
      Scope: a breakpoint that collapses the nav, touch targets at 44px or more, and an on-screen
      keyboard sized for fingers (it is the primary input wherever MIDI is unavailable, which is
      exactly the tablet case).
      *Proof: at 768x1024 and 1024x1366, no control is under 44px, the page does not scroll
      horizontally, and a tapped on-screen key grades an answer — driven in a browser, not asserted
      from CSS.*
- [ ] B.7 `docs`: state the platform reality in `requirements.md` or `ARCHITECTURE.md` — **Web MIDI
      does not exist on iPadOS or iOS in any browser**, because every iOS browser is WebKit
      underneath. `createWebMidi` already degrades honestly (`webmidi.ts:38` returns
      `err('Web MIDI API is not available in this browser.')`) and the app stays usable without a
      keyboard, but that removes sight-reading assessment, technique evenness, keyboard-answered
      theory drills and dictation — i.e. most of what the app is for. An Android tablet with
      Chrome has working Web MIDI and is a real target; an iPad is a viewer until B.1 lands.
      REQ-4.4 currently implies any tablet is fine, which is not true.
      *Proof: the doc names the constraint, and B.1/B.6 reference it instead of rediscovering it.*

---

## Session notes

Full session-by-session history: docs/roadmap-archive-2026-08-08.md and git log. Append new entries here as sessions land.
