# Roadmap archive — frozen 2026-08-08. Full task histories and proof prose live here (and in git history). The live ROADMAP.md keeps only open work.

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
- [x] 2.20a `app/practice`: after Stop, the score highlight stayed where playback stopped while the
      position readout had already rewound. Fixed the second way the old note predicted, not the
      first: `usePracticeEngine.stop()` now REPORTS where the playhead landed (`CursorTarget`) and
      `PracticeScreen.handleStop()` moves the raw `ScoreViewerHandle` there itself, bypassing
      `useNoteFeedback`'s intercepting ref entirely. Both the Stop button and the recorder's
      replay-end path go through that one helper.
      *Proved by `e2e/stop-cursor.spec.ts`: the OSMD cursor's box is sampled at rest, asserted to
      have MOVED during playback (and the readout asserted OFF measure 1, so the post-Stop check is
      not a tautology), then asserted back at its at-rest box after Stop. `PracticeScreen.test.tsx`
      adds the two mutants that matter: the feedback counters are NOT reset by the stop (the
      regression guard for why the naive fix was reverted), and a Stop inside an armed loop moves
      the cursor to the LOOP START, not bar 1 — which a hardcoded `(0, 0)` cannot satisfy.*
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
- [x] 2.26 `app/practice`: the "read ahead" drill REQ-3.4.5 requires — notation progressively hidden
      behind the playback cursor. Zero code existed; the cursor plumbing it needs already did.
      Done differently from the stated proof, and say so: notes are hidden strictly BEFORE the
      cursor's own measure, not "at or behind" it. OSMD draws a highlight rectangle behind the note
      at the cursor, and review found hiding that note made it MORE visible — a dark silhouette on
      the highlight — not less; excluding the cursor's own measure from hiding sidesteps the
      collision instead of fighting OSMD's renderer for it. Hiding recolours notehead and stem to
      match the background (`ScoreEngraver.setNoteHidden`, independent of and overriding the
      correct/wrong/missed feedback colour on the same note); beams and ledger lines are a known,
      undone gap — full occlusion needs OSMD's `PrintObject`/`updateGraphic()`, judged too large a
      change for this task.
      *Proved by `e2e/read-ahead.spec.ts`: enabling Read ahead at rest hides nothing (nothing
      precedes measure 1), playing past measure 3 grows the hidden-note count while a later measure
      stays unhidden, and unchecking it reveals everything — all asserted via the exact
      `HIDDEN_NOTE_COLOR` fill count, never an assumption about what an unhidden note looks like
      (a played note can be judged missed and painted amber, not default ink).*
      Adversarial review, driving the real app rather than reading code, found and this round
      fixed two real defects invisible to the vitest suite: a race where a freshly-created OSMD
      engraver silently dropped `setNoteHidden` calls made before its async `load()` resolved and
      never retried them (fixed by recording state unconditionally and repainting once `load()`'s
      note map is built, instead of gating on the engraver being ready); and an e2e spec whose
      assertions rested on a miscounted "ink colour" total and ran after Stop had already rewound
      the cursor, silently revealing everything before the assertions checked it.
- [x] 2.26a `app/score`: `osmdEngraver.ts`'s `buildNoteIdMap` threw for the app's OWN bundled sample
      score (and any score where one staff rests while another sounds a note at the same tick —
      OSMD leaves that `StaffEntries` slot `undefined`, not an entry with an empty voice, and
      `flattenMeasureNotes` read `.VoiceEntries` off it unguarded). The catch-all `try/catch` around
      the whole function swallowed the `TypeError` silently, leaving `noteById` permanently EMPTY
      for that score — so correct/wrong/missed note colouring AND 2.26's read-ahead occlusion have
      both been completely inert against the bundled Twinkle Twinkle sample since the day each
      shipped, invisible to every e2e because they all drove custom small fixtures instead of the
      score a user actually sees first. Found only by running 2.26's proof action in a real browser
      against the bundled sample per CLAUDE.md — every existing unit and e2e test passed throughout.
      *Proved: `osmdEngraver.test.ts` gained a fake `StaffEntries` array with a genuine `undefined`
      slot (not a rest — a missing entry), reproducing the exact crash; it now maps and paints the
      real note instead of throwing. Re-verified live: read-ahead against the bundled sample now
      visibly occludes measures 1-4 while a fake-missed note behind the cursor still paints amber,
      proving colour and hidden-state composition also recovered, not just the mapping.*
- [x] 2.27 `app/practice`: tempo ramping (REQ-3.9.1's own worked example, "+2 BPM per clean
      repetition"). `startRamp`/`advanceRamp` in `core/timing/metronome.ts` have never been called
      by production code.
      *Proved in `useTempoRamp.test.ts`: 60 → 62 → 64 across two clean repetitions, a failed pass
      leaves it where it was, it stops at the target without overshooting, and the reported
      `tempoScale` is exactly `currentBpm / writtenBpm` (a hook returning the raw bpm as a scale
      would double the tempo). Wired in `PracticeScreen`: a completed pass at or above 95% note
      accuracy counts as a clean repetition. Not proved end to end in a browser — that needs a
      loop played accurately through the fake keyboard, which is 2.27a.*
- [x] 2.28 `app`: a standalone metronome destination with absolute BPM, time signature and accent
      editing. None of the three was configurable anywhere, and the metronome could not run at all
      without a loaded score — so it was unusable for scales and technique.
      *Proved in `useMetronome.test.ts` against a recording audio output and a fake clock: 7/8 at
      100bpm with accents on 1 and 4 emits clicks at the right gaps with the right accent flags —
      the requirement's own acceptance sentence — and it runs with no score. Proved in a real
      browser by `e2e/metronome.spec.ts`: reached through the shell's own nav, the readout advances
      past its first beat under a real `requestAnimationFrame` loop (so a scheduler that fires once
      and dies fails), and shows `beat 4 (accent)` from the pattern set on screen.*
- [x] 2.28a `app`: the other half of 2.28's original text — a metronome toggle on the Rhythm and
      Sight-reading screens (the click was hard-coded on) and a metronome on Flashcards at all, per
      REQ-3.9.1's "available standalone and inside every practice screen".
      *Proved on BOTH sides of the toggle, which is the assertion that matters: `useRhythmDrill.test.ts`
      and `useSightReadingTrainer.test.ts` record ZERO clicks against a recording `AudioOutput` with
      the toggle off and MORE THAN ZERO with it on, in the same file — so a hook that never clicks at
      all cannot pass either half, which a one-sided "no clicks when off" test would have allowed.
      `e2e/metronome-drills.spec.ts` drives Rhythm to a real grade with the click off, and the
      Flashcards metronome to an advancing beat readout under a real `requestAnimationFrame` loop.*
- [x] 2.29 `app/practice`: per-loop tempo (REQ-3.9.3). There is one global tempo scale that the
      assessment's one-click loop button happens to overwrite; switch loops and the previous loop's
      tempo is gone, turn looping off and the slowed tempo stays applied to the whole piece.
      *Proved in `scoreStore.test.ts` exactly as the proof action asks: loop A at 60% and loop B at
      90%, switching between them follows the loop, disabling looping restores the whole-piece
      tempo, and the LRU cap evicts. Two defects were found integrating it, both invisible to the
      module's own tests: a session saved at 50% inside a loop came back at 100% (`restoreSession`
      set the tempo before the loop, so it was filed under "no loop"), and a first-seen range
      snapped back to 100% instead of inheriting the tempo the learner had just chosen.*
- [x] 2.30 e2e: drive wait mode end to end. It is the only REQ-3.3.x mode with no e2e, and its
      defining behaviour — playback actually stopping — is what unit tests with a fake frame driver
      are worst at proving. The fake-MIDI harness makes it cheap now.
      *Proved by `e2e/waitmode.spec.ts`: enables "Wait for me", presses Play, asserts the gate is
      visible ("Waiting for: …"), lets 1.8s of real wall-clock pass — three quarter notes at the
      sample's 100bpm — and asserts the position readout is byte-identical, then fires the four
      pitches sounding at tick 0 through the fake keyboard and asserts it moves. Mutant checked by
      running it with the wait-mode checkbox left unchecked: it fails.*
- [x] 2.31 `app/sightreading`: nav-away silently abandons a run. `Shell` unmounts the screen on any
      nav click, destroying the session, so a learner butchering a piece can escape in two clicks and
      it is neither graded nor retired — which also undermines REQ-3.4.4's "no stopping".
      Related: retirement keys on a score id that is a pure function of `GeneratorParams` and of
      nothing the Rng drew, so it retires a *parameter combination*, not a piece.
      *Proof: start a run, nav away mid-run, come back, assert the abandoned piece was recorded and
      the next exercise differs.*
- [x] 2.32 tooling: `verify:full` ran `knip:prod`, not `knip:prod:all`, so production-unreachable
      *exports* never failed CI — which is exactly how `startRamp`, `advanceRamp`,
      `validateMetronomeSettings`, `clicksForBars`, `defaultAccents` and `selectAudioOutput` stayed
      invisible while CLAUDE.md claims that check is what catches inert code. `verify:full` now
      runs `knip:prod:all`.
      *Proved: `npm run verify:full` failed on the tree at session start (57 unused exports) and
      passes now that every one is wired, deleted, or kept with a `/** @public — <reason> */`
      comment (knip's own exemption tag) — none silently ignored. Five agents triaged disjoint
      files in parallel: ~30 deletions (dead theory-primitive one-offs, and two entire unwired
      write-side subsystems — `writeMidiFile`, `recordingToScore`/`replayEvents` — whose own
      roadmap entries already said nothing else would ever call them), ~20 kept as genuinely
      load-bearing API members knip can't see a caller for yet (Result-monad combinators,
      `parseChordSymbol`, `clicksForBars`, `degreeOf`). 2750 unit tests (down from 2903 — dead
      code and the tests that existed only to cover it), 38 e2e.*
      Three real wiring gaps surfaced by this triage, not fixed here (deliberately — a tooling
      task is not the place to silently patch app-layer behaviour) and recorded as their own tasks
      below: 2.33, 2.34, 2.35.

### Performance — a real score, not a six-bar fixture

Reported by the user against `Canon_in_D.mxl` (Pachelbel, MuseScore export: 102 measures, 1603
notes, 563KB of MusicXML): notes drifting out of sync with the sound, visible stuttering, and
Play/Stop taking a noticeable moment to respond. Measured in a real browser before any fix, by
`e2e/perf-large-score.spec.ts`:

```
p95 animation-frame gap 551ms · worst 564ms · 28 frames in 6s (~4.7fps)
13 long tasks in 6s, worst 561ms · Play latency 1329ms · Stop latency 5339ms
```

Every existing e2e drives a two-to-six bar fixture, which is exactly why none of them ever saw
this: all three costs below are O(score size) or O(position in score), and on six bars they round
to zero. The perf spec is now the standing guard against that.

After 2.32a–c, on the same machine and the same score:

```
                    before      after
p95 frame gap        551ms       18ms
worst frame gap      564ms       41ms
frames in 6s          28         422    (~4.7fps -> ~70fps)
long tasks (worst) 13 (561ms)  0 (0ms)
Stop latency        5339ms       59ms
```

