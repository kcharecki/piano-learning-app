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
- [x] T.5 M4 acceptance Defect 1 (REQ-3.8.2): `core/repertoire/repertoire.ts`'s `recordSession`
      (and the `bestAccuracy` it maintains) had zero call sites in `src/app/**` outside test files
      — a repertoire piece's practice history could never leave "never practised" no matter how
      much a learner actually played it. Fixed in `app/practice/usePracticeLog.ts`: `stop()` (and
      its unmount safety net) now call `useRepertoireStore.getState().recordSession` when the
      finished entry is `kind: 'repertoire'`, its `itemId` (the loaded score's id) matches a
      library piece's `scoreId`, and the session ran at least 1s (below that is treated as an
      accidental Play/Stop tap, not practice — see that file's module comment for the argument).
      One wiring point covers both an ordinary practice run and an assessment run: both drive the
      same `engine.phase` transitions `PracticeScreen.tsx`'s existing start/stop effect watches, so
      `bestAccuracy` (derived from `session.accuracy` inside core's own `recordSession`) is fixed
      by the same call — no second gap found. Downstream REQ-3.8.4 consequence (a "maintained"
      piece was always immediately due because `sessions` could never become non-empty) no longer
      holds once a piece receives a real recorded session; still true, correctly, for a piece
      never yet practised (core's own "never practised = due immediately" rule, unchanged).
      Proof: `npx playwright test e2e/m4-acceptance-repertoire-practice-history.spec.ts` passes for
      real (`test.fail()` deleted) — add Greensleeves, open in Practice, play it, stop, the
      Repertoire row no longer reads "never practised". Scoped `vitest run src/app/practice
      src/app/state/repertoireStore.test.ts src/core/repertoire`: 63 passed, incl. 8 new cases
      covering the scoreId match, the duration floor, a non-repertoire kind, an unmatched itemId,
      and — asserted, not assumed — that the unmount safety net does not reintroduce the React 18
      StrictMode near-zero-duration phantom into the repertoire store. `npm run typecheck` and
      `eslint` clean on owned files. Does not close 4.10 — that verdict needs a full M4 re-run.

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
- [x] 3.16 `core/theory`: fingering for the minor forms (REQ-3.5.4) — **closed 2026-08-11 by
      5.35 + 5.37, not by a fresh attempt at the 16-type derivation this entry warns about.**
      Nothing was left to build: 5.35 shipped the minor tables and 5.37 labelled the eleven types
      that have no standard fingering in any graded syllabus, which between them account for all
      16 `SCALE_TYPES`. Verified against the merged code rather than inferred from the two task
      boxes — `scaleFingering` returns a real `Fingering` for all 12 tonics of each of major,
      ionian, naturalMinor, harmonicMinor and melodicMinor (5 × 12 = 60 covered pairs), and every
      one of the remaining 11 types is in `NO_STANDARD_FINGERING_TYPES`, so the set of types that
      are neither covered nor labelled is **empty**. The four anatomical properties this entry
      demanded be written FIRST were written first, by 5.35, and an adversarial review this
      session extended all four to the major table as well, which had been carrying the weaker
      "step between 1 and 3" check the original post-mortem was written about.
      The historical record below is kept deliberately: it is the most expensive lesson in this
      file and the reason the task closed this way instead of by deriving 16 types again.
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
- [x] 3.17 `app/shell`: the chord/scale reference "available at all times" (REQ-3.5.4) — today it is
      a destination you leave your place for; `Shell` renders exactly one screen.
      *Proof: open it from the practice screen without losing the loaded score.* Shipped as the
      non-modal overlay side panel resolved in `docs/parallel-round-10.md` Q2: new
      `src/app/reference/ReferencePanel.tsx` wraps the existing, unedited `ChordScaleReference`;
      `Shell.tsx` gets a persistent `.reference-toggle` (fixed at every width, `aria-expanded`/
      `aria-controls`) and renders the panel as a sibling after `app-main`. Mounts nothing until
      first open, then hides via `hidden` rather than unmounting; no focus trap/`aria-modal`; Escape
      and the scrim (≤1024px only, z-tier matches `.nav-scrim` so the toggle buttons stay clickable
      through it) return focus to the toggle; mutually exclusive with the nav drawer. *Proof done:*
      `e2e/reference-panel.spec.ts` drives Practice with a loop range, running transport and
      metronome, one matched note, then opens the panel and in one continuous run confirms the
      transport keeps advancing, the panel's own Play works, Shift+Tab reaches and toggles the
      transport's Pause with the panel still open, Escape closes it and returns focus with loop
      range/matched-note count/position all unchanged, and reopening restores the selected scale —
      plus a second spec proving the ≤1024px drawer/nav-drawer mutual exclusion and 44px touch
      target. Visual pass (`Practice --click Reference`) console-clean at both widths, both themes.
      2 real bugs found and fixed during the drive: focus-on-open raced the first-open mount (fixed
      by keying the focus effect on `hasOpenedOnce` too), and the scrim's z-index sat above the
      persistent toggle buttons, intercepting their clicks (fixed to match `.nav-scrim`'s own tier,
      below `--z-nav`). Deleted nothing.
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
- [x] 3.21 `app/rhythm`, `core/rhythm`: clap/tap-back (REQ-3.6.2) — a new "Clap-back mode" on the
      Rhythm screen (a mode switch, not a nav destination — `Shell.tsx` was owned by another
      session this round): the transport plays the pattern AUDIBLY once (no notation ever
      engraved), then replays silently-but-clicking on the same transport instance so the learner
      taps the phrase back from memory; `core/rhythm/clapback.ts` (new, property-tested) grades it
      with a level-scaled tolerance window and a tempo-scale fit over the tapped onsets' own gaps
      (mirrors `core/eartraining/dictation.ts`'s roadmap-3.23 approach, worked out independently for
      bare timestamps) — a phrase tapped a consistent 8-12% off tempo still grades correct; a phrase
      with one extra or one dropped tap does not. `gradeTapping`/`core/generator/rhythm.ts` were left
      untouched (owned by another session) — this is a new, separate grading module.
      *Proof: `RhythmClapback.test.tsx`/`e2e/rhythm-clapback.spec.ts` assert the notation is ABSENT
      from the DOM (element count, not visibility) through listening, tapping and graded; the e2e
      spec taps a known count and asserts `matched + extra` equals it against a real generated
      pattern. `npm run typecheck`/scoped `vitest`/`eslint` green; visual pass on all four
      idle/listening/tapping/graded x 1280/1024 x dark/light combinations, console clean.*
      **Adversarial review (Opus, high effort) found 10 defects post-merge, all fixed**: the level
      was local state that reset to 1 every mount and never adapted (now sourced from/persisted to
      the ear-training session store, `useClapbackDrill.ts`); two confirmed surviving mutants in
      `clapback.ts` (the tick->ms tolerance conversion, and the nearest-neighbour match's sort key)
      had no test pinning them; an all-rest draw could score 100% for zero taps; plus weaker test
      coverage than the mutant class warrants in `dictation.ts` and `scales.test.ts`. See
      `e2e/rhythm-clapback-adaptive-level.spec.ts` for the level surviving a real page reload.
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
- [ ] 4.10 M4 acceptance pass — full §9 acceptance criteria review — **re-run 2026-08-12, still does
      NOT pass**. The 2026-08-11 blocker (REQ-3.8.2 practice history) is genuinely fixed by triage
      T.5 and was re-proven here under a stricter test — the old spec only asserted the row stops
      saying "never practised"; the new one reads the session back out of IndexedDB and backdates
      the stored timestamp so the screen must follow it. Both stale e2e specs from the last run are
      also fixed. But **two criteria that passed on 2026-08-11 fail today**, so the score went 20/21
      → 19/21. Full per-criterion table, diff and proposed tasks: `docs/m4-acceptance-2026-08-12.md`.
      New blockers, each with a driven proof left in the suite:
      - **FIXED 2026-08-12 (integrator).** `npm run knip:prod` was red on
        `src/app/sightreading/noteDisplay.ts` — implemented and tested, imported by nothing, its
        stated consumer `PatternPreview.tsx` deleted by 5.19. Deleted the module and its test; the
        evidence for pruning the test is the module going with it, not a judgement call. The other
        finding, `midiToFrequency` dead in core and duplicated privately in `webaudio.ts`, is fixed
        the other way round: the adapter now imports core's, so one function has one home (its local
        copy's comment also read "A2 = 440 Hz at MIDI note 69", which is A4). *Proof:*
        `npm run knip`, `knip:prod` and `knip:prod:all` all exit 0, unpiped; `npm run verify` green
        at 3774 tests.
      - **`npm run verify:full` is green end to end — exit 0, unpiped, 123 e2e tests.** First time
        this gate has ever run to completion. The audit saw it exit 1 at `knip`; that stage passes on
        master, and `knip:prod:all` was fixed above. Getting the rest green took three real fixes,
        none of them a threshold being loosened:
        (i) B.2 and B.5 each added a barrel re-export nothing imports (`createAudioRecorder`/
        `createAudioPlayback`/`PREFERRED_MIME_TYPES` in `adapters/audio/index.ts`, the two BLE UUIDs
        in `adapters/midi/index.ts`) — their consumers import the modules directly. Neither agent
        could have seen it: `knip` is not in `verify`, only in `verify:full`. Removed, with the
        reason recorded in both barrels.
        (ii) `e2e/piano-roll.spec.ts` waited for an EXACT beat while the transport ran at written
        tempo — a beat that comes and goes between two polls is never seen again, so the wait burned
        its timeout with playback already past it. Green solo, red in the full suite where every
        worker fights for the same CPU. Fixed by dropping the tempo to the slider's 30% floor before
        Play; every assertion is unchanged, because the lit pitches and the tick delta are properties
        of the score and the geometry, not of the tempo.
        (iii) `e2e/onboarding.spec.ts` clicked "Not now" and reloaded immediately, racing
        `useOnboardingGate.markCompleted`'s deliberately un-awaited IndexedDB write (its own module
        doc accepts "the banner reappears next boot" as the worst case). Now the spec asserts the
        persisted `{ completed: true }` record directly before reloading — the durability claim
        stated rather than inferred from a reload that happened to outrun the write.
      - **FIXED (task/M4.F2) — REQ-3.10.4/REQ-4.3, a backup drops a repertoire piece's history, and
        restoring one destroys it.** `RepertoirePieceLike` (`src/core/progress/export.ts`) is widened
        to carry every field `RepertoirePiece` has — `level`/`sessions`/`bestAccuracy`/`notes`/
        `scoreId` — so export-then-restore of the learner's own backup is now lossless; `toRepertoirePiece`
        (`src/app/progress/snapshot.ts`) no longer fabricates them at defaults. Backward compatibility
        is explicit: an OLD-format file (written before this change, missing all five fields) still
        imports cleanly at the old fabricated defaults — proven with a real pre-widening fixture, both
        in `export.test.ts` and driven live against the running app (a hand-built old-format JSON
        restored without a crash, landing at "Level 1"/"never practised"). CSV was made lossless too,
        rather than caveated on screen: `repertoire.csv` gained `level`/`bestAccuracy`/`notes`/`scoreId`
        columns, and practice sessions (a one-to-many relationship a flat row can't hold without lying)
        got their own `repertoireSessions.csv`, keyed back to the piece by `pieceId`. A restored
        `level` is clamped into `MIN_LEVEL..MAX_LEVEL` rather than trusted verbatim from an untrusted
        file. *Proof:* `npm run verify` green (183 files / 3765 tests); a new `fast-check` round-trip
        property test covers the widened repertoire record; `e2e/m4-acceptance-export-repertoire-history.spec.ts`
        passes for real with its `test.fail()` deleted — practise Greensleeves, give it notes, export
        the real downloaded JSON (carries `sessions`/`bestAccuracy`/`level`/`notes`), wipe via restore,
        and the practice history/level/notes read back off the live screen unchanged. Also driven live:
        a corrupt file surfaces a readable error and leaves the library untouched (never a silent
        wipe), and an empty profile exports `repertoire: []` with no crash. Visual pass on Progress
        clean at 1280/1024, dark/light, console clean throughout.
      - **FIXED (task/M4.F1, 2026-08-12).** REQ-3.1.4 — the daily session no longer held the stated
        20/20/40/20 mix (regression from 5.45). Two causes, both fixed:
        (a) `core/curriculum/session.ts` no longer reserves a flat `WARMUP_MINUTES` off the top of
        the budget. `technique`'s own 20% mix share IS the combined "warm-up/technique" bucket
        REQ-3.1.4 names; it is apportioned over the FULL budget exactly like the other three
        segments, and warm-up then claims up to `WARMUP_MINUTES` OF that bucket, technique keeping
        the rest — so warm-up stays at its full 5-step, ~1-minute-a-step routine (`WarmupChecklist`
        never truncates by minutes) whenever the bucket allows it, and is never squeezed to zero by
        technique. (b) `app/session/candidates.ts`'s `lessonCandidates` now falls back — loaded
        score, then the learner's own first repertoire piece, then the curriculum's first lesson —
        so the `lesson` segment always has a real candidate, even on a cold profile with an empty
        score store AND an empty repertoire library (the repertoire library is never auto-seeded;
        confirmed via `repertoire-seed.spec.ts`). Measured on the running app (`npm run dev -- --port
        5816`), cold and warm profiles now both hold the mix EXACTLY at 15/30/60 minutes: warm-up +
        technique 20.0% at every budget (15 min: 3+0=3; 30 min: 5+1=6; 60 min: 5+7=12), sight-reading
        20.0%, lesson/repertoire 40.0%, theory/ear 20.0% — well inside the spec's ±8-point tolerance,
        exactly on target because 15/30/60 divide evenly into the default shares. *Proof:*
        `e2e/m4-acceptance-session-mix.spec.ts` passes with both `test.fail()` markers deleted (2/2),
        full `npx playwright test` 110/110, `npm run verify` green (docs budget, typecheck, lint,
        3757 tests), visual pass on Today at 1280/1024 × dark/light on both a cold and a
        score-loaded profile, console clean throughout. Files touched:
        `src/core/curriculum/session.ts`, `src/app/session/candidates.ts`,
        `src/app/session/useSessionPlan.ts`, `src/app/session/SessionPlanScreen.tsx` (the dead
        "load a score" hint became a real "no score/no repertoire yet" note, shown only when the
        lesson item is the generic curriculum fallback), plus their tests. Not personalized: the
        curriculum fallback is always level 1's first lesson, not the learner's actual progress —
        flagged, not fixed, since REQ-3.1.4 is about proportions, not content relevance, and a
        learner this far into a cold state almost always has a repertoire piece by then, which takes
        priority anyway.
      - Process hazard found while auditing: `npm run … | tail -N` reports *tail's* exit code. Two
        results previously read as green (the full e2e run, `knip:prod`) were red underneath.

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
- [x] 5.10 The gate itself, over what 3.24/3.25 landed. Verified live, not from the ticked boxes: every
      theory lesson at every level (1-5) opens with a real engraved `<svg>` diagram, console clean —
      driven in the browser on port 5325, screenshotted both widths/themes on `l4-seventh-chords` and
      `l5-minor-scale-forms` (both new), console clean throughout.
      **Content audit, the 5.9 five dimensions (key, hand, octave, note values, concept) re-run over
      what exists now: 46 `demoScoreId` lessons audited (40 from 5.9 + 6 new from 3.24), 6 defects
      found** — all six new level 4-5 lessons' demos were on-topic but not on-topic enough: a
      triad-inversion cycle standing in for `l4-seventh-chords`' actual seventh chord, a bare V-I
      standing in for all four of `l4-cadences`' named types, one progression standing in for
      `l4-common-progressions`' three, a chord pair (not a scale at all) standing in for
      `l5-minor-scale-forms`, a plain I-V-I never sounding the borrowed chord `l5-secondary-dominants`
      names, and a same-key run with no chord ever reinterpreted standing in for
      `l5-modulation-closely-related-keys`'s pivot. Both of the task's flagged open gaps are closed, not
      argued acceptable: authored 6 new demos in `harmonyDemoScores.ts` (`@core/notation/score.ts`
      builders only, no transcription) that play exactly what each lesson's prose promises, verified
      against the real theory core, not the demo's title — `romanNumeralFor`/`classifyCadence` on the
      cadences and the modulation's actual pivot chord, `scaleNotes` pitch-class assertions on the three
      minor forms. The 40 pre-existing lessons re-checked clean (5.9/5.9a's fixes hold).
      A second, smaller pass over diagram-vs-prose (part of verifying 3.25, not a demoScoreId
      dimension): 1 of 25 diagrammed lessons found short — `l3-keys-to-two-sharps-flats` names D major
      and B-flat major with equal weight but only diagrammed D major; added `b-flat-major-scale` to
      `diagrams.ts` and referenced it. *Proof: `curriculum.test.ts`/`demoKeyConsistency.test.ts` stay
      green; `demoScores.test.ts` gained 11 new content assertions reading each new demo's actual notes
      (never its title) — 108 of 108 scoped tests pass, `npm run typecheck` clean, `eslint` clean on
      every owned file.* Deleted nothing — the six repointed lessons' old demoScoreIds
      (`demo-c-major-triad-blocked`, `demo-authentic-cadence-c-major`, `demo-i-iv-v-i-c-major`,
      `demo-c-major-and-a-minor-triads`, `demo-i-v-i-c-major`, `demo-circle-of-fifths-c-g-f`) stay in
      the registry, still referenced by their original level 2-3 lessons.

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
- [x] 5.21 Rhythm also needed **3.21** (clap/tap-back). Done together with 3.21 — see that line;
      "Clap-back mode" on the Rhythm screen IS the Rhythm-specific delivery this line asked for.

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

- [x] 5.24 `adapters/osmd`: `paint()` classifies the colour `setNoteColor` gets against `FEEDBACK_CORRECT_COLOR`/`WRONG`/`MISSED` and stamps the matching
      `.note-correct`/`.note-wrong`/`.note-missed` class on the notehead, on the no-re-render fast path; `reapplyFeedbackClasses` restamps after every
      OSMD-triggered re-render (autoResize), since a class has no model-level survival. 3 states colour a note; `extra` colours none, needs no class — 3
      reported, 3 confirmed. 2 more `domain.css` defects found and fixed: the class landed on `<g class="vf-notehead">`, but the child `<path>` OSMD
      paints has its OWN `stroke="none"`/`dasharray="none"`, blocking inheritance — even `.note-missed` (never exercised before) was inert; added a
      `path` descendant selector plus explicit `stroke-width` (was an invisible inherited 0.3px). `.note-wrong` redesigned hollow+dotted, not
      filled+scalloped, which read as noise at real notehead size (verified live). `useNoteFeedback.ts`'s colours stay literal hex, not imported —
      `note-colour.spec.ts` (out of scope) scrapes `WRONG_PITCH_COLOR` verbatim; `osmdEngraver.ts` exports the same 3 under its own names, synced by comment.
      *Proof: `e2e/note-shape.spec.ts` (new) — under greyscale, a wrong note carries `class="note-wrong"` and non-empty `stroke-dasharray`;
      `note-colour.spec.ts`/`perf-large-score.spec.ts` (0 long tasks) unchanged, green. 8 new `osmdEngraver.test.ts` cases.*
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
- [x] 5.27 `app`: confirm the ≤1024px responsive drawer **by hand in a real browser at tablet width**.
      The review could not verify it — the automation pane does not composite frames, so the nav's
      `translateX(-100%)` transition sits frozen at t=0. That is an environment artefact, not a defect,
      and it is the one claim in the review that is unchecked. Folds into **B.6**.
      *Proof: at 768×1024, the drawer opens and closes on tap, the scrim dismisses it, no control is
      under 44px, and the page does not scroll horizontally — screenshotted, not asserted from CSS.*
      The interactive Browser pane would not composite here either, so verified via Playwright (a real
      compositing Chromium) instead, per the task's own fallback instruction — `e2e/responsive-drawers.spec.ts`,
      covering both drawers this app now has (nav, and 3.17's new reference drawer). **The drawer was
      genuinely broken and is now fixed**: `.app-nav` and `.app-topbar` shared the same `--z-nav` tier,
      and `.app-nav` painted later in the DOM, so the OPEN nav drawer visually covered its own
      `.nav-toggle` hamburger — a second tap on the same icon that opened it hit the drawer's own
      "Today" button instead of closing anything, and only the scrim or a nav item's own
      navigate-and-close could dismiss it. Fixed in `src/design-system/css/responsive.css` by giving
      `.app-topbar` a z-index one tier above `.app-nav` (`calc(var(--z-nav) + 1)`), documented in place.
      Fixing that then covered the reference toggle in turn (same tier collision), fixed by raising
      `.reference-toggle` to the panel's own `--z-dialog` tier in `feature-reference-panel.css`. First
      screenshot attempt also caught a genuinely mid-transition frame (proof the composite-frame problem
      is real) — fixed by waiting out the 200ms `--dur-2` transition before each capture; real settled
      screenshots are in `visual-pass/5-27-responsive-drawers/`. Full existing e2e suite (101 specs)
      re-run clean after both CSS fixes — no regression.

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
- [x] 5.29 `app/eartraining`: reveal the answer. New `RevealPanel.tsx` renders after every graded item
      (correct or wrong, since a correct guess taught as little as a wrong one before this) — the
      answer named with its REAL sounding pitches ("major third — C3 and E3", not just "a major
      third"), engraved on a staff (`ExerciseScore` + `createOsmdEngraver({ presentation: 'reference'
      })`, the same pipeline `ScaleStaff` uses — imported, not edited) and shown on `KeyboardDiagram`
      (imported, not edited), plus — interval kinds only — a "Play reference interval" control
      (`useEarTraining.ts`'s new `playIntervalReference`, always middle-C-anchored, register-
      independent of the draw) and a named mnemonic tune (title only, no melody or lyrics reproduced).
      The existing Replay control is what "replay with the answer named" reuses; no second Replay
      button.
      *Proof: `EarTrainingScreen.test.tsx`'s "a wrong answer reveals the two actual pitches, a staff, a
      keyboard, and replays on request" asserts the DOM (pitch names, staff, keyboard) and the
      `RecordingAudioOutput` calls after pressing Replay; `RevealPanel.test.tsx` (11 tests) covers
      every kind directly; `e2e/eartraining-reveal.spec.ts` drives the real running app end to end
      (interval and chord-quality kinds), 2/2 green against a real OSMD render. Visual pass
      (`scripts/visual-pass.mjs "Ear training" --url http://localhost:5303 --click Play --click
      "major third"`) at both widths, both themes: console clean, reveal fully visible.*
- [x] 5.30 `core/eartraining/intervals`: staged the interval set by level — level 1 is exactly {M3,
      m3}; level 2 adds P5; level 3 adds P4; level 4 adds P8 (the octave); level 5 folds in the rest
      (M2/m2/M6/m6/M7/m7, the tritone, and the compounds of levels 1–4 minus the octave). Follows RCM;
      the module doc states explicitly this is a defensible choice among several (Trinity's 2nd–6th
      together, Musical U's 2nds-first), not the only one.
      *Proof: `intervals.test.ts` asserts the exact level-1 set and that each later level adds rather
      than replaces (plus the pre-existing monotonic property test, unchanged); `IntervalAnswerButtons.
      test.tsx` confirms the on-screen pad matches the new staging. `useEarTraining.test.ts` and
      `EarTrainingScreen.test.tsx` updated throughout for the new level-1 draw (M3 instead of P5).*
- [x] 5.31 `app`: the SRS panel exposes Anki's internal vocabulary to a piano beginner — *Cards / Due /
      Young / Mature / Average ease 2.50* — on Ear training, Flashcards and Theory. Nobody learning
      piano knows what a mature card is. Replace with learner-facing language; keep the raw numbers
      behind a details toggle if they are wanted for debugging.
      3 reported, 4 found: `DashboardScreen.tsx`'s "Theory retention" section rendered the identical
      *Young / Mature / Average ease* row and was not named in the original report. Built one shared
      `src/app/srs/SrsSummary.tsx` (never four copies) and pointed all four screens at it. New words:
      **Due now** (unchanged — already plain), **New** (`total - young - mature`: never yet answered
      correctly), **Learning** (the scheduler's `young`: recalled once, interval still short — "still
      building the memory"), **Mastered** (the scheduler's `mature`: interval ≥ 21 days — "you know
      this well now"). The scheduler's own words move into a closed-by-default `<details>` ("Scheduler
      details"), the same disclosure convention `SightReadingCustomizer.tsx`/`.practice-more-tools`
      already use — not deleted, one click away for debugging. Numbers unchanged throughout; only
      label and default visibility moved. `src/core/srs/scheduler.ts` untouched, its own tests
      unchanged and green.
      *Proof: `SrsSummary.test.tsx` (new, 4 tests) asserts the translation and the empty state; none
      of "Young", "Mature" or "ease" appears in the default (closed-`<details>`) view of any of the
      three drill screens — confirmed both by component test and a driven Playwright run against
      `localhost:5322` that answers a real Key-signature flashcard, watches Cards/Due now/New/
      Learning/Mastered move with real numbers (1/0/0/1/0), then opens "Scheduler details" and reads
      the same data back as Young:1 Mature:0 Average ease:2.65. `visual-pass.mjs` clean (console, both
      themes, both widths) on Flashcards, Ear training, Theory and Progress.*
- [x] 5.32 `app/eartraining`: added a persistent on-screen statement, visible for every drill: "This
      screen has no microphone — it can't hear you sing, only what you click or play on a keyboard.
      RCM accepts keyboard playback like the answers here as an equivalent response, but ABRSM,
      Kodály, Dalcroze and Berklee all grade aural skills by having you sing back what you heard. Get
      the fuller benefit by singing the interval, chord or phrase back out loud — away from this
      screen — before you check the answer below."
      *Proof: `EarTrainingScreen.test.tsx`'s "states on screen that it cannot hear singing, names
      RCM's keyboard exception, and tells the learner what to do instead" asserts the statement, the
      named RCM exception, and the named away-from-the-app practice (sing back out loud); a second
      test confirms it persists across drill selection.*
- [x] 5.33 Copy bug fixed: `describeExpected` now prepends a phonetic (not orthographic) indefinite
      article via a new `articleFor` helper — "it was a perfect fifth" / "it was an augmented fourth".
      Class searched within the owned files: 1 reported, 1 found — `EarTrainingScreen.tsx`'s
      wrong-answer feedback line is the only place this sentence is built.
      *Proof: `EarTrainingScreen.test.tsx` asserts "it was a major third" from a real wrong answer
      driven through the app; a dedicated `articleFor`/`describeExpected` suite covers every quality
      this drill can produce, plus the "unison"-is-a-consonant-sound exception ("a unison" vs "an
      octave") directly.*
- [x] 5.34 `core/eartraining/dictation`: the 2–8 note bound now scales linearly by level via a new
      `noteBoundsForLevel` — level 1 is 2–3 notes, level 5 is 7–8, levels 2–4 interpolate (3–4, 5–6,
      6–7) — the outer bracket (`MIN_DICTATION_NOTES`/`MAX_DICTATION_NOTES`, still 2 and 8) is kept
      exactly as REQ-3.6.1 states it, applied identically to both the melodic and rhythmic generators.
      *Proof: `dictation.test.ts`'s new property test asserts level 1 is 2–3 notes and level 5 is 7–8,
      over 200 generated items per level, for both kinds; a second property test pins the level-3
      midpoint (5–6 notes) to guard against a mutant that scales only one end of the window.*

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
- [x] 5.38 **Closed 2026-08-12 by 5.50**, the one gap its 2026-08-11 re-verification left open. Every
      other half of this aspect was already proven that day (see below); what was missing was a chord
      on a staff anywhere in the theory layer. 5.50 shipped `ChordStaff.tsx` through the same
      `Score` → `ExerciseScore` → `createOsmdEngraver({ presentation: 'reference' })` path `ScaleStaff`
      uses — no third rendering route — for BOTH consumers: `ChordLookup`'s looked-up chord and
      `ChordScaleReference`'s diatonic rows. Verified by the integrator on merged master rather than
      from the ticked box: `e2e/theory-chord-staff.spec.ts` reads each notehead's engraved pitch off
      the SVG (not its presence) — D-flat diminished seventh gives 4 noteheads at midi 61/64/67/70,
      the V7 diatonic row 4 at 67/71/74/77 — and both pass alongside the rest of the merged round
      (11/11 specs, one dev server, one run). The spelling comes from core's own `SpelledPitch` per
      3.14a, never a re-derived enharmonic guess. One thing deliberately NOT done: the original bullet
      said "grand staff"; the shipped engraving is a single treble staff, because reusing `ScaleStaff`'s
      existing pipeline was the explicit instruction and a second bass-clef part would have been a new
      rendering route. Flagged here rather than quietly satisfied.
      The 2026-08-11 record of the other halves is kept below.
      The rest of this aspect was **3.14** (no staff rendering in the theory layer — `osmdEngraver`
      is never imported there), **3.15** (no chord picker, no sevenths, and the chord section vanishes
      entirely for the 10 modal/exotic types) and **3.17** (reference is a destination you leave your
      place for). Referenced, not restated; the aspect cannot reach 9 without them, because "you
      cannot look up D♭ diminished seventh" is what a reference is *for*.
      **Re-verified 2026-08-11, once 3.17 landed — still not shippable, one real gap found.** Driven
      live against the running app (`node scripts/_verify-538.mjs`-style Playwright drive, not
      inspection): opened the reference from Practice without leaving; looked up any chord including
      sevenths and diminished sevenths (`ChordLookup`'s `CHORD_QUALITIES` covers all 13, confirmed live
      with D♭ diminished seventh → symbol "Dbdim7"); looked up any scale, all 16 `SCALE_TYPES` including
      the modes/pentatonics/blues/whole-tone (3.15's fix); heard both (Play buttons, confirmed wired);
      saw the SCALE on staff (`ScaleStaff`, confirmed rendered). **The gap: a chord — neither a looked-up
      one in `ChordLookup` nor a diatonic one in `ChordScaleReference`'s own list — is EVER shown on
      staff, anywhere.** `grep`-confirmed no chord-staff component exists in `src/app/theory/**` or
      `src/core/theory/**`; live-confirmed 0 staff/score elements inside `.chord-lookup` or
      `.diatonic-chords` with a diminished seventh chord selected (screenshot on file from this
      session). REQ-3.5.3/3.5.4's "see it on staff and keyboard" is met for scales, not chords — every
      chord is keyboard + audio only. **Leaving unticked**; the gap is 5.50 below.
- [x] 5.50 `app/theory`: engrave a chord on staff, not just the keyboard diagram — the gap 5.38's
      2026-08-11 re-verification found. Both `ChordScaleReference`'s diatonic chord rows and
      `ChordLookup`'s looked-up chord need a small staff rendering of the chord's own notes (reuse
      `ScaleStaff`'s pattern of building a real `Score`/`Measure` and handing it to the existing
      `ExerciseScore`/`ScoreViewer` — a chord is a single simultaneity, a strict subset of what that
      path already engraves for a scale's run of single notes). Owned by whichever session next touches
      `src/app/theory/**` (not this shell/onboarding/reference-panel session — out of file boundary).
      **Done.** New `ChordStaff.tsx` builds a whole-note-chord `Score` (every tone `startTick: 0`, same
      duration, so `musicxmlwriter.ts` marks them a real `<chord/>` simultaneity) with each tone's own
      `spelling` carried through untouched — Db diminished 7th engraves Db Fb Abb Cbb, not a respelled
      guess. Single treble staff, right hand, `presentation: 'reference'` — the exact same pipeline
      `ScaleStaff` already uses (a literal "grand staff" was this bullet's own loose wording; the task
      brief for this slice was explicit about reusing `ScaleStaff`'s existing single-staff path rather
      than inventing a second one, and a grand staff has no left-hand part to put on its bass clef for a
      chord that is a single right-hand simultaneity). Wired into both consumers: `ChordLookup` renders
      it below the keyboard diagram for the looked-up chord; `ChordScaleReference`'s shared `ChordRow`
      renders it for every row in both `DiatonicChords` and the no-key `ScaleDegreeChords` fallback.
      *Proof: `npm run verify` green (183 files, 3753 tests). Playwright
      (`e2e/theory-chord-staff.spec.ts`, driven live on port 5302): looked up D♭ diminished seventh in
      `ChordLookup` — exactly 4 `.vf-notehead`s, engraved pitches read off each notehead's own
      `data-note-id` equal midi [61, 64, 67, 70] (Db4 Fb4 Abb4 Cbb5); toggled "Show seventh chords" and
      selected the `ChordScaleReference` V7 row — exactly 4 noteheads, midi [67, 71, 74, 77] (G7).
      Visual pass (`scripts/visual-pass.mjs Theory`, both widths, both themes, Db dim7 selected):
      console clean in all four configurations; every diatonic row and the lookup show a compact
      "paper" staff under their keyboard diagram, correct in both themes. States: empty/loading/error
      N/A (a chord is always ≥3 notes, built synchronously; OSMD failure already surfaces through
      `ScoreViewer`'s existing error paragraph, unchanged here); no-MIDI N/A (read-only reference,
      unaffected by MIDI connection state).*

### First-run experience — **2/10 → 9**

The app opens on Practice (`Shell.tsx:185`) showing Twinkle, with 30 controls below it. There is no
onboarding, no first-run state, and no "start here". The front door is the most intimidating screen in
the app.

- [x] 5.39 `app/shell`: the default destination is **Today**, not Practice — `/` now parses to Today's
      own route (landed with 5.42). *Proof: `e2e/default-destination.spec.ts` wipes IndexedDB, reloads,
      asserts Today (not Practice) is active at `/today` — a fresh profile the test itself creates.*
- [x] 5.40 `app/onboarding`: a first-run flow — a few questions (experience, goal, practice minutes), a
      MIDI/input check that tells the truth about this browser (5.6), starting track levels set from
      the answers, and a first session ready to start. Skippable, and re-runnable from settings.
      *Proof: e2e from an empty IndexedDB — complete onboarding, assert the chosen levels are what the
      dashboard shows after a reload, and that Today's plan is non-empty and matches the chosen
      minutes.* Shipped as a dismissible callout on Today (`src/app/onboarding/OnboardingGateway.tsx`)
      that expands into the full flow (`OnboardingFlow.tsx`), plus a new Settings destination
      (`SettingsScreen.tsx`, `route.ts`'s `settings` screen id) that re-runs it unconditionally — **not**
      a hard gate blocking every destination, a deliberate deviation from the literal "complete
      onboarding" reading; see the design note below. Reuses `isWebMidiSupported` (5.6) unchanged. On
      Finish: `setTrackLevel` on the existing `useLevelStore` for all three tracks (no second
      persistence path), and a real `SessionRunSnapshot` built with the same `planSession`/
      `sessionCandidates` `SessionPlanScreen` itself uses, written directly to `useSessionRun.ts`'s own
      exported `SESSION_RUN_COLLECTION`/`SESSION_RUN_KEY` — using that existing persisted contract, not
      inventing one, because `src/app/session/**` is outside this task's file boundary. *Proof done:*
      `e2e/onboarding.spec.ts`, two specs — completing onboarding (experience → level 2, 60 min) then
      reloading: dashboard shows level 2 on all three tracks, and the raw IndexedDB `todaySessionRun`
      record (read directly, not off a UI readout) has `totalMinutes: 60` and a non-empty item list,
      with Today itself showing "Item 1 of N" on that same reload; a second spec proves Skip changes
      nothing and persists (banner never returns after reload), and Settings re-runs the flow and
      writes new levels. Full existing e2e suite (101 specs, ~60 of which `goto('/')` against an empty
      IndexedDB) re-run clean with the banner present — see the design note for why that mattered.

      **Design note — banner, not a gate.** The roadmap text ("complete onboarding" before reaching the
      dashboard) reads like a hard gate blocking `renderScreen('today', …)` until completed. Rejected on
      concrete evidence: this app's e2e suite is ~60 spec files, nearly all of which land on Today
      against a Playwright-fresh (i.e. empty) IndexedDB with no onboarding interaction at all — a gate
      would have intercepted nearly every one of them, most owned by other live parallel sessions this
      round. `OnboardingGateway` is instead purely additive (a sibling rendered before `renderScreen`'s
      own output, alongside `InputCapabilityBanner`), confirmed safe by re-running the full existing
      suite clean. If a harder gate is wanted later, the two questions worth asking first: is the
      collision with ~60 fresh-IndexedDB specs still real (some may since have been rewritten to seed
      onboarding-complete), and does the product actually want first-run to block every destination
      including a direct deep link.

      **Simplifications stated plainly, not left silent:** the experience answer sets all three tracks
      (playing/sight-reading/theory) to the same level (1/2/3) — no per-track granularity in the
      questions; the goal answer is captured but does not yet bias the session mix (`DEFAULT_MIX` is
      used as-is) — both are reasonable defaults for "a few questions", not full placement testing, but
      are named here rather than assumed obvious.
- [x] 5.41 `app`: honest first-run empty states on every screen that can be reached with no data —
      what this screen is for, and the one action that starts it. Today's dashboard renders zeros
      correctly (proved in 4.7); the other screens were not checked for this.
      **12 checked, 0 had no honest empty state.** Visited every one of the 12 nav destinations
      (`app/shell/Shell.tsx`'s full `NAV_PRIMARY`/`NAV_GROUPS` list) against a genuinely wiped
      IndexedDB and wrote down what each one actually rendered before changing anything: Today
      already builds and shows a real session plan with a working "Start session"; Lessons/Practice/
      Sight reading/Rhythm/Metronome are content- or generator-driven, not user-data-driven, so
      "empty" does not apply and each already opens on a real, playable state; Flashcards/Ear
      training/Theory generate their first card/item on load and already say "Nothing recorded yet."
      under the SRS summary (5.31, this same round); Technique already says "No clean run yet at this
      drill."; Repertoire already says "No pieces in your library yet — add the score you have loaded
      above." and correctly disables "Add loaded score" with a stated reason ("Load a score first...")
      until one is; Progress was already proved in 4.7. Spot-checked the five that looked most likely
      to hide an inert control — Repertoire's disabled "Add loaded score", Today's "Start session",
      Rhythm's "Start", Sight reading's "Start exercise", Repertoire's catalogue "Add" — by actually
      clicking them against a fresh profile: all five did real work (a piece added, a session item
      opened, a rhythm prompt generated, a sight-reading countdown started). Added nothing new to any
      screen; this item is the survey plus the regression guard below.
      *Proof: `e2e/empty-state-starting-actions.spec.ts` (new) wipes IndexedDB, reloads, then walks
      all 12 destinations in one test — Progress first (its "Theory retention" section reads the same
      store the Theory destination writes to, so it has to be read before Theory touches it) — and at
      each one asserts the real starting action is enabled, clicks it, and asserts a genuine output
      (a status appearing, a button's enabled state flipping, a message disappearing), never mere
      presence. Confirmed the guard actually guards by deliberately breaking one assertion and
      watching the test fail, then reverting. Passed 3/3 parallel runs, console clean throughout
      (0 console/page errors across the whole walk).*

### Information architecture — **3/10 → 9**

12 flat nav buttons with no grouping. Navigation is `useState`, not routing: the URL never changes,
there are no deep links, a refresh returns you to Practice, and **the browser Back button exits the
app**.

- [x] 5.42 `app/shell`: real routing — a hand-rolled History-API router (`route.ts`: pure path↔`Route`,
      unit + property tested; `routing.ts`: impure History wiring). A URL per destination; deep links
      carry identity for technique/flashcard-deck/theory-quiz (id+level), round-tripped via the URL, not
      `useState`. Scope note: `LessonsScreen`/`useLessons.ts` (not owned here) keep the selected lesson
      in a private `useState` with nothing to seed externally, so the lesson BODY isn't deep-linkable
      without adding `initialLessonId`/`onSelectLesson` there — flagged, not guessed at.
      *Proof: `e2e/routing.spec.ts` — URL changes at every step Practice → Lessons → a lesson's quiz,
      Back twice lands on Practice with the same score, Forward replays the deck/level, the deep-link
      URL reloads the same place; a second deep-link kind survives reload; an unknown path falls back
      to Today.*
- [x] 5.43 `app/shell`: group the nav — Practice / Learn / Drills / Progress — so Flashcards, Ear
      training, Rhythm, Technique and Theory read as drills, and Today as the entry point.
      `NavGroups.tsx` renders Today standalone (accent-coloured, heavier) then four `role="group"`
      landmarks in `<nav aria-label="Main">`. Found in the same pass: the new "Drills" group's name
      collided with two specs' non-exact `getByLabel('Drill')` — fixed with `{ exact: true }`, matching
      five specs already using it for the same label.
      *Proof: `NavGroups.test.tsx` + `e2e/nav-groups.spec.ts` — labelled landmarks hold the right
      destinations, Today reads distinctly, and `Tab` visits Today then each group in visual order.*

### Curriculum & session planning — **6/10 → 9**

The lesson sequence is sound and matches Faber's order, including the deliberate choice to put reading
after keyboard geography and rhythm. The planner's 15/30/60 presets are a defensible synthesis (no
source gives an evidence-based split — these are conventions, and worth saying so). What is missing is
that **the plan doesn't run**: each item is an "Open" button that navigates away, with no timer, no
next item, no completion state, no sense of being 3 of 5 through today.

- [x] 5.44 `app/session`: make the plan runnable — a timer per segment, an explicit next-item step,
      completion state per item, a visible "3 of 5" (was links to elsewhere). New `useSessionRun.ts`
      persists a run record (own `Store` slice, independent of `persistence.ts`); `SessionPlanScreen.tsx`
      renders "Item N of TOTAL", a done/current/upcoming list, live elapsed, "Complete" stops/starts
      `usePracticeLog` (StrictMode-safe, mirrors `useLessons.ts`). Mix behind `<details>`, demoted.
      *Proof: `e2e/session-run-resume.spec.ts` — real 15-min plan, completes warm-up (5.45) + 1 item, 2
      positive-duration `practiceLog` rows in IndexedDB, reloads, resumes at item 3 with 1-2 done, no
      phantom entries minted. Visual pass clean, both widths/themes.*
- [x] 5.45 `core/curriculum/session` + `content`: add the **warm-up** segment, away *from the keys* —
      jaw, shoulders, posture, stretch — first. `planSession` reserves flat `WARMUP_MINUTES` (5) off
      the top, splits the remainder across the four mixable segments as before; cannot rescue an
      unfillable plan. New `content/curriculum/warmups.ts` (the one file allowed there): a 5-step
      checklist + `WARMUP_EXERCISE`, wired in by `candidates.ts` (`session.ts` never imports content).
      `WarmupChecklist.tsx` is what it opens, inline in the running view. Re-adds `'warmup'` to
      `ActivityKind`. **Follow-up (not owned here):** `DashboardScreen.tsx` needs `warmup: 'Warm-up',` in `ACTIVITY_KIND_LABELS`, else `typecheck` errors there.
      *Proof: `session.test.ts` — first/present every budget (property test), clamps, declines cleanly.
      `warmups.test.ts` stays off-keyboard. Driven: completing it logs a real `warmup` entry; given 35s
      elapsed, Progress's weekly total reads "1 min" non-zero (number correct, label pending follow-up).*
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
- [x] 5.49 M5 acceptance pass — re-ran the 2026-08-06 review's method adversarially and re-scored all
      17 aspects: [docs/ux-pedagogy-review-2026-08-12.md](docs/ux-pedagogy-review-2026-08-12.md).
      **M5 DOES NOT EXIT.** Nine aspects reach ≥ 9 (breadth 10, engineering 9, first-run 9, practice
      usability 9, input accessibility 9, lesson content 9, technique 9, theory reference 9, progress
      9); **eight do not** — visual design system 7, information architecture 8, playable content 7,
      sight reading 7, ear training 7, rhythm 8, accessibility 7, and overall **4.5 → 8**. Each gets a
      task below (5.51–5.58); no score was softened to reach the bar.
      *Proof: the nav has **13** destinations now, not 12 (Settings, from 5.40) — all 13 driven from an
      empty IndexedDB, console clean on every one. `npm run verify` green (190 files / 3900 tests);
      `npx playwright test` 123/123 green on port 5280; `npm run verify:full` **exits 1** at the `knip`
      step only, an artefact of this worktree's empty local `node_modules` shadowing the root install —
      localised, not proven clean, stated as such in the doc. New `scripts/review-probe.mjs`
      (`walk`/`contrast`/`claims`) makes the method re-runnable instead of prose: it reads the
      destination list off the running app, measures **every** visible text element against its own
      effective background at both themes (27 AA failures found, all `--text-3`, worst 2.90:1), and
      seeds IndexedDB behind the app's back. Progress passes that seed test exactly — 5 days × 41 min
      of `eartraining` reads back as "Longest streak 5 day(s) / This week 205 min / Ear training:
      205 min", every other category 0. Sight-reading leaps measured off the engraved output, not the
      table (level 1 max 2 st, level 2 max 10 st). Pedagogy re-checked against RCM 2022, ABRSM 2025–26
      and Faber's own scope-and-sequence; one 2026-08-06 claim found **false** and corrected in the
      app's favour (ABRSM does test interval identification, Grades 6–8). Screenshots in
      `visual-pass/5-49*`.* Deleted nothing.

### M5 acceptance follow-ups — from the 2026-08-12 re-score

- [ ] 5.51 `design-system`: `--text-3` is documented in `tokens/colors.css:26` as "decorative only —
      fails AA on purpose", and two M5 tasks then used it for load-bearing text — `.nav-group-title`
      (`feature-nav-groups.css:37`, roadmap 5.43's own IA labels: 4.36 dark, **3.12 light**) and
      `.session-plan-warmup-note` (`feature-session-run.css`, roadmap 5.45: **2.90 light**). 27 AA
      failures across all 13 destinations, both themes. Move information-bearing text to `--text-2`
      (the AA-compliant secondary tone `feature-ear-reveal.css` already names), or raise `--text-3`
      and retire the comment — not both. Found in the same pass, fix alongside: `.app-nav`'s
      background stops at ~897px on a page taller than the viewport instead of filling the scroll
      height. Blocks aspects **visual design system**, **accessibility** and half of **information
      architecture**.
      *Proof: `node scripts/review-probe.mjs contrast --url <dev>` exits **0** — it exits 1 on any AA
      failure, so this is a check and not a claim. Visual pass both widths/themes.*
- [ ] 5.52 `app/repertoire` + `content`: the catalogue row reads "Für Elise (Theme A) / Ludwig van
      Beethoven (1770–1827) / Level 3 / Add" and discloses nothing, while `src/content/scores/
      LICENSE.md` and `gradedPieces.ts`'s own doc say these files are "a faithful rendition of the
      named melody/theme… **not a verified note-for-note transcription**", with four classical pieces
      "a stylistically-faithful excerpt", most 2–6 bars, and 14 of 5.3's 20 additions "this app's own
      rendition". Surface that per piece — a provenance field on `GradedPiece` rendered on the row and
      on the Practice heading when a catalogue piece is loaded, with the excerpt length. Same sweep:
      `warmups.ts`'s "Piano tension hides in the jaw first" is unsourced (Juilliard's guide verifies
      shoulders/posture at the bench and never mentions the jaw) — soften to what is supportable.
      Blocks **playable content**.
      *Proof: an e2e reads a per-piece provenance line off the real Repertoire row for a
      research-verified piece AND for a flagged excerpt, and the two differ; a content test fails the
      build if a `GRADED_PIECES` entry has no provenance value.*
- [ ] 5.53 `core/generator/levelDefaults`: level 1 is genuinely stepwise (measured max leap **2
      semitones**) and level 2 immediately permits **10** — a minor seventh — with levels 2/3/4 all
      sharing `maxLeap: 10`, because the column is sized for the cadence walk's reachability, not for
      pedagogy (the file's own comment says so). Faber Level 1 prepares reading "with intervals up
      through the 5th"; the 2026-08-06 "level 1 → 2 is a cliff" finding still stands and the cliff is
      now wider than the P5 it objected to. Re-grade the leap column so it rises monotonically and
      no level below 4 exceeds a 5th (7 st), decoupling the cadence-reachability constraint from the
      pedagogical ceiling. Blocks **sight reading**.
      *Proof: `node scripts/review-probe.mjs claims` re-run — measured max leap off the ENGRAVED
      output rises level by level and level 2 never exceeds 7 st over ≥ 50 sampled intervals; the
      existing `levelDefaults.test.ts` cadence-reachability property stays green.*
- [ ] 5.54 `core/generator/levelDefaults`: level 1's rhythm is `'whole-half'` and level 2 is the first
      `'quarters'` — a level-1 exercise engraves four whole notes. Faber Piano Adventures Primer
      introduces **quarter → half → whole, all inside Unit 2** (official Teacher Guide, verified
      2026-08-12). This is the identical inversion roadmap 5.20 fixed for the Rhythm drill on exactly
      this source and never applied here. Blocks **sight reading**.
      *Proof: a driven level-1 exercise engraves quarter and half notes and no whole notes; the
      monotonic-ladder property test in `levelDefaults.test.ts`/`melody.test.ts` extended to rhythm.*
- [ ] 5.55 `app/eartraining` + `core/eartraining`: 5.28's "tonal context" is documented in its own code
      as "a drone: tonic + fifth" — an **open fifth, with no third**, so it cannot establish major or
      minor. Both cited authorities specify something that can: RCM 2022 "identify the key, **play the
      tonic triad once**"; ABRSM 2025–26 aural p.45 "**play a tonic chord** (to establish the key)".
      Level 1's answer set is exactly {major 3rd, minor 3rd} — mode is the one thing a bare fifth
      withholds and the one thing that distinguishes the two answers. Play a real tonic triad, and name
      the key on screen the way RCM's examiner does. Second, smaller: the drone anchors on the item's
      own lower sounding note (`chords.ts:221`), not on a key, so for an interval item it hands over
      the bottom note. Blocks **ear training**.
      *Proof: the recorded `AudioOutput` calls carry three distinct pitch classes forming the key's own
      tonic triad before the item's first note (the 5.28/3.13 pattern — assert the calls, not the
      projection), a minor-key item sounds a minor triad, and the key is read off the running screen.*
- [ ] 5.56 `app/rhythm` + `core/generator/rhythm`: the engraved rhythm pattern is titled **"Untitled
      Score"**. That is verbatim the defect the 2026-08-06 review named and roadmap **5.13 is ticked as
      fixing** — 5.13 titled `generateMelody` and `techniqueScore` (both confirmed fixed) and never
      touched `rhythmToScore`. Give it the drill's own title, and sweep for any remaining untitled
      generated score. Blocks **rhythm drill**.
      *Proof: a driven complexity-1 drill engraves a real title naming the drill and complexity, and no
      screen in the app renders "Untitled Score" — asserted across all 13 destinations by
      `review-probe.mjs walk`.*
- [ ] 5.57 `app`: one skill, two numbers, both called "level". Driven in one session, the Progress
      screen read "Sight-reading: level 4 (overridden)" while the Sight reading screen read "Level 1" —
      the curriculum track level (`settings/levelState`) and the trainer's adaptive level
      (`sightReadingHistory`, REQ-3.4.6's 80–90% band). Both are legitimate and neither is broken; the
      product never says they are different things, so a learner who sets level 4 on Progress and gets
      level-1 exercises has been misled by omission. Name them distinctly on both screens and say what
      each does. Blocks **information architecture**.
      *Proof: an e2e seeds the two stores to different values and asserts both screens render distinct,
      self-explaining labels; the Progress accuracy-trend panel states which of the two it is charting.*
- [ ] 5.58 `core/eartraining/dictation`: 5.34's per-level bounds are systematically shorter than the
      syllabus they cite — app level 1 is **2–3 notes**, RCM is **4 at Preparatory A and 5 at Level 1**
      (verified 2026-08-12); app level 5 is 7–8 against RCM's 8–10. Re-anchor the ladder on the quoted
      RCM figures, keeping REQ-3.6.1's outer 2–8 bracket or raising it deliberately and saying so.
      Contributes to **ear training** (smaller than 5.55).
      *Proof: `dictation.test.ts`'s property tests updated to the RCM-quoted per-level bounds, with the
      source figures recorded in the module doc.*

## Backlog / optional

- [x] B.1 Microphone pitch-detection fallback (REQ-3.3.7, optional) — **shipped by roadmap 5.7**,
      which promoted this entry into Phase 5 rather than leaving it in the backlog; the box was
      simply never ticked here. Verified against the merged code, not inferred from 5.7's prose:
      `src/core/audio/pitchDetection.ts` (YIN) and `src/core/audio/noteOnsetDetector.ts` exist with
      their co-located tests, `src/adapters/audio/micPitchInput.ts` implements the same `MidiInput`
      port `webmidi.ts` does, and Practice wires it through `useMicInput.ts` + `MicInputControl.tsx`.
      Full proof paragraph: 5.7. On iPadOS it is not a fallback, it is the input (see B.7).
- [x] B.2 Bluetooth MIDI (REQ-3.3.1, if feasible). Feasible: shipped as a second, explicit-gesture
      `MidiInput` alongside Web MIDI. `core/midi/bleMidiPacket.ts` decodes the BLE-MIDI wire format
      (header/timestamp bytes, running status, a message split across two packets, 13-bit timestamp
      unwrap) — fast-check round-trips a random event stream including a wrap, a running-status run
      and a split message. `adapters/midi/blemidi.ts` pairs via `navigator.bluetooth.requestDevice`,
      decodes GATT notifications through it, and anchors the device's own clock onto the host clock so
      timing feedback works like a USB note's. `MidiDeviceStatus` (all eight screens, none edited)
      grew a "Pair Bluetooth MIDI" control via `useBluetoothMidi.ts`; a module-level registry feeds
      `useMidiConnection.ts`, which fans a BLE note into the same `input` a USB note flows through,
      additive to its returned shape. Proof: `npm run verify` green (185 files / 3773 tests); e2e
      `bluetooth-midi.spec.ts` — API absent states the limitation without crashing, and a fake device
      emitting real BLE-MIDI packet bytes through the notify listener is graded by the real matcher
      (`feedback-correct` moves) — no physical BLE keyboard was available, both halves rest on the
      fake; visual pass clean (1280/1024, dark/light, console clean).
- [x] B.4 Light gamification: streaks, milestones (REQ-3.10.3). New pure core module
      `src/core/progress/milestones.ts` (`computeMilestones`): five DERIVED milestones — all 12
      major scales clean at their own curriculum target tempo (REQ-3.10.3's own example, read via
      `tempoHistory`/`techniqueLibrary`), a repertoire piece at 90% assessed accuracy (read via
      each piece's `sessions`, never the timestamp-less `bestAccuracy` alone), first drill played
      hands together clean (any `hands: 'both'` drill, via `techniqueDrillById`), a 7-day practice
      streak (reuses `longestStreakDays` verbatim — deliberately the LONGEST-ever run, not the live
      current one, so it can never un-achieve itself: no streak-loss guilt), and ear training at
      level 3 in every kind (`EarSessionState.levels`/`attempts`). No points, no badges for showing
      up, nothing re-derives the streak or clean/evenness logic that already exists. Surfaced as a
      new `MilestonePanel` on the Dashboard, behind a closed-by-default `<details>` (same convention
      as `SrsSummary`'s "Scheduler details") — demotes nothing else on the screen; adds exactly one
      summary line ("Milestones — N of 5 achieved") when collapsed.
      *Proof: 21 core tests + 2 property tests on `milestones.ts` (streak achievement date derived
      by walking real entry prefixes through `longestStreakDays`, never reimplementing day-bucketing);
      5 `MilestonePanel` render tests; `useDashboard`/`DashboardScreen` wiring tests, incl. one
      seeding a real clean hands-together technique attempt and asserting the milestone flips;
      `e2e/milestones.spec.ts` seeds a real `TechniqueAttempt` into IndexedDB and reads the live
      Dashboard before ("0 of 5", empty state) and after reload ("1 of 5", the achieved card and the
      12-scales progress label both changing) — 2/2 passing. `npm run verify` green (184 files,
      3767 tests). Visual pass on Progress at 1280/1024, dark/light, both the honest-empty and a
      seeded-achieved state — console clean in all runs. Ambiguity resolved and reported: the task
      brief said "Clock" but this module's only wall-clock need is `DateSource` (per this repo's own
      Clock=monotonic/DateSource=wall-clock split, `@core/ports/clock.ts`) — used once, to drop any
      input timestamp later than "now" (clock-skew defence), not for elapsed time.
- [x] B.3 Falling-note piano-roll view (REQ-3.2.4 optional half). A toggle inside Practice's
      existing "Practice setup" disclosure (off by default; demotes nothing — it is a sixth
      control sharing the same already-collapsible slot loop range/hand mute/metronome/wait
      mode/record already share), rendering ABOVE the engraving, both visible together. Geometry
      is pure (`src/core/notation/pianoRoll.ts`): given a Score, a tick window and a lane range,
      returns the rectangles to draw — property-tested (visibility, no same-pitch overlap,
      monotonic lane-per-pitch, degrade-clean on a zero-length/out-of-range note or a degenerate
      window/range). The React side (`PianoRoll.tsx`) does layout/paint only, driven by the SAME
      per-frame `moveCursorTo` call `usePracticeEngine` already makes for the score cursor —
      `PracticeScreen` wraps `useNoteFeedback`'s own intercepting ref one layer further (its
      established pattern) rather than adding a second clock. No literal `--hand-left`/
      `--hand-right` tokens exist in `design-system/tokens/colors.css` — flagged, not silently
      decided: reused `--fb-early`/`--fb-late` as the most neutral existing two-colour pair.
      *Proof: `npm run verify` green (184 files/3766 tests); `e2e/piano-roll.spec.ts` drives a
      real bundled piece (Twinkle Twinkle) with the transport RUNNING, samples two positions and
      asserts the lit lanes exactly match the score's own pitches at each (`[48,52,55,60]` then
      `[48,52,55,67]`) and that a tracked note's x moved left by a bounded, expected tick range;
      `e2e/perf-large-score.spec.ts` stays green unmodified (roll off, no regression) and a
      second perf test in `piano-roll.spec.ts` reproduces its exact method with the roll ON
      against the same 102-measure/1603-note score (p95 frame gap 18ms, worst 46ms, 0 long
      tasks — both perf tests exceeded the original roll-off numbers well within the pre-set
      budget slack); visual pass clean at 1280/1024, dark/light, roll off and on
      (`scripts/visual-pass.mjs`, extended with `--file` since Practice needs a score imported
      first).
- [x] B.5 Audio recording alongside MIDI recording (REQ-3.9.2 optional). Opt-in
      `getUserMedia`+`MediaRecorder` capture (`src/adapters/audio/audioRecorder.ts`, feature-detects
      the mime type via `MediaRecorder.isTypeSupported`, never hardcodes one) alongside the existing
      MIDI recorder — never instead of it, and never automatic (roadmap 5.7's opt-in rule). Start/stop
      is bracketed on the SAME click as the MIDI recorder's own start/stop (`RecordPanel.tsx`'s
      `handleRecord`/`handleStopRecording`), and the offset between the audio's first sample and the
      MIDI recording's own time origin is MEASURED (`performance.now()` either side of the two starts,
      `useAudioRecording.beginCapture`/`markMidiOrigin`) and stored, not assumed zero — proved in
      `useRecorder.test.ts`'s "measures a real offset" test with a non-zero injected clock. Storage
      reuses the existing `recordings` IndexedDB object store under a separate `audio:<id>` key
      (`src/adapters/store/idb.ts`'s `putRecordingAudio`/`getRecordingAudio`/`deleteRecordingAudio`) —
      no `Recording` type or schema change, so an old MIDI-only recording loads and replays exactly as
      before (`idb.test.ts`'s and `useRecorder.test.ts`'s migration-path tests). Replay plays both
      together (`useAudioRecording.beginPlayback`, scheduled off the stored offset).
      PracticeScreen.tsx (owned by a sibling session this round) was never touched — the wiring lives
      entirely in `RecordPanel.tsx` wrapping the same callbacks it already receives, plus a new
      `useAudioRecording` hook in `useRecorder.ts` that opens its own IndexedDB connection (same
      pattern as `useSessionRun.ts`).
      **What this demotes** (docs/DESIGN.md rule 3): the new opt-in toggle, its error text, the saved-
      audio summary and the delete-audio control are GROUPED behind their own collapsed `<details>`
      ("Audio recording") inside the Record & replay group, rather than landing as four more
      always-visible controls — only one more disclosure line is visible by default.
      Proof: `npm run verify` green (183 files / 3788 tests). E2E
      (`e2e/audio-recording.spec.ts`, Chromium launched with `--use-fake-device-for-media-stream
      --use-fake-ui-for-media-stream`) records a real take against the fake device, reads the stored
      audio back from real IndexedDB (non-empty `ArrayBuffer`, a real `audio/…` mime type, a finite
      offset), confirms the MIDI event count is still there, and replay puts a real, attached
      `<audio>` element into `playing: true` with advancing `currentTime` — both twice in a row,
      `--workers=1`. A second spec proves a denied mic surfaces a real, visible error without
      crashing the panel or the MIDI half. Visual pass: `Practice --level playing=3`, both widths,
      both themes, both the collapsed and the expanded state of the new disclosure (`scripts/
      visual-pass.mjs` extended with a text-locator fallback for `--click`, since the disclosure is a
      `<summary>`, not a `<button>`) — console clean in all eight shots. NOT proven: the fake media
      device's audio content itself (a synthetic tone, not a real microphone signal) — real-hardware
      capture quality is unverified, as it must be in this sandbox.
- [x] B.6 `app`: make the UI usable on a tablet (REQ-4.4 names "a laptop/tablet" as where practice
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
      exactly the tablet case). Note the 2026-08-06 measurement predates the `responsive.css` /
      nav-drawer work merged since — re-measure in a real browser before assuming the numbers hold.
      *Proof: at 768x1024 and 1024x1366, no control is under 44px, the page does not scroll
      horizontally, and a tapped on-screen key grades an answer — driven in a browser, not asserted
      from CSS.*
      **Re-measured 2026-08-12, live from the CSSOM at both required widths, across all 13 nav
      destinations (528 controls counted per width) — the nav drawer, `--control-h`→44px scaling,
      and native-input sizing from the 5.27/5.40 rounds already fixed most of the 62: only 3 real
      gaps remained, all in the shared design-system layer, not per-screen. (1) The on-screen
      keyboard's black keys are 0.62× the white key's width by construction — same as a real
      piano — which never clears 44px at any reasonable white-key size; `--black-key-w` now floors
      to `max(44px, …)` at ≤1024px (`domain.css`, `responsive.css`), with `.chord-scale-reference`'s
      non-interactive reference diagram (plain `<div>`s, never a touch target) explicitly excluded
      from the floor so its keys stay proportional instead of ballooning past their white keys.
      (2) The full 37-key practice/technique keyboard was silently shrinking below its own
      breakpoint values (56px keys measured at ~41px) because `.keyboard-diagram .key` had no
      `flex-shrink: 0` — the "scroll, don't shrink" container comment was aspirational, not
      enforced; fixed by adding it. (3) Every checkbox/radio in the app was already wrapped in a
      `<label>` (a convention `.onboarding-option` had independently discovered for itself), so the
      label — not the ~13px native box — is the real tap target; it was just never sized. Generalized
      onboarding's own pattern app-wide: `primitives.css`'s new `label:has(> input[type="checkbox"],
      > input[type="radio"])` rule. Before: Practice/Technique/Theory each had ~38-41 undersized
      controls (all on-screen-keyboard keys, squeezed by the shrink bug); Flashcards had 4 (black
      keys only); seven other screens had 1-7 (checkbox labels only). After: 0 undersized controls
      on any of the 13 destinations, at both 768x1024 and 1024x1366, and no horizontal scroll
      anywhere. Driven proof: `e2e/tablet-touch-targets.spec.ts` (4 tests, real Chromium with
      `hasTouch: true`, not the non-compositing manual-drive pane) — sweeps all 13 destinations at
      both widths asserting the 44px floor and no horizontal scroll, then TAPS an on-screen
      flashcard key and asserts `flashcard-stats-total` moves 0→1 (graded, not just rendered).
      `npm run verify` green (182 files, 3739 tests); visual pass clean (console-clean, both
      themes, 1280/1024px) on Practice, Flashcards, Theory, and Settings — the four screens the CSS
      changes touch. Nothing deleted.
- [x] B.7 `docs`: platform reality stated in `requirements.md` as **REQ-4.4.1**, a sub-clause of the
      REQ-4.4 it corrects, rather than a free-floating note — a per-platform table (Chrome/Edge
      desktop and Chrome on an Android tablet have Web MIDI; desktop Firefox and **every browser on
      iPadOS/iOS** do not, the latter because all iOS browsers are WebKit underneath), what is lost
      without it (sight-reading assessment, technique evenness, keyboard-answered theory drills,
      dictation), and the honest-degradation contract already met by `createWebMidi`'s
      `err('Web MIDI API is not available in this browser.')` plus 5.6's `InputCapabilityBanner`.
      It also records why B.1 (mic, shipped by 5.7) and 5.4/5.5 (on-screen + computer keyboard) are
      not optional extras: they are the only playing input an iPad has.
      *Proof: REQ-4.4.1 names the constraint with the measured table, and B.1/B.6 now reference it
      instead of restating it. Docs only — no code, no test, nothing deleted.*

---

## Session notes

Full session-by-session history: docs/roadmap-archive-2026-08-08.md and git log. Append new entries here as sessions land.
