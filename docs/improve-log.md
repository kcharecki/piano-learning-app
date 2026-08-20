# improve-log — the /improve-app ledger

One entry per run of `/improve-app` (`docs/commands/improve-app.md`; method in
`docs/improve/method.md`). This file is the memory between runs: without it every run
rediscovers the same gaps, no metric ever gets a verdict, and no thread survives a session.

`scripts/check-improve-log.mjs` validates every `## Run` entry below and runs inside
`npm run verify`, so a malformed entry cannot reach a commit. The machine-readable run state
lives in the append-only `runs/ledger.ndjson` (owned by `scripts/improve-run.mjs`); this file is
the human-readable half, and the two must agree — `improve-run.mjs audit` says when they do not.

## Entry schema

Copy this shape. Every labelled field is required; the checker names the line when one is
missing.

```markdown
## Run 2026-08-21-1

- **Persona:** <stage + concrete musical goal> (piano|drums)
- **Tier:** Floor|M|L
- **Pick source:** 1a|1b|1c|1d|1e|reg|idea
- **Previous pick source:** 1a|1b|1c|1d|1e|reg|idea|none
- **Class:** HARMFUL|MIS-GRADED|MIS-GATED|VOID|BLIND|UNREACHABLE|THIN|FLAT
- **Claim:** After this ships, a learner who <state> will be able to <do what>, and we
  will know because <observable in the running app>.
- **Refutation condition:** <the observation that would prove the claim false>
- **Metric:** <field in the learner's persisted history>
- **Baseline:** <number> | 0 events, newly instrumented
- **Endorsement:** yes|no|n/a — Floor tier
- **Outcome:** clean|shipped-not-clean|abort
- **Harm gate:** <only when the harm gate overrode the ranking — say what and why>
- **Thread:** <slug>, run k of ≤N — N is 3, or prereq-count+1 for a prerequisites-win
  thread (`docs/improve/method.md`) — <what the previous run left open>

### Ledger

| Gap | Source | Class | Blocked | Reach | Teacherliness | Unmatchable | Sum | Cost |
|---|---|---|---|---|---|---|---|---|
| <one line> | 1e | BLIND | 1 | 3 | 3 | 3 | 10 | M |

### Interview

<verbatim from runs/<id>/interview.md, or: no answer this run>

### Orphan signals

<verbatim from `node scripts/orphan-signals.mjs`, with ages>

### Panel

<per seat and round: the findings and what happened to each>

### Proof

<RED exit at the spec commit, GREEN exit on HEAD, the refutation result>

### Previous run's metric verdict

<the number, or: none — and what it means for the next pick>

### Cannot-sense register

<one row added this run, or one sentence on why the run found nothing between its events>
```

The pick recorded in **Pick source** must be the source of the ledger table's highest-scoring
row, unless a **Harm gate**, a **Thread**, or a **Register cadence** line explains the override.
That check exists so a run cannot write a ranking table that disagrees with what it actually
built. **Class** is required on the pick and on every ledger row: without it the log can say
which source and which cost won ten times running, and still not say whether any of the ten was
new capability — the one failure this process exists to prevent.

## Cannot-sense register (standing)

A queue of open problems, not a list of laws (`docs/improve/method.md`). **PHYSICAL** = no
sensor in this rig reports it. **OURS** = the signal reaches the app and this repo discards or
normalises it — an OURS row **is a gap** and is scored like any other. Every row carries a
countability challenge; a row without one is unexamined, not defended. Each names the screen
disclosing the limit — silence must never read as approval. Every fourth run of an instrument
picks a row from here. A row leaves only on a shipped proxy with its challenge observed, naming
the run id; one surviving three challenges is re-filed PHYSICAL with all three written down.

**A row enters** at §8 of every run: each run adds one, or states in one sentence why it found
nothing between its events. Without an inlet this is a queue with only a drain, and the cadence
empties it — five rows, two of them OURS, one per instrument. **A row whose challenge reads
*None known* cannot satisfy the cadence**, or run 8 is mandated to pick a row this table itself
declares unbuildable.

| Unsensable | Why | Countability challenge | Disclosed on |
|---|---|---|---|
| Tone, touch, voicing | **PHYSICAL** — lives in the sound, not the event stream | Velocity curve across a phrase is a proxy for evenness of touch; it stands in if learners a teacher calls uneven show higher velocity variance on the same passage | *(not yet disclosed)* |
| Pedalling nuance (half-pedal) | **OURS** — CC64 arrives 0–127 and `src/adapters/midi/webmidi.ts:143` collapses it to `down: d2 >= SUSTAIN_THRESHOLD`. Not a fact about MIDI | Keep the continuous value; depth-over-time against note decay is the proxy for a half-pedal change | *(not yet disclosed)* |
| The pocket, phrasing | **OURS** — signed per-limb mean offset is exactly what `docs/improve/method.md` already requires a drums drive to report, using the offset-vs-spread split `src/core/practice/assessment.ts` already computes. `src/core/drums/model/hit.ts` carries `DrumHit.time` per pad and has **zero importers** | A consistent non-zero signed offset with low variance is the proxy for deliberate placement; it stands in if a drummer asked to lay the snare back produces it and one asked to play straight does not | *(not yet disclosed)* |
| Posture, grip, hand shape | **PHYSICAL** — no sensor | None known. Re-file only if a camera or sensor enters scope | *(not yet disclosed)* |
| Drum sticking / hand assignment | **PHYSICAL** — a pad hit does not report which hand made it | Alternation inferred from inter-onset intervals is the nearest proxy and is **not** admissible for grading; the honesty rule forbids a verdict on the inference | *(not yet disclosed)* |

**Not on this register**, and never admissible on it: note-off times, sustain-pedal events,
velocity, release times. They are captured, on disk and unread — `orphan-signals` business, not
blindness. `check-improve-log.mjs` fails a run that files them here.

## Idea register (standing)

Where the Rival seat's **strongest version nobody ships** goes, plus any idea a run generated and
did not pick. Without this it is written at §5 and discarded, which throws away the one
free-form invention output the process has. §1 reads this register as a sixth source: an entry
here is admissible in the ledger, citation-exempt like 1a and 1e, and carries a harm hypothesis.
An entry names the run that produced it. An entry picked and shipped names the run that closed
it. An entry nobody has picked after five runs is either restated as something buildable or
struck out in writing with the reason. **An entry that survives five runs and is not struck out
becomes a mandatory pick on the next run of a matching instrument** — otherwise this is a
write-only queue with a timer, and every entry has a legal exit that is not "built".

| Idea | From run | Status |
|---|---|---|
| *(none yet)* | | |

## Learner-said (standing)

The 1a answer outranks every other source (`docs/improve/method.md`) and was, until this table
existed, the only source with no memory: a reply arriving after §2 was worth nothing, and a reply
from run 3 was invisible at run 5. Every answer lands here, verbatim, with the run that asked.
A run that gets `no answer this run` falls back to the newest unstruck rows and says so. A row is
struck out when the learner's own later answer contradicts it, never because it aged.

| Answered | Run | Verbatim | Struck |
|---|---|---|---|
| *(none yet)* | | | |

## Runs

*(none yet — the first run appends below)*
