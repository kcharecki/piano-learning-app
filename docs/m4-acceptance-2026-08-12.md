# M4 acceptance pass — 2026-08-12

Milestone M4 ("progression") covers roadmap 4.1–4.9c: the curriculum model with exit criteria,
the daily session builder, per-track levels with advancement and manual override, the technique
library and drill screen, repertoire statuses and practice history, JSON/CSV export/restore, the
dashboard, the Today screen, score annotations, and the authored content. This is the second
§9 acceptance review of that milestone, run against the running app. Baseline:
[docs/m4-acceptance-2026-08-11.md](m4-acceptance-2026-08-11.md).

**Verdict: M4 still does not pass.** The single blocker the 2026-08-11 pass found (REQ-3.8.2's
practice history) is genuinely fixed and re-proven here under a stricter test than the one that
closed it. But **two criteria that passed on 2026-08-11 fail today** — one a real regression from
work merged since (REQ-3.1.4), one a gap that only became material *because* the REQ-3.8.2 fix
landed (REQ-3.10.4/REQ-4.3). Net: 19 of 21 criteria pass, against 20 of 21 last time. Roadmap
4.10 stays unticked.

This is the second consecutive pass where the defect was found at an integration seam that every
individual module's green tests stepped over.

## Method

- Worktree `w-4-10`, dev server on port 5487, driven with Playwright specs and
  `scripts/visual-pass.mjs`. Every verdict below that says "driven" was observed in the running
  app; no verdict rests on reading source or on a unit test alone.
- **Baseline discipline.** `git log c20c806..HEAD -- src/` shows 40+ commits touching `src/`
  since the previous pass, including the shell's real URL routing, Today becoming the default
  destination, the onboarding gateway, a runnable session plan with a new warm-up segment, and
  the REQ-3.8.2 fix itself. Criteria whose code changed were re-driven from scratch rather than
  carried over; criteria whose code did not change were re-checked against the existing e2e
  suite.
- Two new specs were added, both left in the suite (see New specs below).
- **A correction to how the previous run's tooling was read.** Several commands in this
  environment were originally invoked as `npm run … | tail -N`, which reports *tail's* exit
  code, not the command's. Two "green" results were false under that pattern: the full e2e run,
  and `npm run knip:prod`. Every exit code quoted in this document was captured directly with no
  pipe. This is worth recording as a process hazard, not just a local slip.

## Per-criterion results

