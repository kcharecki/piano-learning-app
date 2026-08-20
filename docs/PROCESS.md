# PROCESS.md — how this project is developed

Owner: the orchestrating model. **This file is meant to be changed.** Improving it is a
required part of every session (see "Improve the process"). `CLAUDE.md` holds the invariants
that move only with user consent (core purity, testing rules, git hygiene); this file holds
the way of working, and the model has standing authority to rewrite any assumption in it —
round shape, ordering, gates, delegation policy — provided the change is logged in
`docs/retro-log.md` with its reason and a review-by date.

Created 2026-08-08, replacing the "Proceed with next steps" round protocol, after the user's
verdict on that process: too many bugs reaching them, long costly sessions, mediocre output,
a UI that "looks bad, feels bad", and a `/next` that did the bare minimum to tick a box.

## What we optimize for (in order)

1. **The learner's experience** — correct, clear, good-looking, fast, *in the running app*.
2. **User trust** — never tick something a user could disprove in five minutes of use.
3. **Session cost** — fewest tokens and wall-clock to a *proven* improvement.

Explicitly not optimized: roadmap boxes per session, test counts, prose volume, agent counts.
Three proven slices beat six half-proven ones every time.

## Two loops

`/next` runs the session loop below: recover, triage `ROADMAP.md`, ship 3–4 slices, retro.
`/improve-app` (`docs/commands/improve-app.md`) runs a different loop for a different question —
it discovers gaps nobody has written down, ships **one**, and reviews it with an adversarial
panel. Everything in this file that is a standard rather than a step — the experience gate, the
delegation policy, the retro — applies to both. The loop below is `/next`'s alone.

## The session loop (`/next` runs this)

0. **RECOVER** — `git status`. Dirty → `npm run verify`; green → slice-commit leftovers;
   red → fixing it is triage item #1. Never start new work on a dirty tree.
1. **TRIAGE** — pick work in `ROADMAP.md`'s stated order: the Triage section (user-reported
   bugs, red states, disproven claims) first, then highest learner impact. The old
   "first unchecked box" rule is dead. State what you picked and why in one sentence.
2. **SLICES** — up to 3–4 vertical slices per session. One slice = one user-visible
   improvement, end to end, passing the experience gate below. Commit each as it lands.
3. **RETRO** — mandatory before ending: append an entry to `docs/retro-log.md` (template
   there), and make at most one process change — an edit to this file, or better, a
   script/hook/lint — or state explicitly why no change this session.

## The experience gate (Definition of Done, every slice)

Green tests alone have shipped inert features here repeatedly — the roadmap archive records
over a dozen "tests green, feature dead in the browser" defects. The browser drive is the gate.

1. `npm run verify` green (`verify:full` at least once per session).
2. **Driven proof on real content** — the task's proof action performed in the running app
   against a real piece or full drill flow, never only a six-bar fixture. Evidence captured:
   screenshot, console, or a driven e2e asserting behaviour (not presence).
3. **Visual pass** — `node scripts/visual-pass.mjs <destination>` (with `--level track=n` /
   `--select sel=label` when the screen needs a state first) shoots every changed screen at
   1280px and 1024px, dark and light, and exits 1 on any console error. Judge the four
   screenshots against `docs/DESIGN.md`'s checklist as a picky user. Findings fixed *before*
   the tick, not filed for later. Do not hand-roll a driver script; extend that one.
   **If the interactive Browser pane won't composite** (`screenshot` times out, or
   `document.hidden` reads true) — go straight to `visual-pass.mjs` for the screenshots and a
   driven Playwright e2e spec for the interaction proof, rather than troubleshooting the pane.
   It is a real Playwright browser and does not share the pane's compositing dependency.
4. **Console clean** during the proof drive — no errors, no React warnings.
5. **States handled** — empty, loading, error, and no-MIDI each handled or explicitly N/A.
6. **No perf regression** — `e2e/perf-large-score.spec.ts` budgets still green when the slice
   touches score rendering, playback, or anything on those paths.

## Building a slice