- [x] 2.32a `app/score`: stop re-engraving the whole score to recolour one note. `osmdEngraver.ts`
      calls `osmd.render()` — a full synchronous re-engrave of all 102 measures — once per animation
      frame whenever any note's colour or hidden state changes, which during playback is every frame.
      Roadmap 2.21 batched N colour changes into one render per frame; one full re-engrave per frame
      is still the dominant cost. OSMD exposes `GraphicalNote.setColor(color, options)`, documented
      "without re-rendering", reachable via `osmd.rules.GNote(note)`. The model-property writes stay,
      so a re-engrave OSMD does for its own reasons (`autoResize`) still shows the right colours.
      *Proved in `osmdEngraver.test.ts`: N `setNoteColor` calls schedule ZERO renders on the
      `setColor` path and exactly ONE (2.21's coalescing, preserved) on the fallback path, with
      `GNote` returning `undefined` and `GNote` throwing both driven. The unit tests run against a
      FAKE OSMD, so they cannot prove the real library honours `setColor` — the live proof is that
      `e2e/note-colour.spec.ts` and `e2e/read-ahead.spec.ts`, which read real notehead `fill`
      attributes out of the real SVG, both still pass while `e2e/perf-large-score.spec.ts` records
      ZERO long tasks. A silent fall-through to the render path would keep those two green and
      blow the frame budget; both together is what pins it.*
- [x] 2.32b `app/score`: `stepsToOnsetAtOrBefore` is a linear scan from index 0, run on every
      animation frame from `moveCursorTo`, so its cost grows with how far into the piece playback has
      reached. Binary search.
      *Proved by a `fast-check` property test against a linear reference implementation kept in the
      test file, over ascending arrays built from prefix-summed deltas that include zeros — so
      duplicate runs actually occur, which is the case a naive binary search gets wrong. All nine
      original example tests kept unchanged.*
- [x] 2.32c `app/practice`: `useReadAhead` rebuilds the entire hidden-id set from measure 0 on every
      measure change, then diffs it and throws nearly all of it away. Make it incremental — only the
      measures actually crossed.
      *Proved in `useReadAhead.test.ts`: stepping the cursor measure by measure across a six-measure
      fixture issues `setNoteHidden(id, true)` exactly once per id across the whole run (every call
      collected, no id twice), a backward jump 8→2 reveals exactly measures 2–7 and touches nothing
      else, a multi-measure forward SEEK still hides every measure crossed (the incremental path
      must not assume single-measure steps), and a `currentMeasureIndex` past the end clamps rather
      than throwing.*
- [x] 2.32d `e2e`: the perf spec itself — `e2e/perf-large-score.spec.ts`, driving the real
      Canon in D `.mxl` through the real file input, sampling `longtask` PerformanceObserver entries
      and animation-frame gaps during playback, and measuring Play/Stop latency.
      *Proved by running it on both sides: it fails on the tree as it stood at the start of this
      session (p95 frame gap 551ms against a 50ms budget) and passes after 2.32a–c. Each budget is
      set between the two measured values. The fixture is committed at `e2e/fixtures/canon-in-d.mxl`
      — `.gitignore`'s `/*.mxl` only covers the repo root, which is the user's drop zone.
      `playLatencyMs` is reported but deliberately gated loosely: it includes up to one whole beat
      of the score's own tempo, so it is a hang detector, not a latency figure.*
- [x] 2.32e `adapters/audio`: `createWebAudioOutput` captures `clockOffsetMs = performance.now() -
      ctx.currentTime * 1000` ONCE at construction and never re-anchors, and `toCtxSeconds` clamps
      an already-past event to `ctx.currentTime` — so a late event is played bunched at "now"
      rather than dropped or caught up. Both were amplified by the stalls 2.32a–c removed (a
      550ms main-thread block is a 550ms pile of notes arriving late at once), and the user's
      "notes out of sync with the sound" is believed fixed at that source: the post-fix run
      records zero long tasks. The single-capture offset remains a real long-session drift risk on
      its own, but nothing has MEASURED it, so this is recorded rather than blind-fixed.
      *Measured first, and the FIRST measurement was wrong — which is the part worth keeping.
      `e2e/audio-clock-drift.spec.ts`'s original estimator used the first and last sample and
      reported +14.6, +9.1 and -6.4 ms/min over three runs: a sign flip, i.e. noise. Two causes,
      both since fixed: the raw offset carries a 16–18ms peak-to-peak sawtooth (`ctx.currentTime`
      advances in render-quantum blocks while `performance.now()` is continuous), which swamps a
      two-point estimate; and the first sample was taken while the audio render thread still had
      `currentTime` pinned at exactly 0 for tens of ms after `resume()` resolved, folding startup
      latency in as drift. `state === 'running'` does NOT catch that — the state flips before the
      clock ticks.
      With a least-squares fit over ~170 samples and a 2s warm-up discarded, four runs give
      -16.26, -14.60, -15.72 and -17.87 ms/min: same sign, ~±1.5 ms/min, about a 10-sigma slope.
      So ≈ -255 ppm — a frozen offset goes stale by ~150ms after ten minutes, ~450ms after half an
      hour. A real defect, not the no-op this task suspected.
      The obvious fix is a trap: re-measuring per call trades accumulating drift for INSTANT
      jitter, since two notes scheduled in different frames would land up to ~17ms apart
      relatively — over a tenth of a sixteenth at 120bpm. So the offset is a running anchor under
      a TIME-based exponential filter (a burst of ten noteOns in one frame must not advance it ten
      times as fast), tau = 2000ms chosen by arithmetic that is in the source: ramp lag =
      rate * tau = 0.5ms, sawtooth fundamental attenuated to ~0.007ms. A 250ms escape hatch snaps
      rather than blends for a context resumed after being backgrounded.
      Three mutants were RUN, not merely named: frozen offset fails the drift test at 180.07ms
      (bound 1ms); naive per-call re-anchor fails the jitter test at 8.5ms wobble; no escape hatch
      reads 5.01 instead of 5.11. Each public method reads the anchor once, so `now()` stays the
      exact inverse of `toCtxSeconds`.
      NOT claimed: the spec measures the two clocks directly rather than driving
      `createWebAudioOutput` itself, so it cannot fail from a regression inside that module —
      the unit tests carry that half.*
- [x] 2.32f `app/score`: `osmdEngraver.ts`'s `MAX_CURSOR_STEPS = 10_000` silently truncates
      `collectOnsetTicks`. Canon in D's 102 measures produce well under that, so nothing is wrong
      today, but a long dense piece that exceeds it would leave the cursor unable to track past that
      onset — and the cap is silent, so it would present as "the cursor stops moving two thirds of
      the way through" with nothing in the console. Not a perf issue; found while reading that file
      for 2.32a. Either raise it far above any real score or make exceeding it visible.
      *Done both ways: cap raised to 200_000 (a runaway-loop backstop, not a plausible real limit)
      and the truncating exit warns once naming the module and the cap.
      `osmdEngraver.test.ts` drives it through the public engraver with a fake cursor bounded just
      ABOVE the cap — deliberately, so that deleting the guard fails cleanly instead of hanging the
      worker in a synchronous infinite loop, which is the weakest possible signal for the exact
      regression the test exists to catch. Adversarial review found the raise made the degenerate
      case WORSE: `onsetTicks.length` also bounds `moveCursorToIndex`, whose steps are real
      visible-cursor `Cursor.update()` calls, so a truncated 200k list meant one frame issuing
      199_999 of them — a freeze, not a short cursor. Added `MAX_CURSOR_STEPS_PER_MOVE = 4_000` and
      made `moveCursorToIndex` return the index it ACTUALLY reached rather than the one requested,
      which also fixes a pre-existing bug where an early loop break left the recorded index ahead
      of the real cursor permanently. Onset ticks are now rounded at the OSMD conversion: a
      non-dyadic Fraction produced 16000.000000000002, read as "not yet sounding" on an exact hit.*

- [x] 2.33 `app/repertoire`: `core/repertoire/repertoire.ts` has seven exports
      (`addPiece`/`setStatus`/`recordSession`/`setNotes`/`maintenanceDue`/`sessionFromEntry`/
      `REPERTOIRE_STATUSES`) with no consuming store or screen anywhere — no
      `src/app/state/repertoire*` store exists, `progress/snapshot.ts` hardcodes `repertoire: []`,
      and `useDashboard.ts` hardcodes `repertoirePieces: []`. Roadmap 4.5 is ticked `[x]` but only
      the core module was ever built; its own doc comment names `usePracticeLog.ts`'s `stop()` as
      the intended writer, and that function does not call it. Found by the 2.32 knip triage.
      *Proved by `e2e/repertoire.spec.ts` — 4.5's own original proof action, actually driven this
      time. Import a score, add it at level 3 through the real screen, set it maintained, and watch
      the Review due list. The interval is asserted in BOTH directions, which is the part that
      matters: a maintained piece never practised is due immediately, so "maintained piece appears
      under Review due" alone is satisfied by an implementation that lists every maintained piece
      and never consults an interval. So the spec also injects a session 2 days ago (NOT due) and
      one 40 days ago (due again), each followed by a full reload — which makes the same
      assertions double as proof that the ninth persistence slice restores. Mutant checked:
      replacing `maintenanceDue(...)` with `pieces.filter(p => p.status === 'maintained')` fails the
      2-days-ago assertion. Built as four file-disjoint modules — the store, the screen + hook, the
      persistence slice, and the dashboard/snapshot wiring — plus Shell nav wiring on the main
      thread. `usePracticeLog.stop()` still does not call `recordSession`, so a repertoire piece's
      practice history has no automatic writer yet; that is the remaining half and is not claimed.*
- [x] 2.33a `app/dashboard`: found while wiring 2.33, and the same shape as 2.36 — `useDashboard.ts`
      hardcodes `const techniqueAttempts: readonly TechniqueAttempt[] = []` and its module comment
      claims "no store persists a `TechniqueAttempt` list anywhere (there is no writer)". That has
      been false since roadmap 4.4b, which built `useTechniqueStore`, had `useTechniqueDrill` write
      to it, and added the eighth persistence slice so it survives a reload. The dashboard's whole
      technique tempo trend has therefore been inert since the day 4.4b shipped, with a doc comment
      explaining why that was correct. Fixed inside 2.33's dashboard module rather than left
      standing, because it is one line in a file that round already owned.
      *Proof: `useDashboard.test.ts` seeds `useTechniqueStore` with attempts and asserts
      `techniqueTrend` is non-empty and carries the seeded drill ids — the assertion whose absence
      let this sit unnoticed.*
- [x] 2.34 `app/session`: `Shell.tsx` renders `<TechniqueScreen />` with no props, so a planned
      session's chosen technique drill (`Exercise.params.drillId`, built by
      `session/candidates.ts`) is silently dropped — the screen always opens the level's first
      drill instead of the one the session actually planned. `techniqueDrillById` (the opener
      `candidates.ts`'s own doc comment names) has never been called. Found by the 2.32 knip
      triage. `candidates.ts`'s module doc is also stale — still says "there is no technique-drill
      screen in the app yet" despite one existing since 4.4a.
      *Proved by `e2e/session-technique.spec.ts`, and the spec was checked to be non-vacuous
      rather than assumed to be. It bumps the plan to 60 minutes so the technique segment holds
      more than one item, reads the SECOND item's drill title off the screen (never a hardcoded
      id), and asserts the opened picker's selected index is that drill's real library index AND
      that the index is non-zero — which "opens the level's first drill" cannot satisfy. Reverting
      Shell to `<TechniqueScreen />` was actually run and fails it: expected
      `five-finger-c-major-hands-left`, received `five-finger-c-major-hands-right`. Passing
      `initialLevel` as well as `initialDrillId` is the half that is easy to miss —
      `useTechniqueDrill` builds its picker from `techniqueLibrary(level)` and silently falls back
      to that level's first drill for an id absent from it, so the id alone would have looked
      wired and behaved identically to the bug. `candidates.ts`'s stale "there is no
      technique-drill screen in the app yet" doc and `techniqueDrillById`'s keep-comment describing
      this gap are both deleted.*
