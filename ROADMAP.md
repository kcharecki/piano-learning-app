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
- [x] 1.21 UX: the transport controls sit below a long scrolling score, so they are off-screen while
      reading. Make the control strip sticky, or put it above the score.
      *Proved in the browser: scrolled 272px down the sample score, `.practice-controls` stays
      pinned at viewport top 0 (`position: sticky`) with the Play button fully visible.*
- [x] 1.22 `core/practice/matcher`: add a way to start matching from a tick other than the first note.
      Looping a sub-range currently reports every note before the loop start as `missed` in one batch
      on the wrap, because `reset()` always rewinds to the first expected note.
      *Proved by a driven e2e (`e2e/smoke.spec.ts`) looping bars 3–4 through two wraps: missed
      stays below 4 right after each wrap. Reverting the one-line wiring makes it report 13.*
- [x] 1.23 `app`: nothing constructs the IndexedDB store, so 1.16 is production-unreachable —
      `knip:prod` fails on it. Persist the loaded score and the practice settings through the
      `Store` port and restore them on start.
      *Proved in the browser: set 75% tempo, right hand only and looping, reloaded the page — all
      three came back from the `piano-learning-app` IndexedDB database. `knip:prod` is clean.*

## Phase 2 — Milestone M2: feedback & reading

Everything below through 2.12 was built by the session that died before committing; this session
recovered it commit by commit and recorded the evidence each box was ticked on.

- [x] 2.1 `core/practice/assessment`: fixed-tempo run, accuracy %, timing consistency, per-measure (REQ-3.3.4)
- [x] 2.2 `core/practice/review`: worst-measure detection → suggested loops (REQ-3.3.5)
- [x] 2.3 ‖ `core/generator/melody`: parameterised sight-reading generation (key, range, rhythm, hands, accidentals) (REQ-3.4.2)
      *Proved by e2e: the sight-reading screen generates, plays and grades a full level-1 exercise.*
- [x] 2.4 ‖ `core/generator/rhythm`: rhythm-only patterns for tapping drills — core only; wired by 2.13
- [x] 2.5 `core/sightreading/session`: preview timer, no-stopping rule, retirement pool (REQ-3.4.1/3/4)
      *Proved by e2e: preview countdown, "Begin now", the run cannot be stopped, then a grade.*
- [x] 2.6 `core/sightreading/adaptive`: difficulty adaptation to 80–90% accuracy band (REQ-3.4.6)
- [x] 2.7 `core/srs`: spaced repetition scheduler, deterministic, shared by all drill types (REQ-3.9.4)
- [x] 2.8 ‖ `core/drills/flashcards`: staff→key note naming, interval recognition on staff (REQ-3.4.5)
      *Proved by e2e: a computed, unlabelled staff prompt graded from an on-screen keyboard answer.*
- [x] 2.9 ‖ `core/progress/log`: practice session log, timer, what/how long/tempo/accuracy (REQ-3.9.5)
      — core only; wired by the 4.7 dashboard
- [x] 2.10 `core/practice/recorder`: MIDI capture, replay against score (REQ-3.9.2) — core only; wired by 2.14
- [x] 2.11 `app`: feedback overlay on score (correct/wrong/missed colouring), review overlay.
      *Proved by a driven e2e (`e2e/assessment.spec.ts`) with a fake Web MIDI keyboard
      (`e2e/fake-midi.ts`): imports a six-bar fixture, starts an assessment, plays measures 1–3
      correctly and 4–6 not at all, lets the transport run off the end, then asserts accuracy lands
      strictly between 0% and 100%, the review overlay names measures 3/4/5 and NOT measure 0, and
      the one-click "Practice measures 2–5" button sets the loop range control to 3..6 and checks
      Loop. Voiding the loop-reflection line in `LoopRangeControl` makes that last assertion fail
      while every earlier one still passes.*
      Two defects closed on the way: the loop range control never displayed a loop set from outside
      itself, and `useAssessment.start()` did not rewind the transport.
