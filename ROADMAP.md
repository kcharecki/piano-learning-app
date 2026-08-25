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
Full histories of completed tasks: `docs/roadmap-archive-*.md` and git history.

## Triage — before any feature work

- [x] T.1 OSMD `TypeError` false-red in `npm run verify` (happy-dom canvas gap) — fixed by mocking
      `ScoreViewer` in the two screen tests that hit real OSMD (33fabaa). Full history: archive.
- [x] T.2 `audio-clock-drift.spec.ts` false-red on a starved-timer null sink — spec now asserts the
      adapter's tracking RATIO instead of raw clock slopes, holds on any machine. Full history: archive.
- [x] T.3 main-checkout `eslint .` walked into other sessions' worktrees and could turn master's
      verify red — root-anchored globs + `worktree-isolation.test.mjs` (623ac1b). Full history: archive.
- [x] T.4 `npm run verify:full` red on `knip`: an unresolved dynamic import of `webaudio.ts` from
      `audio-clock-drift.spec.ts` — knip's Node-side resolver cannot follow a browser-URL
      `page.evaluate` import. Path built by concatenation so the scanner cannot statically match
      it; runtime behaviour unchanged. Full history: archive.
- [x] T.5 M4 acceptance Defect 1 (REQ-3.8.2): `core/repertoire`'s `recordSession` had no call site
      outside tests, so a repertoire piece could never leave "never practised" however much it was
      played — wired into `usePracticeLog.ts`'s `stop()` behind a 1s floor. Full history: archive.
- [x] T.6 User-reported (2026-08-15): Practice took **2667ms** with Canon in D loaded — four full
      OSMD engraves where one was needed. `autoResize` off, a StrictMode abort flag, and a 2-entry
      engraving LRU took the return visit to **107ms**. Full history: archive.
- [x] T.7 The triad sequence was missing with a RED spec saying so (`/improve-app` run 2026-08-20-1
      built it and aborted) — rebuilt in `be8e853`: `core/technique/triadSequence.ts` and four
      level-1 drills, spec green with no `test.fixme`. Full history: archive.
- [x] T.8 OSMD engraved only 2 of 8 triplet numerals, so a 4/4 bar read as 5 beats. Cause was
      OSMD's own `TupletNumberLimitConsecutiveRepetitions` defaults, not our rules; turned off in
      `applyEngravingRules` (`7e42b99`, proof `be8e853`). `parseMusicXml` also gained
      `<time-modification>`, so our written triplets round-trip. Full history: archive.
- [x] T.9 `useMetronome`: a second setter in the same tick silently undid the first, so
      `setBpm(72)` then `setSubdivision(3)` left bpm at 100 — all four setters now funnel into one
      `apply(partial)` over a synchronously written `draftRef`. Full history: archive.
- [x] T.10 Technique evenness had no absolute tolerance floor, so the bar moved with the note rate
      and re-notating a pattern as triplets changed the verdict — the 500ms reference gap floors
      the SCALING GAP, not the allowance (`6547d90`). Full history: archive.
- [x] T.11 `MATCHER_DEFAULTS.chordWindowMs` (80ms) was a cliff at both ends: a mouse-rolled triad
      scored 0%, and at 300bpm a triplet collapsed into a perfect score — the window is now a
      fraction of the shortest gap the score writes, capped at `toleranceMs`, and a roll is
      reported in words beside the verdict. Full history: archive.
- [x] T.12 The technique verdict could not name a wrong note: accuracy was computed, persisted and
      dropped — `core/technique/verdict.ts` now says "You played E♭4 where the 3rd (E4) belongs",
      spelled from the drill's own key and capped at three. Full history: archive.
- [x] T.13 `fiveFingerRun` omitted the closing blocked triad RCM Prep A puts in that row — `Run`
      gained an optional `closing` chord and `scoreFromRuns` counts bars from ticks rather than
      note count, so the drill is exactly three 4/4 bars. Full history: archive.
- [x] T.14 The Progress "Technique tempo" card flattened drills with different targets onto one
      unlabelled line, so two clean runs read as getting slower — `tempoSeriesByDrill` plus one
      titled chart per drill, each best read against its own target. Full history: archive.
- [x] T.15 A `tapClassifier` property test was flaky, holing U.3's agreement claim — not a flake
      but a false guarantee: the live classifier compares ticks and the graders compare the ms
      derived from them, so the same rational reached two ways differed by 1.2e-15.
      `timing/window.ts` now owns that boundary for both (`fa153ad`). Full history: archive.
- [x] T.16 `src/core/notation/score.ts` was over the 500-line cap on an unjustified override and
      held two concepts — split into the model and `scoreQueries.ts` (203 lines), override deleted
      from `eslint.config.js`, one import edge and no cycle. Full history: archive.
- [x] T.17 The drums groove trainer was missing with two RED specs saying so (`/improve-app` run
      2026-08-21-1 aborted on eight BLOCKERs, five of them created by its own round-2 fix) — rebuilt
      from the frozen specs outward: three pure modules under `core/drums/practice/`, and each of
      the eight faults has a test that was RED before the rebuild. Full history: archive.

- [ ] T.18 **`npm run verify` has no e2e step, so a red claim spec passes the commit gate.**
      `verify` is `docs:budget && typecheck && lint && test:all`. During run 2026-08-21-1 that went
      green — 4860 tests — over `e2e/improve-DR-09.spec.ts` failing 3 of 4, and it is green today
      over two deliberately-red specs (T.17). The same hole let run 2026-08-20-1 ship a dozen inert
      features under green suites, which is the sentence `AGENTS.md` already carries. A related
      trap sits next to it: `playwright.config.ts` uses `const port = Number(process.env.E2E_PORT ??
      5173)` with `reuseExistingServer: !process.env.CI`, so a stale dev server on 5173 silently
      grades the wrong tree — run 2026-08-21-1's first RED check reported "4 passed" at a commit
      where the screen did not exist. Whatever shape the fix takes, it has to survive T.17's
      intentionally-red specs: a gate that cannot express "this spec is expected to fail until the
      feature lands" will just be switched off the first time it is inconvenient.
      *Proof: a spec made to fail turns the gate red in a fresh checkout with no dev server running
      and with a stale server on 5173, and the two DR-09 specs are recorded as expected-red by the
      gate itself rather than by a comment.*
      **Cost again, run 2026-08-24-1**: that run changed two feedback strings, `npm run verify`
      stayed green over both commits, and `npm run test:e2e` then failed on
      `theory-quiz-routing.spec.ts` and `acceptance-m3.spec.ts`, which were still pinned to the old
      wording. Fixed in `b7f9282`, two commits after the copy landed.

- [ ] T.19 **The theory reveal names the whole answer and never says which note was wrong.**
      Panel MINOR, /improve-app run 2026-08-24-1 (Teacher seat, round 1), deferred with reason:
      §6 requires BLOCKERs and MAJORs, and this is new copy on the verdict line rather than a
      defect in that slice. `gradeTheoryStep` already computes `matchedGroups` and the panel
      throws it away (`src/core/drills/theory.ts:784`, `src/app/theory/TheoryDrillPanel.tsx`), so
      a learner who plays seven of eight scale degrees correctly reads the same eight names as
      one who played none. A teacher names the degree that broke: "6th note: you played B♭, it is
      B". The value is already on the result — this is a rendering decision, not a computation.
      *Proof: a multi-group item missed at group n names group n, and the e2e arm asserts n from
      the presses it made rather than from anything the app printed.*

- [ ] T.20 **The flashcard reveal's black-key vocabulary is sharps only.**
      Panel MINOR, /improve-app run 2026-08-24-1 (Teacher seat, round 1), deferred with reason:
      the fix is a key context on the deck itself, which `buildDeck` (`src/core/drills/flashcards.ts`)
      does not have, so it is a slice of its own rather than polish on that one. Today a miss is
      corrected as "that was A♯3" whatever key the learner is reading, and the `note-name` pad
      offers C C♯ D D♯ E F F♯ G G♯ A A♯ B with no flats at all — so a learner working through the
      flat keys is corrected in a spelling their score never uses. The theory drill no longer has
      this defect: its items carry their own `spelledAnswer` since `9e09ef1`, and the same idea
      (spell at generation, never re-derive from MIDI) is what a flashcard deck needs.
      *Proof: a deck drawn in a flat key names its answers with flats, and the pad offers them.*