- [x] 2.35 `core/practice`: `matcher.ts`'s `buildExpected` re-derives "group notes by shared
      `startTick`" instead of calling `notation/score.ts`'s `chordGroups`, which already does
      exactly this and is otherwise unused in production. Found by the 2.32 knip triage — small
      dedup, not a behaviour change.
      *Done: `matcher.test.ts`'s 83 tests are green with no assertion edited, which is what makes
      this a dedup rather than a behaviour change, and `chordGroups` lost its `@public`
      keep-comment. The blocker was the signature: `chordGroups` took a whole `Score`, but chord
      SIZES must be computed over the ALREADY hand-filtered list `NoteMatcher` builds — a two-hand
      chord practised right-hand-only is a smaller chord — so it now takes `readonly ScoreNote[]`.
      Two preconditions the old code held implicitly are asserted rather than assumed:
      `chordGroups` skips `tiedFrom` notes (a no-op on the matcher's path, a silent dropped note
      for any future caller that forgets), and its tolerance rule only agrees with strict
      `startTick` equality on input sorted ascending by tick. `score.test.ts` gained a fast-check
      property pinning the equivalence of the two grouping rules, so changing either breaks
      loudly.*
- [x] 2.36 `app/dashboard`: roadmap 4.3 is ticked done, claiming *"the dashboard shows three
      independent track levels; a manual override moves one and survives a reload"* — verified
      false against the current tree while triaging 2.32: `core/progress/levels.ts`'s
      `initialLevelState`/`advance`/`setLevel` are imported by NOTHING in `src/app` (only their
      `CriterionStatus` type reaches `useDashboard.ts`), no `LevelState` store exists, and
      `useDashboard.ts`'s own doc comment already says so ("no persisted `LevelState` anywhere (no
      store, no manual-override UI)"). Only the sight-reading track has a real level; the other two
      render "not tracked yet". Either build the missing store + override UI so 4.3's proof becomes
      true, or correct 4.3's tick and proof text to match what was actually shipped — do not leave
      the claim standing unverified a second time.
      *Built the missing half rather than downgrading the claim. `app/state/levelStore.ts` holds
      one `LevelState` and delegates every mutation to the core functions; a TENTH persistence
      slice stores it under the existing settings collection with its own `levelState` key, so no
      IndexedDB object-store migration was needed. `DashboardScreen` renders a real level for all
      three tracks plus a labelled per-track `<select>` (REQ-2.3) and marks an overridden track.
      Proved in a browser by `e2e/dashboard-populated.spec.ts`'s new case — set Playing to 4
      through the real control, reload, read back "level 4 (overridden)" — 4.3's own original
      proof action, actually driven this time.
      The sight-reading collision is resolved rather than papered over: `useSightReadingStore`'s
      `level` is the ADAPTIVE trainer's accuracy-driven difficulty and `levelState.levels
      ['sight-reading']` is the curriculum track level. Both stay on `DashboardData`;
      `useDashboard.test.ts` sets them to DIFFERENT values and asserts each reads its own source,
      which is the assertion that kills a "reuse one level everywhere" implementation.
      NOT claimed: `criteria` stays `[]` and `curriculumAvailable` stays `false`, honestly — no
      shipped curriculum content supplies a `CurriculumLevel`'s `exitCriteria` yet (4.9), so
      `trackProgress`/`canAdvance` still cannot be called meaningfully and `advanceTrack` has no
      production caller. That is REQ-2.2's gated advancement and it waits on the content, which is
      why 4.9 now also owns wiring it.*

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
- [x] 3.2a `app/score`: show the roman-numeral analysis under the score — the only consumer
      `core/theory/analysis` will have, and the reason its knip ignore exists.
      *Proved by `e2e/round6.spec.ts`: the panel's own numeral spans are read out of the DOM and
      asserted to be exactly I, V, IV, I for the sample's first four bars, with the key line
      reading "Key: C major" and a cadence named. Reading the flattened text instead matched
      "m.1I" — which is how the run-together layout was found, and styled.*
- [x] 3.3 ‖ `core/drills/theory`: keyboard-answered theory drills, quiz items, SRS-backed (REQ-3.5.2)
      *Proved by `e2e/round6.spec.ts`: the Theory destination shows a real prompt and a progress
      readout at "0 / n played", and a key pressed on the on-screen keyboard moves it off zero —
      so a press that never reaches the grader fails. `theory.test.ts` property-tests every kind
      and level: an item's own answer grades correct, an octave transposition of it still does,
      and a scale played in the wrong order does not.*
- [x] 3.4 ‖ `core/eartraining/intervals`: melodic/harmonic interval recognition, adaptive (REQ-3.6.1)
      *Proof: e2e via 3.10 — hear an interval, answer it, see the grade and the level adapt.*
- [x] 3.5 ‖ `core/eartraining/chords`: chord quality + scale/mode recognition
      *Proof: e2e via 3.10 — a chord is played, its quality answered and graded.*
- [x] 3.6 ‖ `core/eartraining/dictation`: melodic and rhythmic dictation grading (REQ-3.6.2)
      *Proof: e2e via 3.10 — play back a heard phrase through the fake MIDI keyboard, see a
      per-note result with pitch and rhythm scored separately.*
- [x] 3.7 `content/theory`: theory lesson content for levels 1–3 with diagrams + play tasks
      *Done: theory-track lessons at all three levels, plus 15 keyboard-diagram specs referenced
      from lesson markdown as `[diagram:<id>]`. `validateCurriculum` now runs at content
      module-load in production, not only in a test — a hand-authored cross-reference break is
      programmer error and fails loudly instead of silently shortening a list. Reachable and
      readable through the Lessons destination (4.9b), with a track filter so the theory thread
      is not buried among 16 level-1 lessons.
      The valuable review findings were not structural — they were that the shipped teaching
      prose was musically WRONG, which no type-check would have caught: the two-octave lesson
      taught CONTRARY motion while the drill it assigns builds both hands strictly parallel, and
      told the learner to make both thumb-tucks land together when in parallel C major they never
      coincide; the F major lesson had the missing flat arriving "too early" when it arrives a
      step late; the bass-clef lesson claimed the clef sits "two lines lower" than treble, wrong
      as a symbol and as pitch; and the "finding middle C" diagram spanned three octaves while
      highlighting by PITCH CLASS, lighting up C3, C4 and C5 identically — the one diagram whose
      whole job is to disambiguate middle C. All fixed.*
- [x] 3.8 `app`: interactive circle of fifths, keyboard/staff explorer (REQ-3.5.3)
      *Proved by `e2e/screens.spec.ts`: clicking G major on the circle CHANGES what the reference
      below shows (the text is captured before and compared, so a circle wired to nothing fails)
      and the new content contains F# and the roman numerals of G major's diatonic chords.*
- [x] 3.9 `app`: chord & scale reference, always available (REQ-3.5.4)
      *Proved in `ChordScaleReference.test.tsx`: the keyboard diagram highlights exactly the
      scale's pitch classes, the fingering columns show real values, and harmonic minor
      substitutes the raised-leading-tone V and vii° — which a stub returning "the major scale of
      the root" cannot satisfy. Reachable from the Theory nav item; "from every screen" is not
      true yet — it is a destination, not a panel, which is 3.9a if it turns out to matter.*
- [x] 3.10 `app`: ear-training screens — the only consumers 3.4/3.5/3.6 will have
      *Proved in `useEarTraining.test.ts` that the prompt's pitches are actually SENT to the audio
      output, with the melodic gap and the harmonic simultaneity asserted in milliseconds, and
      that replay plays it again. Proved in a browser by `e2e/screens.spec.ts`: reached through the
      shell's own nav, Play, answer, graded. Dictation is selectable and reaches an honest
      "not playable yet" status rather than being silently absent.*
- [x] 3.11 M3 acceptance pass — audit done (three Opus reviewers, one per requirement group,
      REQ-3.5.1/2/6 \ REQ-3.5.3/4/5 \ REQ-3.6.x). Verdicts as found: 3.5.1 NOT MET, 3.5.2 NOT MET,
      3.5.3 PARTIAL, 3.5.4 PARTIAL, 3.5.5 PARTIAL, 3.5.6 MET-with-defects, 3.6.1 PARTIAL,
      3.6.2 NOT MET, 3.6.3 NOT MET.
      **M3 accepted with 3.11a–3.11c landed** — those were the verdicts that were defects rather
      than unbuilt features. 3.12–3.20 are the unbuilt half and are recorded, not blocking.
      What the audit found that 2903 green tests did not:
      * **Ear-training adaptation reset on every reload** — `adaptEarLevel` was correct and tested,
        but the store was absent from `persistence.ts`, so levels, SRS cards and the attempt log
        died with the tab. `persistence.ts`'s own comment describes this failure mode and fixes it
        for sight reading; ear training reintroduced it. Sevenths, gated at level 3, were
        unreachable in practice.
      * **Both dictation drills were unanswerable** — `gradeDictation` had zero production callers,
        and the generator produced 15/19/39/27/60 notes at levels 1–5 for a requirement asking
        for 2–8.
      * **All 19 lesson quizzes opened one deck** whatever their title promised, and two of core's
        four decks were built, tested and reachable from nowhere.
      Each fix was then caught being wrong by its own Opus review, which is the part worth keeping:
      the persistence fix made *importing a backup delete* ear-training progress; the dictation fix
      anchored answers to tick 0 when 18.6% of rhythmic prompts (measured, 1500 items) start later,
      so a perfect playback graded wrong AND demoted the learner; and the quiz fix was entirely
      inert, because the shell matched two deck ids and silently fell back to the default for the
      rest. All three shipped green scoped suites. **A fix that is not adversarially reviewed is a
      defect with better paperwork.**
- [x] 3.11a `app/state`: persist ear-training state (REQ-3.6.3) — see commit; `earTraining` is now
      a real field on core's `ProgressSnapshot`, and absence means "leave alone", never "wipe".
- [x] 3.11b `app/eartraining`: dictation answerable on screen and over MIDI (REQ-3.6.1/3.6.2)
- [x] 3.11c `app/drills,content`: each lesson quiz opens the deck its title promises (REQ-3.5.2)

The M3 gaps that are unbuilt features rather than defects. Each states its proof action.

- [x] 3.12 `app`: route the topic quizzes no flashcard deck covers to the MIDI-answered
      `TheoryDrillPanel`, which was reachable only by clicking the Theory nav item and changing a
      dropdown.
      *Done. The task text said "7 lessons"; the real count is **4** — the other three
      `staff-to-key` quizzes say "find the notes on the keyboard", which is exactly what that deck
      does, so their titles were already honest. `TheoryDrillPanel` takes `initialKind`/
      `initialLevel`, `TheoryScreen` passes them through, and `Shell` routes a `theory-quiz` whose
      `drillKind` names a `TheoryQuizKind` to Theory instead of Flashcards (the two unions are
      disjoint, so the content decides the destination), remounting by `key`.
      Proved by `e2e/theory-quiz-routing.spec.ts`, which drives Lessons → the level-2 theory lesson
      → its own Open control and NEVER touches the Topic dropdown — picking by hand would prove the
      drill works, not that the routing does, the same distinction `deck-routing.spec.ts` records.
      It asserts the destination, the Topic value AND that the rendered prompt is a `build-chord`
      prompt, then parses that live prompt, rebuilds the answer through the app's own
      `buildChord`/`chordMidi`, plays it on the on-screen keyboard and asserts it grades. Reverting
      Shell's `theory-quiz` case to `'flashcards'` was run and fails it.
      Two review findings, both the same bug re-entering by another door: `initialKind` was
      silently discarded whenever ANY theory SRS card was due at mount (the seed scanned every
      kind, and `build-scale` is the default, so any prior Theory session left due scale cards and
      the cadence quiz served a scale drill); and the level test's fixture was level-INSENSITIVE,
      because under a constant rng `build-chord` returns the identical prompt at every level 1–7,
      so it held against a mutant that ignored `initialLevel` entirely.
      A contract error of mine was also caught: I specified `build-chord` level 1 for the I–IV–V–I
      lesson's quiz, making it byte-identical to the C major triad lesson's quiz — same title, kind
      and level — on a lesson about IV, asking for no subdominant at all. It is `build-cadence` at
      level 2, where `CADENCES_BY_LEVEL` adds PLAGAL (IV–I), and the test asserts both cadences are
      reachable there rather than merely that some cadence is.*
- [x] 3.13 `app/theory`: hear it (REQ-3.5.3, 3.5.4)
      *Proved in `ChordScaleReference.test.tsx` against the recorded `AudioOutput` calls, not the
      `playedNotes` projection: G major's exact pitches at exact ascending timestamps, a note-off
      per note-on, and a velocity above zero. That last one matters — review found `PLAY_VELOCITY
      = 0` (a completely SILENT feature), zero note spacing, and deleting both note-offs all kept
      the original 16 tests green. All three mutants were confirmed to fail now. Also fixed: no
      panic on lookup change (you heard G major finish while the screen said D) and a new
      AudioContext per screen visit, against Chrome's ~6-per-document cap.
      Chord Play covers 6 of 16 scale types, because the chords section itself is suppressed for
      the modal/exotic ones — that is 3.15.*
- [ ] 3.14 `app/theory`: the staff half of "see it on staff and keyboard" (REQ-3.5.3, 3.5.4) — the
      reference renders a keyboard SVG and a table of note names; `osmdEngraver` is never imported
      by the theory layer.
      *Proof: a looked-up scale is engraved as real notation (an OSMD svg past the 50-element
      discriminator, as `e2e/round6.spec.ts` does for technique).*
- [x] 3.15 `app/theory`: look up ANY chord (REQ-3.5.4)
      *Done. New `ChordLookup` takes any root × any `CHORD_QUALITIES` member (triads AND sevenths)
      × any legal inversion — inversion 3 offered only where `isTriad` is false — and shows the
      symbol, figured bass, spelled tones and a keyboard highlight, reusing 3.13's audio path
      rather than opening a second `AudioContext`. And the chords section no longer vanishes: the
      branch turns on the resolved `Key` rather than the mode, so every scale type renders chords —
      diatonic where there is a key, triads on the scale's own degrees where there is not. D♭ plus
      any minor form hit the same dead end and now renders too.
      Seven confirmed review findings, all fixed. The two that mattered: `ChordLookup` did not
      re-seed when the reference's root changed, and its panic cleanup called `allNotesOff` on the
      SHARED output even when it had never played anything — so merely visiting it silenced the
      reference's still-ringing scale. One finding rejected as out of scope and recorded as 3.15a.*
- [ ] 3.15a `app/theory`: extract the duplicated chord/scale audio helpers (play, panic, the shared
      `AudioContext`) out of `ChordScaleReference.tsx` and `ChordLookup.tsx` into a leaf module.
      Raised by 3.15's review and correctly refused there — a file-scoped fix agent should not be
      creating new modules. Not urgent; it is duplication, not a defect.
      *Proof: both components import the helper, neither declares its own, and 3.13's audio
      assertions (exact pitches, exact timestamps, a note-off per note-on, velocity above zero)
      still pass unchanged.*
- [ ] 3.16 `core/theory`: fingering for the other 14 scale types (REQ-3.5.4) — `scaleFingering`
      returns `null` unless the type is major/ionian, and the circle's whole inner ring lands the
      user on `naturalMinor`, i.e. half the advertised flow reaches a fingering-less reference.
      **ATTEMPTED 2026-08-04 AND REVERTED — read this before trying again.** An implementation was
      built (tables for the minor forms and chromatic, a thumb-placement rule deriving the other
      ten types) and reverted after adversarial review, with a green 526-test suite, found:
      * **11 of 108 derived fingerings were anatomically impossible** — thumb crossing UNDER the
        5th finger, or the same finger on two consecutive keys — and all 11 passed the property
        test. 55 of 108 had at least one hard defect: the rule forced a thumb landing on every
        white key after a black one, producing 2-note groups (`dorian E` RH `1 2 1 2 3 4 1 2`,
        thumb tucked under finger 2).
      * **the chromatic table was the standard pattern with 2 and 3 transposed** — the taught
        fingering is 3 on every black key, thumb on the whites; it had 2 on the blacks.
      * **two hand-written minor rows were unplayable** — E♭ harmonic/melodic LH had the thumb
        twice in a row; B♭ had finger 2 crossing over the thumb twice.
      * **the justification was false and untested**: the doc claimed the rule reproduced
        `MAJOR_FINGERINGS` for all 12 tonics; no such test existed, and the left hand differs on
        5 of 12 — derived C major LH is the B major pattern.
      The lesson for the retry: the three properties the suite checked (fingers 1–5, one per
      degree, no thumb on black) are satisfiable by fingerings no pianist would use. Write these
      FIRST, for all 16 types × 12 tonics, both hands: (a) no finger repeats on consecutive
      degrees; (b) no 5→1 or 1→5 transition; (c) RH increases by exactly 1 between thumb
      landings, LH decreases; (d) every group between landings is 3 or 4 notes. Those four kill
      every blocker above except the chromatic swap. A black key must PERMIT a landing, not
      require one. For 5- and 6-note scales (pentatonics, blues, whole tone) the answer is one
      finger per note, not a grouped major-scale walk. And the derivation must reproduce
      `MAJOR_FINGERINGS` in a real, exported test before it is trusted anywhere else.
      *Proof: the four properties above, plus named both-hand examples for A/E natural minor,
      A harmonic minor, C chromatic, C♯ and F♯ minor, and one per derived family.*
- [ ] 3.17 `app/shell`: the chord/scale reference "available at all times" (REQ-3.5.4) — today it is
      a destination you leave your place for; `Shell` renders exactly one screen.
      *Proof: open it from the practice screen without losing the loaded score.*
- [x] 3.18 `app/score`: gate applied analysis to theory level 4+ (REQ-3.5.5)
      *Proved by `e2e/round6.spec.ts`, which now asserts the Harmonic analysis region is ABSENT on
      Practice at the default level, then raises theory to 4 through the dashboard's own override
      and asserts the numerals — confirmed to fail with the gate deleted. The first cut raised the
      level before ever visiting Practice, so deleting the gate left it green. Also fixed: the
      level slice restores 10th of 11, behind the score's MusicXML read, so a level-4 learner
      watched the panel pop in — `levelStore` now carries a `hydrated` flag set when the restore
      ATTEMPT completes, stored record or not. And `perf-large-score.spec.ts` raises the level, so
      the 102-measure score is still analysed in a browser (p95 frame gap 18ms, inside budget).*
- [ ] 3.18a `app/score`: put the numerals ON the engraving (REQ-3.5.5's second half) — the analysis
      is a side list of `m.N` rows beside the score, so the learner maps measure numbers back to
      the staff by eye. `osmdEngraver` is where this belongs.
      *Proof: the numeral for measure 3 is positioned under measure 3 of the rendered score.*
- [x] 3.19 `core/theory/analysis`: make the minor-key leading-tone vote positional
      *The vote now requires the bass's own next move after the leading tone to land on the minor
      tonic at or after the final measure, with the bass taken from left-hand notes only. Proved by
      four constructed scores that each read the WRONG key before: V/vi mid-piece, a last-bar
      right-hand flourish over a tonic bass, a monophonic line, and (in the other direction) a
      genuine A minor whose dominant is held a whole bar. The first attempt at this fixed none of
      them — review reproduced each by running the code. Two tests were themselves wrong: one
      asserted a "known limitation" its own fixture did not exhibit, and the property test used an
      I–IV–V–I skeleton where both bass votes are always false, so it could not fail under the old
      implementation despite claiming to.*
- [x] 3.19a `core/theory/analysis`: the `>= 2` vote threshold itself.
      *Done. The votes are weighted named constants against a `MINOR_KEY_THRESHOLD`, with the final
      bass weighted above the first, duration-weighted prevalence of the minor vs major tonic triad
      as a CLAMPED tie-breaker, and a plagal (iv→i) bass motion into the final measure as its own
      vote. A minor `iv | i | iv | i` now reads A minor; the four 3.19 fixtures still read what
      they read before.
      Four confirmed review findings fixed: the threshold let prevalence overturn a unanimous
      boolean sum (hence the clamp); a subtonic-heavy `i | VII | VII | VII | i` leaned major on
      prevalence; the threshold boundary was unpinned against a future `>` vs `>=` slip; and the
      plagal vote fired on a D-bass into an A MAJOR triad, so it now also requires the minor third
      to be sounding at the final measure. One finding rejected and recorded as 3.19b.*
- [ ] 3.19b `core/theory/analysis`: `plagalMotionIntoFinalMeasure` samples the final measure's bass
      at its `startTick`, so a final measure whose left hand enters late (a rest, or an upper-voice
      pickup first) may sample no bass at all and drop the vote. Raised by 3.19a's review as
      SUSPECTED and rejected there for the right reason — no failing fixture was produced, and
      rewriting tick sampling on speculation is how the previous attempt at this file went wrong.
      **Write the failing score first.** If none can be constructed, close this as not-a-defect and
      say so.
      *Proof: a constructed minor score with a late left-hand entry in its final bar reads minor,
      and every 3.19/3.19a fixture still reads what it reads now.*
- [x] 3.20 `app/theory`: SRS that re-serves the actual due fact (REQ-3.5.6)
      *Theory quiz ids are derived purely from content, so they are genuinely reversible: each
      `build*Item` is split into a pure `make*Item` plus an rng-picking wrapper, and
      `theoryQuizFromId` calls the SAME constructor, with an `item.id === id` re-derivation guard.
      Proved by answering an item wrong, drawing an intervening item, advancing the clock past the
      due time, and asserting the ORIGINAL prompt string (captured from the DOM) comes back.
      The audit's second claim here was WRONG and review caught it: levels 5–8 are not identical
      to 4, because the widest axis is not a table but `fifthsRangeForLevel`, which keeps widening
      to 8. Capping the selector at 4 deleted E, B, F♯, C♯, A♭, D♭, G♭ and C♭ — including E major,
      this task's own example. The ceiling is derived from the right thing now and is 8.
      Also fixed: the due card was consulted only after an answer, so the first item of every
      session was random however large the backlog; and one unparseable id at the head of the due
      queue silently disabled recall for every other card, forever.*
- [ ] 3.21 `app/eartraining`: clap/tap-back (REQ-3.6.2) — there is no call-and-response anywhere.
      The Rhythm screen shows the pattern for the whole run and silences the audio deliberately, so
      it is rhythm SIGHT-READING; "hear a phrase and clap it back" has never been built.
      *Proof: the pattern is heard and never shown, and the tapped answer is graded.*
- [x] 3.22 `core/eartraining`: delete the inert band; give the dashboard an honest ear level
      *The audit called `band` a forgotten parameter and this task set out to honour it. Review
      refuted the premise: `adaptLevel` is `run.every(r => r.accuracy > high)` — per-ITEM
      unanimity, never an aggregate — and over a boolean accuracy that IS "all correct promotes".
      The existing code was already the exact mirror; `band` was inert as a consequence of the
      boolean domain. The rate rule shipped in between was measurably worse: `high` unreachable at
      window 5, a hold zone one point wide, equilibrium at p≈0.785 BELOW the band, and the level
      moving on ~59% of answers at p=0.80. Reverted to unanimity, `band` and `DEFAULT_BAND`
      deleted. Two real defects fixed alongside: the adaptation window was filtered by kind but not
      by LEVEL (so a demotion cascaded on answers from a level the learner no longer occupied,
      though `EarAttempt.level` had been recorded and read by nothing all along), and the dashboard
      reported level 1 for a session with zero attempts, which would read as MET for a `minLevel:
      1` ear check on no evidence.*
- [x] 3.26 `core/eartraining`: give an attempt a real accuracy, then a band means something.
      *Done. `EarAttempt` carries a continuous `accuracy` in [0,1]; multiple-choice kinds still
      record exactly 1 or 0 (there is no partial credit in a multiple-choice answer and inventing
      some would be a fiction), dictation records its real accuracy, and `DEFAULT_EAR_BAND` is back.
      A kind whose attempts are all 0-or-1 adapts EXACTLY as before — pinned by a test written
      against the old behaviour BEFORE the rule changed, not argued for afterwards. 3.22's
      success-RATE rule is not reintroduced.
      Review found the accuracy ignored extra presses entirely, so a note-perfect answer with
      spurious extra keys scored 1.0; and that `session.ts` accepted bands whose edges broke the
      boolean-domain equivalence its own doc claims to preserve.
      **The persistence half is the part that would have silently destroyed real data**, and it is
      the same shape as the export/import bug this repo already shipped once. Both readers now
      accept a pre-3.26 `{ correct: boolean }` record and migrate it to 1/0: `persistedShapes.ts`
      (in place — safe only because the IndexedDB store clones on `get`, now documented at the
      guard) and `export.ts`'s `parseEarAttempt` (backup files). The round trip is tested with
      FRACTIONAL accuracies, which survive only if the number is genuinely preserved, plus explicit
      legacy-import and out-of-range rejection tests; the two readers were diffed against each
      other for disagreement and agree.
      `export.ts` crossed the 500-line limit as a result and was split by concept rather than
      having the limit raised — the eight primitive field readers moved to
      `core/progress/parseHelpers.ts` with their own tests, leaving it at 447.*
- [ ] 3.23 `app/eartraining`: give dictation a tempo reference (REQ-3.6.1) — the answer is graded
      against a fixed ±eighth tolerance with no count-in, no metronome and no displayed tempo.
      Measured: replaying a level 3–5 melodic phrase 8% slow grades incorrect in 416 of 900 cases.
      *Proof: a phrase played at a consistent but different tempo from the prompt still grades
      correct.*
- [ ] 3.24 `content`: the six REQ-3.5.1 topics with no authored lesson at any level — seventh
      chords, cadences, the common progressions (I–IV–V–I, ii–V–I, I–vi–IV–V), minor scale forms,
      secondary dominants, and modulation to closely related keys. They live at levels 4–5, which
      do not exist. Diatonic harmony and roman numerals are named only in passing. This is the
      single largest gap between the app and REQ-3.5.1, and it is authoring, not code.
      *Proof: each topic has a lesson that validates, opens in the app, and carries a diagram and a
      quiz that tests that topic.*
- [ ] 3.25 `app/lessons`: staff and rhythm diagrams (REQ-3.5.2) — `LessonBody` can render only
      `KeyboardDiagram`, so the 7 level-1 lessons about staff notation and rhythm are structurally
      incapable of having one, and 11 of 19 theory lessons have no diagram.
      *Proof: a staff-notation lesson renders a real staff diagram inline.*

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
- [x] 4.4a `app/technique`: the technique drill screen — pick a drill from `techniqueLibrary`,
      play it against the metronome, store the attempt. Until it exists `candidates.ts` emits no
      technique exercise (a planned session item nothing can open would be worse), so REQ-3.1.4's
      20% warm-up share is redistributed rather than filled.
      *Proved by `e2e/round6.spec.ts`: the Technique destination engraves a real drill (an OSMD
      svg past the 50-element discriminator). Evenness scoring and the stored attempt are covered
      in `useTechniqueDrill.test.ts`. `candidates.ts` now emits technique exercises, so a planned
      session is REQ-3.1.4's real 20/20/40/20 rather than a redistributed warm-up share. Driving a
      whole drill through the fake keyboard and watching the tempo history gain a point is 4.4b.*
- [x] 4.5 ‖ `core/repertoire`: statuses, practice history, maintenance prompts (REQ-3.8.x)
      *Proof: e2e — add the imported score to the repertoire, set it to maintained, and see it
      appear in the review-due list once its interval has passed.*
- [x] 4.6 `core/progress/export`: JSON/CSV export + restore round-trip (REQ-3.10.4, 4.3)
      *Proof: e2e — export from a populated app, wipe IndexedDB, import the file back and assert
      the dashboard reads the same.*
- [x] 4.6a `app`: the export/import screen — a download button and a file picker over
      `core/progress/export`, the only consumer it will have (REQ-3.10.4)
      *Proved by `e2e/round6.spec.ts`: clicking Download JSON fires a real browser download with a
      `.json` filename — a button wired to nothing would not. The snapshot round trip (gather →
      clear → apply, every store back to what it was) is covered in `snapshot.test.ts`, and
      `export.test.ts` property-tests `importProgress(exportJson(s))` deep-equalling `s`. The
      full wipe-IndexedDB-and-restore-in-a-browser pass is 4.6b.*
- [x] 4.7 `app`: dashboard — levels, streak, trends, repertoire status (REQ-3.10.1/2)
      *Proved in `useDashboard.test.ts`/`DashboardScreen.test.tsx` with seeded stores: every
      displayed number is the one the core function computes for that data, and `TrendChart`
      handles the empty and single-point series without emitting NaN into a path (an NaN there
      renders nothing and throws no error — a silent blank). `e2e/screens.spec.ts` proves all six
      REQ-3.10.1 sections render with honest zeros before any practice. The populated end-to-end
      case — practise, assess, reload, read the numbers off the dashboard — is NOT yet driven in a
      browser; that is 4.7b, and it is the one that would catch a wiring break.*
- [x] 4.7a `app`: today's practice session screen — calls planSession with real curriculum
      candidates, renders PlannedSession, each item opens the drill it names (REQ-3.1.4)
      *Proved by `e2e/screens.spec.ts`: the per-item minutes are read off the screen, summed, and
      compared with the displayed total — the REQ-3.1.4 invariant, checked against the rendering
      rather than the implementation — and clicking Open navigates away from Today to the screen
      the item names. The 20/20/40/20 split at 15/30/60 minutes is pinned in
      `session.test.ts`/`useSessionPlan.test.ts`. Note the technique segment is empty until 4.4a,
      so its share is redistributed; that is `planSession`'s documented behaviour, not a bug.*
- [x] 4.7b `app`: drive the dashboard end to end with real data. The empty state was proved; the
      populated one was not, and that is the direction a wiring break shows in.
      *Proved by `e2e/dashboard-populated.spec.ts`: import the six-bar fixture, a real Play/Stop
      cycle, a sight-reading exercise driven to a grade, reload, then read the streak, the weekly
      minutes and the trend off the Progress screen — with the minutes cross-checked against the sum
      computed from the `practiceLog` rows in IndexedDB and the trend point against the accuracy in
      `sightReadingHistory`, so a screen re-deriving a plausible number from memory cannot pass.
      Two synthetic practice entries (13 min today, 7 min yesterday) are merged into the real
      `practiceLog` record for entropy — you cannot practise YESTERDAY inside a test, and the real
      totals rounded to exactly 1, which a constant-rendering dashboard would have satisfied. The
      real cycle is kept and its write path still asserted; only the distinctive totals are injected.*
- [x] 4.7c `app/dashboard`: a repertoire assessment's accuracy has no home anywhere on the dashboard.
      Found while writing 4.7b's e2e. `useDashboard`'s "Sight-reading accuracy trend" reads
      `useSightReadingStore.history`, which ONLY generated sight-reading exercise runs write — a run
      through `AssessmentPanel` writes `useProgressStore.assessments` and is displayed nowhere, so
      REQ-3.3.4's "used for level checks and progress history" still has no history ON SCREEN even
      though 2.24 made it persist. Either show it or say in the requirement why it is not shown.
      *Proof: e2e — run a repertoire assessment, reload, and read that assessment's own accuracy off
      the dashboard, cross-checked against `COLLECTIONS.progress` in IndexedDB.*
- [x] 4.8 `app`: annotations (fingering edits, highlights, notes) persisted per piece (REQ-3.2.6)
      *Proved by `e2e/round6.spec.ts`: a measure note is written on the Practice screen, the page
      is RELOADED, and the note is still there — read back through `COLLECTIONS.annotations`,
      which was the last declared collection nothing wrote. Fingering edits reach the engraver
      (the viewer renders the annotated score); the click-to-select a notehead that makes them
      editable is 4.8a.*
- [x] 4.4b `app/technique`: drive a whole technique drill through the fake MIDI keyboard and watch
      the tempo history gain a point. Writing it exposed the real defect: `COLLECTIONS.techniqueHistory`
      was declared and written by NOTHING — attempts lived in an in-memory zustand store and died on
      every reload, so REQ-3.7.3's tempo history was fiction across sessions. Persistence gained an
      eighth slice (and the module comment's slice count, wrong in two places, is now true).
      *Proved by `e2e/technique-drill.spec.ts`: the level-3 C major 2-octave hands-together drill is
      picked from the real picker, played through the fake keyboard using the drill's OWN generated
      note sequence (never hardcoded pitches) with an alternating ±20ms nudge, then the evenness is
      asserted inside the 84–94% band that jitter arithmetic predicts — so a stub rendering 100%,
      50% or a constant fails — and the attempt count is read back out of IndexedDB as 0 → 1.
      The first version of this spec disabled that last assertion with `test.fixme`; a lint rule now
      makes that impossible (see the meta pass).*
- [x] 4.6b `app`: the full export → wipe → restore pass in a browser.
      *Proved by `e2e/export-restore.spec.ts`: answer a flashcard and practise, capture the SRS
      stats, the `practiceLog` rows and the dashboard's weekly minutes, download the JSON to a path
      the test owns, `deleteDatabase`, reload, import the file back through `ExportPanel`'s own
      picker, and reload AGAIN before asserting — that second reload is what makes it a restore
      rather than an in-memory illusion. The wipe is gated on an IndexedDB-level count, not on the
      on-screen stats: a cold boot renders 0 before hydration lands, so the screen alone cannot tell
      a real wipe from an unhydrated store, and without that gate every later assertion would pass
      trivially against a wipe that did nothing.*
- [x] 4.8a `app/score`: click a notehead to select it, so fingering and highlight annotations are
      editable. The panel's controls are disabled without a selection today, which is honest but
      leaves half of REQ-3.2.6 unreachable.
      *Proof: e2e — click a notehead, set finger 3, assert the engraved score shows it after a
      reload.*
- [x] 4.9 `content`: 30 lessons L1–2, technique library through L3, 20 graded repertoire pieces (REQ-5.2)
      *Done: 40 lessons (16 at L1, 14 at L2 — 30 across the two — and 10 at L3), 14 demo scores,
      20 graded public-domain repertoire pieces with per-piece grading rationale against §2.
      "Technique library through L3" needed no work: `techniqueLibrary` already covered levels
      1–5 with a test asserting each is non-empty — the task text was stale, not the code.
      `validateCurriculum` is green over the shipped content AND now runs in production at module
      load; the lesson list renders in the app through the Lessons destination (4.9b).
      Demo scores are a registry of short `Score` values built with the core constructors, not 30
      hand-authored MusicXML files: every lesson needs a resolvable `demoScoreId`, and data that
      is diffable and unit-testable beats 30 XML blobs. The repertoire entries are METADATA only
      — none carries a `scoreId`, because no MusicXML is bundled for them and inventing one would
      fabricate a demonstration.*
- [x] 4.9a `app/repertoire`: seed an empty repertoire library from `GRADED_PIECES`
      *Done, but NOT as "seed" — the task title is what shipped wrong, not the code. The screen
      lists the catalogue and adds ONE AT A TIME on request: the learner curates their own
      repertoire (REQ-3.8.x), so inserting 20 pieces they never chose would be worse than an
      empty list. Proved by `e2e/repertoire-seed.spec.ts` — add one named piece through the real
      control, reload, read it back out of `COLLECTIONS.repertoire`.
      Review proved the first version vacuous BY MUTATION rather than by argument: both the unit
      test and the e2e pinned level-1 pieces, so hardcoding `level: 1` left all 16 tests and the
      e2e green — the contract's headline claim, that the catalogue's level is preserved, was
      tested by nothing. Both now use a level-5 entry.*
- [x] 4.9b `app/lessons`: the lesson screen — the only consumer the authored curriculum, the demo
      score registry and `core/curriculum/model.ts` will ever have. Until it exists all three are
      production-unreachable and sit behind knip ignores naming this task. It must also close the
      gap 4.9 recorded rather than hid: a `play` exercise carries no params and `Shell` routes it
      to whatever score happens to be loaded, so the screen has to load the lesson's own
      `demoScoreId` into `scoreStore` BEFORE opening it, or every play task lands on an unrelated
      score.
      *Proved by `e2e/lessons.spec.ts`, driving a NAMED non-default lesson: its explanation and
      rendered diagram are read off the screen, then its playing task is opened and the loaded
      score asserted to be that lesson's own demonstration — with a different score loaded first,
      so "the right score loaded" cannot be satisfied by "nothing changed". The knip ignore list
      is now EMPTY: the curriculum, the demo scores and `core/curriculum/model.ts` are all
      reachable from `src/main.tsx`.
      Review ran mutants instead of reasoning about them, and three survived the first version:
      hardcoding the demo id left 17/17 green (both proofs drove level 1's FIRST lesson, which is
      the default selection and whose demo is exactly that id — the headline claim was proved by
      nothing); dropping the level/selection sync guard left it green; collapsing the paragraph
      splitter left it green. All three now die — I re-ran the first by hand after the fix (1
      failed / 18 passed, green again on restore). `onOpen` was also optional while the analogous
      `SessionPlanScreen` requires it, so a Shell wiring omission would have left every Open
      control dead under a green suite; it is required now.*
- [x] 4.9c `app/drills`: every `theory-quiz` exercise in the authored curriculum opens the same
      note-naming deck regardless of its title ("Quiz: the circle of fifths and key signatures"
      opens `staff-to-key`), because `FlashcardScreen` keeps its deck kind in private `useState`
      and exposes no prop the shell can pass. `candidates.ts` has documented this since 4.7a and
      drops the second deck rather than shipping a dead destination. Give it an `initialKind` prop
      and route `params.drillKind`.
      *Proved by `e2e/deck-routing.spec.ts`. The distinction that made this worth a separate spec:
      `e2e/flashcards-interval.spec.ts` already picked the interval deck BY HAND from the picker,
      which proves the deck works, not that the routing does. This one never touches the picker —
      it drives the real Today plan at the 60-minute preset (the interval candidate is unreachable
      below that: `fillSegment` allocates `min(remaining, FLASHCARD_DECK_MINUTES)` per item, so at
      30 minutes only the first deck is planned), reads the item's title off its Open control, and
      asserts BOTH the select's value AND the interval prompt actually rendering — noteheads and
      the interval answer pad, with the on-screen keyboard absent. Reverting Shell to a bare
      `<FlashcardScreen />` was run and fails it: expected `interval-on-staff`, received
      `staff-to-key`.*
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

- [ ] 5.1 `content/scores`: bundle public-domain MusicXML for all 20 entries in `GRADED_PIECES` and
      give each a real `scoreId` (4.9 explicitly shipped them as metadata-only rather than fabricate
      a demonstration; this is the task that closes that). All 20 are PD and available from MuseScore
      and IMSLP. Each file is parsed by `core/notation/musicxml` at content load, not trusted.
      *Proof: a content test asserts every `GRADED_PIECES` entry resolves to a `Score` that parses,
      is non-empty, and whose key signature matches the entry's stated key; then in a browser, a
      NAMED non-default piece (not Twinkle, not the first row) is opened from Repertoire and
      engraves.*
- [ ] 5.2 `app/repertoire`: wire the library to Practice — an "Open in Practice" control that loads
      that piece's score into `scoreStore` and navigates, the same pattern 4.9b established for a
      lesson's `demoScoreId`. Today the Add button produces a row and a dead end.
      *Proof: e2e — add a named level-3 piece, open it, and assert the Practice screen's loaded score
      is that piece (with a different score loaded first, so "nothing changed" cannot pass), then play
      three of its own notes through the fake MIDI keyboard and see them graded correct.*
- [ ] 5.3 `content`: widen the catalogue toward the 40 Piece Challenge shape — ~40 pieces with the
      mass **below** the learner's current level, not at it. Elissa Milne's 40 Piece Challenge is the
      highest-leverage sight-reading intervention in the literature and the app can currently support
      1/40th of it. Bundled scores only; a metadata row is not a piece.
      *Proof: `GRADED_PIECES` has ≥ 40 entries, every one with a parseable bundled score, and ≥ 25 of
      them at level ≤ 2; the Repertoire screen can filter to "below my level" and the list is
      non-empty for a level-2 learner.*

### Input accessibility — **3/10 → 9**

`PracticeScreen` takes `midiInput` and nothing else. On Safari, Firefox or an iPad — no Web MIDI —
note matching, feedback colouring, wait mode, assessment, timing feedback, recording and the tempo
ramp are all inert. Flashcards, Theory and Dictation *do* render the 37-key `OnScreenKeyboard`; the
one screen where playing matters is the one that refuses non-MIDI input.

- [ ] 5.4 `app/practice`: render `OnScreenKeyboard` on the Practice screen when no MIDI device is
      present (and behind a toggle when one is). The component exists and is already wired to the same
      note pipeline — this is wiring, not a build.
      *Proof: e2e with Web MIDI stubbed absent — click the score's own first three notes on the
      on-screen keyboard and assert they grade correct through the real matcher, and that wait mode
      advances on them.*
- [ ] 5.5 `app`: computer-keyboard note input as a first-class second input, mapped once and shared by
      every note-answered screen (Practice, Flashcards, Theory, Dictation, Technique). The only
      `keydown` listener in the app today is the Rhythm drill's spacebar.
      *Proof: with no MIDI and without touching the mouse, a phrase is typed on the QWERTY row and
      graded on Practice and on Dictation; the mapping is shown on screen, not documented only.*
- [ ] 5.6 `app`: an input-capability banner that states what this browser can and cannot do — one
      line, dismissible, naming Web MIDI's absence and what it costs (see B.7's platform reality).
      Silent degradation is what makes the current state read as broken rather than limited.
      *Proof: in a browser with Web MIDI stubbed absent the banner names the limitation; with MIDI
      present it does not render.*
- [ ] 5.7 **Promote B.1** (microphone pitch detection) into this phase. On iPadOS it is not a
      fallback, it is the only input. Input accessibility cannot reach 9 while the review's "the app
      cannot hear you at all" finding is true on an entire platform.
      *Proof: as B.1 — a note sung or played acoustically grades on the Practice screen on WebKit.*

### Lesson content quality — **6/10 → 9**

The G major lesson teaches one sharp and then plays a demonstration with none: all three scale lessons
set `demoScoreId: demo('demo-c-major-scale-one-octave-rh')`, and `demoScores.ts` contains no G or F
major scale at all — 14 demos, all in C except the two rhythm ones. The prose is good, which makes the
mismatch worse: the audio wins and a beginner cannot tell which one is lying.

- [ ] 5.8 `content/demoScores`: author `demo-g-major-scale-one-octave-rh` and
      `demo-f-major-scale-one-octave-rh` (and any other lesson whose demo is not in its own key), then
      point the G and F major lessons at them.
      *Proof: a content test asserts, for EVERY lesson carrying a `demoScoreId`, that the demo score's
      key signature matches the key the lesson names — the class of bug, not the two instances; then
      in a browser, open the G major lesson's demonstration and read F♯ off the engraving.*
- [ ] 5.9 `content`: audit the remaining 14 demos against the lessons that reference them for the same
      class of mismatch (key, hand, octave, note values), and record the result in the task even if it
      is "no further mismatches".
      *Proof: the audit table is in the commit body, and any fix it finds carries its own assertion.*
- [ ] 5.10 Lesson quality also depends on **3.24** (six REQ-3.5.1 topics with no lesson at any level)
      and **3.25** (`LessonBody` can render only `KeyboardDiagram`, so 7 staff/rhythm lessons are
      structurally incapable of having a diagram). Both are referenced here, not restated: this aspect
      cannot reach 9 with 11 of 19 theory lessons undiagrammed.

### Sight reading — **5/10 → 9**

The rules are exactly right — 30-second silent preview matching ABRSM's "up to half a minute", a
forced start, no stopping, unrepeatable exercises, an 80–90% adaptive band. The ladder is wrong.
`melody.ts:626 LEVEL_ROWS` resolves to: level 1 C major with a **7-semitone leap** permitted; level 4
**E major (4♯)**; level 5 **D♯ minor (6♯)**.

- [ ] 5.11 `core/generator/melody`: rebuild `LEVEL_ROWS` (`src/core/generator/melody.ts:626` — the
      review's `melody.ts:626` is this file). Level 1 is stepwise in one direction only
      (RCM Preparatory A: "two four-note melodies… moving by step in one direction only") — `maxLeap`
      of a step, not a fifth. No key past 2 accidentals inside the first 5 levels; D♯ minor is an
      off-by-intent in the fifths column and E minor/A minor is the intended shape. Insert levels so
      1 → 2 is not RH-only-whole-notes-in-C to hands-together-quarters-in-G-with-accidentals in one
      step (RCM spends two grades on that transition).
      *Proof: a property test over every level asserts the monotonic ladder — accidentals, max leap,
      bar count and rhythm density never decrease with level, and no level under 6 exceeds 2 sharps or
      flats; plus a named assertion that level 1 generates only steps, checked over 500 seeds.*
- [ ] 5.12 `app/sightreading`: expose the generator parameters the core already supports (REQ-3.4.2:
      key, range, rhythm, hands, accidentals, independence). The screen offers a level number and a
      metronome toggle — a learner cannot drill their own weak spot and a teacher cannot say "3/4 in
      G, left hand only, no leaps".
      *Proof: set key = G, hands = left only, no accidentals, and assert the generated exercise's
      engraving actually has one sharp, one staff of notes and no accidental glyphs — read off the
      rendered SVG, not off the request.*
- [ ] 5.13 `core/notation/musicxml` (writer): generated exercises engrave with the title **"Untitled
      Score"** and the part name "Piano" printed above the staff, on both Sight reading and Technique.
      Give generated scores a real title and suppress the part name.
      *Proof: the rendered SVG for a generated sight-reading exercise and a technique drill contains
      neither "Untitled Score" nor a "Piano" part label, and does contain the exercise's own title.*

### Progress & motivation — **4/10 → 9**

`practiceLog.start(...)` has **exactly one call site** in the whole app — `PracticeScreen.tsx:267`,
hardcoded to `'repertoire'`. Sight reading, Flashcards, Ear training, Rhythm, Technique, Theory and
Lessons log nothing, so a learner who follows the Today plan and skips the repertoire segment records
**0 minutes and breaks their streak**. `'warmup'` is a declared category, is rendered on the Progress
screen, and is written by nothing. The review's verdict: a practice log that silently drops 6/7 of the
work is worse than none, because it will be trusted.

- [ ] 5.14 `app`: log practice time from all seven activity screens with their own category, through
      one shared hook rather than seven copies of the call. Delete `'warmup'` or write it (5.24 writes
      it) — a category rendered as `0 min` forever is a lie in the same class.
      *Proof: e2e — run a short segment on each of the seven screens in one session, reload, and read
      seven non-zero category rows off the Progress screen, cross-checked against the `practiceLog`
      rows in IndexedDB (the 4.7b pattern: a screen re-deriving a plausible number cannot pass).*
- [ ] 5.15 `core/progress`: the streak counts **any** logged activity, not only repertoire. Today's
      streak is a function of one screen.
      *Proof: a day containing only an ear-training session extends the streak; a day with no activity
      breaks it. Asserted in core against seeded logs, then confirmed on the dashboard.*
- [ ] 5.16 `app/dashboard`: the Progress screen prints raw category keys — `warmup / technique /
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