- [x] 2.11a `app/practice`: three findings from 2.11's review, all the same shape — a transport
      mutation that only reached the transport on the NEXT React commit, after `play()` had already
      run. `usePracticeEngine` now offers `rewindToTop()` and `playLoop(range)`, which mutate and
      play atomically on the transport instance, and `play()`/`playLoop()` return the instant the
      transport actually anchored tick 0 to, so callers stop guessing it.
      *Proved in `e2e/assessment.spec.ts`: after clicking the suggested loop, the position readout
      is sampled every 50ms for 2s and every sample lies within the looped bars. Replacing
      `playLoop(range)` with the old `play()` makes it fail with `Received: 1` — playback starting
      at measure 1 and walking to the loop end before wrapping, which is exactly the bug.*
- [x] 2.12 `app`: sight-reading trainer screen, flashcard drill screen
      *Proved by e2e: both reached through the shell's own nav, driven to a grade.*
- [x] 2.13 `app`: rhythm tapping drill screen — the only consumer `core/generator/rhythm` will ever
      have. The knip ignore is deleted.
      *Proved by `e2e/rhythm.spec.ts`: reaches the screen through the shell's own nav, starts a
      drill, taps the generated pattern deliberately imperfectly, and asserts `matched + missed`
      equals the pattern's real non-rest onset count with accuracy strictly between 0 and 1 — so
      neither a stub returning 0 nor one returning 1 can pass.*
- [x] 2.14 `app`: record & replay panel — the only consumer `core/practice/recorder` will ever have.
      The knip ignore is deleted.
      *Proved by `e2e/record-replay.spec.ts`: records a live take through the fake MIDI keyboard
      (3 correct, 1 deliberately missed), then replays it with NO further input and asserts the note
      feedback counters end at the same values. Those counters come from the same `NoteMatcher` that
      colours the notes, and both sides are asserted nonzero first, so "equal" cannot be satisfied by
      both being empty.*
      Two real defects found only by driving this in a browser, neither visible to the unit suite:
      the clear-on-stop effect wiped the counters the instant a take ended, and a frame that ran
      after `transport.stop()` had rewound the position reported tick 0, which `useNoteFeedback`
      read as a loop wrap and reset the matcher on. The second was latent before this task and was
      being masked by the first.
- [x] 2.15 M2 acceptance pass — audit done (three Opus reviewers, one per requirement group,
      REQ-3.3.x / REQ-3.4.x / REQ-3.9.x). Verdicts: 3.3.1 MET, 3.3.2 PARTIAL, 3.3.3 MET,
      3.3.4 PARTIAL, 3.3.5 PARTIAL, 3.3.6 PARTIAL, 3.4.1 PARTIAL, 3.4.2 MET, 3.4.3 NOT MET,
      3.4.4 MET, 3.4.5 PARTIAL (2 of 4 drills), 3.4.6 NOT MET, 3.9.1 PARTIAL, 3.9.2 PARTIAL,
      3.9.3 PARTIAL, 3.9.4 PARTIAL, 3.9.5 NOT MET.
      **M2 accepted with 2.16–2.19 landed** — those were the verdicts that were defects rather than
      unbuilt features, and all four are done and proved. 2.20–2.32 are unbuilt features and
      measured-but-unfixed risks; they are recorded, not blocking, and may be taken in Phase 3.
      Read them before starting Phase 3 — several are cheaper now than later.
      The dominant finding is one sentence: *nothing persists except the loaded score and the
      practice settings.* `src/core/ports/store.ts` declares `srsCards`, `sightReadingHistory`,
      `practiceLog`, `progress` and `recordings`; `persistence.ts:201` is the only `store.put` call
      in the entire app. Every one of those five is written by nothing.

### M2 blockers — must land before 2.15 can be ticked

- [x] 2.16 `app/practice`: measure numbers disagree between the review overlay and the loop control.
      `ReviewOverlay`/`AssessmentPanel`/`review.ts`'s `reason` prose printed raw 0-based indices
      while `LoopRangeControl` prints 1-based, so "Practice measures 2–5" set the loop boxes to 3
      and 6. A learner told to practise bar 2 practises bar 3. The 2.11 e2e had *encoded* the
      mismatch as expected behaviour.
      *Proved: `e2e/assessment.spec.ts` now asserts the button reads "Practice measures 3–6" and
      the loop-range inputs read 3 and 6. Core data stays 0-based — `ProblemMeasure.measureIndex`
      and `SuggestedLoop.startMeasure/endMeasure` are still what `measureRange` consumes; only
      human-facing text converts, at the render site and in `review.ts`'s `reason` prose.*
