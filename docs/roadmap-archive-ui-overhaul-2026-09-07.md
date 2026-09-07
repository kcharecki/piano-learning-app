# Roadmap archive — the UI/UX overhaul (UI-01…UI-35), shipped 2026-08-14/15

Moved out of `ROADMAP.md` on 2026-09-07, when that file reached 93% of its 28000-token budget
and this section was 32k characters of finished work — every box in it is `[x]`. Nothing is
summarised away: the section is here verbatim, headings and proof prose intact, so a later
session asking "what did UI-17 actually change, and what did the pass that found it look at"
still has the answer. `ROADMAP.md` keeps a pointer and the two-paragraph summary.

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
