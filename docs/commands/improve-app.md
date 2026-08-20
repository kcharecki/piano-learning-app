# /improve-app — find what the app is missing, build it, polish it until it is great

`/next` executes a backlog somebody already wrote. **This command writes the backlog itself**,
from evidence, and holds the result to a bar above "done".

**Read now:** this file, then `docs/improve/method.md` — classes, axes, ranking, severity,
tokens, personas, the blind register. That is the whole up-front load. **Read when you reach
it:** `ROADMAP.md` at §2 and not before, `docs/DESIGN.md` at §3, `docs/efficiency-guide.md`
Appendix A at §4, `docs/panel/*` at §5, `docs/PROCESS.md` at §7, `docs/retro-log.md` at §8.
Front-loading the rest is how a run spends its budget reading. `docs/PROCESS.md` applies in full
and is not restated here — its experience gate is the **floor**, not the target.

**Main checkout only.** This command writes `ROADMAP.md`'s Triage section and
`docs/retro-log.md`, which `docs/WORKTREES.md` forbids to worktree sessions. `/next`'s step 0
routes a refused claim into a worktree; **this command stops and reports instead.**

**Great means**, for a run: the slice names one metric in the learner's persisted history,
instrumented with its pre-ship baseline recorded (`0 events, newly instrumented` is valid); the
refutation condition was run and did **not** refute the claim; and at M and above the Teacher
endorses it against a cited syllabus. The metric's verdict is due at the **next** run — no run
can observe its own effect on a human's playing.

## The loop

Every step names the gate that enforces it. Where a gate exists, prose is not the rule — the
script is, and it refuses to advance. Call `improve-run.mjs mark <section>` on entering each
section; that is what the budget stops read.

### 0. START

**Bootstrap check first** — the next command is one of the things it checks for. If any of
`scripts/{improve-run,orphan-signals,check-improve-log}.mjs`, `docs/improve-log.md` or
`docs/panel/` is missing, **building the absent ones (only those) is slice 1 and the run stops
there**: green committed slice, `rewind` if `start` already ran, §8 logs the bootstrap only.

```bash
node scripts/worktrees.mjs claim main-checkout      # refused → stop and report
node scripts/improve-run.mjs start                  # → run id, persona, instrument, prev source
```

`start` refuses a dirty tree, a worktree, and a previous run with no metric verdict. It stamps
the start commit and a 240-minute budget (every percentage below is of that), creates
`runs/<id>/`, and advances the persona rotation once — the rotation **alternates piano and
drums**, and the persona's instrument **binds this run's pick** (method doc, rule 3), so neither
instrument can be starved by a run of interesting gaps in the other.

**`runs/<id>/` is git-ignored scratch; `runs/ledger.ndjson` is committed.** Without the ignore,
run 1 leaves untracked files and run 2's `start` refuses the tree as dirty.

### 1. DISCOVER — five sources. **Do not open `ROADMAP.md` yet.** Cap: 25% of budget

The roadmap records what somebody already noticed. This step finds what nobody has.

| | Source | How |
|---|---|---|
| **1a** | **Ask the learner** | This app has one user and they are in this chat. Post the four questions from the method doc as one block, keep working, paste the reply **verbatim** into `runs/<id>/interview.md`. Never simulate an answer that did not arrive; `no answer this run` is the only substitute. |
| **1b** | **Mine their history** | Export the stores from the running app. Report the three metrics unmoved in 30 days, the most-abandoned item (started, not returned to in 14 days) with its last error, and the top error class of ≤7 buckets. Each is admissible with no drive failure attached. An empty profile is a finding — say so, never invent history. |
| **1c** | **Drive as the learner** | One drive, every tier, on a seeded profile, interactively via the on-screen keyboard / QWERTY note input (`e2e/qwerty-note-input.spec.ts`). `e2e/fake-midi.ts` installs only through `page.addInitScript` before `page.goto` — spec-driven proof, not a live drive. Take the wrong turns a beginner takes. Classify every failure. **Write it to `runs/<id>/drive.md`** — screens entered, inputs played, what the app said back, every failure — that file is `{{DRIVE_LOG_PATH}}` and two panel seats read it. |
| **1d** | **Syllabus first** | Fix the learner's grade in one cited syllabus. Write the 10–15 skills it requires **before opening the app**, then mark each taught+graded / taught-not-graded / absent. Every *absent* is a VOID needing no drive. **The only source that finds what no drive hits.** |
| **1e** | **Orphan signals** | `node scripts/orphan-signals.mjs` — captured, persisted or decoded, and read by no grader or screen. Paste it verbatim. The script owns the ages (+1 per run, capped +3, added to the raw sum). **This is where new capability comes from**; it needs no drive failure attached. Confirm LOW-confidence rows by hand before ledgering them. |

