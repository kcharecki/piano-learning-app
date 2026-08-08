# Retro log — one entry per session, newest first

Written by the session's RETRO step (`docs/PROCESS.md`). Template:

```
## YYYY-MM-DD — <one-line session summary>
- user-reported defects since last session: <n, listed briefly>
- slices proven / started: <a>/<b>
- gate catches before commit: <n, what>
- docs budget (ROADMAP+CLAUDE+PROCESS lines): <n>
- cost note: <where the session's cost went, one line>
- hypothesis: <weakest part of the process right now>
- change: <the experiment + review-by date | "none because …">
- experiment verdicts due: <keep / extend / revert for any past review-by dates>
```

---

## 2026-08-08 (seventh session) — generated-score titles, Technique's on-screen fallback, two merges

- user-reported defects since last session: 0
- slices proven / started: 4/4 — 5.13 (generated exercises get a real score title instead of
  "Untitled Score") and 5.5a (Technique gets the on-screen-keyboard/qwerty fallback Practice
  already has, reusing `createPlayableInput` and `PracticeKeyboard` rather than duplicating
  either), plus two worktree branches integrated (5.16 activity-kind display names, 5.6
  input-capability banner).
- gate catches before commit:
  1. `scripts/worktree-isolation.test.mjs`'s eslint sub-test timed out at 5s under load (7 active
     worktrees at once) — confirmed a false red by rerunning it alone (1.3s); not a real defect,
     not touched.
  2. The 5.6 merge conflicted on ROADMAP.md (adjacent 5.5a/5.6 lines, both sessions editing the
     same stretch) — line-local, resolved by keeping both entries.
  3. The real catch: `node scripts/worktrees.mjs status` showed `task/5.5a` actively claimed by a
     *different* worktree session AFTER this session had already claimed and shipped 5.5a on
     master via a `refs/claims/5.5a` main-checkout claim. Two sessions independently implemented
     the same roadmap task in parallel — neither claim kind checks the other. Not caught by any
     test; caught by reading `status` output closely, same class of gap the sixth session's retro
     flagged for STALE detection.
