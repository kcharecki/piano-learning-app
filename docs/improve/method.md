# The /improve-app method — classes, axes, ranking, citations

Reference for `docs/commands/improve-app.md` steps 1–2. The command is the loop; this is what
the loop reasons with. Where `scripts/improve-run.mjs` or `scripts/check-improve-log.mjs`
enforces a rule below, the script is the rule and this file is its explanation.

## 1a — the four questions

Post as one block, then keep working. Paste the reply verbatim into `runs/<id>/interview.md`.

1. What did you sit down to do this week that the app did not do?
2. What did you do outside it — book, YouTube, metronome, teacher — and why there?
3. What did you stop using, and what broke the day you stopped?
4. If one thing here vanished tomorrow, what would you miss most?

A verbatim answer outranks any inference from stored data or a drive. Where they conflict, the
answer names the goal and the data names the state — both go in the ledger. **Never simulate,
paraphrase or predict an answer that did not arrive**; `no answer this run` is the only
permitted substitute, and the run continues without it.

## Gap classes

| Class | Meaning |
|---|---|
| **HARMFUL** | Works as designed and drills a defect in — wait-mode dependency, note-hunting instead of reading ahead, eyes on the screen instead of the staff or the kit, playing to the hit window instead of the pocket. **Admissible only with both**: the missing guard named at `file:line` in shipped code, and a cited source calling the habit a defect. Without both it ranks normally. The gate is strong, so the evidence bar is too — otherwise asserting HARMFUL becomes the cheapest way to win a ranking. |
| **MIS-GRADED** | Wrong content order or grade **for every learner** — the ladder itself needs re-grading. |
| **MIS-GATED** | Right ladder, wrong rung **for this learner** — a gating or personalisation fix. |
| **VOID** | Nothing in the app teaches this skill at all. |
| **BLIND** | The app cannot say what the learner did wrong, or says something a teacher would call wrong. |
| **UNREACHABLE** | It exists, but this learner never finds it or cannot pass its gate yet. |
| **THIN** | It works and the learner wants more of it — the app under-serves something it already does well. The only non-deficiency class. A process whose every class is a defect can only ever repair. |
| **FLAT** | It works, but a book and a metronome do it as well — the app adds nothing. |

## Ranking axes

Score each 0–3. `check-improve-log.mjs` rejects an out-of-range score or a missing source.

| Axis | 0–3 |
|---|---|
| **Blocked** | Can the learner reach their goal at all without it? |
| **Reach** | Share of practice sessions that hit it. |
| **Teacherliness** | Distance from what a human teacher would give here. |
| **Unmatchable** | Could a teacher with a book and a metronome do this at all? (0 = easily) |

**Rank on the raw sum (0–12), plus any 1e age bonus. Cost never divides the score** — it sets
the tier and nothing else. Dividing by cost is arithmetically guaranteed to buy the cheapest
gap: a raw-9 new capability at M weight scores 4.5 against a raw-8 S-cost repair's 8.0, so new
capability can never win and the process ships small repairs for ever while sounding ambitious.

## The three rules that override the table, in order

1. **Harm gate.** A gap whose defect is drilled in daily, or that is injury-adjacent, is picked
   ahead of any higher-scoring gap. Several qualify → the higher raw sum. Requires the HARMFUL
   evidence bar above.
2. **Prerequisites win.** The pick names its prerequisites. If a prerequisite is itself a ledger
   row, the ranking takes the upstream one and logs the redirect.