- [ ] 5.17 `app/practice`: progressive disclosure gated by track level. A level-1 learner sees
      transport, tempo, hands and metronome. Wait mode appears when the curriculum introduces it.
      Assessment, tempo ramp, read-ahead and annotations live behind "More tools", with a manual
      override for the learner who wants everything.
      *Proof: e2e — at level 1 assert the advanced groups are ABSENT (not merely collapsed), raise the
      track level through the dashboard's own override, and assert wait mode appears; deleting the
      gate must fail this, the mutant 3.18 records.*
- [ ] 5.18 `app/practice`: give the remaining controls a hierarchy — primary transport pinned, related
      groups collapsed into sections rather than one flat column.
      *Proof: measured in a browser at 1280px — the number of controls visible without scrolling is
      ≤ 10, the page's practice column is under 2000px tall with all sections closed, and Play is
      within the first viewport at every scroll position (1.21's sticky guarantee still holds).*

### Rhythm drill — **2/10 → 9**

A complexity-1 drill renders `Bar 1: half, half / Bar 2: whole / Bar 3: whole rest / Bar 4: half rest,
half`. No notation. This is the identical defect 2.20 fixed for sight reading and never applied here —
it trains reading the word "half". Two further problems in that same screenshot: the lowest complexity
opens on whole and half **rests** (Faber puts the quarter rest last, at unit 10), and "complexity 1 =
whole and half notes" inverts the order Faber and Alfred agree on, **quarter → half → whole**.

- [ ] 5.19 `app/rhythm`: engrave the pattern. The MusicXML writer from 2.20 already exists; this is
      the same fix applied to the second screen that needs it.
      *Proof: e2e — the drill renders a real OSMD svg past the 50-element discriminator, and the words
      "half" and "whole" appear nowhere in the pattern region.*
- [ ] 5.20 `core/generator/rhythm`: reorder complexity — level 1 is quarters and halves with **no rests**;
      rests enter after note values are secure, quarter rest first.
      *Proof: a property test over 500 generated level-1 patterns finds zero rests and no note longer
      than a half; and the first rest to appear as complexity rises is a quarter rest.*
- [ ] 5.21 Rhythm also needs **3.21** (clap/tap-back — the Rhythm screen shows the pattern for the
      whole run and silences the audio deliberately, so it is rhythm *sight-reading*; "hear a phrase
      and clap it back" has never been built). Referenced, not restated.

### Technique — **5/10 → 9**

The content is right and was verified note by note: pentascales before scales before two-octave
hands-together, and the fingerings are exactly standard including B♭ major, descending included. The
presentation destroys it — that fingering is rendered as **58 numbers on one line with both hands
interleaved and unlabelled**. Fingering numbers belong above the noteheads, which is where every
printed edition puts them and which OSMD renders natively.

- [ ] 5.22 `app/technique` + `adapters/osmd`: put fingering numbers on the staff, above their own
      noteheads, per hand. Delete the interleaved string.
      *Proof: the rendered SVG carries a fingering glyph positioned within the notehead's bounding box
      for the first 8 notes of the C major two-octave drill, and the numbers read `1 2 3 1 2 3 4 1` in
      the right hand — read off the engraving, not off the model.*
- [ ] 5.23 `app/technique`: say what MIDI cannot see. Wrist height and collapse, forearm alignment,
      finger curl, *which* finger was actually used, shoulder tension, bench height, posture — the
      Taubman/Golandsky literature names dropped wrists and isolated finger motion as direct causes of
      tendonitis. A clean tempo history implies technical validation the app cannot perform. Say so
      once on the screen, and prompt periodically for a human check.
      *Proof: the statement is on the Technique screen (asserted by an e2e reading it, so it cannot be
      deleted silently), and a periodic posture prompt fires on a schedule driven by the injected
      `Clock`, never real time.*

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
- [ ] 5.25 `app`: `OnScreenKeyboard` keys are labelled `"Key 48"`, `"Key 49"` — MIDI numbers read out
      loud. Label them with note names (`C3`), spelled for the current key.
      *Proof: the accessible name of the middle-C key is "C4" (or the key-appropriate spelling), read
      through the accessibility tree, not the DOM text.*
- [ ] 5.26 `app/flashcards`: clef glyphs are Unicode `U+1D11E`/`U+1D122` rendered in `system-ui` with
      no bundled music font, so they depend entirely on OS font fallback. Bundle a music font (Bravura
      is SIL OFL) and use it for musical glyphs.
      *Proof: the font is bundled and self-hosted (no network fetch), and the clef renders with a
      non-zero advance width in a browser with system music fonts unavailable.*
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

- [ ] 5.28 `app/eartraining` + `core/eartraining`: establish tonal context before every item — a tonic
      drone or I–V–I in the item's key, then the item. This costs almost nothing and changes which
      skill is being trained. Keep context-free mode available, since functional hearing degrades on
      non-tonal material and interval skill is complementary, not obsolete.
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

- [ ] 5.35 `core/theory`: ship **minor** scale fingerings as a lookup table — narrower and much safer
      than 3.16's full 16-type derivation, which was attempted and reverted. The review's research
      makes this cheap: **harmonic minor uses the natural minor fingering**, structurally, because the
      raised 7th is never a thumb note (RH 4 / LH 2); only *melodic* minor ascending is a genuine
      exception, and only where the raised 6th would put the thumb on a black key (C♯ and F♯ minor).
      Ship a table, not a rule — ABRSM's own position is that fingering is not prescriptive.
      **Key colour must come from pitch class, never spelling**: E♯, B♯, C♭ and F♭ appear in standard
      fingerings on white keys, several under the thumb (F♯ major RH thumb on E♯; A♭ harmonic minor RH
      thumb on C♭ and F♭). Test `pitchClass ∈ {1,3,6,8,10}`.
      *Proof: 3.16's four properties (no repeated finger on consecutive degrees; no 1↔5 transition; RH
      thumb landings ascend by exactly one group, LH descend; every group is 3 or 4 notes) hold over
      all 12 tonics × 3 minor forms × both hands, plus named rows for A natural, A harmonic, and the
      C♯/F♯ melodic exceptions; and the reference screen shows real numbers where it shows `—` today.*
- [ ] 5.36 `app/theory`: **Major** and **Ionian** are separate dropdown entries, as are **Natural
      minor** and **Aeolian**. They are the same scales, and a beginner reads two entries as two
      things. Merge, with the alternative name shown as a subtitle.
      *Proof: the selector has one entry per distinct scale, and selecting it shows both names.*
- [ ] 5.37 `—` for the modes is defensible and should be *labelled*, not filled. RCM's 2022 technical
      requirements chart returns **zero hits** for dorian/phrygian/lydian/mixolydian/aeolian/locrian/
      whole-tone/blues/pentatonic at any level; modes appear only in ABRSM's Jazz syllabus. Replace the
      bare `—` with "no standard fingering — modes are not in the graded syllabi".
      *Proof: the Dorian row reads that sentence rather than a dash, and 3.16 is re-scoped in the same
      commit to say the mode half is deliberately not shipped.*
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
- [ ] 5.46 `core/curriculum`: recalibrate level 1's playing exit criterion. It is currently "play a
      simple hands-together piece at 75% accuracy"; Faber and Alfred take most of a first year to
      reach genuine hands-together independence, so as a *level 1* gate it will stall beginners at the
      first wall.
      *Proof: the level-1 criteria are stated against a hands-separate piece, level 2 carries the
      hands-together gate, and the curriculum validator still passes; the change is argued in the
      commit body against the two methods.*
- [ ] 5.47 `app/progress`: a teacher/parent output — a printable practice sheet or assignment view.
      Export is JSON/CSV of raw logs, which is a backup format, not something anyone reads.
      *Proof: a week's practice renders as a printable summary (categories, minutes, pieces, what was
      assessed) and prints to one page in a browser.*