| # | REQ / roadmap | Criterion | Verdict | Evidence |
|---|---|---|---|---|
| 1 | REQ-3.1.1 (4.1) | Curriculum: levels → units → lessons → exercises; lesson = explanation + demo + task | **Met** | [e2e] `lessons.spec.ts`, `lesson-staff-rhythm-diagrams.spec.ts`; [driven] visual pass on Lessons, console clean |
| 2 | REQ-2.1 (4.3) | Per-track level maintained independently | **Met** | [e2e] `dashboard-populated.spec.ts`; values read from `useLevelStore` (`useDashboard.ts:350`) |
| 3 | REQ-2.2 (4.1/4.3) | Advancement on measurable checks, not time | **Met** | [e2e] `dashboard-populated.spec.ts`; `canAdvance` gates the Advance button (`DashboardScreen.tsx:291`) |
| 4 | REQ-2.3 (4.3) | Manual level override | **Met** | [e2e] `dashboard-populated.spec.ts` — override moves the track and survives a reload |
| 5 | REQ-3.1.4 (4.2/4.7a) | Daily session, 15/30/60 presets, ~20/20/40/20 split, adjustable | **Not met** | [e2e, driven] `m4-acceptance-session-mix.spec.ts` — see **Defect 1**. Regression since 2026-08-11 |
| 6 | REQ-3.7.1 (4.4/4.4a) | Technique library by level, fingerings in the score | **Met** | [e2e] `technique-fingering.spec.ts`; 54 drills across levels 1–5 (`core/technique/library.ts:567`) |
| 7 | REQ-3.7.2 (4.4a/4.4b) | Drills against metronome, MIDI-evaluated evenness + tempo tracking | **Met** | [e2e] `technique-drill.spec.ts` — real MIDI input, evenness scored 84–94%, "Clean at" reported |
| 8 | REQ-3.7.3 (4.4) | Per-drill tempo history graph | **Met** | [e2e] `technique-drill.spec.ts` asserts the best-BPM readout *and* reads the attempt back out of IndexedDB — no longer a presence-only check as in the previous pass |
| 9 | REQ-3.8.1 (4.5/4.9/4.9a) | Graded repertoire per level, public-domain | **Met, exceeds minimum** | 40 pieces, levels 1–5 (`content/repertoire/gradedPieces.ts`); [e2e] `graded-scores.spec.ts`, `repertoire-seed.spec.ts` |
| 10 | REQ-3.8.2 (4.5) | Status per piece | **Met** | [e2e] `m4-acceptance-repertoire.spec.ts` |
| 11 | REQ-3.8.2 (4.5) | Practice history + best assessment result stored per piece | **Met** — *was the 2026-08-11 blocker* | [e2e, driven] `m4-acceptance-export-repertoire-history.spec.ts` test 1 — see Diff below for why this is a stronger proof than the spec that closed it |
| 12 | REQ-3.8.3 (4.5) | Manually assign a level to an imported score | **Met** | [e2e] `m4-acceptance-repertoire.spec.ts` |
| 13 | REQ-3.8.4 (4.5) | Periodic prompt to review "maintained" pieces | **Met** — caveat now lifted | [e2e] `m4-acceptance-repertoire.spec.ts`; the previous pass's "every maintained piece is always due" limitation is gone now that sessions record — a backdated stored session drives the day count (spec test 1) |
| 14 | REQ-3.10.4 / REQ-4.3 (4.6/4.6a/4.6b) | JSON/CSV export, restore round-trip, local-only data | **Not met** | [e2e, driven] `m4-acceptance-export-repertoire-history.spec.ts` test 2 — see **Defect 2**. Regression in effect since 2026-08-11 |
| 15 | REQ-3.10.1 (4.7/4.7b/4.7c) | Dashboard: level/track, streak, weekly time, sight-reading trend, technique trends, theory retention, repertoire status | **Met** | All seven render from persisted stores, none re-derived or hardcoded (`useDashboard.ts:228–388`); [e2e] `dashboard-populated.spec.ts` cross-checks against IndexedDB, `dashboard-assessment.spec.ts` |
| 16 | REQ-3.10.2 (4.7) | Checkable per-level goals + progress to next level | **Met** | [driven] Progress screen exit-criteria list with live percentages; [e2e] `dashboard-populated.spec.ts` |
| 17 | REQ-3.2.6 (4.8/4.8a) | Annotations persisted per piece | **Met** | [e2e] `notehead-select.spec.ts`, `round6.spec.ts` |
| 18 | REQ-5.2 (4.9) | ~30 lessons L1–2, technique through L3, ~20 graded pieces | **Met, exceeds minimum** | L1 16 + L2 14 = 30 exactly (46 lessons across all five levels); technique through L5; 40 pieces; sight-reading via generator |
| 19 | 4.9a | Seed empty repertoire from `GRADED_PIECES` | **Met** | [e2e] `repertoire-seed.spec.ts` |
| 20 | 4.9b | Lessons screen is the sole consumer of the authored curriculum | **Met** | [e2e] `lessons.spec.ts` |
| 21 | 4.9c | Every `theory-quiz` exercise opens its own deck | **Met** | [e2e] `deck-routing.spec.ts`, `theory-quiz-routing.spec.ts` |

**19 met, 2 not met.**

## §9's whole-app, longitudinal criteria

Unchanged in substance from the previous pass; re-stated with this pass's corrections.

