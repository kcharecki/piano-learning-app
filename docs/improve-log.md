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
- **Pick source:** 1a|1b|1c|1d|1e
- **Previous pick source:** 1a|1b|1c|1d|1e|none
- **Claim:** After this ships, a learner who <state> will be able to <do what>, and we
  will know because <observable in the running app>.
- **Refutation condition:** <the observation that would prove the claim false>
- **Metric:** <field in the learner's persisted history>
- **Baseline:** <number> | 0 events, newly instrumented
- **Outcome:** clean|shipped-not-clean|abort
- **Harm gate:** <only when the harm gate overrode the ranking — say what and why>
- **Thread:** <slug>, run k of ≤3 — <what the previous run left open>

### Ledger

| Gap | Source | Blocked | Reach | Teacherliness | Unmatchable | Sum | Cost |
|---|---|---|---|---|---|---|---|
| <one line> | 1e | 1 | 3 | 3 | 3 | 10 | M |

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

none this run
```

The pick recorded in **Pick source** must be the source of the ledger table's highest-scoring
row, unless a **Harm gate** or **Thread** line explains the override. That check exists so a run
cannot write a ranking table that disagrees with what it actually built.

## Cannot-sense register (standing)

What this method structurally cannot see, because everything it counts is a discrete event.
Each entry names the screen that discloses the limit to the learner — silence must never read
as approval. A removal names the run id and the evidence that the thing turned out to be
countable after all.

| Unsensable | Why | Disclosed on |
|---|---|---|
| Tone, touch, voicing | Lives in the sound, not the event stream | *(not yet disclosed)* |
| Pedalling nuance (half-pedal) | `MidiEvent` normalises CC64 to a boolean | *(not yet disclosed)* |
| The pocket, phrasing | A property of the whole, not of any onset | *(not yet disclosed)* |
| Posture, grip, hand shape | No sensor | *(not yet disclosed)* |
| Drum sticking / hand assignment | A pad hit does not report which hand made it | *(not yet disclosed)* |

**Not on this register**, and never admissible on it: note-off times, sustain-pedal events,
velocity, release times. They are captured, on disk and unread — `orphan-signals` business, not
blindness. `check-improve-log.mjs` fails a run that files them here.

## Runs

*(none yet — the first run appends below)*