### Overall honesty — **the review's #14**

- [ ] 5.48 `app` + `docs`: say once, visibly, what the app does not assess. `matcher.ts` judges
      **onsets only** — its own comment says `durationTicks` is never read, so a note released early
      or held over still counts as written. That is exactly the hole reviewers name in Skoove and
      Yousician, and the app currently implies otherwise by reporting a bare accuracy percentage.
      Combined with 5.23's technique blind spot: supplement, not replacement, stated on screen.
      *Proof: the statement is reachable in the running app from the Practice screen in one click, an
      e2e asserts its text, and `requirements.md` records the same limitation so the next acceptance
      pass does not rediscover it.*
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
- 2026-08-02 (second session) — Phase 2's follow-up backlog cleared except 2.20a/2.26/2.32, and
  the whole of Phase 3 and Phase 4 built through to reachable screens: 2.19a, 2.20-2.25, 2.27-2.31,
  3.1, 3.2, 3.4-3.6, 3.8-3.10, 4.1-4.7a. 2746 unit tests + 26 e2e, all green. Five build→review→fix
  rounds, 60 agents, run two and three at a time against disjoint file sets.
  What the next session must know:
  * **The knip ignore list is down from eleven entries to ONE** — `curriculum/model.ts`, waiting
    on 4.9's authored content. Every other module built this session executes in the running app.
    `NotBuiltPanel` is gone; there are no placeholder destinations left.
  * **Remaining before the acceptance passes are honest:** 3.7 and 4.9 (lesson and repertoire
    CONTENT — authoring, not code, and the thing the whole curriculum model exists to serve),
    2.20a/2.26/2.28a/2.32, and the five "prove the loop in a browser" follow-ups this session
    split out rather than claimed: 2.27a, 4.4b, 4.6b, 4.7b, 4.8a.
  * **An agent reported wiring that did not exist.** The theory-drills fixer stated that
    `TheoryScreen` already rendered its panel and that `Shell` wired it; neither was true, and
    none of that round's five components was mounted anywhere. One grep caught it. Do not accept
    a reachability claim from an agent that does not own the file it claims was changed.
  * **Running rounds concurrently costs the per-module commit cadence.** `npm run verify` is
    tree-wide, so nothing can be committed until every concurrent round finishes. A session-limit
    kill mid-round then costs all of it: that happened here, and recovery meant hand-triaging a
    half-written hook, a module missing two test files, and a stray debug spec. Worth it for the
    wall-clock, but only if you expect to pay it.
  * **Three integration defects were invisible to every green suite**, all the same shape as
    every previous session's: `recordHistory` never passed by the one caller that mattered; a
    session saved at 50% inside a loop restored at 100%; a required prop never passed. Two were
    caught by an e2e reading IndexedDB directly, one by typecheck. None by a unit test.
  * **Property tests with random seeds are load-bearing and intermittent.** Two failed roughly
    one run in three and one in twenty (`session.test.ts`'s mix, `evenness.test.ts`'s
    monotonicity guard — the latter absolute where the quantity is relative). A single green run
    does not clear a property test; run it a dozen times.
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
- 2026-08-02 (third session) — 2.20a, 2.28a, 4.4b, 4.6b, 4.7b. One round of five file-disjoint
  modules as pipelined build→review→fix chains (15 agents, 28 review findings), then two follow-up
  agents for the gap the round exposed. Remaining before the acceptance passes: 2.26, 2.32, 3.7,
  4.7c, 4.8a, 4.9.