- docs budget (ROADMAP+CLAUDE+PROCESS lines): 765 + 101 + 130 = **996**
- cost note: two Explore-agent dispatches (one research-only for 5.5a's wiring, kept off the main
  thread's context) plus direct implementation; the interactive Browser pane wouldn't composite
  again (same class the fifth session hit), so both slices' visual proof went straight to
  `scripts/visual-pass.mjs` + driven tests per the standing rule — no time lost troubleshooting it.
- hypothesis: **the two claim kinds (`refs/claims/<id>` and `task/<id>` branches) are visible to
  each other in `status` output but nothing stops a session from claiming an id the other kind
  already holds** — a worktree session claims by raw `git branch -m`, which this script cannot
  intercept, so at least the main-checkout half is enforceable in code.
- change: `worktrees.mjs claim <id>` now refuses when a `task/<id>` branch already exists (was
  previously only atomic against other main-checkout claims). Smoke-tested: claiming an id with an
  existing worktree branch is refused, a fresh id still succeeds. Does not close the reverse
  direction (a worktree session's `git branch -m` cannot consult `refs/claims/*` without wrapping
  that command too — left as a documented residual risk, not silently declared fixed). **Review-by
  2026-08-15 (or 2 sessions):** keep if no further same-id collision occurs; if one recurs on the
  worktree-claims-a-main-checkout-id direction, that direction needs the same treatment (likely a
  wrapper script worktree sessions call instead of raw `git branch -m`).
- experiment verdicts due: none this session (nearest review-by, 2026-08-15, is this session's own
  new experiment; 2026-08-22 and 2026-08-29 are both still open).

## 2026-08-08 (sixth session) — integrated four worktree branches, shipped 5.2

- user-reported defects since last session: 0
- slices proven / started: 5/5 — four worktree branches merged serially (5.1 graded-score bundle,
  5.11 sight-reading ladder rebuild, 5.9a demo-mismatch fixes, 5.9b Open-demonstration navigation),
  each verified green before the next merge; plus one new slice, 5.2 (Open in Practice).
- gate catches before commit:
  1. The 5.9a/5.9b merge conflicted on ROADMAP.md only (both worktrees ticked adjacent lines);
     resolving it left a duplicate stray `[ ] 5.9b` block in the file that a plain merge-conflict
     resolve would have shipped — caught while compressing the file for the docs budget, not by
     any test.
  2. `npm run verify:full`'s `knip` step is red (T.4, logged, not fixed this session — see below).
  3. Merging the four branches pushed ROADMAP.md to 809/816 lines against the 800 budget —
     `docs:budget` caught it immediately, compressed the done entries' proof prose to one-liners.
- docs budget (ROADMAP+CLAUDE+PROCESS lines): 754 + 101 + 130 = **985**
- cost note: integration (4 merges + `npm run verify` each + a ROADMAP compression pass) was the
  bulk of the session; the one new slice (5.2) was delegated to a single Sonnet builder for the
  hook/component/tests, with the shared file (`Shell.tsx`) wired by the main thread per the
  delegation rule — no full fan-out workflow needed for a wiring-shaped task.
- hypothesis: the integrator's own step (0) says "clear STALE claims" but gives no signal for
  *when* a claim is stale vs. still-active-and-slow — this session found 5.4's worktree claimed
  with 0 commits ahead (already merged in a prior session) only by reading `worktrees.mjs status`
  closely, not because anything flagged it.
- change: none — logged the knip regression (T.4) as a proper Triage item with a proof action
  rather than fixing it inline (it is unrelated to this session's slices and touching knip config
  deserves its own verified slice, not a rider on this commit). Extended `scripts/visual-pass.mjs`
  with `--click <label>` instead, so a post-interaction visual state doesn't need a hand-rolled
  driver — the tool paying rent as designed. **No process-file change this session** — the loop
  (integrate → triage → slice → gate → retro) held up under a 5-branch session without needing a
  new rule; the docs-budget and visual-pass tooling from prior retros are what caught things.
- experiment verdicts due: none this session (2026-08-22 review-by is still open).

## 2026-08-08 (fifth session) — merged 5.4, shipped 5.5, and the Browser pane's compositing gap

- user-reported defects since last session: 0.
- slices proven / started: integrated task/5.4 (parallel worktree, playable practice screen)
  + shipped 5.5 (computer-keyboard note input) = 2 / 2.
- gate catches before commit: 2.
  1. My own first cut of 5.5 anchored the QWERTY mapping at middle C. A test asserting the
     bundled sample's ACTUAL first-beat chord (48/52/55/60) — not just "some note presses" —
     found only 1 of 4 notes reachable, since the mapping only climbs from its base. Anchored
     at the range's own low instead; all four now reachable. Caught before commit, not after.
  2. The 5.5 proof named Technique among the note-answered screens; it has no `OnScreenKeyboard`
     at all to hang a computer-keyboard mapping on. Filed as 5.5a rather than silently narrowing
     the task's own scope to fit what existed.
- docs budget (ROADMAP+CLAUDE+PROCESS): 954 (798 + 42 + 114, approx — CLAUDE.md/PROCESS.md
  unchanged this session besides this entry's own PROCESS.md edit below).
- cost note: the ROADMAP.md merge conflict (task/5.4 vs. three master commits since) cost real
  time — both sides had rewritten large stretches, and the honest fix was re-applying task/5.4's
  specific tick onto master's version rather than trying to reconcile the diff mechanically.
  Bigger cost: ~20 minutes spent manually driving the MCP Browser pane (clicking refs, reading
  the DOM) after it silently stopped compositing (`document.hidden === true`, `screenshot`
  timing out) — before remembering `scripts/visual-pass.mjs` already exists and does exactly
  this with a real (non-pane) Playwright browser. It found nothing the pane couldn't have.
- hypothesis: **the experience gate names `scripts/visual-pass.mjs` for the visual pass, but
  nothing steers a session to it FIRST when the interactive Browser pane is the thing that's
  broken** — I defaulted to the interactive tool because it is the first one listed in this
  session's tool surface, not because it was the right one once it stopped compositing.
- change: added a line to the experience gate (below) naming `visual-pass.mjs` + a driven
  Playwright e2e spec as the fallback the moment the interactive pane fails to screenshot or
  `document.hidden` is true, instead of troubleshooting the pane itself. **Review-by
  2026-08-22 (or 3 sessions):** keep if a future session hits the same pane failure and the
  line saves it the detour; revert if the pane just works next time and this reads as dead prose.
- experiment verdicts due: "Find the class before fixing the instance" (review-by 2026-08-29)
  not yet due, but this session is a second confirming data point (5.5's middle-C anchor bug,
  found by testing the class of "which notes are reachable", not the instance of "does A press
  something"). `scripts/visual-pass.mjs` (review-by 2026-08-22) not yet due.

## 2026-08-08 (fourth session) — Triage cleared; the reported defect was never the whole defect

- user-reported defects since last session: 0. One mid-session question (was I aware of the
  parallel worktree session, and was the work distinct) — answered, no change needed.
- slices proven / started: 3 / 3. T.3 (worktree lint isolation), T.2 (audio drift spec),
  5.8+5.9 (lesson demos in the key the lesson teaches).
- gate catches before commit: 6, and this is the story of the session.
  1. `npm run verify` itself found T.3: `eslint .` in the main checkout was linting the OTHER
     session's worktree and failing on their in-flight `musicxml.ts`. Master's verify was red
     because of code master does not own, and the main checkout is the only one allowed to merge.
  2. The full e2e suite killed my first T.2 design. An 8 ms/min bound on the adapter's anchor
     error passed alone (1.52) and failed under contention (-218) because the audio device had
     gone away. Redesigned to a tracking ratio.
  3. `no-restricted-syntax` killed my second T.2 design — a conditional `test.skip`. The rule
     ("a skipped e2e reads as green forever") was right: a CI box with no audio device would
     skip permanently. This is the automation-beats-prose principle paying rent on ME.
  4. The 5.9 audit found 11 mismatches where the roadmap reported 2.
  5. The visual pass found the nav's twelve destinations and both Lessons lists rendering with
     raw disc bullets. Fixed before the tick.
  6. Driving 5.8 in a browser found that "Open demonstration" does not navigate — the one
     control promising to show you the music appears to do nothing. Filed as 5.9b.
- docs budget (ROADMAP+CLAUDE+PROCESS): 1014 (798 + 101 + 115).
- cost note: the biggest line was the audio drift spec — ~46 s per run, run 8 times across two
  design iterations and two mutation checks. Second was the roadmap budget: adding 5.9a/5.9b
  needed six completed entries compressed first. Two Sonnet builders (technique key signature,
  demo scores) were cheap and both came back clean.

- hypothesis: **a roadmap task's stated scope is a hypothesis, not a specification, and the
  process has no step that tests it.** Three times today the reported defect was a symptom:
  T.2 "the spec fails" was really "the spec cannot fail for the reason it exists"; 5.8 "two
  lessons point at the wrong demo" was really 11 mismatches over a root cause where EVERY
  technique-library score engraved in C major regardless of tonic; T.3 was not on the roadmap
  at all. Fixing what the task literally said would, in all three cases, have shipped something
  that passed its own proof and left the class of bug in place — which is the exact failure
  mode this whole process was created to stop, one level up from "green tests, dead feature".

- change: added "Find the class before fixing the instance" to `docs/PROCESS.md` "Building a
  slice" — before fixing a reported defect, bound-effort search for every instance, state the
  count in the commit body, and if it is >1 the assertion must cover the class rather than the
  instances. **Review-by 2026-08-29 (or 4 sessions):** keep if it keeps finding counts >1;
  revert if the searches keep returning exactly what the task said, since then it is pure cost.
  Metric to watch: reported instances vs found instances, per triage/defect slice.

- experiment verdicts due: none. `scripts/visual-pass.mjs` (review-by 2026-08-22) is not due
  yet but is tracking to KEEP — used it once here with no bespoke driver, and it produced gate
  catch #5. Its `--url` flag earned itself immediately: port 5173 was held by the other session.

- note for the next session: Triage is EMPTY. Highest-impact unstarted work is Phase 5's
  "playable content" group — but be aware 5.1 needs 20 public-domain MusicXML files sourced
  from outside the repo (IMSLP/MuseScore), which is a fetch-and-licence-check job, not a coding
  one; consider asking the user rather than assuming. 5.9a (7 audited demo mismatches, table in
  the task) is fully actionable with no external dependency, and `l3-two-octave-scales-hands-
  together` is the cheapest of them since `scale-c-major-2oct-hands-together` already exists.
  `task/5.4` was 2 commits ahead and clean at session end but still held an ACTIVE claim, so it
  was correctly not merged here — integrate it first next session.

## 2026-08-08 (third session) — Parallel sessions via worktrees

- user-reported defects since last session: 0. User asked for a capability: several sessions
  in parallel, with `/next` aware of what other sessions claimed, plus merge discipline.
- slices proven / started: 1 / 1 (process tooling, not app code).
- gate catches before commit: n/a (no UI change). Tooling itself was proven, not asserted:
  `worktrees.mjs status` driven through all three claim states (active/clean, AWAITING
  MERGE, freed); smoke e2e 9/9 green on `E2E_PORT=5544` while another live session held 5173.
- cost note: web research (official worktrees doc + community practice) + design + tooling.
  A real port collision existed before this: playwright's `reuseExistingServer` on hardcoded
  5173 would have tested against whichever session's server answered first.
- what shipped: claim registry = `task/<id>` branch names (shared .git makes it visible to
  every session, nothing to go stale); `scripts/worktrees.mjs status` with per-branch
  deterministic ports; `E2E_PORT` in playwright config (+`--strictPort`);
  `worktree.baseRef: "head"` (master here is usually ahead of origin);
  `docs/WORKTREES.md` contract (worktrees build, ONLY main checkout merges — Claude Code's
  own isolation enforces the boundary); location-aware `/next`; spine rule (at most one
  active claim touches Shell/routes/state/design-system/package.json).
  Found free: worktrees under the repo root resolve the main checkout's node_modules via
  Node's ancestor walk — no npm ci per worktree.
- hypothesis: the untested half is the INTEGRATE step under real conflicts; rules make
  conflicts unlikely but the first real parallel round will tell.
- change: this whole entry is the change (docs/PROCESS.md "Parallel sessions" section +
  WORKTREES.md + tooling). **Review-by: after the first round with 2+ real parallel
  sessions** — keep if merges stay boring; tighten the spine rule if not.
- experiment verdicts due: none yet (visual-pass and redesign review ~2026-08-22).

## 2026-08-08 (second session) — Triage cleared; the gate caught a dead feature on its first run

- user-reported defects since last session: 0 new. The standing one (T.1, `verify` exit 1) is fixed.
- slices proven / started: 4 / 4 — T.1 (verify green), 3.14, 3.18a, 3.23 (+3.19b ticked on
  existing evidence). All four boxes T.1 was blocking passed the gate.
- gate catches before commit: **7**, none of which a test would have found.
  1. **3.18a was completely inert.** `buildMeasureLabels`, `ScoreViewer`'s `measureLabels` prop
     and the engraver's `setMeasureLabels` all shipped tested last session, and *no caller ever
     passed the prop*. Driving the Practice screen returned an empty label list. This is the
     defect class the gate was written for, caught on its first real session.
  2–5. 3.14's engraving had a playback cursor on a score nothing plays, a `♩=120` on a scale, a
     title duplicating the heading beside it, and a synthetic `8/4` meter in 360px of empty paper.
  6. Every retention stat printed its label twice ("Cards 0 CARDS") on two screens.
  7. `.keyboard-diagram { width: 100% }` at ≤1024px drew the 5-key dictation pad against ~700px
     of empty frame.
  Also found, recorded, not silently fixed: 3.14a (per-note spelling — F# major's E# engraves as
  F♮) and T.2 (`audio-clock-drift` e2e red on a clean tree, ~5994 ms/min vs a 150 budget).
- docs budget (ROADMAP+CLAUDE+PROCESS lines): 773 + 92 + 100 = **965**
- cost note: the visual pass dominated. The Browser pane could not composite frames, so every
  screenshot went through a hand-written Playwright script — six of them written and deleted
  across four slices, each re-deriving the same drawer-opening, theme-setting, error-collecting
  boilerplate. The slices themselves were small and serial; no subagent was warranted and none
  was used.
- hypothesis: the experience gate is the right gate and is working, but it had **no tooling**.
  A gate that must be re-implemented from scratch every session is a gate that will get skipped
  on a session that feels rushed — and skipping it is exactly how 3.18a shipped dead.
- change: added `scripts/visual-pass.mjs` — one command per destination, both widths, both
  themes, exits 1 on any console error, with `--level`/`--select` for state-gated screens.
  `docs/PROCESS.md` step 3 now names it and forbids hand-rolled drivers. **Review-by 2026-08-22
  (or 4 sessions):** keep if the next sessions' visual passes run through it; revert if it turns
  out screens need so much bespoke setup that the flags grow faster than the value.
- experiment verdicts due: none — the 2026-08-08 redesign experiments are reviewed ~2026-08-22.
- note for the next session: T.2 is the triage item, then Phase 5's "playable content" group
  (5.1/5.2), the highest-impact unstarted work.

## 2026-08-08 — Process redesign (baseline entry)

User verdict on the old round protocol, verbatim intent: too many bugs reaching them; long,
costly sessions with mediocre output despite workflows; UI "looks bad, feels bad"; `/next`
doing the bare minimum to advance a box. Root causes found in evidence:

1. Proof was test-and-fixture-shaped. The roadmap archive records 12+ "tests green, feature
   inert in the browser" defects; milestone audits returned NOT MET verdicts on ticked boxes.
2. "First unchecked box, top to bottom" buried the highest-impact work: the 2026-08-06 UX
   review scored the product 4.5/10 and its fixes (Phase 5) sat below Phase 3/4 minutiae.
3. No design step and no visual gate existed anywhere in the process.
4. Cost silting: ROADMAP.md had grown to 1685 lines (~54k tokens) of proof prose, re-read
   every session; 6-module workflow rounds were the default shape regardless of need.
5. The meta pass was capped at 5 minutes and enforcement-only, so process *assumptions* were
   never revisited.

Changes landed this session (review-by 5 sessions from now, ~2026-08-22):
- `docs/PROCESS.md` created — model-owned, self-modifying process: triage by learner impact,
  vertical slices, experience gate (browser proof on real content + visual pass + console +
  states + perf), mandatory retro with metrics.
- `docs/DESIGN.md` created — composition rules + visual pass checklist over the existing
  design-system tokens.
- `ROADMAP.md` slimmed: done-task prose archived to `docs/roadmap-archive-2026-08-08.md`;
  ordering rule replaced with triage + impact; Triage section added (T.1: WIP 3.14 tree red —
  9 unhandled OSMD errors under `npm run verify`).
- `CLAUDE.md` slimmed to invariants + pointer to PROCESS.md; `/next` rewritten to run the
  session loop; SessionStart hook message updated.
- `scripts/check-docs-budget.mjs` added to `verify` — hard line budgets so the docs cannot
  silt up silently again.

Baseline metrics:
- user-reported defects at redesign time: 4 themes (bugs leaking, cost, UI quality, shallow /next)
- product score: 4.5/10 overall (2026-08-06 review), 17 aspects, worst: playable content 2/10,
  first-run 2/10, rhythm drill 2/10, practice usability 3/10, IA 3/10, input access 3/10
- verify at session start: exit 1 (9 unhandled OSMD errors, WIP 3.14)
- next re-review of the 17 aspects due: within ~5 sessions