- [x] 2.17 `app/practice`: an assessment run is documented as fixed-tempo and its anchor arithmetic
      depends on it, but the tempo slider, loop, hand mute and wait mode all stay live during a run.
      Moving the tempo mid-run silently turns the reported timing consistency into fiction; setting
      a loop mid-run means the transport never plays off the end, so the run never finalises — and
      Pause/Stop are deliberately neutered, so the only escape is a page reload. Pause and Stop also
      render enabled while wired to no-op lambdas.
      *Proved by `e2e/assessment-locked.spec.ts`: tempo, loop range and Pause/Stop are all disabled
      mid-run and enabled again once it finishes. The no-op lambdas are gone — Pause and Stop are
      wired to the real handlers and simply disabled, so "cannot be stopped" is now visible rather
      than a silently swallowed click.*
- [x] 2.18 `app/state`: persist the sight-reading level + retirement history and the flashcard SRS
      cards through the `Store` port, into the already-declared, entirely unused
      `COLLECTIONS.sightReadingHistory` and `COLLECTIONS.srsCards`. Without this, REQ-3.4.3
      ("unrepeatable **by design**") and REQ-3.4.6 ("track sight-reading level") are simply not met:
      a refresh empties the retirement pool and drops the learner back to level 1.
      *Proved by `e2e/persistence.spec.ts`: answer a flashcard, reload, the SRS stats come back from
      IndexedDB. The roadmap-1.23 single-slice mechanism is now three independent slices sharing one
      validate-guard-apply helper and one last-write-wins write queue; persisted data is validated
      structurally on the way in and degrades to defaults rather than throwing.*
- [x] 2.19 `app/drills`: the flashcard drill schedules SRS cards against `createBrowserClock()`,
      i.e. `performance.now()` — milliseconds since page load — while `srs/scheduler.ts` computes
      `due = now + intervalDays * DAY_MS` treating `now` as epoch millis. Self-consistent within one
      page life, so it looks fine; fatal the moment 2.18 lands, because every persisted card would
      be due immediately forever. The drill needs the `DateSource` port, not `Clock`.
      *Proved by unit test: a card graded `good` is not due again after a simulated reload. The
      drill now takes a `DateSource` for scheduling; `Clock` is kept, but only for `elapsedMs` —
      how long the learner took to answer, which is legitimately session-relative and never
      compared across a reload.*

### M2 follow-ups — recorded, not blocking, may be taken in Phase 3

- [x] 2.19a `core/notation`: support `.mxl`, the compressed MusicXML format (REQ-3.2.5). Requested by
      the user. An `.mxl` is a ZIP whose `META-INF/container.xml` names the real MusicXML rootfile —
      it is what most publishers and MuseScore actually hand out, so "import MusicXML" is only half
      true without it. Unpack it and feed the existing `parseMusicXml`; because the result is real
      MusicXML text, it engraves in OSMD like any other `.musicxml`, unlike a MIDI import (2.20b).
      *Proved by `e2e/import-mxl.spec.ts`: zips a MusicXML fixture in memory, imports it through
      the real file input, asserts the heading becomes the archive's own score title (so the ZIP
      was opened and the right rootfile chosen, not the bundled sample still showing) and that the
      score container's OSMD `<svg>` renders. The `musicXml: undefined` mutant — the one that
      would leave a `.mxl` as blank as a MIDI import — unmounts `ScoreViewer` entirely and fails
      the `<svg>` assertion.*

