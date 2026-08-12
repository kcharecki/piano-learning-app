# M4 acceptance pass — 2026-08-12b

Milestone M4 ("progression") covers roadmap 4.1–4.9c: the curriculum model with exit criteria,
the daily session builder, per-track levels with advancement and manual override, the technique
library and drill screen, repertoire statuses and practice history, JSON/CSV export/restore, the
dashboard, the Today screen, score annotations, and the authored content. This is the **third**
§9 acceptance review of that milestone. Baselines:
[docs/m4-acceptance-2026-08-11.md](m4-acceptance-2026-08-11.md) (20/21, failed) and
[docs/m4-acceptance-2026-08-12.md](m4-acceptance-2026-08-12.md) (19/21, failed).

**Verdict: M4 passes. 21 of 21 criteria met.** Both blockers the 2026-08-12 pass raised are
genuinely fixed and were re-driven here from scratch, not taken on trust. Nothing that passed
before regressed under the day's merges (milestones panel, audio recording, falling-note piano
roll, Bluetooth MIDI everywhere, 44px tablet touch targets).

That is not the most useful thing this pass found. **Five criteria were carrying a PASS on
evidence this project does not accept** — a code reading of `useDashboard.ts`, or an e2e that
asserted the neighbour of the requirement. Three sections of the REQ-3.10.1 dashboard, the whole
of REQ-3.10.2, and REQ-2.2's Advance control had *zero* e2e coverage before today: grep the suite
for `dashboard-criterion`, `dashboard-advance`, `dashboard-retention`, `dashboard-technique` or
`dashboard-repertoire` at the previous pass's HEAD and there are no hits. REQ-3.1.4's
"adjustable by the user" clause had none either. Those five are now driven, and they all hold —
but they were passing on paper for two consecutive acceptance reviews, which is exactly the
failure mode this milestone's gate exists to prevent.

## Method

- Worktree `w-410b`, branch `task/4.10-rerun`, dev server on port 5818, driven with Playwright
  specs and `scripts/visual-pass.mjs`. Every verdict below marked "driven" was observed in the
  running app. No verdict rests on reading source or on a unit test alone.
- **Every exit code below was captured unpiped**, per the process hazard the previous pass
  recorded.
- **Baseline discipline.** The branch base is `0c4a015`. `git log` shows the milestones panel
  (`core/progress/milestones.ts`, `app/dashboard/MilestonePanel.tsx`), audio recording
  (`adapters/audio/audioRecorder.ts`, a widened `adapters/store/idb.ts`), the piano roll,
  BLE MIDI via `MidiDeviceStatus` on seven screens, and the 44px tablet touch-target change all
  landing since the previous pass. Each was checked for reach into an M4 surface before its
  criteria were re-driven; the findings are in "Did the day's merges break anything" below.
- Four new tests were written and left in the suite; one existing spec was strengthened.

## Per-criterion results