| Criterion | Verdict | Notes |
|---|---|---|
| Pass each level's exit checks in order | Mechanism **met**; outcome **cannot be evaluated** | Multi-week usage claim, outside a single acceptance pass |
| Sight-read a never-seen level-appropriate piece at ~85% | Mechanism **met**; outcome **cannot be evaluated** | `smoke.spec.ts`/`screens.spec.ts` drive and grade a real generated exercise |
| All major and harmonic minor scales hands together at ♩=100+ | **Partial**, beyond M4's content minimum | 12 major keys (L3+L4); harmonic/melodic minor covers 6 of 12 tonics (L5). REQ-5.2's M4 minimum is "through level 3", so this does not block 4.10 |
| Perform ≥3 upper-intermediate pieces to "performance-ready" | Mechanism **met**; outcome **cannot be evaluated** | The previous pass's "partially blocked by Defect 1" caveat is lifted: best assessment result now populates (criterion 11). But it does **not survive a backup/restore** — see Defect 2 |
| Analyze chords/cadences with Roman numerals | **Met** | [e2e] `round6.spec.ts` |

## Diff against the 2026-08-11 run

| Criterion | 2026-08-11 | 2026-08-12 | Why it moved |
|---|---|---|---|
| REQ-3.8.2 practice history (#11) | **Not met** (the sole blocker) | **Met** | Triage T.5 wired `recordSession` in `usePracticeLog.ts`. Independently re-proven here, not taken on trust |
| REQ-3.1.4 session mix (#5) | Met | **Not met** | Roadmap 5.45 added a flat 5-minute warm-up reservation taken off the top of the budget, changing the proportions the previous pass measured as exactly 6/6/12/6 |
| REQ-3.10.4 / REQ-4.3 export (#14) | Met | **Not met** | The export format never carried a repertoire piece's `sessions`/`bestAccuracy`/`level`/`notes`. That was invisible while those fields were always empty; the T.5 fix made them real, and the loss with them |
| REQ-3.8.4 review prompt (#13) | Met, "practically limited" | **Met**, caveat lifted | Same cause as #11 |
| Defect 2 (`repertoire.spec.ts` stale locator) | Open | **Fixed** | Another session corrected it; the spec passes in the full run |
| Defect 3 (`progress-persistence.spec.ts` stale gating) | Open | **Fixed** | Now seeds the playing level and opens "More tools"; passes |
| `npm run knip:prod` | Reported clean | **Red** | See Defect 3 below. The previous "clean" reading is unsafe — the command had been piped to `tail`, masking its exit code |

**On the REQ-3.8.2 re-proof.** The spec that closed the original defect
(`m4-acceptance-repertoire-practice-history.spec.ts`) asserts only that the row *stops saying*
"never practised" — an absence, which a row that vanished entirely would also satisfy, and which
says nothing about whether the displayed figure comes from stored data. This pass replaced that
with a positive proof: the session is read back out of the real IndexedDB record (carrying an
`accuracy`, with `bestAccuracy` derived from it), and then the stored `at` timestamp is rewritten
to five days ago behind the app's back — after a reload the screen prints "5 days since last
practice". A screen re-deriving a plausible number cannot follow that edit. The original spec is
left in place; it is not wrong, only weak.

## Defects

### Defect 1 — REQ-3.1.4: the planned daily session does not hold the stated mix

**Driven proof:** `e2e/m4-acceptance-session-mix.spec.ts` (both tests `test.fail()`-marked so the
suite stays green while the gap is on record). Observed on the running app, at the three presets
the requirement names:

| Budget | State | warm-up/technique (~20%) | sight reading (~20%) | lesson/repertoire (~40%) | theory/ear (~20%) |
|---|---|---|---|---|---|
| 15 min | nothing loaded | 9 min (**60.0%**) | 3 min (20.0%) | **0 min (0.0%)** | 3 min (20.0%) |
| 30 min | nothing loaded | 14 min (**46.7%**) | 8 min (26.7%) | **0 min (0.0%)** | 8 min (26.7%) |
| 60 min | nothing loaded | 24 min (**40.0%**) | 18 min (30.0%) | **0 min (0.0%)** | 18 min (30.0%) |
| 15 min | score loaded | 7 min (**46.7%**) | 2 min (13.3%) | 4 min (**26.7%**) | 2 min (13.3%) |
| 30 min | score loaded | 10 min (**33.3%**) | 5 min (16.7%) | 10 min (33.3%) | 5 min (16.7%) |
| 60 min | score loaded | 16 min (26.7%) | 11 min (18.3%) | 22 min (36.7%) | 11 min (18.3%) |

Note REQ-3.1.4 groups warm-up and technique as one ~20% category, so the table sums them.

Two independent causes:

**(a) The warm-up reservation is flat, not proportional.** `core/curriculum/session.ts:238` takes
`min(WARMUP_MINUTES, totalMinutes)` — 5 minutes — off the top before the 20/20/40/20 split is
applied to the remainder. At 60 minutes that is a rounding-scale distortion; at 15 minutes it is
a third of the whole session, and the stated mix cannot survive it. This is the regression from
roadmap 5.45.

**(b) The lesson/repertoire segment — the largest, ~40% — is empty until a score is loaded.**
`candidates.ts:143`'s `lessonCandidates` returns `[]` unless `scoreStore` holds a loaded score,
and `planSession` then renormalises that 40% onto the other three segments. Today is the app's
**default destination**, so this is what a fresh install actually shows: a 30-minute plan reading
"Lesson / repertoire — 0 min" under a quiet "Load a score to fill the lesson segment." note,
with technique inflated to 9 minutes to absorb it. Confirmed on the visual pass of Today (both
widths, both themes, console clean). The learner is offered a session with no lesson and no
repertoire in it.

Note the pre-existing coverage cannot catch either: `e2e/screens.spec.ts` asserts only that the
per-item minutes **sum** to the chosen budget, which is true of any split whatsoever.

**Proposed roadmap task:**
> `core/curriculum/session`, `app/session`: make the planned session hold REQ-3.1.4's stated mix
> at all three presets. Two fixes: (a) fold warm-up into the technique share rather than
> reserving it flat off the top — the requirement's first category is "warm-up/technique (~20%)",
> one bucket, so a 5-minute warm-up should come out of technique's 20%, not out of the budget;
> (b) give the `lesson` segment a candidate that exists on a cold profile — the learner's
> repertoire library and the curriculum's next lesson are both real sources, and neither requires
> a score to already be open. Failing (b), the renormalisation should be visible to the learner
> rather than silently inflating technique.
> *Proof:* `npx playwright test e2e/m4-acceptance-session-mix.spec.ts` passes with both
> `test.fail()` markers deleted — i.e. every category is within 8 points of its stated share at
> 15, 30 and 60 minutes, cold and warm.

### Defect 2 — REQ-3.10.4/REQ-4.3: a backup does not carry a repertoire piece's history, and restoring one destroys it

**Scope:** `RepertoirePieceLike` (`src/core/progress/export.ts:52`) is a structural minimum
carrying only `id`/`title`/`composer`/`status`/`addedAt`. `toRepertoirePieceLike`
(`src/app/progress/snapshot.ts:102`) therefore drops `level`, `sessions`, `bestAccuracy`, `notes`
and `scoreId` on the way out, and `toRepertoirePiece` (`snapshot.ts:118`) fabricates them back at
defaults on the way in — `level` at the curriculum minimum, `sessions` empty, `bestAccuracy` `0`,
`notes` blank. Because `applyProgressSnapshot` (`snapshot.ts:216`) hydrates the repertoire store
by **replacement**, a restore does not merely fail to carry the history forward: it deletes the
history that was there.

This is not a new code path — it is accurately described in `snapshot.ts`'s own module comment.
What is new is that it now costs the learner something. Until the T.5 fix, `sessions` and
`bestAccuracy` were always empty, so dropping them was lossless in practice. Now they hold the
only record of what the learner has played, and REQ-3.10.4 says **all** progress data is
exportable while REQ-4.3 promises simple backup/restore.

**Driven proof:** `e2e/m4-acceptance-export-repertoire-history.spec.ts` test 2 (`test.fail()`).
Add Greensleeves (level 3), practise it, give it notes, download the real JSON: the exported
entry has no `sessions` key at all. Restore that same file and the row reads "never practised"
again at "Level 1".

**Proposed roadmap task:**
> `core/progress/export`, `app/progress/snapshot`: widen the exported repertoire record to carry
> a piece's own fields (`level`, `sessions`, `bestAccuracy`, `notes`, `scoreId`), so REQ-3.10.4's
> "all progress data" is true of the repertoire and a restore stops destroying practice history
> it had just exported. `RepertoirePieceLike`'s doc comment already anticipates this
> ("widening these two types is a follow-up, not a round-trip break, since every field they
> currently declare is optional except `id`"). Keep `importProgress` tolerant of files written
> before the widening.
> *Proof:* `npx playwright test e2e/m4-acceptance-export-repertoire-history.spec.ts` passes with
> the `test.fail()` deleted — the downloaded file carries the practice history, and a restore
> preserves the level, the notes and the day count.

### Defect 3 — `npm run knip:prod` is red: a module that is implemented, tested, and imported by nothing

**Scope:** `npm run knip:prod` exits **1**:

```
Unused files (1)
src/app/sightreading/noteDisplay.ts
```

`durationLabel` (30 lines, plus a 21-line co-located test that passes) has **zero importers
anywhere in `src/`** — grep finds only its own test. Its module comment states "its remaining
consumer is `@app/rhythm/PatternPreview.tsx`"; that file does not exist in the repo. This is
precisely the failure class this project's standard of proof exists to catch, and it is a hard
failure by this repo's own rules.

`npm run knip:prod:all` additionally reports `midiToFrequency`
(`src/core/audio/pitchDetection.ts:153`) as an unused export — `src/adapters/audio/webaudio.ts:73`
defines and uses its own private copy of the same function, so the core export is dead and the
implementation is duplicated.

Neither module is M4 scope (sight-reading is M3, audio is M2), so neither is counted against the
21 criteria above — but `knip:prod` being red is a repo-level gate failure and is reported here
because this pass is what found it.

**Proposed roadmap task:**
> Make `npm run knip:prod` exit 0. Delete `src/app/sightreading/noteDisplay.ts` and its test —
> its stated consumer `@app/rhythm/PatternPreview.tsx` no longer exists and nothing else imports
> `durationLabel`. Then either drop the unused `midiToFrequency` export from
> `src/core/audio/pitchDetection.ts` or make `src/adapters/audio/webaudio.ts` import it instead
> of keeping a private duplicate.
> *Proof:* `npm run knip:prod` exits 0, captured without piping to `tail`.

### Defect 4 — `npm run verify:full` cannot be green

`npm run verify:full` exits **1** at its `knip` stage, before it ever reaches `test:e2e`:

```
Unused devDependencies (2)   @stryker-mutator/core, @testing-library/dom
Unlisted binaries (8)        vite, tsc, vitest, playwright, eslint, prettier, knip, stryker
```

Confirmed pre-existing and unrelated to this pass: stashing this branch's additions and re-running
`npm run knip` on a clean HEAD reproduces it exactly. `package.json` is outside this task's write
boundary, so it is reported rather than fixed. The practical consequence is that the second half
of `verify:full` never runs, so nobody is getting the e2e stage from that command.

**Proposed roadmap task:**
> Make `npm run verify:full` reach its `test:e2e` stage. Either configure knip's `ignoreBinaries`
> / `ignoreDependencies` for the eight binaries and the two devDependencies that are genuinely
> used (stryker via `npm run mutate`, `@testing-library/dom` transitively), or drop what is truly
> unused. *Proof:* `npm run verify:full` exits 0, captured without a pipe.

## Minor observations (not blocking)

- **Stale doc comments now contradicted by the code.** `core/repertoire/repertoire.ts` still says
  "roadmap 4.5's consumer screen doesn't call this yet" on nearly every export (lines 22–29,
  99–101, 133–135, 149–151, 173–175, 202–204), and `sessionFromEntry`'s comment (lines 54–59)
  still asserts "`usePracticeLog.ts`'s `stop()` does not actually call `recordSession` … today
  (checked: no reference … in that file)" — which the T.5 fix made false. `content/curriculum/
  curriculum.ts:17–22` similarly claims the lesson screen "is not consumed yet". These comments
  are load-bearing in this repo: the 2026-08-11 pass's reachability check was partly guided by
  them.
- **`e2e/onboarding.spec.ts` is flaky under parallel workers.** It failed once in a `--workers=4`
  full run ("Skip leaves levels untouched…", timing out on a post-reload assertion) and then
  passed 2/2 in isolation and in the serial full sweep. Not an app defect on the evidence
  available, but it is a spec that cannot be trusted to gate.
- **Over-exported internals.** `evaluateCriterion` (`core/progress/levels.ts:107`) and `unitById`
  (`core/curriculum/model.ts:254`) have no call sites outside their own modules; both are used
  internally by exported functions that *are* reachable, so neither is dead, only over-exposed.
- The Today screen's mix inputs still display raw decimals (`0.2`) rather than percentages.
  REQ-3.1.4 only requires the shares be adjustable, which they are.

## Tooling results

| Command | Exit | Note |
|---|---|---|
| `npm run verify` | **0** | 182 test files, 3739 tests, all passing |
| `npm run verify:full` | **1** | Fails at `knip`; never reaches `test:e2e` — Defect 4 |
| `npm run knip:prod` | **1** | Defect 3 |
| `npm run knip:prod:all` | **1** | Defect 3 |
| `npx playwright test` (full suite) | **0** | 108 passed against port 5487, including this pass's 5 new tests (3 of them `test.fail()`-marked, which Playwright counts as passing). An earlier `--workers=4` run of the same suite had 1 failure, `e2e/onboarding.spec.ts`, which did not recur here or in 2 isolated re-runs — see Minor observations |
| `scripts/visual-pass.mjs` × 5 destinations | **0** | Today, Repertoire, Progress, Lessons, Technique — both widths, both themes, console clean in all four configurations each |

## New specs added by this pass

- `e2e/m4-acceptance-session-mix.spec.ts` — REQ-3.1.4's proportions at 15/30/60 minutes, cold and
  with a score loaded. Two tests, both `test.fail()`-marked; delete the markers when Defect 1 is
  fixed. This is the first check in the suite that asserts the *mix* rather than the total.
- `e2e/m4-acceptance-export-repertoire-history.spec.ts` — two tests. Test 1 passes and is the
  strengthened REQ-3.8.2 proof described in the Diff (stored-row read-back plus a backdate the
  screen must follow). Test 2 is `test.fail()`-marked and is Defect 2's proof action.

## Summary

21 REQ/roadmap criteria were re-checked against the running app, plus the 5 longitudinal §9
outcomes assessed by mechanism. **19 of 21 pass; 2 do not.** The 2026-08-11 blocker is closed and
independently re-proven under a stricter test. Two criteria that passed then fail now: the daily
session's mix (a genuine regression from merged work, and visible on the app's own default
screen), and the export/restore round trip for repertoire (a latent gap that the fix to the first
blocker converted into real data loss). Separately, `npm run knip:prod` and `npm run verify:full`
are both red on pre-existing, non-M4 causes.

The shape of both new defects is worth naming, because it is the same shape as last time. Neither
is a broken module. `planSession` allocates exactly what it is told to; `snapshot.ts` serialises
exactly the fields its type declares. Both failures live at the seam between two correct pieces,
and in both cases the existing tests assert something adjacent to the requirement — a *total*
rather than a *mix*, a *round trip of the fields that are exported* rather than *all progress
data*. A test that asserts the neighbour of the requirement will pass forever without the
requirement ever holding.

**Roadmap 4.10 is left unticked.** Defects 1 and 2 are the two tasks that would close it;
Defects 3 and 4 are repo-hygiene gates that should not be carried further either.