- **Find the class before fixing the instance.** A roadmap task's stated scope is a
  hypothesis, not a specification — it records what someone noticed, which is rarely all of
  what is wrong. Before fixing a reported defect, spend bounded effort finding every instance
  of it, and state the count in the commit body ("2 reported, 11 found" or "1 reported, 1
  found" — both are results). If the count is greater than one, the assertion must cover the
  class, not the instances you happened to fix. *Evidence (2026-08-08, fourth session): 5.8
  reported two lessons demonstrating the wrong key; the audit found 11 mismatches over a root
  cause where every technique-library score engraved in C major regardless of tonic. T.2
  reported a failing spec; the real defect was that the spec could not fail for the reason it
  existed. Fixing either as written would have passed its own proof and left the class alive.*
  **Review-by 2026-08-29 (or 4 sessions).**
- **Design before code** for any UI change: three sentences in the slice plan — what the
  screen shows, what is primary, what is behind disclosure. Adding a control to an
  already-dense screen obliges the slice to say what it demotes or hides
  (`docs/DESIGN.md`, "Screen rules").
- **Delegate** module-sized implementation to Sonnet builders with the pasted brief
  (`docs/efficiency-guide.md` Appendix A) — never "read CLAUDE.md and…". Opus adversarially
  reviews correctness-critical code (theory, timing, matching); that is where it has
  repeatedly earned its cost.
- **Fan-out is earned, not default.** The 6-module pipelined workflow round exists for
  genuinely independent core modules. Most remaining work is wiring, UX and content — serial
  in nature, browser-verified — and gets a single builder or is done directly. Do not build
  orchestration machinery a slice does not need.
- **Main thread**: orchestration, contracts, integration glue, judgement, evidence. Not bulk
  implementation.
- Leave-it-better still applies each session: delete dead code (`npm run knip:prod:all`),
  prune docs that stopped being true, and say what was deleted in the commit body
  ("deleted nothing" is a valid, stated outcome). Prune tests only on evidence (a named
  superset test or a surviving Stryker mutant) — a wrongly deleted test fails invisibly.

## Parallel sessions (worktrees)

Several sessions can run at once — one per git worktree, full contract in `docs/WORKTREES.md`.
The rules that matter: every session claims before working — a worktree session by renaming
its branch to `task/<id>`, a main-checkout session via `worktrees.mjs claim <id>`, and the
main checkout itself is single-occupancy (`claim main-checkout` first; refused → move into a
worktree). Check `node scripts/worktrees.mjs status` before picking work; claims are atomic,
so a lost race just means "pick the next task". A worktree session works only its claimed
task, skips Triage (integrator-owned), and never touches master, PROCESS.md, retro-log, or
other tasks' ROADMAP lines; only the integrator merges — serially, verifying after each
branch; every worktree uses its own port; at most one active claim may touch the app spine
(Shell, routes, `app/state`, design-system, package.json). Claims are released at session end.

## Improve the process (the self-improvement loop)

The retro is not a diary; it is the mechanism this process uses to fix itself. Each session:

1. **Evidence** — what did the user report broken since last session? Where did this
   session's cost go? What did the experience gate catch, and what got past it?
2. **Hypothesis** — one sentence naming the currently weakest part of the process.
3. **Change** — one concrete experiment: edit this file, or add/adjust a hook, script or
   lint (automation beats prose — a rule that can be violated silently will be). Give it a
   review-by date. "No change because …" is allowed but must be argued from the evidence.
4. **Log** — the entry in `docs/retro-log.md`, with the metrics:
   - user-reported defects since last session (target: trending to 0)
   - slices proven / slices started
   - experience-gate findings caught before commit (the gate paying rent)
   - docs budget: `ROADMAP.md` + `CLAUDE.md` + `PROCESS.md` line total
     (enforced by `scripts/check-docs-budget.mjs` in `verify`)

Experiments with passed review-by dates get a verdict at the next retro: keep (fold in as
standing text), extend (say why), or revert (say what the evidence showed).

## Periodic product re-review

Every ~5 sessions, or when a Phase-5 group completes: re-run the 17-aspect UX/pedagogy review
(method in `docs/ux-pedagogy-review-2026-08-06.md` — drive every destination as a learner,
verify pedagogy against the cited syllabi) and record the new scores in the retro log. The
score trend is the product-quality metric. M5 exits at ≥9 on every aspect. Baseline
2026-08-06: **4.5/10 overall**.