| # | REQ / roadmap | Criterion | Verdict | Evidence |
|---|---|---|---|---|
| 1 | REQ-3.1.1 (4.1) | Curriculum: levels → units → lessons → exercises; lesson = explanation + demo + task | **Met** | [e2e] `lessons.spec.ts` (opens a lesson, opens its playing task, gets that lesson's OWN demo), `lesson-staff-rhythm-diagrams.spec.ts`; [driven] visual pass on Lessons, console clean |
| 2 | REQ-2.1 (4.3) | Per-track level maintained independently | **Met** | [e2e, driven] `m4-acceptance-dashboard-sections.spec.ts` test 3 — sight-reading advances to 2 while playing and theory stay at 1, and the split survives a reload; `dashboard-populated.spec.ts` |
| 3 | REQ-2.2 (4.1/4.3) | Advancement on measurable checks, not time | **Met — first driven proof** | [e2e, driven] `m4-acceptance-dashboard-sections.spec.ts` test 3. Was passing on a code reading of `DashboardScreen.tsx:291`; see **Gap A** |
| 4 | REQ-2.3 (4.3) | Manual level override | **Met** | [e2e] `dashboard-populated.spec.ts` — override moves the track, marks it `(overridden)`, survives a reload |
| 5 | REQ-3.1.4 (4.2/4.7a) | Daily session, 15/30/60 presets, ~20/20/40/20 split, adjustable | **Met — was the previous pass's Defect 1** | [e2e, driven] `m4-acceptance-session-mix.spec.ts`, 2/2 with both `test.fail()` markers gone; adjustability now driven by `m4-acceptance-dashboard-sections.spec.ts` test 2 (**Gap D**); [driven] visual pass on Today reads warm-up 5 + technique 1 / sight-reading 6 / lesson 12 / theory-ear 6 at a 30-minute budget — exactly 20/20/40/20 on a cold profile |
| 6 | REQ-3.7.1 (4.4/4.4a) | Technique library by level, fingerings in the score | **Met** | [e2e] `technique-fingering.spec.ts` (fingering above RH, below LH, per note) |
| 7 | REQ-3.7.2 (4.4a/4.4b) | Drills against metronome, MIDI-evaluated evenness + tempo tracking | **Met** | [e2e] `technique-drill.spec.ts` — real MIDI input through the whole drill |
| 8 | REQ-3.7.3 (4.4) | Per-drill tempo history graph | **Met — strengthened** | [e2e] `technique-drill.spec.ts` reads the attempt back out of IndexedDB; **new**: `m4-acceptance-dashboard-sections.spec.ts` test 1 seeds four attempts (three clean, one not) and asserts the chart plots exactly the three clean tempos — proving the screen renders `tempoHistory`, not raw attempts |
| 9 | REQ-3.8.1 (4.5/4.9/4.9a) | Graded repertoire per level, public-domain | **Met, exceeds minimum** | 40 pieces across levels 1–5 (18/13/2/5/2) in `content/repertoire/gradedPieces.ts`; [e2e] `graded-scores.spec.ts`, `repertoire-seed.spec.ts` |
| 10 | REQ-3.8.2 (4.5) | Status per piece | **Met** | [e2e] `m4-acceptance-repertoire.spec.ts`; **new**: the dashboard's own status readout is now driven (test 1) |
| 11 | REQ-3.8.2 (4.5) | Practice history + best assessment result stored per piece | **Met** | [e2e, driven] `m4-acceptance-export-repertoire-history.spec.ts` test 1 — stored row read back out of IndexedDB, then backdated behind the app's back so the screen must follow |
| 12 | REQ-3.8.3 (4.5) | Manually assign a level to an imported score | **Met** | [e2e] `m4-acceptance-repertoire.spec.ts` |
| 13 | REQ-3.8.4 (4.5) | Periodic prompt to review "maintained" pieces | **Met — strengthened** | [e2e] `m4-acceptance-repertoire.spec.ts`; **new**: test 1 seeds two `maintained` pieces (last practised 40 days / 2 days), asserts only the overdue one is listed, then backdates the fresh one's session in storage and watches it join the list |
| 14 | REQ-3.10.4 / REQ-4.3 (4.6/4.6a/4.6b) | JSON/CSV export, restore round-trip, local-only data | **Met — was the previous pass's Defect 2** | [e2e, driven] `m4-acceptance-export-repertoire-history.spec.ts` test 2, `test.fail()` gone. **Strengthened here**: the old assertion was "'never practised' is hidden", an absence a vanished row satisfies too. It now asserts positively that the restored record carries the sessions, a non-zero `bestAccuracy`, the level, and the notes — the notes read back off the live input |
| 15 | REQ-3.10.1 (4.7/4.7b/4.7c) | Dashboard: level/track, streak, weekly time, sight-reading trend, technique trends, theory retention, repertoire status | **Met — first complete driven proof** | 4 of 7 by `dashboard-populated.spec.ts`; the other 3 (technique trends, theory retention, repertoire status) had never been driven — see **Gap B**. Now `m4-acceptance-dashboard-sections.spec.ts` test 1 |
| 16 | REQ-3.10.2 (4.7) | Checkable per-level goals + progress to next level | **Met — first driven proof** | [e2e, driven] `m4-acceptance-dashboard-sections.spec.ts` test 3 — the sight-reading criterion moves "Not met (0%)" → "Met (100%)" purely because evidence appeared in storage. See **Gap C** |
| 17 | REQ-3.2.6 (4.8/4.8a) | Annotations persisted per piece | **Met** | [e2e] `notehead-select.spec.ts`, `round6.spec.ts` |
| 18 | REQ-5.2 (4.9) | ~30 lessons L1–2, technique through L3, ~20 graded pieces | **Met, exceeds minimum** | L1 16 + L2 14 = 30 exactly; technique through L5; 40 graded pieces |
| 19 | 4.9a | Seed empty repertoire from `GRADED_PIECES` | **Met** | [e2e] `repertoire-seed.spec.ts` |
| 20 | 4.9b | Lessons screen is the sole consumer of the authored curriculum | **Met** | [e2e] `lessons.spec.ts`; `knip --production` exits 0, so no authored-content module is unreachable |
| 21 | 4.9c | Every `theory-quiz` exercise opens its own deck | **Met** | [e2e] `deck-routing.spec.ts`, `theory-quiz-routing.spec.ts` |

**21 met, 0 not met.**

## §9's whole-app, longitudinal criteria

| Criterion | Verdict | Notes |
|---|---|---|
| Pass each level's exit checks in order | Mechanism **met**, now proven | The mechanism was the weakest-evidenced thing in the whole milestone until today. `m4-acceptance-dashboard-sections.spec.ts` test 3 drives one full check → advance → persist cycle. The multi-week *outcome* remains outside a single acceptance pass |
| Sight-read a never-seen level-appropriate piece at ~85% | Mechanism **met**; outcome **cannot be evaluated** | `smoke.spec.ts`/`screens.spec.ts` drive and grade a real generated exercise |
| All major and harmonic minor scales hands together at ♩=100+ | **Partial**, beyond M4's content minimum | 12 major keys (L3+L4); harmonic/melodic minor covers 6 of 12 tonics (L5). REQ-5.2's M4 minimum is "through level 3", so this does not block 4.10 |
| Perform ≥3 upper-intermediate pieces to "performance-ready" | Mechanism **met** | The previous pass's caveat is lifted: `bestAccuracy` populates *and* now survives a backup/restore (criterion 14, positively asserted) |
| Analyze chords/cadences with Roman numerals | **Met** | [e2e] `round6.spec.ts` |

## The five evidence gaps this pass closed

None of these was a broken feature. All five worked when finally driven. What they were is
**criteria carrying a PASS that nothing executed** — the precise thing this repo's standard of
proof exists to catch, found in the acceptance document rather than in the code.

**Gap A — REQ-2.2 had no e2e at all.** The 2026-08-11 and 2026-08-12 passes both cite
"`canAdvance` gates the Advance button (`DashboardScreen.tsx:291`)". That is a code reading. A
button wired to a `canAdvance` that always returned `true`, or an `advanceTrack` that no-opped,
would have satisfied it. Now driven: with a fresh profile the Advance button is disabled and
states why; seeding three 92% sight-reading reads into the real IndexedDB and reloading flips the
criterion to Met and enables the button; clicking it moves the track to level 2 **without**
marking it `(overridden)`, which is what keeps REQ-2.2's evidence-based advancement distinct from
REQ-2.3's manual placement.

**Gap B — three of REQ-3.10.1's seven dashboard items had never been rendered from real data.**
`dashboard-populated.spec.ts` covers the level, the streak, the weekly minutes and the
sight-reading trend. Technique tempo trends, theory retention and repertoire status were passed on
`useDashboard.ts:228–388`. Now driven, each with a trap built in: the seeded technique history
includes a **non-clean** attempt at 999 bpm that must not be plotted, and the seeded card set
includes a **non-theory** card that must not be counted. Both traps hold — the chart plots exactly
52/58/63 bpm and retention reads total 4 / due 2 / mastered 2 / learning 1 / new 1.

**Gap C — REQ-3.10.2 had no e2e at all.** Same spec, same mechanism as Gap A: the exit-criteria
list's percentages are driven by evidence, and a criterion moves 0% → 100% with nothing else
changing.

**Gap D — REQ-3.1.4's "adjustable by the user" had no e2e at all.** `m4-acceptance-session-mix.spec.ts`
proves the *default* proportions; `screens.spec.ts` proves the *total*. A set of mix inputs wired
to nothing passes both. Now driven: at a 60-minute budget the lesson segment is 24 min and
theory/ear 12 min; dropping theory/ear's share to 0 and raising lesson's to 0.6 makes theory/ear
0 min and lesson strictly more than 24, with the total still exactly 60; "Reset mix" restores
24/12.

**Gap E — the restore half of criterion 14 asserted an absence.** Fixed by adding positive
assertions, described in the table above.

**The shape worth naming.** All five gaps have the same signature as the two *defects* the last
two passes found: a check that asserts something adjacent to the requirement. A *total* rather
than a *mix*; a *round trip of the exported fields* rather than *all progress data*; an *absence*
rather than a *value*; a *code path that exists* rather than a *behaviour that happened*. An
acceptance document is not immune to it — this pass's real finding is that a criterion table can
launder a code reading into a PASS and carry it for two rounds.

## Did the day's merges break anything?

No — checked, not assumed.

| Merge | Reach into M4 | Result |
|---|---|---|
| Milestones panel (`core/progress/milestones.ts`, `MilestonePanel.tsx`) | Renders **on the Progress screen**, the home of criteria 15/16 | Recomputed each render from the same persisted stores the rest of the dashboard reads; nothing cached or hardcoded. `milestones.spec.ts` passes, criteria 15/16 re-driven from scratch, visual pass on Progress clean |
| Audio recording (`adapters/audio/audioRecorder.ts`, `RecordPanel.tsx`, widened `adapters/store/idb.ts`) | Practice screen, where the repertoire practice log is written | **No contact**: `useRecorder.ts` never imports `usePracticeLog.ts` or the repertoire store. The idb change added prefixed keys inside the existing `recordings` store with **no `DB_VERSION` bump**, so a database from an older build still opens. Criterion 11 re-driven and passes |
| Falling-note piano roll | Practice screen | `piano-roll.spec.ts` passes, including its perf budget against a 1603-note score |
| BLE MIDI via `MidiDeviceStatus` on 7 screens | Technique, Practice, Sight reading, Flashcards, Theory | `bluetooth-midi.spec.ts` passes; visual pass console-clean on all five M4 destinations |
| 44px touch targets at tablet widths | Every M4 screen | `tablet-touch-targets.spec.ts` passes at 768×1024 and 1024×1366 with no horizontal scroll; visual pass clean at 1024 in both themes |

## Findings that are not criterion failures

### Finding 1 — `npm run verify:full` cannot be green in a worktree, and the previous pass's Defect 4 was misdiagnosed

`npm run verify:full` exits **1** here, at its `knip` stage, before `test:e2e`:

```
Unused devDependencies (2)   @stryker-mutator/core, @testing-library/dom
Unlisted binaries (8)        vite, tsc, vitest, playwright, eslint, prettier, knip, stryker
```

This is **not a repo defect**. It is an artifact of the worktree contract: a worktree checkout has
no installed `node_modules` (the repo root's is used via npm's parent-directory lookup, which
`knip` does not perform for binaries or for plugin-owned dependencies). Proven, not guessed —
symlinking the root's `node_modules` into the worktree and re-running the identical command:

| Command | `node_modules` resolvable | Exit |
|---|---|---|
| `npm run knip` | no (worktree default) | **1** |
| `npm run knip` | yes (junction to repo root) | **0** |

The previous pass reported this as "confirmed pre-existing… stashing this branch's additions and
re-running on a clean HEAD reproduces it exactly". That re-run was also inside a worktree, so it
reproduced the artifact, not a defect. The practical cost is real either way: **the one gate that
runs e2e cannot be run from the place most sessions work**, so it gets skipped exactly where it
would help. Recorded as a proposed task below.

`knip:prod` and `knip:prod:all` both exit **0** even in the worktree, so the previous pass's
Defect 3 (`noteDisplay.ts` implemented-tested-unimported, and the duplicated `midiToFrequency`)
is genuinely closed. There is no "implemented, tested, never imported" module left in production.

### Finding 2 — an advancement can be lost if the tab reloads within the write-queue window

Observed, not theorised. The first version of the REQ-2.2 test clicked "Advance", asserted the
screen read level 2, and reloaded immediately: after the reload the track was back at **level 1**,
and stayed there for a 10-second poll. `persistence.ts`'s `createWriteQueue` drains
asynchronously and there is **no `pagehide`/`visibilitychange`/`beforeunload` flush anywhere in
the module** (grepped: zero hits). The advancement lives only in the zustand store until that
drain completes.

The spec now waits for the value to reach the persisted `levelState` record before reloading, and
then passes — so REQ-2.1/2.2 are met, and this is not scored against them. But the window is real
for a learner who clicks Advance and closes the tab, and it is the same class of bug as the
onboarding race `0c4a015` fixed one commit ago. Proposed as a follow-up task, not a blocker.

### Finding 3 — module comments that now assert things the code contradicts (unchanged since the previous pass)

Still present, verbatim, and still load-bearing: the previous pass's reachability check was partly
guided by them, and this one had to re-verify each by hand.

- `core/repertoire/repertoire.ts` — "roadmap 4.5's consumer screen doesn't call this yet" on
  exports at lines 22, 54, 99, 133, 149, 173, 202, and `sessionFromEntry`'s "`usePracticeLog.ts`'s
  `stop()` does not actually call `recordSession` … (checked: no reference … in that file)". It
  does; triage T.5 wired it, and criterion 11 drives it.
- `content/curriculum/curriculum.ts:17–22` — "Not consumed yet: the lesson screen…" and
  "`knip.jsonc`'s ignore entry … must STAY until that lesson screen imports `CURRICULUM`". The
  lesson screen landed (4.9b) and `knip.jsonc`'s ignore list is now empty.
- `app/state/techniqueStore.ts` — "`hydrate` exists for exactly that future wiring and, in the
  meantime, is unused". `persistence.ts:346` calls it, and `:568` persists the store.

The previous pass logged these as minor observations and nothing acted on them. Two passes is
enough; they are a proposed task now.

## Tooling results

| Command | Exit | Note |
|---|---|---|
| `npm run verify` | **0** | 190 test files, 3900 tests (before this pass's specs) |
| `npm run verify` (after this pass's specs) | **0** | Same counts — the new work is all e2e |
| `npm run verify:full` | **1** | Fails at `knip`, a worktree artifact — Finding 1 |
| `npm run knip` (with `node_modules` resolvable) | **0** | Finding 1's control |
| `npm run knip:prod` | **0** | Previous pass's Defect 3 closed |
| `npm run knip:prod:all` | **0** | Previous pass's Defect 3 closed |
| `npx playwright test` (full suite, baseline) | **0** | 123 passed |
| `npx playwright test` (full suite, with this pass's 4 new tests) | **0** | **126 passed** |
| `scripts/visual-pass.mjs` × 5 destinations | **0** each | Today, Repertoire, Progress, Lessons, Technique — 1280 and 1024, dark and light, console clean in all four configurations each |

## Diff against both previous runs

| Criterion | 2026-08-11 | 2026-08-12 | 2026-08-12b | Why it moved |
|---|---|---|---|---|
| REQ-3.1.4 session mix (#5) | Met | **Not met** (Defect 1) | **Met** | `task/M4.F1` removed the flat warm-up reservation and gave the `lesson` segment a cold-profile fallback. Re-driven here, and confirmed visually at 20/20/40/20 |
| REQ-3.10.4 / REQ-4.3 export (#14) | Met | **Not met** (Defect 2) | **Met** | `task/M4.F2` widened `RepertoirePieceLike`. Re-driven here under strictly stronger assertions than the fix's own |
| REQ-2.2 advancement (#3) | Met (code reading) | Met (code reading) | **Met (driven)** | Gap A |
| REQ-3.10.1 dashboard (#15) | Met (4 of 7 driven) | Met (4 of 7 driven) | **Met (7 of 7 driven)** | Gap B |
| REQ-3.10.2 goals (#16) | Met (visual) | Met (visual) | **Met (driven)** | Gap C |
| REQ-3.1.4 adjustability | not separately assessed | not separately assessed | **Met (driven)** | Gap D |
| REQ-3.7.3 tempo history (#8) | presence-only | Met (IndexedDB read-back) | **Met, + the chart itself** | The clean-attempt filter is now proven at the screen |
| REQ-3.8.4 review prompt (#13) | Met, "practically limited" | Met | **Met, + the due list driven** | Seeded and edited storage, both directions |
| `npm run knip:prod` | "clean" (piped, unsafe) | **Red** (Defect 3) | **0** | Fixed on master by the integrator |
| `npm run verify:full` | not run | **Red** (Defect 4, called pre-existing) | **Red — but misdiagnosed before** | Finding 1: worktree artifact, proven by control experiment |
| Stale module comments | minor observation | minor observation | **proposed task** | Unchanged for two passes and actively misleading |
| Advance durability | not examined | not examined | **Finding 2** | Observed failing, then bounded |

## New specs added by this pass

- **`e2e/m4-acceptance-dashboard-sections.spec.ts`** — three tests, all passing, no `test.fail()`:
  1. *REQ-3.10.1: the technique, retention and repertoire sections render the stored data, and
     follow an edit made behind the app's back.* Asserts the honest empty states first, seeds the
     real `techniqueHistory` / `srsCards` / `repertoire` IndexedDB records, reloads, checks exact
     values (including the two exclusion traps), then rewrites a stored status and a stored
     session date and reloads again — the screen follows both.
  2. *REQ-3.1.4: the session mix is adjustable by the learner, and the plan follows the
     adjustment.* Gap D.
  3. *REQ-2.2/REQ-3.10.2: the exit-criteria list and the Advance control are driven by measurable
     evidence, not by time or a click.* Gaps A and C, plus an explicit poll proving the
     advancement reaches the persisted `levelState` (which is how Finding 2 was found).
- **`e2e/m4-acceptance-export-repertoire-history.spec.ts`** (existing, strengthened) — the restore
  half of test 2 now asserts the sessions, `bestAccuracy`, level and notes positively, and reads
  the restored notes back off the live control, instead of only checking that "never practised"
  is hidden.

## Proposed roadmap tasks

None of these blocks 4.10. Each names its own proof action.

1. **Make `npm run verify:full` runnable from a worktree.** Either teach `knip` where the
   installed `node_modules` is (a `knip.jsonc` `workspaces`/root setting, or an `ignoreBinaries`
   + `ignoreDependencies` pair for the eight binaries and two plugin-owned devDependencies), or
   have `docs/WORKTREES.md` state plainly that `verify:full` is a main-checkout-only gate and give
   worktree sessions `npm run verify && npx playwright test` as the equivalent. *Proof:* from
   inside a fresh worktree, the documented command exits 0, captured unpiped.
2. **Flush the persistence write queue on `pagehide`.** `app/state/persistence.ts` has no
   unload-time drain, so any store write in flight when the tab closes is lost — demonstrated for
   `advanceTrack` in Finding 2. *Proof:* an e2e that clicks "Advance" and reloads *immediately*,
   with no poll, and still reads level 2 after the reload.
3. **Delete the module comments that the code has already contradicted** in
   `core/repertoire/repertoire.ts`, `content/curriculum/curriculum.ts` and
   `app/state/techniqueStore.ts` (Finding 3). These are the comments acceptance passes use to
   route their reachability checks, so a false one costs a whole review cycle. *Proof:* `grep -n
   "doesn't call this yet\|Not consumed yet\|is unused" src/` returns nothing in those three
   files, and `npm run verify` stays green.

## Summary

21 REQ/roadmap criteria were re-checked against the running app, plus the five longitudinal §9
outcomes assessed by mechanism. **21 of 21 pass.** The two blockers from 2026-08-12 are closed and
independently re-proven under stricter assertions than the fixes' own; nothing that passed before
regressed under a day of merges that touched every M4 surface.

The pass's own finding is about the reviews, not the code: five criteria had been carrying a PASS
on a code reading or on an assertion adjacent to the requirement, and four of them had no
executing test whatsoever. They hold now that they are driven — but "it holds" was never the
claim under test; "we checked" was. Those five checks now exist, in `e2e/`, and will fail if the
behaviour goes away.

**Roadmap 4.10 is ticked.**