### 2. LEDGER, PICK, CLAIM

Score every gap on the four axes in the method doc, **rank on the raw sum (0–12) plus any 1e
age bonus, and never divide by cost** — dividing by cost is arithmetically guaranteed to buy
the cheapest gap, which is how an ambitious-sounding process ships ten consecutive small
repairs. Cost sets the tier and nothing else.

```bash
node scripts/improve-run.mjs pick --source <1a-1e> --instrument <piano|drums> \
  --sum <n> --cost <S|M|L> --leader-gap <n> --harm <0|1> \
  --thread <slug|none> [--payoff <id> --prereqs <n>] --metric <field> --baseline <v>
```

`--instrument` must match this run's persona or `pick` refuses — without that gate the
alternation is decorative, because 1b and 1e are repo-wide and the top row is usually piano.
`pick` derives the tier and enforces, in order: **harm gate**, **prerequisites win**,
**continue-then-rotate**. Rules in the method doc; the script refuses the call that breaks them,
so the table cannot disagree with what gets built.

| Tier | Set by | Panel | Adds |
|---|---|---|---|
| **Floor** | cost S | Skeptic + Regression hunter, 1 re-panel | — |
| **M** | cost M, or crosses a `src/` top-level boundary (core↔adapters↔app↔content), or crosses piano↔drums | + Teacher, 2 re-panels | three-design divergence |
| **L** | cost L, HARMFUL, or VOID | + Rival, 3 re-panels | second and third drive (here, not §1), held-out goal |

**Budget stops**, enforced by `mark`: no `slice` by 40% → drop to Floor and drop every
tier-added obligation not yet started; none by 60% → ABORT.

*Now* cross-check `ROADMAP.md` — already a task → take its id; contradicts one → resolve it
there. Then claim: `node scripts/worktrees.mjs claim <id>` — the bare roadmap id, or
`improve-<slug>` if it has none. **Not** `task/<id>`: the script adds that prefix itself, and
passing it defeats the collision guard that stops two sessions claiming the same work.

### 3. DESIGN, then commit the claim before the code

M and L: three materially different designs, the axis they trade on, two killed in writing.
Floor: one design and the named alternative it beat. L runs its extra drives here. Then:

> After this ships, a learner who **\<state\>** will be able to **\<do what\>**, and we will
> know because **\<observable in the running app\>**.

State the **refutation condition** with it — the observation that would prove it false; the
Skeptic runs it at §5. Name the §1b metric and record its pre-ship baseline. "A test passes" is
not an observable, nor is "a hint appears" — `check-improve-log.mjs` rejects both.

Write `e2e/improve-<id>.spec.ts` asserting the observable, run it **RED**, commit it alone:

```bash
node scripts/improve-run.mjs spec --id <id> --red-exit <code>
```

It refuses a spec commit that touches anything else, and refuses a spec that was never red.
Three sentences of screen design per `docs/PROCESS.md`, and what the screen demotes.

### 4. BUILD

Vertical slice; module work to Sonnet builders with the pasted brief (`docs/efficiency-guide.md`
Appendix A); main thread owns integration and `verify`. **Exactly one gap, taken all the way, in
exactly one implementation commit** — `improve-run.mjs slice --sha <sha>` takes one sha and
refuses a second, so a slice that wants five commits wants two gaps. A second build attempt with
no green committed slice → ABORT.

### 5. PANEL — parallel, prompts rendered from `docs/panel/`, never rewritten