- [ ] T.21 **A flashcard deck says "No cards at this level yet" when the level has nine cards.**
      Ledger row G2 of /improve-app run 2026-08-24-1 (source 1c, class BLIND, sum 6 — not picked;
      the run built G1). `FlashcardScreen.tsx:213` renders one string for two different states:
      a level that really is empty, and a level whose whole deck is scheduled into the future.
      The second is the common one — the level-1 decks are 9 / 9 / 3 / 20 cards — and the advice
      it gives ("try a lower level") is wrong for it. A learner who has just answered everything
      correctly is told the level is empty.
      *Proof: a deck seeded due-in-the-future says when it comes back; a genuinely empty level
      still says what it says now, and an e2e arm distinguishes the two.*

- [ ] T.22 **Three of the four level-1 flashcard decks run out inside a minute.**
      Ledger row G3 of /improve-app run 2026-08-24-1 (source 1c, class THIN, sum 7 — not picked).
      The decks are 9 / 9 / 3 / 20 cards against a **6-minute** flashcard segment in Today's
      session, so the segment cannot be filled by the content that exists. `buildDeck` generates
      from level tables, so widening is a content-and-generator change, not a UI one.
      *Proof: a level-1 deck sustains the segment's own duration without exhausting, measured
      against the session plan's minutes rather than a number picked here.*

- [ ] T.23 **Every perfect authentic cadence the drill draws has its leading tone falling a fifth.**
      Panel MAJOR, /improve-app run 2026-08-24-1 (Teacher seat, round 2), unresolved at the
      re-panel cap. `finalChordPitches` (`src/core/theory/harmony.ts`) hands the tonic chord a
      doubled-tonic soprano, which leaves 7 nowhere to go: C major reveals "G4 + B4 + D5,
      C4 + E4 + C5" - B4 falls to E4 instead of rising to C5 - and E-flat major and F major do
      the same. Pre-existing, not introduced by this run: `git show 85df305:src/core/drills/theory.ts`
      has identical voicing semantics. It is a harmony defect, so the fix belongs with the
      cadence builder, not with the reveal that prints it.
      *Proof: for every key and every cadence type the drill can draw, the leading tone of a
      perfect authentic cadence resolves upward by a semitone - a property test over the
      generator, not an example.*

- [ ] T.24 **The same accidental is spelled two ways two lines apart.**
      Panel MINOR, /improve-app run 2026-08-24-1 (Teacher seat, round 2), deferred with reason:
      `scaleName` and `keyName` are ASCII app-wide and ear training, the reference panel and the
      technique library all assert 'Bb major', so changing the glyph is a cross-screen slice
      rather than polish on this one. Today the prompt reads "Play Bb major, ascending." and the
      verdict directly beneath it reads "it was Bb4" in glyphs.
      *Proof: no screen prints both spellings of one accidental, asserted where the two strings
      meet rather than in either producer alone.*

- [ ] T.25 **73 of the 770 theory items name a note the on-screen keyboard does not draw.**
      Panel MINOR, /improve-app run 2026-08-24-1 (Skeptic seat, round 2), deferred with reason:
      the drill is answerable - `gradeTheoryStep` and the reveal's echo both match by pitch class,
      so the octave-down voicing grades correct and plays back - but the printed answer still
      names keys that are not on screen ("Play a B major chord, second inversion." names D-sharp 6,
      MIDI 87, against `KEYBOARD_HIGH` 84). Every second- and third-inversion chord on A, B-flat,
      B, F-sharp, G and A-flat is affected. Either voice generated items inside 48-84, or draw the
      range the item needs.
      *Proof: every item any kind and level can generate names only notes the panel draws - a
      property over the generator against the keyboard's own bounds.*

- [ ] T.26 **`osmd-teardown.spec.ts` fails under full-suite load and passes alone.**
      Found during /improve-app run 2026-08-24-1's experience gate. The spec throttles the CPU to
      engrave a large score, then waits `SETTLE_MS`; alone on its own port it passes in **49.2s**
      against a **60s** test timeout, and in the full `npm run test:e2e` run (6 workers) it times
      out at line 121 — twice in a row, then passed once the other two real failures were fixed and
      the suite re-ran. An 11-second margin under a variable load is not a margin. It is the only
      spec in the suite whose pass depends on how many other specs are running.
      *Proof: the spec's own timing is measured rather than waited out - it asserts the teardown
      threw nothing without a wall-clock settle that competes with the rest of the suite.*

- [ ] T.27 **`npm run verify:full` is red on `knip:prod:all`, and has been since `d6e1af9`.**
      Found during /improve-app run 2026-08-24-1's experience gate. `knip --production` reports
      1 unused file (`src/app/state/persistenceHarness.ts`) and 4 unused exports (`lastAttempt`,
      `grooveById`, `writtenTicks`, `snapshotGrade`), exit 1 - so `verify:full` never reaches its
      `test:e2e` step, which is the step T.18 is about. Confirmed pre-existing, not caused by that
      run: the same command at `d6e1af9` in an isolated worktree with `node_modules` linked reports
      the same set plus `allMappedPads`, exit 1. Each finding is either dead code to delete or a
      seam knip cannot see; both answers are cheap, and leaving it red costs the whole gate.
      *Proof: `npm run verify:full` exits 0 in the main checkout, and each of the five findings is
      resolved by a deletion or by a recorded reason, not by widening the ignore list.*

## Phases 0-2 — Foundation, M1 playable core, M2 feedback & reading — all done

Every box in these three phases is `[x]`. Moved to
[docs/roadmap-archive-2026-08-08.md](docs/roadmap-archive-2026-08-08.md) 2026-08-11 to stay
under this file's line budget; full task list and proof prose there, and in git history.

## Phase 3 — Milestone M3: theory & ears — all done