3. **Continue on your own instrument, then rotate.** The persona's instrument **binds the
   pick**: the pick must be a gap in the persona's instrument, and `pick --instrument
   <piano|drums>` refuses one that is not. Sources 1b and 1e are repo-wide, so the other
   instrument's rows are still scored and carried in the ledger — they are simply not pickable
   this run, and their 1e age keeps accruing while they wait.

   If the previous run **on this instrument** left a named continuation — an unresolved MAJOR
   filed as `T.<n>`, a metric whose verdict came back flat or negative, or a capability whose
   own spec names the next rung — that continuation **is** the pick (`--thread <slug>`), and
   source rotation does not apply. A thread runs only on its own instrument's runs and **never
   consumes the other instrument's run**; its cap counts runs of that instrument, not calendar
   runs. Otherwise the pick may not come from the same source as the previous run's, unless the
   harm gate fired or no other source produced a gap within 2 points of the leader.

   A thread opened by **prerequisites win** declares its **payoff item** at run 1 (`--payoff
   <id>`: the first item downstream that a learner can actually practise). Its cap is that
   item's unshipped prerequisite count **plus one**, fixed at run 1 and logged; prerequisites
   win keeps redirecting until the payoff ships. Every other thread caps at **three runs of its
   instrument**. A thread past its cap with no learner-visible capability is abandoned **in
   writing**, naming what was learned and what finishing would have cost — a chain abandoned
   one item short of its declared payoff is logged as the process failing, not the chain.

   *All three parts are load-bearing.* Without the binding, a drums run picks the highest piano
   row and reports success. Without continuation, an L-cost capability is unreachable by
   construction and nothing shipped "not clean" is returned to. Without rotation, every run
   picks a drive defect and nothing new is ever built.

## Citations

Every pedagogy claim carries **the claim, a verbatim quote, and one sentence of entailment**
saying why the quote supports *this* fix. Source: a URL fetched in this session, or a syllabus
or method book cited to grade and page. Piano — RCM 2022, ABRSM 2025–26, Faber, Alfred,
Taubman. Drums — Drumeo, Rockschool, Trinity, PAS.

A repo `path:line` may evidence **facts about the app**, never pedagogy. A named authority with
no quote is not a citation. `docs/ux-pedagogy-review-2026-08-12.md` and
`docs/drums/research-2026-08-15.md` are this app's own digests with their own NOT-PROVEN
sections — citing them as authority is the app grading its own homework.

**1a answers and 1e orphans are exempt** — the learner does not cite, and a genuinely new idea
has no syllabus precedent. Each instead carries a stated **harm hypothesis**: how this could
teach the wrong thing.

## Severity

The polish loop ends on a round with **zero BLOCKER and zero MAJOR**. Grade against this rubric,
not against how hard the fix looks — the reviewer who softens a finding to MINOR ends the run.

| Word | Meaning |
|---|---|
| **BLOCKER** | Ships a wrong musical fact, teaches a defect, loses learner data, or breaks a screen the learner reaches today. Also: a refutation condition that passes against sabotaged code. May not be deferred to `T.<n>` or shipped `shipped-not-clean` — an unfixed one exits through ABORT. |
| **MAJOR** | The claim is not true for some real learner state, or the feedback is wrong enough that a teacher would contradict it. |
| **MINOR** | Everything else. |

## Panel token contract

`docs/panel/*.md` are byte-stable: the orchestrator substitutes `{{TOKEN}}`s and never edits the
prose, and `improve-run.mjs panel` records the rendered sha256 so a later round cannot quietly
soften its own prompt. Each template ends with the tokens it requires. Values come from here:

| Token | Value |
|---|---|
| `REPO_ROOT`, `RUN_ID`, `INSTRUMENT` | From `improve-run.mjs start`. |
| `DIFF_REF`, `BASE_SHA` | The slice sha from `slice --sha`, and the start commit `start` stamped. |
| `ROUND`, `PRIOR_FINDINGS`, `FIX_DIFF_REF` | Round 1: `1`, `none — this is round 1`, `n/a`. Later rounds: the previous rounds' verbatim findings and the diff of the fixes made since. |
| `CLAIM`, `REFUTATION_CONDITION`, `METRIC` | The §3 claim block, unedited. |
| `DEV_URL`, `SEED_PROFILE`, `STATE_RECIPES` | The running dev server, the profile §1c seeded, and how to force empty / loading / error / no-MIDI. |
| `DRIVE_LOG_PATH` | `runs/<id>/drive.md`, written at §1c. |
| `LEARNER_PROFILE` | The persona: stage, current grade, this week's goal. |
| `BANNED_SOURCES` | `docs/ux-pedagogy-review-2026-08-12.md`, `docs/drums/research-2026-08-15.md`, and any other of this app's own digests. |

A token the template requires and the run cannot supply is a **stop**, not a blank: a seat given
`{{STATE_RECIPES}}` it cannot fill will report the states as checked without forcing them.

## Personas

`improve-run.mjs start` owns the rotation and **alternates piano and drums**, so neither
instrument can be starved by a run of interesting gaps in the other. The rotation advances once
per run and is derived from the ledger by replay (`count(start) − count(rewind)`), so it cannot
be silently reset. A bootstrap run gives its persona back with `rewind`.

Each persona is a stage and a concrete musical goal, not a demographic — something a teacher
would recognise as a week's work: *play Ode to Joy hands together at 60 bpm without stopping*,
*play a rock beat with hats on 8ths at 80 bpm for a minute*, *sight-read a new grade-1 piece
cold and know what I got wrong*.

## What a drums drive reports

Drum teaching does not grade "wrong note". A drums drive reports **per-limb mean offset and
variance** (ahead or behind), **ghost/accent separation**, and **per-limb drift under load**.
**Sticking and hand-assignment are permanently unsensable** — a pad hit does not report which
hand made it — so they live on the register, not in a ledger, and are not re-derived each run.
Never ship a slice that infers them and grades the learner on the inference.

## The cannot-sense register

Everything this method counts is a discrete event. **Tone, touch, voicing, the pocket, phrasing,
posture, grip** and **drum sticking** live between the events and cannot surface as a gap here.
Never let the countable quietly define the curriculum.

`docs/improve-log.md` owns the register, the rule that each entry names the screen disclosing the
limit, and the list of signals that are captured-but-unread and therefore `orphan-signals`
business rather than blindness. It narrows only on proof of countability.