Verbatim output to `runs/<id>/panel-rN-<role>.md`; the orchestrator may append a named
refutation under a reviewer's text but may not edit a severity.
`improve-run.mjs panel --round n --role r --prompt-sha <sha> --file <path>` records the prompt
hash and refuses a round 2 whose prompt differs from round 1.

| Seat | From | Model | Duty |
|---|---|---|---|
| **Skeptic** | Floor | Opus, high | **Sabotages the §3 refutation condition first** — a condition that still passes against broken code is void and gets replaced. Then runs it. ≥5 attempted refutations, ≥2 against the running app. |
| **Regression hunter** | Floor | Sonnet | What broke that no test covers? Drives the neighbouring screens and forces each state by a named mechanism. |
| **Teacher** | M | Opus | One seat **per instrument the slice touches** — a slice touching both gets two, never one reviewer wearing both hats. Would a teacher endorse this? Cite the syllabus. |
| **Rival** | L | Opus, high | A concrete superior alternative from shipping products, **or** an evidenced "nothing found", every negative carrying a fetched URL. A bare "nothing found" is invalid. |

Every template ends with the tokens it requires; values come from the method doc's token table.
**A token you cannot fill is a stop, not a blank** — a seat handed an empty `{{STATE_RECIPES}}`
reports the states as checked without ever forcing one.

### 6. POLISH

Fix every BLOCKER and every MAJOR (method doc defines all three words), re-panel with
byte-identical prompts, up to the tier's cap. Cosmetic findings fixed too unless the log says why
not. **Clean = a round with zero BLOCKER and zero MAJOR.** Silence does not pass round 2+: a
re-panel re-runs earlier repros, attacks the fix diff rather than the original slice, and is void
if it makes no attempt an earlier round did not.

At the cap it is **not** a pass: each unresolved MAJOR becomes a `T.<n>` in `ROADMAP.md`'s
Triage, the roadmap box stays `[~]` naming those ids, outcome logged `shipped-not-clean`.

**An unfixed BLOCKER cannot ship** — not as `shipped-not-clean`, not deferred to a `T.<n>`. It
exits through ABORT, as does a refuted claim. Shipping a slice whose own claim was disproved is
the one outcome this command never permits.

### 7. PROVE

1. `e2e/improve-<id>.spec.ts` **RED at the spec commit, GREEN on HEAD**, both exit codes pasted.
   This proves the gap closed; `visual-pass` only proves the screen is not broken.
2. The refutation condition, run, with its result.
3. **L**: the held-out goal — a second goal in the same skill, written down *before* the build,
   driven once, unaided.
4. **If the slice claims adaptivity**: two different input streams through the shipped path; the
   outputs must differ **and** one must match a teacher-verified expected result. Differing-but-
   wrong feedback is worse than none.
5. The full experience gate in `docs/PROCESS.md`.

### 8. LOG, RETRO, RELEASE

Append the run to `docs/improve-log.md` in the schema `check-improve-log.mjs` enforces (it runs
in `verify`, so a malformed entry cannot reach a commit): persona, tier, pick source and the
previous one, ledger table, claim, refutation condition, metric, baseline, outcome, the
cannot-sense register, and **the verdict on the previous run's metric**. Then:

```bash
node scripts/improve-run.mjs verdict --value <n>|--none
node scripts/improve-run.mjs finish --outcome <clean|shipped-not-clean|abort>
```

`finish` refuses without the section marks, the verdict and (unless aborting) the slice. Then
the `docs/PROCESS.md` retro in `docs/retro-log.md`, then release every claim taken at §0 and §2:

```bash
node scripts/worktrees.mjs release <id>
node scripts/worktrees.mjs release main-checkout
```

### ABORT — a valid, successful outcome

No qualifying gap, a build blocked past a budget stop, an unfixed BLOCKER, or a refuted claim:
revert the implementation commits, **keep the spec commit** — the run's one durable artefact, a
failing test naming what the app still cannot do. File the blocker as a `T.<n>`, run §8 with
`--outcome abort` and a `### Proof` section evidencing it, release the claims, end.

A run that ships nothing and says why is a pass. A run that downgrades to a cosmetic S-cost gap
so it can report success is the failure this clause exists to prevent.