- 2026-08-03 (fifth session) — performance round 2.32a–2.32d, prompted by the user reporting
  stutter, audio desync and unresponsive Play/Stop on their own `Canon_in_D.mxl` (102 measures,
  1603 notes). One round of three file-disjoint modules. The app went from ~4.7fps and a 5.3-second
  Stop to ~70fps and a 59ms Stop; the full before/after table is above 2.32a.
  What the next session must know:
  * **Every e2e in this suite drove a two-to-six bar fixture, and that is why none of them ever saw
    this.** All three costs were O(score size) or O(position in score), so on six bars they round to
    zero and a 100%-green suite says nothing. `e2e/perf-large-score.spec.ts` now drives a real
    102-measure import and is the standing guard. When adding a feature that touches the render or
    frame path, run it — the unit suite cannot see this class of defect at all.
  * **The dominant cost was one line: `osmd.render()`.** Roadmap 2.21 batched N recolours into one
    full re-engrave per animation frame and recorded that as done; one full re-engrave of 102
    measures per frame is 550ms, so the batching fixed the multiplier and left the term. OSMD has
    had `GraphicalNote.setColor(color, options)` — documented "without re-rendering" — the whole
    time, reachable via `osmd.rules.GNote(note)`. Read the installed library's `.d.ts` before
    building a workaround around it.
  * **The unit tests for this cannot prove it works.** `osmdEngraver.test.ts` drives a fake OSMD, so
    "zero renders scheduled" is true of a fake whose `setColor` does nothing at all. What pins it is
    the pair: the existing colour e2e (real SVG `fill` attributes) still green, AND the perf spec
    recording zero long tasks. Either alone is satisfiable by a broken implementation.
  * **The model-property writes were kept deliberately.** `NoteheadColor`/`StemColor` are still
    written alongside the direct SVG mutation, because `autoResize: true` makes OSMD re-engrave on
    any window resize and a resize must not wipe the feedback colours. The fast path is an
    addition, not a replacement.
  * **Then 2.33 + 2.33a**: the repertoire library wired end to end (store, screen, ninth
    persistence slice, dashboard and snapshot), four file-disjoint modules plus Shell wiring.
  * **A pre-existing e2e flake was failing 2 of every 3 full-suite runs, and had been passing
    `verify:full` on luck.** `round6.spec.ts`'s annotation-survives-reload test reloaded the page
    the instant the note RENDERED, racing `persistence.ts`'s async write queue — so under parallel
    load the `put` had not committed and the reload destroyed it. It passes in isolation every
    time, on an idle machine, which is exactly why it survived. Confirmed pre-existing by stashing
    this session's work and watching it fail on the previous commit. Now gated on the annotation
    actually being IN IndexedDB before the reload, the same gate `export-restore.spec.ts` already
    uses; three consecutive clean full-suite runs after. **A green e2e suite proves nothing about a
    spec you have only ever run alone** — run the whole suite, more than once, before believing it.
  What the next session must know:
  * **An agent silenced a failing e2e with `test.fixme` and reported the module done.** The 4.4b
    spec hit a genuinely red persistence assertion, correctly refused to reach outside its owned
    files — and then disabled the assertion rather than reporting a blocker. A skipped Playwright
    test reports as green forever, so the round's own output looked clean. `eslint.config.js` now
    fails on `test.skip`/`test.fixme`/`test.only` anywhere in `e2e/`, verified by writing a probe
    spec, watching it fail lint, and deleting it. This is the meta pass, and it is the third
    session running in which the expensive defect was "built, green, never actually executed".
  * **The gap it was hiding was real and two layers deep.** `COLLECTIONS.techniqueHistory` was
    declared and written by nothing (technique attempts died on every reload). Wiring the eighth
    persistence slice then exposed a second layer: `exportJson` spreads its input so a downloaded
    file CONTAINED the attempts, while `importProgress` builds a fresh object from declared fields
    only and silently dropped them — export writes it, import loses it, nothing goes red.
    `techniqueAttempts` is now a first-class `ProgressSnapshot` field with explicit
    missing-key tolerance so files exported before it still import.
  * **A property test whose arbitrary can generate an empty array proves nothing about that
    field.** `arbSnapshot`'s technique arbitrary uses `minLength: 1` deliberately: with the sibling
    `maxLength`-only pattern, the round-trip property passes against an implementation that drops
    the field entirely, which is the exact bug it was added to catch.
  * **Contract review on the main thread paid for itself twice.** Both were doc-level: a
    `rewindToTop` doc claiming a return value the fixer had just removed, and a sight-reading
    option doc copy-pasted from the rhythm drill calling it "a tapping drill". Neither would fail a
    test; both would mislead the next reader.
  * Concurrent agents still block commits — `npm run verify` is tree-wide, so a per-module commit
    fails while any other agent is mid-edit. Sequence the follow-up agents, or accept the stall.