- [x] 2.20 `core/notation`: a `Score` → MusicXML writer. **Two consumers, not one — this is the
      highest-value item in this list.**
      (a) Generated sight-reading exercises. `SightReadingScreen` renders `NoteListPreview`, a TEXT
      list reading "C4 (quarter), D4 (quarter)", in both the preview and the playing phase. That
      trains no staff decoding and hands the learner the answer in letters; the 30-second "scan the
      key, time and patterns" preview shows no key signature, no time signature and no bar lines.
      (b) **Every imported MIDI file.** Reported by the user: importing a `.mid` shows no notation
      at all. `parseMidiFile` handles them fine — a real 87-measure, 1258-note 6/8 file parsed with
      both hands split correctly — but `ImportPanel` sets `musicXml: undefined` for MIDI, and
      `PracticeScreen.tsx:255` only mounts the OSMD viewer when `musicXml` is defined. So MIDI
      import is playback-only, and REQ-3.2.5 ("import MusicXML **or** MIDI") is met for playing and
      not for reading. The on-screen explanation at `ScoreScreen.tsx:46` was not noticed next to a
      blank space where a score should be — whatever else happens, that message needs to be where
      the notation would have gone.
      The engraver already works in both cases; the only missing piece is an input.
      *Proved on both counts. (a) `e2e/smoke.spec.ts`'s sight-reading test asserts the Preview
      region holds an OSMD `<svg>` of more than 50 elements and that its text matches no note name.
      (b) `e2e/import-midi.spec.ts` builds a two-hand SMF byte by byte, imports it through the real
      file input and asserts the same. The writer itself round-trips through `parseMusicXml` for
      every fixture and for fast-check-generated scores, tempos included.*
- [ ] 2.20a `app/practice`: after Stop, the score highlight stays where playback stopped while the
      position readout has already rewound. It self-corrects on the next Play, so it is cosmetic —
      but the obvious fix does NOT work, and that is worth knowing before anyone tries it.
      Moving the cursor from `usePracticeEngine.stop()` was attempted and reverted: the only cursor
      ref that hook holds is `useNoteFeedback`'s intercepting one, and a backward cursor move is
      exactly what that hook reads as a loop wrap, so it resets the matcher and wipes the run's
      counters — deterministically failing `e2e/record-replay.spec.ts`. It is the same tension the
      2.14 clear-on-stop fix hit: `useNoteFeedback` cannot see `phase`, by design.
      A real fix needs the cursor moved through a path that bypasses the feedback interception (the
      raw `ScoreViewerHandle`, which only `PracticeScreen` has), or `useNoteFeedback` given an
      explicit "this jump was a seek, not a wrap" signal.
      *Proof: press Stop mid-piece, assert the highlight returns to the rewound position AND that
      `e2e/record-replay.spec.ts` still reports equal non-zero counters.*
- [x] 2.21 `app/practice`: batch `osmd.render()` to once per animation frame. `osmdEngraver.ts`
      calls a full re-engrave of the entire score synchronously inside `setNoteColor`, once per
      judged note, on the MIDI event's own task — a four-note chord is four full re-renders. Fine on
      the two-line bundled sample, and the one structural threat to REQ-3.3.6's 100ms visual budget
      on a real piece.
      *Done differently from the stated proof, and say so: colour mutations now accumulate and
      exactly one `render()` runs per animation frame, through an injectable scheduler. That is
      asserted directly in `osmdEngraver.test.ts` — N `setNoteColor` calls in one frame produce
      exactly one render, and the colour that lands is the last one written — which pins the
      behaviour the latency budget depends on without making the suite depend on a timing
      measurement taken on whatever machine happens to run it.*
- [x] 2.22 `app/score`: `osmdEngraver.ts` is the only file in `src/app/score/` with no test, is
      imported by no test, and no e2e ever asserts a notehead colour. Its id→OSMD-note mapping is a
      best-effort index zip that silently no-ops a whole measure on a count mismatch, all inside a
      `catch {}`. The note colouring REQ-3.3.2 requires is therefore unverified end to end.
      *Proved by `e2e/note-colour.spec.ts`: the wrong-note colour is asserted ABSENT from the score
      SVG, a wrong pitch is played through the fake MIDI keyboard, and it is then asserted PRESENT.
      `osmdEngraver.test.ts` drives a fake OSMD through the mapping order, rests, unknown ids,
      clearing, and the count-mismatch case — asserting the OTHER measures still map, which is what
      makes the silent whole-measure drop visible.*