Every box in this phase is `[x]` (35 tasks, 0 open). Moved to
[docs/roadmap-archive-phase3-2026-08-12.md](docs/roadmap-archive-phase3-2026-08-12.md) on
2026-08-12 to stay under this file's line budget; full task list and proof prose there, and in
git history. The most expensive lesson in it — 3.16's reverted scale-fingering derivation, and
the four anatomical properties any future attempt must write FIRST — is kept in that archive
deliberately, not deleted.

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
- [x] 4.10 M4 acceptance pass — full §9 acceptance criteria review — **re-run 2026-08-12b, PASSES,
      21 of 21**. Third review of this milestone (20/21 → 19/21 → 21/21). Full per-criterion table,
      diff against BOTH previous runs, findings and proposed tasks:
      `docs/m4-acceptance-2026-08-12b.md`.
      - **Both 2026-08-12 blockers are genuinely closed, re-driven from scratch under assertions
        stricter than the fixes' own.** REQ-3.1.4: `m4-acceptance-session-mix.spec.ts` 2/2 with the
        `test.fail()` markers gone, and the visual pass on Today reads warm-up 5 + technique 1 /
        sight-reading 6 / lesson 12 / theory-ear 6 at a 30-minute budget — exactly 20/20/40/20 on a
        cold profile. REQ-3.10.4/REQ-4.3: the restore half of
        `m4-acceptance-export-repertoire-history.spec.ts` used to assert only that "never practised"
        was hidden — an absence a vanished row satisfies too — and now asserts the restored
        sessions, `bestAccuracy`, level and notes positively, reading the notes back off the live
        control.
      - **The real finding is about the previous reviews, not the code: five criteria were carrying
        a PASS that nothing executed.** REQ-2.2's Advance control, REQ-3.10.2's exit criteria, three
        of REQ-3.10.1's seven dashboard sections (technique trends, theory retention, repertoire
        status) and REQ-3.1.4's "adjustable by the user" clause had **zero** e2e coverage — grep the
        suite at the last pass's HEAD for `dashboard-criterion`, `dashboard-advance`,
        `dashboard-retention`, `dashboard-technique`, `dashboard-repertoire` and there are no hits.
        They were passing on a code reading of `useDashboard.ts`/`DashboardScreen.tsx`. All five now
        hold when driven, but "it holds" was never the claim under test. New spec
        `e2e/m4-acceptance-dashboard-sections.spec.ts` (3 tests, no `test.fail()`) seeds the real
        `techniqueHistory`/`srsCards`/`repertoire`/`sightReadingHistory` IndexedDB records, reloads,
        asserts exact values with two exclusion traps built in (a non-clean 999 bpm attempt that
        must not be plotted, a non-theory card that must not be counted), then rewrites stored
        values behind the app's back and watches the screen follow. *Proof:* `npm run verify` exit 0
        (190 files / 3900 tests), full `npx playwright test` **126 passed** exit 0, five visual
        passes exit 0 (Today, Repertoire, Progress, Lessons, Technique × 1280/1024 × dark/light,
        console clean), every exit code unpiped.
      - **Nothing regressed under the day's merges** — checked per surface, not assumed: the
        milestones panel shares the Progress screen with criteria 15/16 (recomputed from the same
        persisted stores, nothing cached); audio recording never touches `usePracticeLog.ts` and
        bumped no `DB_VERSION`, so an older database still opens; the piano roll, BLE
        `MidiDeviceStatus` on seven screens and the 44px tablet targets all pass their own specs
        with the M4 screens console-clean.
      - **Correction to the 2026-08-12 pass: Defect 4 was misdiagnosed.** `verify:full` exiting 1 at
        `knip` is a **worktree artifact**, not a repo defect — a worktree has no installed
        `node_modules`, and knip does not do npm's parent-directory lookup for binaries or
        plugin-owned deps. Proven by control: identical command, `node_modules` junctioned in →
        `npm run knip` exits **0**. The previous "reproduced on a clean HEAD" re-run was also inside
        a worktree. `knip:prod` and `knip:prod:all` exit 0 (Defect 3 closed — no
        implemented-tested-unimported module left).
      - **F.1 FIXED 2026-08-12 (integrator).** `scripts/worktrees.mjs status` now links a worktree's
        `node_modules` to the main checkout's (junction on Windows, directory symlink on POSIX) the
        first time it runs inside one. `status` is where it belongs because every worktree session
        already runs it before picking up work, so no step is added and none can be skipped. Proven
        both directions in a scratch worktree, exit codes unpiped: `npm run knip` exits **1** with no
        link and **0** with it. Recorded in `docs/WORKTREES.md` with why only knip was affected —
        Node's resolver walks ancestors and worktrees sit under the repo root, so every other tool
        worked, which is what hid this for a dozen sessions.
      - **F.3 FIXED 2026-08-12 (integrator).** Rewrote the module comments the code had already
        contradicted, each replaced with what is true and a note that it was wrong: eight in
        `core/repertoire/repertoire.ts` (the "no screen wired to it / `snapshot.ts` hardcodes
        `repertoire: []`" claim, and `sessionFromEntry`'s "`usePracticeLog.ts`'s `stop()` does not
        actually call `recordSession`" — both false since triage T.5; the module header now lists the
        six real call sites, since a reachability check is the first thing every review here does),
        `content/curriculum/curriculum.ts` ("not consumed yet", false since 4.9b — `CURRICULUM` is
        read by `app/lessons/**`, `app/session/candidates.ts` and the dashboard's exit criteria), and
        `app/state/techniqueStore.ts` ("were this store wired into `persistence.ts`" / "`hydrate` …
        is unused", both false — it is a persisted slice and `hydrate` is what its restore calls).
        Comments only; no behaviour touched. *Proof: `npm run verify` green, and each replaced claim
        checked against the code by grep before it was rewritten, not assumed stale.*
      - **F.2 FIXED 2026-08-12.**
        `app/state/persistence.ts` had no `pagehide`/`beforeunload` flush, so a store write still
        sitting in `createWriteQueue`'s `pending` when the tab went away was never sent at all
        (distinct from a request already sent but not yet committed, which no in-page listener can
        close). `createWriteQueue` now carries a synchronous, best-effort `flush()`, and
        `startPersisting` registers one `pagehide` + `visibilitychange`→hidden listener pair that
        flushes all eleven slices, torn down by the same unsubscribe. *Proof:* reproduced the exact
        loss first — a deterministic two-write-per-queue race, checked with a synchronous native
        `IDBObjectStore.put` call count so the assertion cannot be won by the ordinary (non-flush)
        drain loop's own unrelated timing — failed 10/10 runs against the pre-fix code and passed
        10/10 against the fix, driven in the real app (`e2e/persistence-pagehide.spec.ts`, small
        payload `levelState` and the bigger repertoire library); `npm run verify` green (115 new/
        changed persistence unit tests, 3908 total); full `npx playwright test` **128 passed**
        (126 baseline + 2 new), console clean; every exit code unpiped. The "sent but not committed"
        window — a transaction the browser kills mid-commit during an abrupt teardown — remains
        open by design, and is stated in the module comment rather than left implied.
      - Process hazard, still worth keeping: `npm run … | tail -N` reports *tail's* exit code.

## Phase 5 — Milestone M5: teachable product

Source: [docs/ux-pedagogy-review-2026-08-06.md](docs/ux-pedagogy-review-2026-08-06.md) — the app
driven screen by screen as an adult beginner, cross-checked against source, with the pedagogy
claims verified against RCM 2022, ABRSM 2025–26, Faber/Alfred and the Taubman literature. It
scored 17 aspects and rated the whole **4.5/10 as a teaching product**.

**Exit condition: every aspect scores ≥ 9/10 on a re-run of the same review.**

**57 of 61 tasks are done and have been archived to**
[docs/roadmap-archive-phase5-2026-08-15.md](docs/roadmap-archive-phase5-2026-08-15.md) **with their evidence** (2026-08-15, when this file passed its
1500-line budget). The four below are what is left; all four are content/pedagogy calibration in
`core`, none of them blocked, and they are still ordered by the review's own learner-impact
ranking. The two standing rules the phase was run under carry over: a score does not move because
a task was ticked (every task states the observable thing a re-review would check), and prose
fixes count only if the prose is on screen.

- [x] 5.53 `core/generator/levelDefaults`: level 1 is genuinely stepwise (measured max leap **2
      semitones**) and level 2 immediately permits **10** — a minor seventh — with levels 2/3/4 all
      sharing `maxLeap: 10`, because the column is sized for the cadence walk's reachability, not for
      pedagogy (the file's own comment says so). Faber Level 1 prepares reading "with intervals up
      through the 5th"; the 2026-08-06 "level 1 → 2 is a cliff" finding still stands and the cliff is
      now wider than the P5 it objected to. Re-grade the leap column so it rises monotonically and
      no level below 4 exceeds a 5th (7 st), decoupling the cadence-reachability constraint from the
      pedagogical ceiling. Blocks **sight reading**.
      *Proof: `node scripts/review-probe.mjs claims` re-run — measured max leap off the ENGRAVED
      output rises monotonically (non-strict) and level 2 never exceeds 7 st over ≥ 50 sampled
      intervals; the existing `levelDefaults.test.ts` cadence-reachability property stays green.*
      **Done:** leap column re-graded `2, 7, 7, 10, 11, 12` (was `2, 10, 10, 10, 11, 12`) — rises
      monotonically, levels 1-3 all ≤ 7 st. An adversarial re-review of the first pass found it FIX
      FIRST: `doubleHand` (`melody.ts`) derived the second hand from a register-correct target with
      no leap bound of its own, so level 3's narrow `leftRange` (48..67) could not always hold a
      diatonic third below `rightRange`'s top and octave-folded the left hand past the declared
      column (measured 5.2% of engraved intervals over the column, left hand reaching 10 st at a
      declared 7). Fixed by bounding `doubleHand`'s own placements to `maxLeapSemitones` of the
      PREVIOUS derived note, cascading register → same pitch class → any scale tone → hold the note
      if the exact interval can't be reached in range (mirrors the primary line's own chromatic →
      diatonic → repeat fallback); also fixed a related bug in the same function where its octave
      shift rounded to zero near the range's midpoint, playing the "one octave apart" `'unison'` rows
      in true unison. Separately, the first pass had also narrowed `melody.ts`'s `quarters` rhythm
      pool (dropped its half note) to satisfy level 2's cadence reachability against RANGE WIDTH —
      unnecessary and reverted: the generator's real reachability test is distance to the NEAREST
      TONIC in range, not range width, which is ~2.7x looser; `levelDefaults.test.ts` now models that
      distance directly and every row clears it on its own unchanged range and rhythm pool.
      `scripts/review-probe.mjs`'s `claims` mode measured the right hand only; extended to measure
      both hands' own consecutive-note leaps separately (chord tones excluded). Re-run against the
      fixed code, both hands, ≥ 50 sampled intervals per level except level 1 (right-hand-only) and
      level 4 (blocked-chords left hand has no melodic leaps to sample): level 1 max=2 (15 samples),
      level 2 max=7 (146), level 3 max=7 (438), level 4 max=10 (138, right hand), level 5 max=11
      (588), level 6 max=12 (460) — matches the declared column exactly at every level, both hands.
- [x] 5.53b `core/generator/levelDefaults`: level 3's `leftRange` (48..67, `levelDefaults.ts:97`)
      cannot hold a diatonic third below `rightRange`'s top (79−3 = 76 > 67), so `doubleHand`'s
      leap-bounded cascade gives up the exact interval on 5.2% of level-3 simultaneities (2.1% bare
      fifths, 1.6% sevenths, 0.9% tritones/6ths; true thirds 62%→52%, held notes 1.4%→7.7%) while
      `levelDescriptions.ts` still promises "Both hands move in parallel thirds". Found by 5.53's
      adversarial re-review (2026-08-16); the cascade is strictly better than the 10-semitone folds
      it replaced — the root cause is the RANGE grading, not the cascade. Re-grade level 3's
      `leftRange` so a diatonic third fits below every `rightRange` pitch, or deliberately re-word
      the level description to match measured reality, and say which.
      *Proof: measured vertical-interval distribution at level 3 over ≥ 1000 seeds shows ≥ 95%
      thirds-or-tenths and 0% sevenths/tritones — or the reworded description matches the measured
      distribution; the `levelDefaults.test.ts` description-congruency check extended beyond
      `'unison'` rows.*
      **Done:** decision-ladder arm 1 (re-grade the range; no description rewording needed).
      `leftRange` 48..67 → **57..76** (same 19-semitone width as the old range and as `rightRange`,
      just shifted to sit a diatonic third under `rightRange` instead of a full octave under it —
      `doubleHand`'s `'parallel'` path targets `n.midi - 3`, not `n.midi - 12`, so the range that
      needs covering is `rightRange` shifted down 3-4 semitones, not 12; new top `76` is exactly
      `rightRange.high - 3`). Measured on engraved output via a scratchpad `vite-node` probe
      (`generateMelody` + `defaultParamsForLevel(3)`, vertical intervals = simultaneous right/left
      pairs sharing a startTick, chord onsets excluded the same way `monophonicSequence` excludes
      them for melodic leaps), 200 seeds (8907 simultaneities) then re-confirmed at 2000 seeds
      (89126): before (48..67) 94.7%/94.6% thirds-or-tenths, 0.9% tritones, 1.7-1.8% bare fifths,
      ~0.0% sevenths (a different measurement method upstream of this task reported 1.6% sevenths —
      not reproduced by this probe, which sees fifths as the dominant non-third failure mode, not
      sevenths); after (57..76) 99.7-99.8% thirds-or-tenths, 0% tritones, 0% sevenths at both sample
      sizes (a 0.001% residual — 1-3 occurrences per ~89000 — showed up only at 2000 seeds, from
      `doubleHand`'s own fallback cascade, which this task does not touch). `levelDefaults.test.ts`'s
      hand-range-congruency block gained a `'parallel'`-rows check (mirroring the existing
      `'unison'` one, since `levelDescriptions.ts`'s own doc says hand-independence prose describes
      `generateSecondHand`'s per-case field, not free text) asserting on 200-seed engraved output:
      thirds-or-tenths ratio ≥ 0.97 (pinned between the measured 94.7% before and 99.8% after) and
      zero tritones/7ths. Hand-verified the `leftRange` 57..76 → 48..67 revert mutant: it fails the
      new test (`0.9474570562478949` < `0.97`), passes every other test in the file. Scoped tests
      (`npx vitest run src/core/generator src/content/sightreading src/app/sightreading`, 148
      tests), `npm run typecheck`, and `npx eslint src/core/generator src/content --max-warnings 0`
      all green; cadence-reachability and `EXPECTED_MAX_LEAP` properties untouched and still green.
      Driven: level 3 exercise seeded via IndexedDB (`sightReadingHistory`, no in-app level
      control) in the running app, both hands render in parallel thirds, plays and looks correct,
      console clean. Deleted nothing (the measurement probe was a scratchpad file, never committed).
- [x] 5.54 `core/generator/levelDefaults`: level 1's rhythm is `'whole-half'` and level 2 is the first
      `'quarters'` — a level-1 exercise engraves four whole notes. Faber Piano Adventures Primer
      introduces **quarter → half → whole, all inside Unit 2** (official Teacher Guide, verified
      2026-08-12). This is the identical inversion roadmap 5.20 fixed for the Rhythm drill on exactly
      this source and never applied here. Blocks **sight reading**.
      *Proof: a driven level-1 exercise engraves quarter and half notes and no whole notes; the
      monotonic-ladder property test in `levelDefaults.test.ts`/`melody.test.ts` extended to rhythm.*
      **Done:** new `'quarter-half'` style (`rhythmPools.ts`, units `{4, 8}`) as level 1's default,
      replacing `'whole-half'` there; `generateStepwiseOneDirectionLine` (`stepwiseLine.ts`) now
      re-articulates each bar's stepped pitch through `style`'s own pool instead of one whole-bar
      note — the actual bug, since level 1's rhythm column was already being ignored by that path.
      Driven proof: fresh level-1 exercise engraved quarter (480 ticks) and half (960 ticks) notes
      only, zero whole notes, over 13 notes / 4 bars. Property tests on ENGRAVED output (300+ seeds)
      in `levelDefaults.test.ts` and `stepwiseLine.test.ts`.
- [x] 5.55 `app/eartraining` + `core/eartraining`: 5.28's "tonal context" is documented in its own code
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
      **Shipped**, then **redesigned by adversarial review**: the first pass gave chord-quality and
      scale-mode drills a random *independent* `contextKey` too — a worse leak, since their own
      answer IS a key/mode. Context now applies only where the answer isn't the key itself: interval
      (diatonic lower note of `contextKey`) and melodic-dictation. Chord-quality/scale-mode carry no
      `contextKey` and render no label. `scheduleContext`'s triad transposes under the item's lowest
      prompt note; `scheduleItem` anchors `baseMs` on the *earliest* scheduled offset (was `now()`),
      so the pre-roll no longer collapses onto the first note. The label latches to the context last
      actually scheduled, not the live toggle.
      `npx vitest run src/core/eartraining src/app/eartraining` — 257 tests green, incl. distribution
      properties (≥1000 seeds: ≥6 keys, both modes, P(major) ∈ [.42, .58]) and an every-event-≥-now
      property. `npm run typecheck` and `npx eslint src/core/eartraining src/app/eartraining` clean.
- [x] 5.58 `core/eartraining/dictation`: 5.34's per-level bounds are systematically shorter than the
      syllabus they cite — app level 1 is **2–3 notes**, RCM is **4 at Preparatory A and 5 at Level 1**
      (verified 2026-08-12); app level 5 is 7–8 against RCM's 8–10. Re-anchor the ladder on the quoted
      RCM figures, keeping REQ-3.6.1's outer 2–8 bracket or raising it deliberately and saying so.
      Contributes to **ear training** (smaller than 5.55).
      *Proof: `dictation.test.ts`'s property tests updated to the RCM-quoted per-level bounds, with the
      source figures recorded in the module doc.*
      `noteBoundsForLevel` re-anchored: level 1 is now `{4,5}` (was `{2,3}`), level 5 is now `{8,10}`
      (was `{7,8}`), levels 2–4 interpolate to `{5,6}`/`{6,8}`/`{7,9}` — both bounds non-decreasing
      level over level. **Raised REQ-3.6.1's literal "2–8" ceiling to 10** (RCM's own top-of-ladder
      figure is quoted as "8–10 notes") — a deliberate, documented deviation; the floor is untouched
      since 4 is still inside the requirement's "at least 2". `requirements.md` not edited. RCM figures
      + "verified 2026-08-12" recorded in `dictation.ts`'s own module doc next to the constants.
      Two seeded tests (one in `dictation.test.ts`, one in `useEarTraining.test.ts`) hardcoded a seed
      whose behaviour depended on the old, narrower window (a melody ending on tonic; a rhythmic
      prompt with a nonzero first onset) — both re-seeded to a value that clears the same bar under
      the new bounds, with a comment citing 5.58.
      `npx vitest run src/core/eartraining src/app/eartraining` — 285 tests green. `npm run typecheck`
      and `npx eslint src/core/eartraining --max-warnings 0` clean. Driven: fresh IndexedDB (level 1),
      Ear training → Melodic dictation, Play item, pressed one note back, Submit — the note-by-note
      breakdown showed 5 expected notes on the first draw and 4 on a second fresh draw ("The phrase:
      C5, D5, D5, C5", `Note 1..4`), both inside the new `{4,5}` window and both outside the old
      `{2,3}` one. Console clean throughout.

## UI/UX overhaul — [docs/ui-overhaul-plan.md](docs/ui-overhaul-plan.md), shipped 2026-08-14/15

All 24 tasks (UI-01…UI-24) landed: 7 foundation, 13 screens, 4 polish passes. The design
system gained form and layout primitives, a page scaffold, 24 icons, a real shell and a
working theme control; every one of the 13 screens was rebuilt on top of it; then four
whole-app sweeps (states, motion, accessibility, final QA). Full history in git log.

**UI-25…UI-35 — the follow-ups those sweeps found — are all shipped too (2026-08-15).**
Three of the eleven had a premise that did not survive being measured: UI-29's duplicate
buttons had already been removed by UI-08, UI-32 blamed a pill that is permanently mounted,
and UI-30's control budget was counting content. Each entry below says so where it applies,
rather than reading as though the original diagnosis had been right.

**Two gates were added, both after a defect got through a green build**, per the standing
"enforce hard rules in automation, not prose" rule:
- `scripts/check-css.mjs` (in `verify`) — a stray `*/` left prose outside a comment, postcss
  absorbed it plus the following rule into one garbage selector, and `.page` matched nothing
  across **three** green verify runs. Nothing in the gate read CSS: typecheck ignores it,
  eslint does not lint `.css`, no test imports a stylesheet.
- `scripts/a11y-contrast-audit.mjs` (`npm run audit:a11y`, deliberately NOT in `verify` — it
  needs a running server). Negative-controlled before being trusted.

**Defects the overhaul found that no unit test could**, kept here because they name a class of
bug this project keeps paying for: Bluetooth MIDI was destroyed by the next click after
pairing (a connection's lifetime tied to a component that became transient); both Practice
dialogs rendered permanently (author `display:flex` beats the UA rule hiding a closed
`<dialog>`); the Metronome's accent toggles failed the 44px minimum on **width only**;
`.card--sunken` painted with zero padding on four screens; lesson staff diagrams engraved at
`width="0"` (a centred flex column sized shrink-to-fit around content OSMD had not drawn yet);
and the sight-reading trainer level vanished from Progress because it sat inside a trend
card's children, which only render when the chart has data — invisible exactly when a new
learner needs it. Sight reading also turned out to have **no on-screen keyboard at all**:
roadmap 5.4/5.5/5.5a wired that fallback everywhere else and missed the one screen whose
purpose is reading and playing.

### New work the overhaul surfaced — not in the plan, none of it done

- [x] U.1 `content/sightreading`: the trainer's levels have no human description. UI-11 could
      not write the "Level 1 — notes around middle C" subtitle the plan specifies, because no
      such field exists in `core/generator` or `core/sightreading`, and borrowing the
      curriculum-track description would reintroduce the roadmap-5.57 collision (two different
      numbers both called "level"). Authored one description per trainer level in
      `src/content/sightreading/levelDescriptions.ts`, derived from `LEVEL_ROWS`
      (`core/generator/levelDefaults.ts`) fact by fact rather than guessed: range bounds are
      stated only as the closed interval `melody.ts`'s own candidate search enforces (never as
      where a run starts or clusters — `generateMelodicLine` starts at the range MIDPOINT, not
      its floor, so "starts at middle C" would have been false on plenty of real runs), and the
      hand-independence prose ("doubles... an octave below", "parallel thirds", "block chords")
      matches `generateSecondHand`'s literal per-case behaviour. Exact leap sizes and levels
      1-2's specific rhythm note-values are deliberately never named: 5.53 (leap column, levels
      below 4) and 5.54 (levels 1-2 rhythm) are re-grading those same columns in sibling
      worktrees concurrently with this task, so a sentence naming today's numbers would go stale
      the moment either lands — a content test enforces the omission (`levelDescriptions.test.ts`
      matches for banned note-value/interval wording on levels 1-2). Wired into
      `SightReadingScreen`'s `.page-header` as `Level {trainer.level} — {description}`, next to
      the existing "Sight reading" `<h1>`, per UI-11's own target layout. The trainer's level has
      no on-screen manual control (by design — it only adapts from run accuracy), so "changes
      when the level changes" is proven by a render test that moves the store's `level` directly
      and asserts the subtitle text follows, rather than by clicking a level control that does
      not exist.
      *Proof: `src/content/sightreading/levelDescriptions.test.ts` (4 tests) fails the build if
      a level is missing a description (array-length invariant at module load) or one is blank;
      `SightReadingScreen.test.tsx`'s new case asserts the header renders level 1's real text and
      follows the store to level 3's different text. `npx vitest run src/app/sightreading
      src/content/sightreading` — 5 files, 63 tests, green. `npm run verify` green (docs budget,
      typecheck, lint, 197 files / 4146 tests). Driven on port 5782: Sight reading now shows
      "Level 1 — Right hand only, moving stepwise, from middle C to the G above the staff." in
      the header, console clean (only the expected headless-sandbox
      `requestMIDIAccess`/`NotAllowedError` warning, present on every screen, unrelated to this
      change). Visual pass (`scripts/visual-pass.mjs "Sight reading" --url http://localhost:5782`)
      at 1280/1024 × dark/light: subtitle sits cleanly under the `<h1>`, no overflow or wrap: at
      either width, including a swapped-in check against level 6's longer description (89
      characters, the longest of the six) at 1024px, which still holds one line.
- [x] U.2 `adapters/audio`: audio output was single-route in practice. `createDefaultAudioOutput`
      always built Web Audio; `selectAudioOutput`'s MIDI-out path existed but was never called
      from Practice, so UI-05's Settings "Audio" section stated a verified constant rather than
      a live route. Wired, not deleted: `adapters/audio/audioRoute.ts` (new) owns the learner's
      route preference (`localStorage`, not `app/state`'s IndexedDB-versioned store — that store
      is integrator-owned this round, see the module comment) and the MIDI-out connection itself
      (auto-selects the first output port, REQ-4.6). Settings' Audio card now offers a real
      "Built-in piano sound" / "My instrument" `.seg-control`; `createDefaultAudioOutput` (the one
      call site all seven playing screens share) asks `audioRoute.ts` what is ready and calls
      `selectAudioOutput` accordingly, instead of hardcoding Web Audio.
      *Proof: `createDefaultAudioOutput.test.ts` proves a live, device-selected fake `MidiOutput`
      makes real `noteOn`/`noteOff` calls land on it instead of Web Audio, once `getPlaybackMidiOutput`
      reports it ready; `SettingsScreen.test.tsx` drives the control with a fake MIDI-out connect
      end-to-end and shows the choice survives a remount (reload). 16 new tests
      (`audioRoute.test.ts` × 9, `createDefaultAudioOutput.test.ts` × 3, 4 new + 1 updated in
      `SettingsScreen.test.tsx`'s Audio suite), `npm run verify` green. Physical audibility
      through a real instrument is unverified in this sandbox — no MIDI hardware to drive — the
      same caveat B.5 stated for mic capture. Known, stated-in-code limitation: like the
      pre-U.2 Web Audio singleton it replaces, the route is decided once per session at the first
      Play press and not re-evaluated — a learner who flips the toggle mid-session hears the old
      route until reload, and one who reloads straight into Practice without revisiting Settings
      gets Web Audio until they do (Settings reconnects on mount, same pattern `useMidiConnection`
      already uses for the input side).*
- [x] U.3 `core/rhythm`: no per-tap early/late feedback, and no manual Stop. Neither
      `useRhythmDrill` nor `useClapbackDrill` classifies a tap in real time — both produce one
      batch grade at run end — so UI-14 shipped a generic hit flash and deliberately refused to
      add real-time onset matching to correctness-critical timing code. Wiring `engine.stop()`
      naively would fire the run-ended path mid-pattern and grade every unplayed onset as
      missed. This is a **core task with property tests**, not a UI task.
      *Proof: new pure module `core/rhythm/tapClassifier.ts` — a FIFO-cursor live classifier
      (deliberately not the batch graders' global-nearest matching; see the module doc for why
      a live single-tap classifier needs strictly monotonic attribution) — 15 tests incl.
      `fast-check` property tests: every tap classified against exactly one onset or rejected,
      hit window symmetric, monotonic taps never reclaim an earlier onset, and classification
      agrees with `gradeTapping` on a clean run. `closeExpiredOnsets(onsetTicks, state, atTick,
      opts)` settles which onsets have a decided verdict as of `atTick` — an onset is decided
      once `onsetTick + effectiveToleranceTicks < atTick` (strict: a tap arriving exactly on
      that boundary tick is still claimable) — leaving future onsets pending — property-tested:
      stop never marks a future onset missed. Stop re-grades the decided prefix with the *same*
      batch grader (`gradeTapping`/`gradeClapback`) the natural end-of-run path uses, not the
      live classifier's own running tally, so a Stop and a natural finish at the same point
      always agree; stopping once every onset satisfies that same strict inequality now
      produces exactly the natural run-ended grade by construction, not by coincidence.
      `effectiveToleranceTicks` clamps the live tolerance (and, roadmap U.3 fix round 2, the
      derived hit-window band, always exactly 1/3 of it — a prior bug left the hit window
      keyed off the *unclamped* tolerance, so at complexity 5 the hit window was 81% of the
      matching tolerance instead of the intended ~33%, making early/late verdicts nearly
      unreachable) to at most half the pattern's own minimum onset gap. For `gradeTapping`
      (the sight-tap drill), which always matches against the pattern's own raw onset grid
      exactly like the live classifier does, this guarantees the live per-tap verdict and the
      end-of-run/Stop summary can never disagree about which onset a tap belongs to. This does
      **not** extend to `gradeClapback` (the clap-back drill) once it fits a non-1 tempo scale
      (`fitTempoScale`): a tempo-fitted batch grade matches taps against a *scaled* onset grid
      while the live classifier always matches against the raw one, so the two can legitimately
      disagree on the same run (measured: live 43% vs. a tempo-fitted batch grade of 100% at
      `tempoScale` 1.1199) — known and accepted for clap-back this round; the live verdict there
      is a rehearsal-time hint, not a promise the summary will match it. The clamp also
      tightens the sight-tap drill's own matching tolerance at higher complexities — 150ms
      unclamped down to ~124ms at complexity 3-4 and ~61.5ms at complexity 5 — so practice-log
      accuracies recorded before and after this fix round are not directly comparable at those
      complexities.
      Stop has three outcomes: `aborted` (nothing
      decided yet — no grade, nothing logged), `partial` (some onsets decided — graded and
      shown, but purely informational), and `natural` (the run finished on its own). Only
      `natural` ever logs accuracy to the practice log or adapts an ear-training level —
      `aborted` and `partial` never do, closing the gap where a learner could game the adaptive
      level or the practice log by stopping early on a run that was going badly. A stopped
      clap-back run keeps the same tempo-scale fitting (`fitTempoScale`) the natural grade
      uses; Stop never hardcodes `tempoScale: 1`. Wired into both drill hooks (`lastTapVerdict`,
      `stop`) and both screens (`RhythmScreen.tsx`/`RhythmClapback.tsx`): a per-tap flash now
      shows hit/early/late/extra using the app's existing `--fb-*` tokens and their own
      documented glyphs (✓/‹/›/+ — no new vocabulary), and a Stop control next to the tap pad
      calls the safe path. `npx vitest run src/core/rhythm src/app/rhythm` and `npm run verify`
      both green (4156/4156). Driven via `e2e/rhythm-live-feedback.spec.ts` (2 new specs, run
      3x clean against a real dev server): a tap exactly on onset 0 shows 'hit'; a tap shifted
      +90/-130ms off whichever mark is structurally guaranteed to be onset 1 shows 'late'/
      'early'; and, for both drills, a Stop at a controlled mid-pattern checkpoint leaves
      `missed` far below what the identical run graded naturally end-to-end — proving Stop never
      grades the unplayed remainder. Visual pass (both widths, both themes, dark+light) on the
      idle, tapping (both drills) and completed states: console clean but for the pre-existing
      headless-only `[createWebMidi] requestMIDIAccess` warning, unrelated to this change.
      Ambiguities, not resolved silently: (1) the live classifier's FIFO matching is a
      deliberate departure from the batch graders' global-nearest matching, justified in
      `tapClassifier.ts`'s own module doc; (2) `useClapbackDrill.ts`'s manual Stop always
      reports `tempoScale: 1` rather than running `fitTempoScale`, because that fit needs the
      complete tap list a mid-run Stop does not have; (3) the clap-back Stop control is rendered
      only during the `'tapping'` phase, not `'listening'` (nothing to grade yet) — a reasonable
      scope boundary the brief did not specify explicitly.
### Proposed by UI-24's final pass — measured, none of it done

Rule 2 (~6 visible controls before disclosure) is missed on three screens. UI-24 settled
Practice (closed its setup drawer: 21 → 10) and states the rest as known gaps in DESIGN.md
rather than leaving them implied. Counts are `checkVisibility()`, not bounding rects — a
closed `<details>` still reports a non-zero rect, which inflated the first measurement.

- [x] UI-25 `app/metronome`: Beats, Beat unit, Subdivision and the accent buttons moved behind
      one `<details class="metronome-config">` summarised "Beats, meter and accents"; BPM and
      Start are what is left in the open. The `<h2>Meter</h2>` that used to title the block went
      with it — a disclosure's summary IS its heading, and keeping both would have announced the
      section twice to a screen reader. *Proof: 6 visible controls measured in the browser at
      1280px (Decrease BPM, the BPM number, Increase BPM, the BPM slider, Start, and the
      disclosure itself), down from 12; `e2e/metronome.spec.ts` gained the expand step UI-24
      established for Practice and passes. The visual pass caught what the tests could not: the
      summary had no chevron, and because `summary` is `display: flex` in primitives.css — which
      suppresses the browser's own triangle — it rendered as a plain line of card text with no
      hint it opened anything. It now carries the same glyph and flip as every other disclosure
      in the app.*
- [x] UI-26 `app/repertoire`: each level is a real `<details>` disclosure, open at the learner's
      own level — one `<ul>` per group, each named for its level, rather than one flat list with
      heading rows. **Grouping alone did not make the budget.** The first measured pass came in at
      2295px, because the group that opens by default on a fresh profile is level 1, which is also
      the biggest rung of the 40 Piece Challenge at 18 of ~40 pieces. The row itself had to get
      cheaper: title, composer and provenance now share one baseline-aligned line instead of
      stacking, and vertical padding dropped a step, taking the row from 63.19px to the Add
      button's own `--control-h` floor. Nothing was truncated or deleted to get there.
      *Proof: `document.body.scrollHeight` 1987px at 1280px on a fresh profile (budget <2000,
      was 2295); row height 44px measured, against 45px predicted from the tokens; 18 rows still
      visible in the open group; four e2e specs rescoped from the no-longer-unique "Graded
      pieces" list to the `region` named "Graded library" via one shared
      `e2e/repertoire-helpers.ts` expand helper.*
- [x] UI-27 `app/practice`: Loop range and Hands now sit in the sticky transport toolbar, reachable
      without opening the setup drawer; Sound, Piano roll, Wait mode and Record stayed in it.
      Promoting them made the bar far too tall for something that is permanently pinned over the
      score — 199px at 1280px and 269px at 1024/768 — so the promoted controls were re-laid as
      `.field-inline` (label beside control, not above), the tempo unit became a two-row grid
      instead of a three-line stack, and the loop/hand labels shortened on screen with the full
      wording kept as `aria-label`, which is what every spec and screen reader reads.
      *Proof: measured 143px at 1280px and 211px at 1024/768, down from 199/269; two rows at all
      three widths, and they are the two designed units (transport+loop+hands, then tempo+mic)
      wrapping as units, which is what this task asked for — the "one row at 1280px" target was
      mine, not the roadmap's, and transport + loop + hands + tempo + mic genuinely do not fit
      1050px. Every toolbar control measures ≥44px at 1024px except the two checkboxes, whose
      44px hit area is their wrapping `<label>` and is already asserted by
      `e2e/tablet-touch-targets.spec.ts`.*
- [x] UI-28 `app/eartraining`: Next moved after the verdict and explanation, so the answered state
      reads prompt → answers → verdict → explanation → Next. The reorder shipped a keyboard
      regression first: with Next no longer where focus sat, answering dropped focus to `<body>`
      and a keyboard-only learner had to Tab from the top of the page to continue. The graded
      block is now a focusable `role="group"` named "Answer result" that takes focus on grading,
      so the verdict is announced and Next is one Tab away. *Proof: DOM order asserted in the
      screen's test; driven on a wrong answer; focus assertion covers the regression.*
- [x] UI-29 `app/session`: **the premise was already stale** — UI-08 had made the plan row itself
      the target, so there was no separate per-item "Open …" button left to remove; the 12 controls
      counted here were 4 plan rows plus the chrome around them. What this task actually changed is
      that each row's accessible name now carries its duration ("Open C major five-finger pattern,
      right hand, 4 minutes"), which is the fact a learner needs to choose between items and which
      only sighted users could previously see. *Proof: measured 12 visible controls at 1280px, of
      which 8 are chrome (the onboarding pair, the 15/30/60 budget segments, the mix disclosure and
      Start session) and 4 are the plan rows themselves — content under DESIGN.md rule 2's
      count-controls-not-content reading, the same reading Lessons and Repertoire are held to.
      `e2e/routing.spec.ts` updated to a regex that still asserts the duration rather than
      loosening the match, since Playwright's `name` is whole-string.*
- [x] UI-30 `app/lessons`: the track axis collapsed into a disclosure summarising the current
      selection ("Track: all tracks"); the level axis did not. Filter chrome is 6 visible controls
      (5 level tabs + 1 track disclosure). **The ≤8 target in the original entry was measured
      against the wrong thing** and the task stalled at 10 trying to hit it: the level tabs are
      curriculum navigation — position and extent, "level 3 of 5" — not a filter, and the lesson
      rows they reveal are content, which DESIGN.md rule 2 says not to count. Collapsing the tabs
      to make a number would have hidden the learner's place in the curriculum to satisfy a count.
      *Proof: 26 visible controls measured at 1280px — 6 of filter chrome, the other 20 being
      lesson rows and the open lesson's own actions.*
- [x] UI-31 `design-system`: swept the orphaned CSS and gated it. `check-css.mjs` now collects
      every class any selector declares and fails on any the app's own source never emits.
      **The gate had to understand composition first**: `LessonBody.tsx` builds
      `` `lesson-body-diagram-${diagram.kind}` ``, so a plain token search called a class dead
      that an e2e was asserting on — a gate that reports live code as dead is a gate someone
      switches off. Accepting `prefix-${` cut 27 candidates to 18, all confirmed absent from
      both `src/**` and `e2e/**` before deletion. **186 lines of dead CSS removed** across
      `base.css`, `domain.css`, `primitives.css`, `responsive.css`, including whole sections
      (the old practice transport bar, the pre-`SrsSummary` flashcard/retention stats, the
      in-flow input-capability banner) and several dead selectors de-grouped out of rules that
      are still live. Deleting `.practice-controls` also removed the stated blocker for
      UI-34's sticky topbar.
      Two things worth keeping: `.eartraining-stats` (40 lines) survived the automated check
      and was found by hand — its only occurrence in source was `idPrefix="eartraining-stats"`,
      a `data-testid` prefix, while the component's real className is `srs-summary`. That
      blind spot is now named concretely in the script's header, because "a string used for
      something other than a class still counts as a hit" is the shape of the next one.
      *Proof: the check exits 1 on a deliberately orphaned selector and 0 after (negative
      control run both ways); `npm run verify` green (195 files, 4099 tests); full playwright
      149 passed; and the deletion is provably invisible — 24 of 28 before/after screenshots
      byte-identical, the 4 that differ being Flashcards drawing a different random note.*
- [x] UI-32 `app/drills`: **the stated cause was wrong.** The verdict pill was already
      permanently mounted with a reserved box — it never appeared or disappeared, so reserving
      its space could not have fixed anything. The jitter was `StaffNote`'s `viewBox`, computed
      tight to whatever that card happened to draw: the SVG renders at a fixed CSS width with
      `height: auto`, so a per-card viewBox means a per-card aspect ratio and a per-card rendered
      height. Measured before: viewBox heights 100 → 94 → 88 across three cards, staff 251.4 →
      236.3 → 221.3px, page 1030 → 1003 → 988px. The two variants also disagreed on viewBox
      width (140 vs 160), so an interval card and a single-note card could not have matched even
      at equal heights.
      The box is now computed **once per deck** — the union of every card's steps, memoised on
      (kind, level) — and passed in as a prop. Deck-derived, not app-derived: a level-1 deck gets
      a 106-high box, close to the 88–100 it used to vary between, while a level-7 deck gets the
      full 274 its own range needs. The first attempt sized every card for the whole 88-key piano
      and hit 274 everywhere, which removed the jitter and made a level-1 staff 2.4x too large
      with the note floating in the middle of empty ledger space — correct against the criteria as
      written, and a worse screen.
      One real reserve-space miss did exist, just not where the entry said: `[role="status"]`'s
      shared 36px floor was 3px short of the pill's own filled height, so the first graded answer
      nudged the page. The floor is now derived from the same values the filled box is built from.
      *Proof: 1000px of `document.body.scrollHeight` across six consecutive answers, and a staff
      pinned at 233.2px with viewBox `0 26 160 106` on every one of them. The single remaining
      change is 1015 → 1000 on the first-ever answer, and it is not this screen: the review
      summary card swaps its empty-state line (39px) for a real headline (24px) once there is
      something to report. That is content arriving, and reserving the taller empty state
      permanently would waste 15px on every populated render to flatter a number.*
- [x] UI-33 `app/shell`: the input-status popover now passes the dismissing click through to
      whatever is under it. UI-23's dismiss-only dead region meant the first click after opening
      the popover was always spent closing it, so reaching a control underneath took two clicks —
      and `technique-drill.spec.ts` had encoded that cost as an Escape press before it could touch
      the level stepper. *Proof: that workaround is deleted; the spec now clicks "Increase level"
      with the popover open and asserts BOTH that the popover closed and that the level went 1→2,
      as two separate assertions, so a regression to swallowing the click fails rather than
      passes.*
- [x] UI-34 `design-system`: `.app-main` no longer declares `max-width` — it is the shell's
      content slot, `.page` is the column inside it, and DESIGN.md has called that column
      "centered" since UI-02. Capping both pinned the column to the slot's left edge on any
      monitor wider than 1152px + the rail. The `max-width: none` that undid the cap at ≤1024px
      went with it. The topbar question is answered too, and the answer is **no**: it carries a
      status chip and one button at desktop, and Practice already spends a sticky transport bar,
      so sticking it would put ~112px of permanent chrome over the score. `--topbar-h` is now a
      real token at every width (tokens/spacing.css) instead of a ≤1024px declaration plus four
      `var(--topbar-h, 56px)` fallbacks hardcoding the same number — and with the verdict written
      down, `.lessons-list-pane`'s desktop sticky offset was found to be reserving space for a bar
      that had already scrolled away. UI-36 carries the one cost this answer does not remove.
      *Proof: at 1600px a `.page--focus` screen measures 320px of gap on each side (was 0 right,
      all slack left); the lessons catalogue pins at exactly 16px (`--space-4`) once scrolled,
      not 72px; full Playwright 149 passed.*
- [x] UI-35 `app/practice`: covered by 91 lines of new tests in `useBluetoothMidi.test.ts`. Two
      consumers mount together, one pairs, both observe the same device, and unmounting one leaves
      the other connected — the module-scope registry shares a single connection rather than the
      old single-slot clobber, which was asserted rather than assumed.
      *Proof: `npx vitest run src/app/practice` green, including the new two-consumer cases.*
- [x] UI-36 `app/shell`: deleted the desktop topbar and rehomed its two controls into the nav
      rail's footer. `.app-topbar` no longer mounts at all above 1024px (`Shell.tsx`'s
      `useCompactShell()`, a `matchMedia('(max-width: 1024px)')` hook); `.app-nav` split into
      `.nav-scroll` (the only part that scrolls) and a pinned `.nav-rail-footer` sibling holding,
      in order, the action cluster (desktop only) and the level/streak line. The action cluster
      (input-status chip + Reference toggle) is one JSX expression mounted into exactly one of
      `.topbar-actions` or `.nav-actions`, never both, so `referenceToggleRef` always points at a
      real, visible button. The popover flips upward from the rail footer
      (`bottom: calc(100% + var(--space-2))`) instead of the topbar's downward anchor, and
      `.app-nav`'s z-index resolves to `--z-dialog` at desktop (back to `--z-nav` at ≤1024px,
      where the topbar must still outrank the drawer) so the popover clears the rail rather than
      being clipped by it. Deleted base.css's ~106-line desktop topbar block outright — UI-34's
      own verdict (a permanent 56px band of nothing above a scrolled desktop page, with no fix
      that didn't also delete the bar) left nothing at desktop to keep.
      Two regressions surfaced by the full e2e run and fixed in the same slice, both downstream
      of the rail footer becoming a fixed, non-scrolling sibling rather than sharing one scroll
      region with the destination list: reclaiming that footer's height took the drawer's
      scrollable content budget below its 13-item content height at exactly 1024×800, and the
      last item's clipped-but-still-computed geometry landed on the footer's own painted box
      (`elementFromPoint` returned the footer's `<span>`, not the button "behind" it) — closed by
      trimming ~24px of token-scale spacing (`.nav-primary`'s margin/padding, the inter-group gap,
      the footer's own padding-top) rather than touching the 44px touch minimum anywhere. The
      other was the focus-trap spec's own stale assumption about where Tab exits the rail at
      desktop, corrected once real Playwright (not `matchMedia`-unreliable browser-pane resizes)
      showed the actual order: chip, then Reference, then `<main>`.
      *Proof: `e2e/shell-desktop-chrome.spec.ts` (new) asserts zero `.app-topbar` above 1024px,
      `.app-nav`'s box at y=0/height=viewport, the popover fully inside the viewport and flipped
      above the chip, and Escape returning focus to the visible Reference toggle at both 1280 and
      1025px; full Playwright suite 151 passed (150 + this file) after both CSS/test fixes;
      `npm run verify` green; visual pass (Practice, Progress; 1280/1024 × dark/light) confirms no
      bar above the score at 1280, the rail spanning the full viewport, and the 1024px topbar
      unchanged; `npm run audit:a11y` 0 contrast failures across both themes.*
- [-] UI-38 `app/practice`: dropped 2026-08-15 — the premise is false, verified in code and by
      running the existing test. With no score loaded `PracticeScreen` early-returns a "Load a
      score" paragraph (`PracticeScreen.tsx:603`) — the whole toolbar, `LoopRangeControl`
      included, is unmounted, not live; `PracticeScreen.test.tsx` already asserts no controls
      render in that state, and `ScoreScreen.tsx` auto-loads a sample score so the state is
      unreachable in production anyway. The only disabled-gate any transport control uses is
      `assessmentRunning`, which the loop fieldset already participates in. Entry appears to
      have misread the comment at `PracticeScreen.tsx:667` (about the assessment case).
- [x] UI-37 `adapters/osmd`: navigating away from Practice while a score is still engraving
      threw `Cannot set properties of null (setting 'vexFlowCanvasContext')`. Root cause:
      `osmdEngraver.ts` installs one `instance.render` wrapper per OSMD instance, and the
      wrapper ran the real render unconditionally for ANY caller — not only through this
      file's own `osmd?.render()` call sites, which `destroy()` already neutralises by
      clearing the `osmd` closure variable. A call landing on `instance.render` directly
      (e.g. a stray reference kept elsewhere, or OSMD's own internal machinery in a future
      version/config) still ran against a host `destroy()` had already detached — VexFlow
      rebuilding its drawing backend against a torn-down host is exactly the shape of a null
      `vexFlowCanvasContext` write. Fixed with a `host.parentNode` guard inside the wrapper,
      covering both `destroy()` paths (plain detach and the T.6 cache's idle-entry detach)
      and staying correct across a cache re-adopt, which reconnects the same host. *Diagnosis
      note: read OSMD 1.9.9's actual bundled source — for this app's usage (always an
      already-decompressed MusicXML string, never a URL/Blob; `autoResize: false`) `load()`
      and `render()` are both fully synchronous and OSMD registers no internal timer/observer,
      so the literal "browser click lands mid-`await`" race is not reachable here; three
      honest, increasingly aggressive e2e attempts (plain click, CPU-throttled click,
      CPU-throttled raw-DOM click) all confirmed this. Proof therefore lives in
      `osmdEngraverLifecycle.test.ts`'s "render calls that arrive after destroy (UI-37)"
      suite: red against the pre-fix code (`instance.render()` called directly post-destroy
      re-ran the real render), green after. `e2e/osmd-teardown.spec.ts` stays as a
      real-browser regression net for any future async path (URL/Blob load, `autoResize:
      true`, a future OSMD version).*

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

## Drums — a second instrument, planned 2026-08-15

A complete drum-kit learning package (skills, reading, theory, kit practice; step 0 →
mid-intermediate) behind a Piano/Drums instrument switcher — two apps in one shell. Its
own roadmap, ordered and gated like this one: **[docs/drums/ROADMAP.md](docs/drums/ROADMAP.md)**
— 28 features across 4 phases (foundation → trainers → learning system → intermediate
package), each with a spec in `docs/drums/features/DR-xx-*.md`, research grounding in
[docs/drums/research-2026-08-15.md](docs/drums/research-2026-08-15.md) (pedagogy verified
against Drumeo/Rockschool/Trinity/PAS; tech against GM/e-kit behavior/MusicXML/OSMD;
market against 13 products). Not started; pick up per that file's ordering notes (DR-01
and DR-04 first). Drum work claims worktree branches as `task/DR-xx`.

---

## Session notes

Full session-by-session history: docs/roadmap-archive-2026-08-08.md and git log. Append new entries here as sessions land.
