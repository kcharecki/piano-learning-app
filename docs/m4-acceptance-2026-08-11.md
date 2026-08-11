# M4 acceptance pass — 2026-08-11

Milestone M4 ("progression") covers roadmap 4.1–4.9c: the curriculum model with exit criteria,
the daily session builder, per-track levels with advancement and manual override, the technique
library and drill screen, repertoire statuses and practice history, JSON/CSV export/restore, the
dashboard, the Today screen, score annotations, and the authored content (lessons, technique,
repertoire). This is the §9 acceptance-criteria review of that milestone against the running app.

**Verdict: M4 does not fully pass.** One confirmed defect blocks a stated requirement
(REQ-3.8.2's practice-history clause — see Defect 1). Every other REQ/roadmap item reviewed held
up under driven proof. Two more pre-existing e2e specs were found broken by unrelated test
staleness (not app regressions); both underlying capabilities were re-verified independently and
hold. Roadmap 4.10 is left unticked; see the Summary for the full accounting.

## Method

- Dev server on port 5311, driven against a **cold IndexedDB profile** (all databases and
  storage explicitly cleared before the first load) for the first pass, matching this app's
  own history of first-run-only defects.
- The interactive Browser pane did not composite reliably in this environment — `document.hidden`
  read `true` mid-session, nav clicks intermittently landed on stale screens, and a second tab
  pointing at another session's dev server (port 5307/5301) appeared unprompted. This matches the
  documented caveat in `docs/agent-brief.md` ("if a screenshot times out, or `document.hidden`
  reads true, do not troubleshoot it — go straight to `visual-pass.mjs`"). Every screenshot below
  was taken with `scripts/visual-pass.mjs` (real Playwright, exits 1 on any console/page error,
  both themes, both widths) instead, and every interaction claim was re-driven with a Playwright
  spec rather than trusted from source reading.
- The existing `e2e/` suite (46 spec files, ~90 tests) was run in full against port 5311 as the
  primary "verify the claim, not the box" check — most of it directly proves M4/REQ claims already
  and re-running it catches drift from the other ten sessions editing this repo concurrently.
- Three new specs were added (allowed under this task's file boundary) where an existing spec was
  stale or a claim had no driven check at all: `e2e/m4-acceptance-repertoire.spec.ts`,
  `e2e/m4-acceptance-progress-persistence.spec.ts`, `e2e/m4-acceptance-repertoire-practice-history.spec.ts`
  (the last is `test.fail()` — see Defect 1).
- Content counts (lesson/technique/repertoire totals) were cross-checked by reading
  `src/content/**` directly against what the running screens display.

## Per-criterion results

| REQ / roadmap | Criterion | Verdict | Evidence |
|---|---|---|---|
| REQ-3.1.1 (4.1) | Curriculum: levels → units → lessons → exercises, each lesson = explanation + demo + task | **Met** | [driven] Lessons screen, Level 1/2/3 tabs, 16/14/10 lessons each with prose + demo + task; [e2e] `lessons.spec.ts` |
| REQ-2.1 (4.3) | Per-track level maintained independently (playing/sight-reading/theory) | **Met** | [driven] Progress screen: three independent level selects, each currently at 1 |
| REQ-2.2 (4.1/4.3) | Advancement based on measurable checks, not time | **Met** | [driven] Progress screen's "Exit criteria toward the next level" lists percentage-based checks (e.g. "75% note and rhythm accuracy"); the "Advance" button is disabled with "Not every exit criterion is met yet." until they pass |
| REQ-2.3 (4.3) | Manual level override | **Met** | [e2e] `dashboard-populated.spec.ts`: "a manual level override moves the track and survives a reload (roadmap 4.3, REQ-2.3)" |
| REQ-3.1.4 (4.2/4.7a) | Daily session, 15/30/60 min presets, ~20/20/40/20% split, adjustable, items open the drill they name | **Met** | [driven] Today screen: 30-min default splits exactly 6/6/12/6 min = 20/20/40/20%, share fields editable; opening "C major five-finger pattern, right hand" landed on that exact drill pre-selected; [e2e] `screens.spec.ts`: "Today's session plans to the exact budget and its items navigate" |
| REQ-3.7.1 (4.4/4.4a) | Technique library by level, fingerings shown **in the score** | **Met** | [driven] Technique screen: fingerings numbered above/below noteheads on real engraved staff (not a text string); library covers five-finger (L1), 1-oct scales (L2), 2-oct scales + triads (L3), remaining majors + arpeggios (L4), harmonic/melodic minor + arpeggios (L5) — all 12 major keys covered by L3+L4; [e2e] `technique-fingering.spec.ts` |
| REQ-3.7.2 (4.4a/4.4b) | Drills run against metronome, MIDI-evaluated evenness + tempo tracking | **Met** | [e2e] `technique-drill.spec.ts`: "running a technique drill through a real MIDI keyboard scores evenness and grows the tempo history" |
| REQ-3.7.3 (4.4) | Per-drill tempo history graph | **Met** | [code] `TechniqueScreen.tsx` renders a `TrendChart` under "Clean tempo history"; [driven] section present on screen (empty/honest on a cold profile) |
| REQ-3.8.1 (4.5/4.9/4.9a) | Graded repertoire list per level, public-domain sources | **Met, exceeds minimum** | [driven] Repertoire screen: 40 pieces (grep-counted in `src/content/repertoire/gradedPieces.ts`), levels 1–5, each with composer and PD provenance note (e.g. "Traditional (French folk melody, 18th c.)"); [e2e] `graded-scores.spec.ts`, `repertoire-seed.spec.ts` |
| REQ-3.8.2 (4.5) | Status per piece | **Met** | [e2e] `e2e/m4-acceptance-repertoire.spec.ts` (new — see Defect 2 for why the existing spec needed a replacement); 4 statuses (learning/polishing/performance-ready/maintained), core property-tested in `repertoire.test.ts` |
| REQ-3.8.2 (4.5) | Practice history + best assessment result stored per piece | **Not met** | [e2e, driven, `test.fail()`] `e2e/m4-acceptance-repertoire-practice-history.spec.ts` — see **Defect 1** below |
| REQ-3.8.3 (4.5) | Manually assign a level when adding an imported score | **Met** | [e2e] `e2e/m4-acceptance-repertoire.spec.ts` |
| REQ-3.8.4 (4.5) | Periodic prompt to review maintained pieces | **Met** (wiring), practically limited by the same gap as above | [e2e] `e2e/m4-acceptance-repertoire.spec.ts`: setting a piece to "maintained" surfaces it in the "Review due" list immediately, by name. Because nothing ever moves a piece off "never practised" (Defect 1), this reduces in real use to "every maintained piece is always due" rather than a real 21-day interval |
| REQ-3.10.4 / REQ-4.3 (4.6/4.6a/4.6b) | JSON/CSV export, restore round-trip, local-only data | **Met** | [driven] Progress screen "Export & restore progress" panel: Download JSON / Download CSV / Choose File (restore); [e2e] `export-restore.spec.ts`, `round6.spec.ts` ("progress can be exported and the file round-trips back in") |
| REQ-3.10.1 (4.7/4.7b/4.7c) | Dashboard: level per track, streak, weekly time, sight-reading trend, technique tempo trends, theory retention, repertoire status | **Met** | [driven] Progress screen shows all six sections (honest zeros/"Nothing recorded yet" on a cold profile); [e2e] `dashboard-populated.spec.ts` (streak/weekly/sight-reading trend cross-checked against IndexedDB), `dashboard-assessment.spec.ts` (roadmap 4.7c — assessment accuracy now has a home) |
| REQ-3.10.2 (4.7) | Checkable per-level goals + progress toward next level | **Met** | [driven] Progress screen's exit-criteria list, each with a live percentage and a "met"/"not met" radio state |
| REQ-3.2.6 (4.8/4.8a) | Annotations (fingering, highlighting, notes) persisted per piece | **Met** | [e2e] `notehead-select.spec.ts` ("a fingering set on a clicked notehead survives a reload"), `round6.spec.ts` ("an annotation written against a measure survives a reload") |
| REQ-5.2 (4.9) | ~30 lessons L1–2, technique through L3, ~20 graded pieces | **Met, exceeds minimum** | Lessons: 16 (L1) + 14 (L2) = 30 exactly. Technique: through L5 (minimum was L3). Repertoire: 40 pieces (minimum ~20). Sight-reading: a generator (`core/generator/melody.ts`), which REQ-5.2 explicitly accepts as an alternative to fixed snippets |
| 4.9a | Seed empty repertoire from `GRADED_PIECES` | **Met** | [e2e] `repertoire-seed.spec.ts` |
| 4.9b | Lessons screen is the sole consumer of the authored curriculum/demo registry | **Met** | [e2e] `lessons.spec.ts`, including the roadmap 5.8 regression test that the G major lesson demonstrates a scale with one sharp and F major one flat (see Cross-check section) |
| 4.9c | Every `theory-quiz` exercise opens its own deck/drill, not a default | **Met** | [e2e] `deck-routing.spec.ts`, `theory-quiz-routing.spec.ts` |

## §9's whole-app, longitudinal criteria

These five sentence-level criteria in §9 describe outcomes of *using* the app over weeks, not a
single mechanism. Each is assessed as "the mechanism exists and is provably wired" vs. "cannot be
evaluated in one sitting on a fresh profile" — conflating the two would be exactly the "green
tests are not done" mistake this project's process exists to catch.

| Criterion | Verdict | Notes |
|---|---|---|
| Pass each level's exit checks in order | Mechanism **met**; outcome **cannot be evaluated** | Advancement is gated and measurable (REQ-2.2 above); actually progressing through levels in order is a multi-week usage claim outside a single acceptance pass |
| Sight-read a never-seen, level-appropriate piece at ~85% without stopping | Mechanism **met**; outcome **cannot be evaluated** | `smoke.spec.ts`/`screens.spec.ts` drive a real, unrepeatable generated exercise end to end and grade it; hitting 85% as a learner is a longitudinal claim. (The sight-reading difficulty ladder itself, e.g. level ordering, is roadmap 3.4/M3 content and out of this milestone's scope) |
| Play all major and harmonic minor scales hands together at ♩=100+ | **Partial**, beyond M4's own content minimum | All 12 major keys are in the library (L3+L4). Harmonic/melodic minor covers 6 of 12 tonics (L5, target ♩=100). REQ-5.2's stated M4 minimum is "technique library through level 3" — L5 minor coverage is bonus content already shipped, not an M4 requirement, so this does not block 4.10, but is worth a follow-up note for whichever roadmap task next touches L5 |
| Perform ≥3 upper-intermediate pieces to "performance-ready" | Mechanism **met**; outcome **cannot be evaluated**, and **partially blocked by Defect 1** | Upper-intermediate PD pieces exist (Bach Invention No. 1, Chopin Prelude Op. 28 No. 4, three sonatinas); status can be set to `performance-ready` manually regardless of Defect 1, but the "best assessment result" a teacher would actually check against never populates |
| Correctly analyze chords/cadences with Roman numerals | **Met** | [e2e] `round6.spec.ts`: the roman-numeral analysis panel appears once the theory track reaches level 4, and each numeral is drawn under its own measure |

## Defects found

### Defect 1 — REQ-3.8.2: a repertoire piece's practice history and best-assessment-result are never updated by anything a learner does

**Scope:** `src/core/repertoire/repertoire.ts`'s `recordSession` (and the `bestAccuracy` it
maintains) has exactly zero call sites in `src/app/**` outside test files — confirmed by grep.
`RepertoireScreen`'s "days since last practice" column reads straight off `RepertoirePiece.sessions`,
and nothing in `src/app/practice/**` (the Play/Stop transport, `usePracticeLog.stop()`, or the
assessment-completion path) ever calls `useRepertoireStore.getState().recordSession(...)` for the
score currently loaded, even when it is a piece in the repertoire library.

Driven proof (`e2e/m4-acceptance-repertoire-practice-history.spec.ts`, marked `test.fail()` so it
reports green while documenting the gap): add Greensleeves to the repertoire from the graded
catalogue, open it in Practice (this part works — `repertoire-open-practice.spec.ts` already
proves it), press Play, play the first beat's notes, press Stop, navigate back to Repertoire. The
row still reads "never practised."

This was already flagged, in prose, inside `e2e/repertoire.spec.ts`'s own doc comment ("There is
no UI that records a repertoire practice session yet... that is the `usePracticeLog.stop()`
wiring roadmap 2.33 leaves for later") — this pass turns that into a dated, driven assertion for
the record, and confirms it is still true today.

Downstream consequence for REQ-3.8.4: since a piece's `sessions` can never become non-empty in
real use, a "maintained" piece is *always* immediately due for review (see the module's own
"never practised = due immediately" rule), regardless of how recently it was actually practised —
the interval logic is correct (proven via injected IndexedDB data), but it never receives a real
data point to act on.

**Proposed roadmap task:**
> `app/practice`: wire a finished practice/assessment session on a loaded score to the matching
> repertoire piece's practice history (REQ-3.8.2). `usePracticeLog.stop()` (or wherever a
> practice/assessment run on the current score finalizes) never calls
> `useRepertoireStore.getState().recordSession(pieceId, sessionFromEntry(entry))` when the loaded
> `scoreId` matches a repertoire piece — `RepertoirePiece.sessions`/`.bestAccuracy` are dead
> fields in production despite being fully modelled and tested at the core layer.
> *Proof:* `npx playwright test e2e/m4-acceptance-repertoire-practice-history.spec.ts` passes for
> real (delete its `test.fail()` once it does); a piece opened from Repertoire, played, and
> stopped no longer reads "never practised".

### Defect 2 (test staleness, not an app regression) — `e2e/repertoire.spec.ts`'s `getByLabel('Level')` is now ambiguous

**Scope:** roadmap 5.3 (already merged to `master`, outside this worktree's own scope) added a
"Below my level (playing level *N*)" filter checkbox to `RepertoireScreen` whose accessible name
contains the word "Level". The existing spec's `screen.getByLabel('Level')` (no `{ exact: true }`)
now resolves to two elements in Playwright's strict mode and the whole spec fails at that line.
The underlying feature is unaffected — re-verified independently by
`e2e/m4-acceptance-repertoire.spec.ts`, which passes using `{ exact: true }`.

**Proposed roadmap task:**
> `e2e/repertoire.spec.ts`: fix the locator broken by roadmap 5.3's "Below my level" filter.
> Change line 157's `screen.getByLabel('Level')` to `screen.getByLabel('Level', { exact: true })`.
> *Proof:* `npx playwright test e2e/repertoire.spec.ts` passes.

### Defect 3 (test staleness, not an app regression) — `e2e/progress-persistence.spec.ts` predates the "More tools" disclosure and level gating

**Scope:** roadmap 5.17 (already merged, outside this worktree's scope) gated "Start assessment"
behind the `playing` track's level and moved it behind the collapsed "More tools" disclosure (see
`e2e/assessment.spec.ts`, which does both `seedPlayingLevel` and opens "More tools" first). The
older `e2e/progress-persistence.spec.ts` does neither, so at a fresh level-1 profile the button it
waits for is never rendered and the test hangs for the full 90s timeout. Re-verified independently
by `e2e/m4-acceptance-progress-persistence.spec.ts`, which adds the same two steps and passes,
confirming REQ-3.3.4/REQ-3.9.5 (assessment result + practice-log entry survive a reload) still
holds.

**Proposed roadmap task:**
> `e2e/progress-persistence.spec.ts`: fix the locator/gating broken by roadmap 5.17. Add
> `await seedPlayingLevel(page, 3)` + reload, and `await page.getByText('More tools').click()`
> before reaching for "Start assessment" (mirror `e2e/assessment.spec.ts`).
> *Proof:* `npx playwright test e2e/progress-persistence.spec.ts` passes inside its own 90s budget.

## Minor / cosmetic observations (not blocking)

- Today screen's share inputs display raw decimals (`0.2`, `0.4`) rather than percentages.
  REQ-3.1.4 only requires the shares be adjustable, which they are — a "%"-formatted display
  would read better but this is not a criterion failure.
- A cold profile lands on Practice, not Today or Lessons (`Shell.tsx:224`,
  `useState<ScreenId>('practice')`). Onboarding/first-run is out of M4's REQ scope (already
  tracked as recommendation #12 in `docs/ux-pedagogy-review-2026-08-06.md`) — noted here only
  because this pass was run cold and it is the first thing a fresh install shows.

## Cross-check against `docs/ux-pedagogy-review-2026-08-06.md`

That review (five weeks of other sessions ago, by wall-clock content in the repo) found several
severe defects. This pass independently re-drove each of the ones that overlap M4's scope and
confirms they are now fixed:

| 2026-08-06 finding | Status now | Evidence |
|---|---|---|
| "One piece of music in the whole app" | **Fixed** | 40-piece graded catalogue, each loadable and playable | [driven] screenshot, [e2e] `repertoire-open-practice.spec.ts` |
| "Practice screen is MIDI-only, no fallback" | **Fixed** | On-screen 37-key keyboard + QWERTY mapping present | [driven] screenshot, [e2e] `practice-onscreen-keyboard.spec.ts`, `qwerty-note-input.spec.ts` |
| "G/F major lessons demonstrate the C major scale" | **Fixed** | Own demo scores built from the technique library's own G/F major drills | [code] `demoScores.ts`, [e2e] `lessons.spec.ts` (roadmap 5.8) |
| "Six of seven practice activities log no time" | **Fixed** | All seven screens now log | [e2e] `practice-log-all-screens.spec.ts`, `streak-any-activity.spec.ts` — **but note this is a different mechanism from Defect 1's repertoire-specific `bestAccuracy`/`sessions`, which is still unwired** |
| "Fingering rendered as a 58-number unlabelled string" | **Fixed** | Numbers now engraved above/below the staff per note | [driven] screenshot, [e2e] `technique-fingering.spec.ts` |
| "No exposed sight-reading generator parameters" | **Fixed** | Key/hands/rhythm/independence/range/accidentals all pickable | [code] `SightReadingCustomizer.tsx`, [e2e] `sight-reading-customizer.spec.ts` |
| "Repertoire assessment accuracy has no home on the dashboard" | **Fixed** (this was roadmap 4.7c, in scope) | "Assessment accuracy" panel on Progress | [e2e] `dashboard-assessment.spec.ts` |

## Summary

21 REQ/roadmap-level criteria were checked against the running app (the per-criterion table
above), plus 5 longitudinal §9 outcomes assessed separately by mechanism. 20 of the 21 held up
under driven proof — corroborated by the full existing e2e suite (~90 tests across 46 spec files,
all run against this worktree's port 5311; two were found broken by unrelated test staleness from
other sessions' already-merged work, not by any regression in this codebase, and both underlying
capabilities were independently re-proven with new specs). One did not: REQ-3.8.2's
practice-history and best-assessment-result clauses for repertoire pieces are modelled, stored,
tested and displayed at every layer except the one that matters — nothing in production ever
calls the function that would populate them. That is exactly the kind of gap this process exists
to catch: `core/repertoire` and `RepertoireScreen` are each, individually, "done," and the whole
feature is still not.

**Roadmap 4.10 is left unticked.** The proposed follow-up task for Defect 1 is the one that would
close it; Defects 2 and 3 are test-maintenance items for whichever session next touches those
specs.