- [x] 2.23 `app/practice`: show the early/late timing feedback REQ-3.3.2 asks for. The matcher
      computes `timing` and a signed `deviationMs` for every attributed press and `useNoteFeedback`
      discards both; `meanAbsDeviationMs` is computed globally and per measure and never displayed.
      *Proved by `e2e/timing-feedback.spec.ts`: the readout is asserted to be "—" first (so a
      component that always says "late" cannot pass), the first note is played 140ms late through
      the fake MIDI keyboard, and the rendered deviation is parsed back — the sign must be `+`, so
      a flipped deviation rendering "early (-140 ms)" fails.*
- [x] 2.24 `app/state`: persist assessment results, recordings and the practice log. REQ-3.3.4's
      "used for level checks and progress history" has no history — the result dies with the
      component. Each recording overwrites the last and none survive a refresh. `core/progress/log.ts`
      is 349 tested lines with zero production importers; no `PracticeTimer` is ever started and
      there is no session note field. (The 4.7 dashboard is the *display* half; nothing on the
      roadmap currently wires the *writing* half, which is how that knip ignore becomes permanent.)
      *Proved by `e2e/progress-persistence.spec.ts`: a practice run and a full assessment, then a
      reload, then the rows read straight out of IndexedDB rather than off a screen that could have
      re-derived them from memory — including that the practice entry names the piece. It caught a
      real integration gap: `recordHistory` defaults to false (so generated sight-reading runs
      cannot flush real assessments out of the capped history) and the practice screen had not
      passed `true`. Recordings persist through the same slice; the recordings-list UI is 4.7's.*
- [x] 2.25 `app/drills`: ship the interval-recognition flashcard UI. `buildIntervalDeck` and the
      `interval-on-staff` grading are complete and tested; `useFlashcardDrill` hardcodes
      `buildDeck('staff-to-key', …)` and filters everything else out, so none of it is reachable.
      *Proved by `e2e/flashcards-interval.spec.ts`: reaches Flashcards through the shell's own nav,
      selects the Interval drill, asserts two noteheads on one staff with no letter name anywhere
      in the SVG, answers on the pad, and asserts the graded feedback plus the stats counter moving
      0 → 1 — so a dead handler cannot pass.*
- [ ] 2.26 `app/practice`: the "read ahead" drill REQ-3.4.5 requires — notation progressively hidden
      behind the playback cursor. Zero code exists; the cursor plumbing it needs already does.
      *Proof: e2e — enable Read ahead, play, assert measures at/behind the cursor are occluded while
      those ahead stay visible.*