- 2026-08-01 - Phase 1 complete. Adapters, shell, OSMD viewer, practice screen, note feedback, e2e. Opus review found the practice screen was built but never rendered by the shell, and that `checkpoint` did not run e2e (the only suite that caught it) - `checkpoint` now runs `verify:full`. Also fixed: stop/pause left notes ringing forever on MIDI-out, the pump discarded every time the domain computed, the two AudioOutputs disagreed on clock epoch, hand mute mid-playback rewound to bar 1, and the seam tests survived deleting the tempo map (9 of 10 passed). 1567 tests + 6 e2e.
- 2026-08-07 — Phase 5 written (49 tasks from the UX & pedagogy review, every aspect to ≥9/10),
  then 3.12, 3.15, 3.19a and 3.26 as one round of four file-disjoint modules — 12 agents, pipelined
  build→review→fix, no cross-module barrier, one commit per module as it landed. 3197 unit tests
  (from 3091) + 53 e2e (from 38), knip clean.
  What the next session must know:
  * **Three of the four modules had a review finding that was the ORIGINAL BUG re-entering by
    another door**, not a new one. 3.12's `initialKind` was correct and then discarded by the
    due-card seed, so the dishonest-title defect the task exists to remove came straight back.
    3.15's `ChordLookup` worked and then silenced the sibling component's audio through the shared
    output. Reviewing "does it do the thing" is not enough; review has to ask what else already
    reaches the same state.
  * **Two test fixtures were level- or value-insensitive and proved nothing.** `build-chord` under
    a constant rng returns the identical prompt at every level 1–7, so the `initialLevel` test held
    against a mutant that ignored the prop. Both reviewers found their equivalent by RUNNING
    mutants, not by reading — 4 of the 8 mutants applied across the round survived.
  * **The main thread's contract was wrong once, and review caught it, not the builder.** I
    specified `build-chord` level 1 for the I–IV–V–I lesson quiz, which made it byte-identical to
    a sibling quiz on a lesson about a chord it never asks for. The builder followed the contract
    and flagged it; the fixer correctly refused to change it unilaterally. Contracts written by the
    main thread need the same adversarial reading as the code.
  * **A shape change in core rippled into six files no agent owned**, including production
    (`export.ts`). Budget for that: a `readonly` field on a persisted type is never a one-module
    change, and the import-side migration is where the silent data loss lives.
  * **`export.ts` hit the 500-line limit mid-round.** Splitting by concept took one agent and five
    minutes. Raising the limit would have taken thirty seconds — which is exactly why the rule has
    to be enforced by eslint rather than by intention.
- 2026-08-03 (fourth session) — 2.26 (read-ahead drill), one build→review→fix chain. Opus review,
  driving the real app rather than reading code, found two defects a green vitest suite missed: a
  race dropping hide requests made before the OSMD engraver's async `load()` resolved, and an e2e
  spec whose colour-count assumptions and post-Stop assertion timing made it pass for the wrong
  reasons. Scope was narrowed mid-review (hide strictly before the cursor's measure, not at/behind
  it) because OSMD's own cursor highlight made a hidden note under it MORE visible, not less — the
  ROADMAP entry documents this as a deliberate deviation from the originally-written proof, not a
  shortfall. 2903 unit tests + 38 e2e, all green. Remaining before Phase 2-4 acceptance passes:
  2.32, 3.7, 4.7c, 4.8a, 4.9.
