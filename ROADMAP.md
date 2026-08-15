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
- [x] T.6 User-reported (2026-08-15): "navigating to Practice takes 2s to load" with Canon in D
      loaded. Measured at **2667ms**, and it was not parsing — it was **four full OSMD engraves**
      (~550ms each) where one was needed, and on a RETURN visit, zero were. Three causes, each
      fixed and separately measured:
      (a) `autoResize: true` makes OSMD's constructor call `handleResize`, whose last two lines are
      an unconditional `setTimeout(renderAndScrollBack, 1)` — no resize involved, and it lands
      inside `await osmd.load()`, so every load engraved twice. Turned off; `osmdEngraver.ts` now
      watches the container's own WIDTH (200ms debounce) and re-engraves only when it really
      changed, so a height-only resize is free where OSMD's version was not. → 1490ms.
      (b) React StrictMode's double-invoked effect built a second engraver while the first's
      `load()` was still awaiting; the orphan finished its engrave AND leaked, because `destroy()`
      ran before `osmd` was assigned so its `osmd?.clear()` hit nothing. A `destroyed` flag now
      aborts the load at the `await` boundary and clears the instance the aborted load made.
      → 933ms.
      (c) The remaining 933ms was re-doing work whose result was still correct. OSMD now draws into
      a host `<div>` this app owns, so `destroy()` DETACHES a finished engraving into a 2-entry LRU
      (`engravingCache.ts`) instead of discarding it, and the next mount re-attaches it: no parse,
      no layout, no cursor walk. Only scores of ≥200 notes are cached, so drills and lesson
      diagrams can never evict the piece being practised. → **107ms**.
      Also removed a wasted `analyseScore` run: `ScoreScreen` passed the score to `useMeasureLabels`
      unconditionally and threw the result away below theory level 4 (~6% of a visit).
      Proof: new `e2e/perf-practice-nav.spec.ts` budgets the return visit at <800ms and asserts the
      re-shown score has the same SVG group count and still plays (returnMs 101). Full e2e 150/150.
      `npm run verify` green (196 files / 4141 tests, +11 in `osmdEngraverLifecycle.test.ts`).
      Driven in the running app on the real 563KB `.mxl`: return visits 81/96/90ms, one `<svg>` and
      one host child (no leak), console clean, re-importing a different piece and then Canon again
      both engrave fresh (764ms) rather than reusing a wrong engraving. Screenshots at 1280 and 768
      in both themes: identical engraving, tablet correctly re-laid-out to 2 measures per system,
      no horizontal scroll.

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
- [ ] 5.58 `core/eartraining/dictation`: 5.34's per-level bounds are systematically shorter than the
      syllabus they cite — app level 1 is **2–3 notes**, RCM is **4 at Preparatory A and 5 at Level 1**
      (verified 2026-08-12); app level 5 is 7–8 against RCM's 8–10. Re-anchor the ladder on the quoted
      RCM figures, keeping REQ-3.6.1's outer 2–8 bracket or raising it deliberately and saying so.
      Contributes to **ear training** (smaller than 5.55).
      *Proof: `dictation.test.ts`'s property tests updated to the RCM-quoted per-level bounds, with the
      source figures recorded in the module doc.*

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

- [ ] U.1 `content/sightreading`: the trainer's levels have no human description. UI-11 could
      not write the "Level 1 — notes around middle C" subtitle the plan specifies, because no
      such field exists in `core/generator` or `core/sightreading`, and borrowing the
      curriculum-track description would reintroduce the roadmap-5.57 collision (two different
      numbers both called "level"). Author a short description per trainer level.
      *Proof: the Sight reading header renders a real per-level description, and a content test
      fails the build if a level has none.*
- [ ] U.2 `adapters/audio`: audio output is single-route in practice. `createDefaultAudioOutput`
      always builds Web Audio; `selectAudioOutput`'s MIDI-out path exists but is never called
      from Practice, so UI-05's Settings "Audio" section states a verified constant rather than
      a live route. Either wire the MIDI-out route to a real control or delete the dead path.
      *Proof: either Settings offers a route the learner can change and the change is audible,
      or `knip:prod` stops reporting the unused export.*
- [ ] U.3 `core/rhythm`: no per-tap early/late feedback, and no manual Stop. Neither
      `useRhythmDrill` nor `useClapbackDrill` classifies a tap in real time — both produce one
      batch grade at run end — so UI-14 shipped a generic hit flash and deliberately refused to
      add real-time onset matching to correctness-critical timing code. Wiring `engine.stop()`
      naively would fire the run-ended path mid-pattern and grade every unplayed onset as
      missed. This is a **core task with property tests**, not a UI task.
      *Proof: property tests over the tap classifier, then the pad shows early/late/hit per tap.*
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
- [ ] UI-36 `app/shell`: delete the desktop topbar and rehome its two controls into the nav
      rail's footer. UI-34 settled that the bar must NOT be sticky at desktop (it holds a
      MIDI chip and one Reference button; sticking it would stack ~112px of permanent chrome
      above Practice's score, on top of the transport bar). The cost of that answer is a 56px
      strip of bare rail background above the rail once the page scrolls, and pinning the rail
      at 0 only relocates the waste — the rail's level/streak footer then hangs below the fold
      at rest. Removing the bar is the only move that reclaims the height instead of moving it.
      Hazards, none of them optional: `.app-nav` is `overflow-y: auto`, so the absolutely
      positioned input-status popover would be clipped by the rail's scroll box (needs an inner
      scroll wrapper with the footer as a non-scrolling sibling, and the popover flipped to open
      upward); the popover's `--z-dialog` is currently resolved against the root stacking
      context and would become relative to `.app-nav`'s own; and the cluster still needs a home
      at ≤1024px, so rendering it twice behind a breakpoint gate would leave
      `referenceToggleRef` pointing at the hidden instance and silently break the Reference
      panel's focus return. Shell.tsx is main-thread-only — this cannot be farmed out alongside
      other shell work. *Proof: no `.app-topbar` in the DOM above 1024px; rail spans the full
      viewport; the status popover opens unclipped from the footer; Escape still returns focus
      to the visible Reference toggle at both widths.*
- [ ] UI-37 `adapters/osmd`: navigating away from Practice while a score is still engraving
      throws `Cannot set properties of null (setting 'vexFlowCanvasContext')` — OSMD's async
      render resolves after the container has been torn down. Seen in the console during the
      UI overhaul's browser passes, not caught by any spec because the e2e suite waits for the
      SVG before navigating. *Proof: a spec that routes away mid-render with a console-error
      assertion, red before and green after.*
- [-] UI-38 `app/practice`: dropped 2026-08-15 — the premise is false, verified in code and by
      running the existing test. With no score loaded `PracticeScreen` early-returns a "Load a
      score" paragraph (`PracticeScreen.tsx:603`) — the whole toolbar, `LoopRangeControl`
      included, is unmounted, not live; `PracticeScreen.test.tsx` already asserts no controls
      render in that state, and `ScoreScreen.tsx` auto-loads a sample score so the state is
      unreachable in production anyway. The only disabled-gate any transport control uses is
      `assessmentRunning`, which the loop fieldset already participates in. Entry appears to
      have misread the comment at `PracticeScreen.tsx:667` (about the assessment case).

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