- [ ] 2.27 `app/practice`: tempo ramping (REQ-3.9.1's own worked example, "+2 BPM per clean
      repetition"). `startRamp`/`advanceRamp` in `core/timing/metronome.ts` have never been called
      by production code.
      *Proof: ramp 60 → 80 at +2 per clean repetition; play a loop cleanly twice and assert the
      effective BPM went 60 → 62 → 64, and that a failed pass does not lower it.*
- [ ] 2.28 `app`: a standalone metronome destination with absolute BPM, time signature and accent
      editing. None of the three is configurable anywhere today, and the metronome cannot run at all
      without a loaded score — so it is unusable for scales and technique. Also give the Rhythm and
      Sight-reading screens a metronome toggle (the click is hard-coded on) and Flashcards a
      metronome at all, per "available standalone and inside every practice screen".
      *Proof: from a fresh load with no score, set 7/8 at 100 BPM with accents on 1 and 4, start, and
      assert clicks are emitted at the right gaps with the right accent flags.*
- [ ] 2.29 `app/practice`: per-loop tempo (REQ-3.9.3). There is one global tempo scale that the
      assessment's one-click loop button happens to overwrite; switch loops and the previous loop's
      tempo is gone, turn looping off and the slowed tempo stays applied to the whole piece.
      *Proof: set loop A to 60% and loop B to 90%, switch between them, assert the effective BPM
      follows the loop and that disabling looping restores the unlooped tempo.*
- [x] 2.30 e2e: drive wait mode end to end. It is the only REQ-3.3.x mode with no e2e, and its
      defining behaviour — playback actually stopping — is what unit tests with a fake frame driver
      are worst at proving. The fake-MIDI harness makes it cheap now.
      *Proved by `e2e/waitmode.spec.ts`: enables "Wait for me", presses Play, asserts the gate is
      visible ("Waiting for: …"), lets 1.8s of real wall-clock pass — three quarter notes at the
      sample's 100bpm — and asserts the position readout is byte-identical, then fires the four
      pitches sounding at tick 0 through the fake keyboard and asserts it moves. Mutant checked by
      running it with the wait-mode checkbox left unchecked: it fails.*
- [ ] 2.31 `app/sightreading`: nav-away silently abandons a run. `Shell` unmounts the screen on any
      nav click, destroying the session, so a learner butchering a piece can escape in two clicks and
      it is neither graded nor retired — which also undermines REQ-3.4.4's "no stopping".
      Related: retirement keys on a score id that is a pure function of `GeneratorParams` and of
      nothing the Rng drew, so it retires a *parameter combination*, not a piece.
      *Proof: start a run, nav away mid-run, come back, assert the abandoned piece was recorded and
      the next exercise differs.*
- [ ] 2.32 tooling: `verify:full` runs `knip:prod`, not `knip:prod:all`, so production-unreachable
      *exports* never fail CI — which is exactly how `startRamp`, `advanceRamp`,
      `validateMetronomeSettings`, `clicksForBars`, `defaultAccents` and `selectAudioOutput` stayed
      invisible while CLAUDE.md claims that check is what catches inert code. Triage the current
      output, then add it to the gate.
      *Proof: `npm run verify:full` fails on today's tree, and passes once every entry is wired,
      deleted, or ignored with a named roadmap task.*

## Phase 3 — Milestone M3: theory & ears

Every core module here is built ahead of the screen that consumes it. The screens (3.8–3.10) are
therefore not optional polish: until they land, all of 3.1–3.6 is production-unreachable and
`knip:prod` says so. Do not tick a core task until its named consumer task also exists.

- [x] 3.1 `core/theory/harmony`: diatonic function, roman numerals, cadences, progressions (REQ-3.5.1)
      *Proof: consumed by 3.2/3.3/3.8; property test round-trips every diatonic chord in all 30
      keys through its roman numeral and back.*
- [x] 3.2 `core/theory/analysis`: roman-numeral analysis of a Score (REQ-3.5.5) — core only
      *Proved in `analysis.test.ts` against the bundled Twinkle sample: the I–IV–V–I skeleton and
      the perfect authentic cadence at the end, named literally. The on-screen half is 3.2a.*
- [ ] 3.2a `app/score`: show the roman-numeral analysis under the score — the only consumer
      `core/theory/analysis` will have, and the reason its knip ignore exists.
      *Proof: e2e — open Practice with the bundled sample and read I, IV, V, I under the staff,
      with the cadence named.*
- [ ] 3.3 ‖ `core/drills/theory`: keyboard-answered theory drills, quiz items, SRS-backed (REQ-3.5.2)
      *Proof: e2e — Theory → a quiz item answered on the on-screen keyboard is graded and its SRS
      card is scheduled.*
- [x] 3.4 ‖ `core/eartraining/intervals`: melodic/harmonic interval recognition, adaptive (REQ-3.6.1)
      *Proof: e2e via 3.10 — hear an interval, answer it, see the grade and the level adapt.*
- [x] 3.5 ‖ `core/eartraining/chords`: chord quality + scale/mode recognition
      *Proof: e2e via 3.10 — a chord is played, its quality answered and graded.*
- [x] 3.6 ‖ `core/eartraining/dictation`: melodic and rhythmic dictation grading (REQ-3.6.2)
      *Proof: e2e via 3.10 — play back a heard phrase through the fake MIDI keyboard, see a
      per-note result with pitch and rhythm scored separately.*
- [ ] 3.7 `content/theory`: theory lesson content for levels 1–3 with diagrams + play tasks
      *Proof: every lesson passes `validateCurriculum` and each one is reachable and readable in
      the app.*
- [ ] 3.8 `app`: interactive circle of fifths, keyboard/staff explorer (REQ-3.5.3)
      *Proof: e2e — click a key on the circle, assert the staff shows that key signature and the
      keyboard highlights its scale.*
- [ ] 3.9 `app`: chord & scale reference, always available (REQ-3.5.4)
      *Proof: e2e — reachable from every screen; look up C harmonic minor and see its notes and
      fingering.*
- [ ] 3.10 `app`: ear-training screens — the only consumers 3.4/3.5/3.6 will have
      *Proof: e2e — each of the three drills reached through the shell's own nav, driven to a
      grade, with the audio output asserted to have been asked to play the prompt.*
- [ ] 3.11 M3 acceptance pass

## Phase 4 — Milestone M4: progression

- [x] 4.1 `core/curriculum`: levels → units → lessons → exercises model + exit criteria (REQ-3.1.1, 2.2)
      *Proof: the shipped curriculum content (4.9) validates, and a lesson opens in the app.*
- [x] 4.2 `core/curriculum/session`: daily practice session builder, 15/30/60 min budgets (REQ-3.1.4)
      *Proof: e2e — ask for a 30-minute session, assert the segment minutes sum to exactly 30 and
      match the 20/20/40/20 mix, and that every item opens the drill it names.*
- [x] 4.3 `core/progress/levels`: per-track levels, advancement checks, manual override (REQ-2.1–2.3)
      *Proof: e2e — the dashboard shows three independent track levels; a manual override moves
      one and survives a reload.*
- [x] 4.4 ‖ `core/technique`: technique library, evenness scoring, tempo history (REQ-3.7.x)
      — core only; `evenness`/`tempoHistory` are read by the dashboard, the drill LIBRARY still
      has no screen (4.4a). Evenness is proved scale-invariant by property test: the same rhythm
      played twice as fast scores the same, which is what makes it a measure of evenness and not
      of tempo.
- [ ] 4.4a `app/technique`: the technique drill screen — pick a drill from `techniqueLibrary`,
      play it against the metronome, store the attempt. Until it exists `candidates.ts` emits no
      technique exercise (a planned session item nothing can open would be worse), so REQ-3.1.4's
      20% warm-up share is redistributed rather than filled.
      *Proof: e2e — pick C major 2 octaves, play it through the fake MIDI keyboard, see an
      evenness score and a new point on the tempo history.*
- [x] 4.5 ‖ `core/repertoire`: statuses, practice history, maintenance prompts (REQ-3.8.x)
      *Proof: e2e — add the imported score to the repertoire, set it to maintained, and see it
      appear in the review-due list once its interval has passed.*
- [x] 4.6 `core/progress/export`: JSON/CSV export + restore round-trip (REQ-3.10.4, 4.3)
      *Proof: e2e — export from a populated app, wipe IndexedDB, import the file back and assert
      the dashboard reads the same.*
- [ ] 4.6a `app`: the export/import screen — a download button and a file picker over
      `core/progress/export`, the only consumer it will have (REQ-3.10.4)
      *Proof: e2e — download the JSON, wipe IndexedDB, import the file back, assert the restored
      state matches (this is 4.6's own proof action, and this task is where it runs).*
- [ ] 4.7 `app`: dashboard — levels, streak, trends, repertoire status (REQ-3.10.1/2)
      *Proof: e2e — after a practice session and an assessment, the dashboard shows a non-zero
      streak, the session's minutes and the assessment's accuracy, all read back from IndexedDB.*
- [ ] 4.7a `app`: today's practice session screen — calls planSession with real curriculum
      candidates, renders PlannedSession, each item opens the drill it names (REQ-3.1.4)
      *Proof: e2e — ask for a 30-minute session, assert the segment minutes sum to exactly 30 and
      match the 20/20/40/20 mix, and that every item opens the drill it names.*
- [ ] 4.8 `app`: annotations (fingering edits, highlights, notes) persisted per piece (REQ-3.2.6)
      *Proof: e2e — add a fingering and a note to a piece, reload, both are still there.*
- [ ] 4.9 `content`: 30 lessons L1–2, technique library through L3, 20 graded repertoire pieces (REQ-5.2)
      *Proof: `validateCurriculum` is green over the shipped content in a test, and the lesson
      list renders all 30 in the app.*
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
- 2026-08-01 - Recovery session. The previous session died with the whole of M2 uncommitted; it was
  committed in 12 module-sized slices, then 1.21/1.22/1.23 were built as one pipelined round
  (build -> adversarial review -> fix, 3 modules, 9 agents, 26 findings). Two "built but never
  executed" defects closed: the IndexedDB adapter that nothing constructed, and `fixtures.ts` living
  in production core. `knip:prod` is now part of `verify:full` and every ignore names the roadmap
  task that will delete it. 1948 unit tests + 9 e2e, core suite 1.1s. Next: 2.11's proof action,
  then 2.13/2.14 or the M2 acceptance pass (2.15).
- 2026-08-02 (second session) — Phase 2's follow-up backlog largely cleared and the whole of
  Phase 3's and Phase 4's DOMAIN layer built: 2.19a, 2.30, 2.20-2.25, 3.1, 3.4-3.6, 4.1-4.6.
  2566 unit tests + 21 e2e, all green. Three build→review→fix rounds ran CONCURRENTLY (45 agents
  total, 0 errors) against disjoint file sets, plus one solo agent.
  What the next session must know:
  * **Everything in Phase 3 and Phase 4 so far is core-only and therefore inert.** Eleven files
    are in `knip.jsonc`'s ignore list, each naming the task that will wire it. The screens
    (3.8, 3.9, 3.10, 4.6a, 4.7, 4.7a) are not polish — they are what makes any of it real, and
    the acceptance passes (3.11, 4.10) cannot be honest before they land.
  * **Running three rounds at once costs the per-module commit cadence.** `npm run verify` is
    tree-wide, so nothing could be committed until all three rounds finished; a kill would have
    cost all of it, not one module. Either run one round at a time, or accept that the commit
    happens at the end and say so up front.
  * Two integration defects were invisible to every green suite and were caught only by an e2e
    that read IndexedDB directly: `recordHistory` never passed, and (in the same shape as ever)
    a feature wired everywhere except at the one call site that matters.
  * A fast-check property in `session.test.ts` failed roughly one run in three — a mix whose
    shares are zero for exactly the segments that still have candidates. Property tests with
    random seeds are load-bearing here; a single green run does not clear them.
- 2026-08-02 - Phase 2 complete. 2.11 (assessment run driven end to end through a fake Web MIDI
  keyboard), 2.11a (atomic transport primitives), 2.13 (rhythm drill), 2.14 (record & replay), 2.15
  (M2 acceptance pass) and its four blockers 2.16-2.19. 2055 unit tests, 14 e2e.
  What the session actually taught, for whoever picks this up next:
  * **Every defect that mattered was invisible to the unit suite.** A stop wiping the feedback
    counters, a frame reading a rewound position as a loop wrap, the review overlay and the loop
    control disagreeing about which bar is bar 2, SRS scheduling against `performance.now()`. All
    found by driving a real browser or by an Opus reviewer reading requirement text against code —
    none by a green test. The unit suite went from 1960 to 2055 without catching one of them.
  * **The e2e can encode the bug.** `e2e/assessment.spec.ts` asserted the button said "measures 2-5"
    AND that the loop boxes read 3 and 6, in adjacent lines, for two rounds. Writing the assertion
    from the observed behaviour rather than the intended behaviour is how that happens.
  * **`npx tsc --noEmit` checks nothing here** — the root tsconfig is a solution file. A whole round
    reported "tsc clean" and landed nine type errors. Agent templates now say `npm run typecheck`.
  * The acceptance pass was worth far more than its cost: three reviewers against the requirement
    text found 30+ real gaps, including that nothing except the score and practice settings was
    persisted while `COLLECTIONS` declared five slots nobody wrote.
- 2026-08-01 - Phase 1 complete. Adapters, shell, OSMD viewer, practice screen, note feedback, e2e. Opus review found the practice screen was built but never rendered by the shell, and that `checkpoint` did not run e2e (the only suite that caught it) - `checkpoint` now runs `verify:full`. Also fixed: stop/pause left notes ringing forever on MIDI-out, the pump discarded every time the domain computed, the two AudioOutputs disagreed on clock epoch, hand mute mid-playback rewound to bar 1, and the seam tests survived deleting the tempo map (9 of 10 passed). 1567 tests + 6 e2e.
