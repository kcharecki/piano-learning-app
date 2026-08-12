# Roadmap archive — Phase 3 (Milestone M3: theory & ears), archived 2026-08-12

Every box in Phase 3 was `[x]` when this was moved out of ROADMAP.md to stay under that
file's line budget. Full proof prose is kept verbatim below, and in git history.

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

