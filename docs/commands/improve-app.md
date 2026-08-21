# /improve-app — find what the app is missing, build it, polish it until it is great

`/next` executes a backlog somebody already wrote. **This command writes the backlog itself**,
from evidence, and holds the result to a bar above "done".

**Read now:** this file, then `docs/improve/method.md` — classes, axes, ranking, severity,
personas, the register. That is the whole up-front load. **Read when you reach it:** `ROADMAP.md`
at §2 and not before, `docs/efficiency-guide.md` Appendix A at §4, `docs/panel/*` at §5,
`docs/PROCESS.md` at §3 and §7 (it carries `docs/DESIGN.md`'s screen rules), `retro-log.md` at §8.
Front-loading the rest is how a run spends its budget reading. `docs/PROCESS.md` applies in full
and is not restated — its experience gate is the **floor**, not the target.

**Main checkout only.** It writes `ROADMAP.md`'s Triage and `docs/retro-log.md`, which
`docs/WORKTREES.md` forbids to worktree sessions. `/next`'s step 0 routes a refused claim into a
worktree; **this command stops and reports instead.**

**Great means**, for a run: the slice names one metric in the learner's persisted history with its
pre-ship baseline (`0 events, newly instrumented` is valid); the refutation condition ran and did
**not** refute the claim; at M+ the Teacher endorses it against a cited syllabus. That metric's
verdict is due at the **next** run — no run observes its own effect on human playing.

## The loop

Where a gate exists, the script is the rule and it refuses to advance. Call `improve-run.mjs
mark <section>` on entering each section; that is what the budget stops read.

**Five rules no script can check, and the process is worth nothing if you fake them:** the 1a
answer is the learner's real words, the §1c drive happened, the panel seats were real agents given
the real templates, a citation's quote is genuine, and a severity is graded against the rubric
rather than against how hard the fix looks. Every other gate is scripted so attention is free for
these five.

### 0. START

**Bootstrap check first** — the next command is one of the things it checks for. If any of
`scripts/{improve-run,orphan-signals,check-improve-log}.mjs`, `docs/improve-log.md` or
`docs/panel/` is missing, **building the absent ones (only those) is slice 1 and the run stops
there**: green committed slice, `rewind` if `start` already ran, §8 logs the bootstrap only.

```bash
node scripts/worktrees.mjs claim main-checkout      # refused → stop and report
node scripts/improve-run.mjs start                  # → run id, persona, instrument, prev source
```

`start` refuses a dirty tree, a worktree, and a previous run with no metric verdict. It stamps the
start commit and a 240-minute budget (every percentage below is of that), creates `runs/<id>/`, and
advances the persona rotation — **piano and drums alternate** and the persona's instrument **binds
this run's pick**. `runs/<id>/` is git-ignored scratch, `runs/ledger.ndjson` committed.

### 1. DISCOVER — five sources. **Do not open `ROADMAP.md` yet.** Cap: 25% of budget

`docs/improve-log.md`'s **idea** and **cannot-sense** registers are sources too (`--source idea|reg`).

| | Source | How |
|---|---|---|
| **1a** | **Ask the learner** | This app has one user and they are in this chat. Post the four questions from the method doc as one block, keep working, paste the reply **verbatim** into `runs/<id>/interview.md`. Never simulate an answer that did not arrive; `no answer this run` is the only substitute. |
| **1b** | **Mine their history** | Export the stores from the running app. Report the three metrics unmoved in 30 days, the most-abandoned item (started, not returned to in 14 days) with its last error, and the top error class of ≤7 buckets, **and the most-repeated item with how many unplayed items remain at the learner's level** — exhaustion is a THIN finding, not an error, and without this figure four of the five sources can only report deficiencies. Each is admissible with no drive failure attached. An empty profile is a finding — say so, never invent history. |
| **1c** | **Drive as the learner** | One drive, every tier, on a seeded profile, interactively via the on-screen keyboard / QWERTY note input (`e2e/qwerty-note-input.spec.ts`). `e2e/fake-midi.ts` installs only through `page.addInitScript` before `page.goto` — spec-driven proof, not a live drive. Take the wrong turns a beginner takes. Classify every failure. **Write it to `runs/<id>/drive.md`** — screens entered, inputs played, what the app said back, every failure — that file is `{{DRIVE_LOG_PATH}}` and two panel seats read it. |
| **1d** | **Syllabus first** | Fix the learner's grade in one cited syllabus. Write the 10–15 skills it requires **before opening the app**, then mark each taught+graded / taught-not-graded / absent. Every *absent* is a VOID needing no drive. **The only source that finds what no drive hits.** |
| **1e** | **Orphan signals** | `node scripts/orphan-signals.mjs` — captured, persisted or decoded, and read by no grader or screen. Paste it verbatim. The script owns the ages (+1 per run, capped +3, added to the raw sum). **This is where new capability comes from**; it needs no drive failure attached. Confirm LOW-confidence rows by hand before ledgering them. |

### 2. LEDGER, PICK, CLAIM

Score every gap on the four axes in the method doc. **Rank on the raw sum (0–12) plus any 1e age
bonus; never divide by cost** — cost sets the tier and nothing else, and the method doc shows why.

```bash
node scripts/improve-run.mjs pick --source <1a-1e|reg|idea> --instrument <piano|drums> \
  --class <VOID|THIN|BLIND|HARMFUL|MIS-GRADED|MIS-GATED|UNREACHABLE|FLAT> \
  --sum <n> --cost <S|M|L> --leader-gap <n> --harm <0|1> \
  --thread <slug|none> [--payoff <id> --prereqs <n>] --metric <field> --baseline <v>
```

`--instrument` must match the persona or `pick` refuses; 1b and 1e are repo-wide and the top row
is usually piano, without which the alternation is decorative. `--harm 1` and `--class HARMFUL`
must agree; `VOID` forces tier L; one `pick` per run. `pick` enforces, in order: **harm gate**,
**prerequisites win**, **innovation quota**, **continue-then-rotate**. The **quota** — no
instrument goes three consecutive runs of its own without a `VOID`, `THIN`, `reg` or `idea` pick —
outranks the thread rule, since the other two overrides can only be won by a repair. A thread the
quota defers waits one run of its own, cap frozen.

| Tier | Set by | Panel | Adds |
|---|---|---|---|
| **Floor** | cost S | Skeptic + Regression hunter, 1 re-panel | — |
| **M** | cost M, or crosses a `src/` top-level boundary (core↔adapters↔app↔content), or crosses piano↔drums | + Teacher, 2 re-panels | three-design divergence |
| **L** | cost L, HARMFUL, or VOID | + Rival, 3 re-panels | second and third drive (here, not §1), held-out goal |

**Budget stops**, enforced by `mark`: no `slice` by 40% → **shed the tier's added obligations**
(extra drives, extra panel rounds), keeping the same gap; none by 60% → ABORT. **The held-out goal
is never shed** — the only test that new capability *generalises*, and VOID forces L, so shedding
it strips the proof from the picks needing it most. Nor is shedding a trade-down.

*Now* cross-check `ROADMAP.md` — already a task → take its id; contradicts one → resolve it there.
Then `node scripts/worktrees.mjs claim <id>`, the **bare** id (or `improve-<slug>`), never
`task/<id>` — the script adds that prefix, and passing it defeats the collision guard.

### 3. DESIGN, then commit the claim before the code

M and L: three materially different designs, the axis they trade on, two killed in writing.
Floor: one design and the named alternative it beat. L runs its extra drives here. Then:

> After this ships, a learner who **\<state\>** will be able to **\<do what\>**, and we will know
> because **\<observable in the running app\>**.

State the **refutation condition** with it — the observation that would prove it false; the Skeptic
runs it at §5. Name the §1b metric and its pre-ship baseline. "A test passes" is not an observable,
nor is "a hint appears" — `check-improve-log.mjs` rejects both.

Write `e2e/improve-<id>.spec.ts` asserting the observable, run it **RED**, commit it alone:

```bash
node scripts/improve-run.mjs spec --id <id> --red-exit <code>
```

It refuses a spec commit touching anything else, and one that was never red. Three sentences of
screen design per `docs/PROCESS.md`, and what the screen demotes.

### 4. BUILD

Vertical slice; module work to Sonnet builders with the pasted brief (`docs/efficiency-guide.md`
Appendix A); main thread owns integration and `verify`. **Exactly one gap, taken all the way, in
exactly one implementation commit** — `slice --sha` takes one sha and refuses a second, so a slice
wanting five commits wants two gaps. A second build attempt with no green committed slice → ABORT.

### 5. PANEL — parallel, prompts rendered from `docs/panel/`, never rewritten

Verbatim output to `runs/<id>/panel-rN-<role>.md`; the orchestrator may append a named refutation
under a reviewer's text but may not edit a severity. `panel --round n --role r --file <path>
--blockers/--majors/--minors <n>` hashes `docs/panel/<role>.md` and refuses a drifted round 2, and
reports the BLOCKER-count ratchet below.

| Seat | From | Model | Duty |
|---|---|---|---|
| **Skeptic** | Floor | Opus, high | **Sabotages the §3 refutation condition first** — a condition that still passes against broken code is void and gets replaced. Then runs it. ≥5 attempted refutations, ≥2 against the running app. |
| **Regression hunter** | Floor | Sonnet | What broke that no test covers? Drives the neighbouring screens and forces each state by a named mechanism. |
| **Teacher** | M | Opus | One seat **per instrument the slice touches** — a slice touching both gets two, never one reviewer wearing both hats. Would a teacher endorse this? Cite the syllabus. |
| **Rival** | L | Opus, high | A concrete superior alternative from shipping products, **or** an evidenced "nothing found", every negative carrying a fetched URL. A bare "nothing found" is invalid. |

Every template ends with the tokens it requires; `docs/panel/README.md` says where each value
comes from and which seats run at which tier. **A token you cannot fill is a stop, not a
blank** — a seat handed an empty `{{STATE_RECIPES}}` reports the states checked, forcing none.

### 6. POLISH

Fix every BLOCKER and every MAJOR (method doc defines all three), re-panel with byte-identical
prompts, up to the tier's cap. Cosmetic findings fixed too unless the log says why not. **Clean =
a round with zero BLOCKER and zero MAJOR.** Silence does not pass round 2+: a re-panel re-runs
earlier repros, attacks the fix diff, and is void if it makes no attempt an earlier round did not.

At the cap it is **not** a pass: each unresolved MAJOR becomes a `T.<n>` in `ROADMAP.md`'s
Triage, the roadmap box stays `[~]` naming those ids, outcome logged `shipped-not-clean`.

**The BLOCKER count must fall every round.** A round returning as many as the one before it means
the fixing is creating faults faster than it closes them; `finish` then refuses every outcome but
`abort`. Do not start the next fix round.

**An unfixed BLOCKER cannot ship** — not as `shipped-not-clean`, not deferred to a `T.<n>`. It
exits through ABORT, as does a refuted claim. Shipping a slice whose own claim was disproved is the one outcome this command never permits.

### 7. PROVE

1. `e2e/improve-<id>.spec.ts` **RED at the spec commit, GREEN on HEAD**, both exit codes pasted on
   an explicit unique `E2E_PORT` — a stale server on 5173 grades the wrong tree and reports a pass.
2. The refutation condition, run, with its result.
3. **L**: the held-out goal — a second goal in the same skill, written *before* the build, driven
   once, unaided. Never shed; an L slice that cannot afford it aborts.
4. **Adaptivity claims**: two input streams through the shipped path; outputs must differ **and**
   one must match a teacher-verified expected result — differing-but-wrong is worse than none.
5. The full experience gate in `docs/PROCESS.md`.

### 8. LOG, RETRO, RELEASE

Append the run to `docs/improve-log.md` in the schema that file documents and
`check-improve-log.mjs` enforces inside `verify`. It includes **the verdict on the previous run's
metric** — the point of the whole ledger — and the pick's **Class**, without which the log cannot
say whether ten runs running were all repairs. Then:

```bash
node scripts/improve-run.mjs verdict --value <n>|--none
node scripts/improve-run.mjs finish --outcome <clean|shipped-not-clean|abort> [--clean-round <n>]
```

`finish` refuses without the marks, the verdict, the spec, the slice, a full seat sweep at the
declared clean round, and a falling BLOCKER count. Then the `docs/PROCESS.md` retro in
`docs/retro-log.md`, then release every claim taken at §0 and §2:

```bash
node scripts/worktrees.mjs release <id>
node scripts/worktrees.mjs release main-checkout
```

### ABORT — a valid, successful outcome

No qualifying gap, a budget stop, an unfixed BLOCKER, a ratchet, or a refuted claim: revert the
implementation commits, **keep the spec commit** — the run's one durable artefact, a failing test
naming what the app still cannot do. File the blocker as a `T.<n>`, run §8 with `--outcome abort`
and a `### Proof` section evidencing it, release the claims, end.

A run that ships nothing and says why is a pass. Downgrading to a cosmetic gap to report success is not.
