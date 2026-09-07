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
- **Pick gap:** <the Gap text of the ledger row this run picked — the key the checker
  cross-checks Pick source, Class and Sum against; it must match that row exactly>
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
- **Register cadence:** <only when the cannot-sense cadence forced the pick — say what
  mandated it and why>

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

### Next steps

- <one line per roadmap row this run leaves behind, each citing its id in backticks,
  ordered by what unblocks the most — or the single line: nothing queued this run>
```

**Next steps** is the hand-off, and it is the section a reader of this file arrives for: the run
that just ended knows which rows it filed, which MAJOR it could not close, and what the next run
has to read before it can `start`. Written down it is a queue; left in a session it is
rediscovered from the roadmap every time, which is the cost this whole file exists to avoid.
The checker takes only lines citing a real `ROADMAP.md` task id, so a step is a pointer at a
committed row and never a plan nobody filed. Required for run ids from **2026-08-24** on.

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
| Chord roll direction and spread | **OURS** — the note-ons carry real times and `MATCHER_DEFAULTS.chordWindowMs = 80` collapses everything inside the window into one onset, so whether a blocked triad was struck as one sound or rolled bottom-to-top is discarded before grading. Not a fact about MIDI | Keep the per-chord spread: the signed low-to-high span in ms is the proxy for blocked-vs-rolled, and it stands in if chords a teacher calls rolled show a larger span than the ones they call blocked | *(not yet disclosed)* |
| Where the learner's own timing sits, once device latency is taken out | **OURS** — every instant this app grades has already been through a keyboard scan, a browser event queue and an audio output buffer, and none of that is measured, so a signed mean offset is the learner's placement plus an unknown constant. A drummer laying the snare back 25 ms and a rig 25 ms slow produce the same number | A calibration pass — one pad, one bar against the click, take the median offset as the rig's constant and report bias relative to it; it stands in if two rigs with known different output latency produce the same corrected bias for the same learner | *(not yet disclosed)* |
| Whether a learner read the note or copied the marked key | **PHYSICAL** — no sensor in this rig reports where the learner looked, and the flashcard reveal rings the correct key while the staff still shows the question | Press latency: a note read off the staff carries a reading cost that scales with how unfamiliar the note is, and a key copied off a highlight does not. It stands in if presses made while a key is marked cluster at a shorter latency that is flat across note difficulty, while presses made with nothing marked do not | *(not yet disclosed)* |

| Whether a learner can READ a chart, or has only memorised the grooves the trainer offers | **OURS** — `useDrumsHistoryStore` already records every attempt with its `grooveId`, so which grooves this learner has met before is on disk; `gradeGrooveRun` never sees it, and a first-sight reading and a fourth rehearsal of the same bar produce the same per-pad numbers | First-attempt score on a groove with zero prior attempts, against the same learner’s score on one with three or more. The gap between them is the proxy for reading rather than recall; it stands in if that gap narrows as the notation improves and stays flat when only the audio preview does | *(not yet disclosed)* |

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
| **Grade the eight triads as eight objects, not the run as one number.** Each triad tests something nameable — the roll of a solid block measured low-to-high onset (the exam wants one sound), the hand-shift gap between triad n and n+1 (a different skill from evenness inside a triad), and the diminished triad on degree 7 where the hand shape changes. The even pulse that matters is the triad-onset pulse, one per beat, not the inter-note one the app measures. | 2026-08-20-1 (Rival, r1) | open |
| **Make the tempo mark an output of the measurement, not an input to it.** Instead of asking "was this run clean at 60?", solve for the tempo at which this learner's timing noise crosses the bar and report a clean-tempo ceiling with an interval, split into systematic drift (a fault practice can move) and random jitter (the floor). Per triad, not per run, so the drill loops the weak triad at its own tempo. | 2026-08-20-1 (Rival, r2) | open |
| **Make the primary output a row per *coincidence*, not a row per limb.** At every instant the notation asks two or more limbs to sound together, print the signed gap between them with the beat named — "kick 34 ms behind the hat on the 1 of bar 6" — and show how that gap moves across the run, so a habit (a constant lean) reads differently from fatigue (a gap that opens). Every product on the market measures a drummer against the click; this is the one measurement immune to device latency, because a constant added to every hit cancels in the difference between two of them. | 2026-08-21-1 (Rival, r1 and r3) | open |

## Learner-said (standing)

The 1a answer outranks every other source (`docs/improve/method.md`) and was, until this table
existed, the only source with no memory: a reply arriving after §2 was worth nothing, and a reply
from run 3 was invisible at run 5. Every answer lands here, verbatim, with the run that asked.
A run that gets `no answer this run` falls back to the newest unstruck rows and says so. A row is
struck out when the learner's own later answer contradicts it, never because it aged.

| Answered | Run | Verbatim | Struck |
|---|---|---|---|
| 2026-08-24 | 2026-08-24-1 | focus on having "flashcard" review styled learning. | |

## Runs

## Run 2026-09-06-2

- **Persona:** Confident intermediate — can read and play, wants theory that survives contact with a teacher (piano)
- **Tier:** Floor
- **Pick source:** 1c
- **Pick gap:** The cadence drill accepts exactly one voicing, and the one it accepts has no fifth — a textbook-correct PAC is marked `Not quite`
- **Previous pick source:** 1d
- **Class:** MIS-GRADED
- **Claim:** After this ships, a learner who is on the Theory screen's Cadence topic will be able to play a perfect authentic cadence the way a teacher writes one — the dominant, then a complete root-position tonic triad with the tonic as the highest voice — and be told they are right, and when they are wrong the answer the drill names will be a tonic chord that has its fifth; and we will know because the Theory drills screen answers `Correct` to `G4 B4 D5, C4 E4 G4 C5` in C major, where today it answers `Not quite — it was G4 + B4 + D5, C4 + E4 + C5` (drive arm C, 2026-09-07).
- **Refutation condition:** Play, through the real on-screen keyboard on `/theory` with Topic = Cadence at level 1, a perfect authentic cadence in the key the prompt names, deriving the notes from `chordForRomanNumeral`/`chordMidi` and never from a hardcoded pitch list, and demand `Correct` plus a scheduled card; then, in a fresh context, play the IMPERFECT realisation — the same chords with the fifth on top — and demand `Not quite` and demand the answer the drill NAMES contains the fifth. Both arms must pass; a fix that buys arm 1 by loosening the grader into "the right pitch classes in any arrangement" fails arm 2.
- **Metric:** PersistedFlashcards.cardsById
- **Baseline:** 5
- **Endorsement:** n/a — Floor tier
- **Outcome:** shipped-not-clean
- **Thread:** pac-voice-leading, run 1 of 3

  *On the Metric field.* The checker takes a bare declared field, so the counting rule cannot
  live on that line: read `cardsById['build-cadence-perfect-authentic-C'].lapses`, and only
  on an attempt that is musically correct: the defect was that a right answer booked an `again`
  review, so a falling count means nothing on its own and a rising one is only evidence when the
  attempt that raised it deserved to pass. Round 2's BLOCKER was found exactly this way — the
  card moved 12 to 13 on a correct dominant whose leading tone had been struck twice.

### Ledger

| Gap | Source | Class | Blocked | Reach | Teacherliness | Unmatchable | Sum | Cost |
|---|---|---|---|---|---|---|---|---|
| Repertoire play discards every dynamic — `ScoreNoteInput.velocity` is captured, validated, stored and read by nothing, so a piece played at one flat volume is graded identically to one shaped | 1e | VOID | 1 | 2 | 3 | 1 | 7 | M |
| The cadence drill accepts exactly one voicing, and the one it accepts has no fifth — a textbook-correct PAC is marked `Not quite` | 1c | MIS-GRADED | 2 | 2 | 3 | 1 | 8 | S |
| The session planner reads neither the onboarding goal nor the persisted level — "experienced" + "theory" and `levelState` level 3 with `overridden: true` still produce a level-1 five-finger plan and zero theory minutes | 1c | MIS-GATED | 2 | 3 | 2 | 1 | 8 | M |
| Pedalling is captured and never shown — `MidiSustain.down` reaches the app and nothing reads it | 1e | VOID | 1 | 1 | 3 | 1 | 6 | M |
| Ear training keeps `EarItem.contextKey` / `contextTonicMidi` and never plays or names the key an interval sits in | 1e | VOID | 1 | 2 | 2 | 1 | 6 | M |
| No transposition drill of any kind (ABRSM Gr5 theory item 4; `transposeMelody` and every spelling: no hits) | 1d | VOID | 1 | 2 | 2 | 1 | 6 | M |
| No ornament recognition (Gr5 item 11), no terms-and-signs drill (item 10), no clef beyond treble/bass (item 3) | 1d | VOID | 1 | 1 | 2 | 1 | 5 | L |
| No melody-harmonisation drill — "choice of suitable chords at cadential points" (Gr5 item 8) is the applied half of the cadence topic and is absent | 1d | VOID | 1 | 1 | 2 | 1 | 5 | M |
| `AssessmentResult.counts` written and never read — the assessment says a verdict and cannot say what it counted | 1e | BLIND | 1 | 1 | 2 | 0 | 4 | S |
| The theory drill's typing hint offers `A S D F G H J K L ;` = MIDI 48–64 (C3–E4); every cadence answer needs G4–D5, so the offered input cannot answer the prompt it is offered under | 1c | UNREACHABLE | 1 | 1 | 1 | 0 | 3 | S |
| Tuplets are parsed, stored and engraved; `Tuplet.actual` is read by nothing and no drill asks for an irregular division (Gr5 item 2) | 1e | THIN | 0 | 1 | 1 | 1 | 3 | M |

Raw leader is the velocity row at 7 + age 3 = 10; the pick is the cadence row at 8, because the
**continue-then-rotate** rule fired: `2026-08-24-1`, the previous run on this instrument, named
`T.23` as its continuation in writing, so that continuation **is** the pick and source rotation
does not apply. Harm gate did not fire — a false fact drilled daily is MIS-GRADED, not the
physical or attentional defect HARMFUL requires. Prerequisites-win did not fire: `buildChord`,
`Chord` and `SpelledPitch` are all shipped. Innovation quota did not fire: piano's last pick was
BLIND, one miss, and the quota needs two consecutively. Register cadence not due — piano run 3.

### Interview

no answer this run. The learner set a standing goal ("I will not be available to answer your
questions or make decisions") before the run started, so no reply arrived and none was simulated.

### Orphan signals

Top 12 of 211, all at age 3 (`node scripts/orphan-signals.mjs`):

```
A     TheoryQuizItem.answerSummary                     src/core/drills/theory.ts:134        HIGH   3
B     MidiControlChange.controller                     src/core/ports/midi.ts:37            HIGH   3
D     ScoreNoteInput.velocity ?? DEFAULT_VELOCITY      src/core/notation/score.ts:163       HIGH   3
A     EarSessionState.cards                            src/core/eartraining/session.ts:107  HIGH   3
B     MidiPolyAftertouch.pressure                      src/core/ports/midi.ts:50            HIGH   3
A     EarItem.contextKey                               src/core/eartraining/item.ts:86      HIGH   3
B     Tuplet.actual                                    src/core/notation/tuplet.ts:21       HIGH   3
A     EarItem.contextTonicMidi                         src/core/eartraining/item.ts:56      HIGH   3
B     PersistedAnnotations.byScoreId                   src/app/state/persistedShapes.ts:56  HIGH   3
A     AssessmentResult.counts                          src/core/practice/assessment.ts:70   HIGH   3
A     MatchResult.expected -> ScoreNote.durationTicks  src/core/notation/score.ts:60        LOW    3
B     MidiSustain.down                                 src/core/ports/midi.ts:24            LOW    3
```

`ScoreNoteInput.velocity` is the ledger's raw leader and is now filed as `T.36`; five more of
these rows are ledger entries above. Nothing here is new this run — every row is at age 3, which
is itself the finding: the orphan list has not moved in three runs.

### Panel

**Round 1 — Skeptic (Opus): 2 BLOCKER, 1 MAJOR, 1 MINOR.** Duty-0a sabotage passed: the
condition failed against a sabotaged tree, so it is not vacuous.

- BLOCKER, root position was checked only on `'perfect-authentic'`, so a plagal cadence answered
  `F4 A4 C5` then `E4 G4 C5` — an inverted tonic — was told `Correct`. **Fixed** `6e48805`.
- BLOCKER, the grader read "the third" positionally out of `Chord.notes`, which on a
  second-inversion chord is the fifth. **Fixed** `6e48805`.
- MAJOR, a dominant with its leading tone doubled and its fifth dropped (`G4 B4 B5`) was accepted.
  **Fixed** `6e48805`. The second half of the same finding — a final tonic with a doubled third
  and no fifth (`C4 E4 E5 C6`) — was **deliberately not changed**: doubling a major triad's third
  is ordinary four-part writing, and round 2 was told to attack that decision, and upheld it.
- MINOR, the file header claimed blanket octave-insensitivity, which cadences do not have.
  **Fixed** `101336f`.

**Round 1 — Regression hunter (Sonnet): 1 MAJOR.** The fifth-less final tonic the grader is
written to accept could not be entered at all, because the panel closed a group on the reveal's
note count and hung at `1 / 2`. **Fixed** `101336f`, by making the learner close a cadence chord.
Inference was tried first and rejected on evidence: closing when the grader would accept what is
played cuts a four-voice dominant at three notes, closing on a foreign pitch class leaves a wrong
final chord never terminating, and IV's own C is also I's root so a plagal cadence mis-cuts either
way. That reasoning is written into the file header so it is not re-derived.

**Round 2 — Skeptic (Opus): 1 BLOCKER, 1 MAJOR, 1 MINOR.** Re-ran all six earlier repros and
confirmed each FIXED. Judged the refutation condition's arm-2 revert "a strengthening, not a
weakening".

- BLOCKER, an interaction between the run's own two fix commits: `6e48805` counted leading-tone
  doublings over the raw press list and `101336f` started holding repeats in the buffer, so one
  key struck twice was graded a doubled leading tone — driven live, `lapses` 12 to 13 on a correct
  dominant, while the same double press on the root was free. **Fixed** `9c77e95`.
- MAJOR, the cadence buffer was invisible and uneditable — a count with no names and no way to
  take a press back, so a slip could only be submitted or abandoned. **Fixed** `9c77e95`.
- MINOR, the refusal names notes and never the rule, and the conventions it polices are not the
  ones the prompt states. **Filed `T.39`** — the feedback string is a content change wider than
  this slice.

**Round 2 — Regression hunter (Sonnet): nothing found.** Re-ran all six round-1 repros
independently and reached the same verdicts. New attempts round 1 did not make: the deceptive
cadence driven live for the first time in both a correct and an incorrect arm, and the Progress
screen — the neighbouring screen reading the same SRS store this diff writes into — driven and
visual-passed. It traced one suspicious observation (the Progress "Theory retention" widget
showing an empty state after real cadence activity) to a deliberate pre-existing prefix filter in
`useDashboard.ts`, untouched by this diff, and correctly declined to file it.

**The BLOCKER count fell 2 to 1.** Floor tier allows one re-panel, so round 2 was the last, and
`9c77e95` — which closes that BLOCKER and that MAJOR — has been reviewed by no seat. That is the
whole reason this run is `shipped-not-clean` and not `clean`, and it is a real gap, not a
formality: the fixes carry a mutation check, an e2e arm and a visual pass, but not an adversarial
read.

### Proof

RED at the spec commit `ea98a39`, in a detached worktree on `E2E_PORT=5391`:

```
  2 failed
    [chromium] improve-T.23.spec.ts:101:1 a perfect authentic cadence played the way a teacher writes one is marked correct (T.23)
    [chromium] improve-T.23.spec.ts:125:1 an imperfect authentic cadence is still refused, and the answer named has its fifth (T.23)
RED EXIT: 1
```

GREEN on HEAD, `E2E_PORT=5392`:

```
  ok 3 an imperfect authentic cadence is still refused, and the answer named has its fifth (T.23) (1.4s)
  ok 2 a perfect authentic cadence played the way a teacher writes one is marked correct (T.23) (1.4s)
  ok 1 a key struck twice inside one chord is a repeat, not a doubling (panel r2) (1.5s)

  3 passed (3.4s)
GREEN EXIT: 0
```

The refutation condition is that spec, both arms, and both pass. `npm run verify` green at HEAD:
245 files / 4987 tests. Visual pass clean at 1280 and 1024 in both themes, console clean in all
four, with the Submit and Clear controls captured both empty and holding three named notes. Full
record in `runs/2026-09-06-2/prove.md`.

### Previous run's metric verdict

**2 events, both scoring zero.** `2026-09-06-1` declared `PersistedDrumsHistory.attempts` against
a baseline of "0 events, newly instrumented". Read live from IndexedDB `settings.drumsHistory` at
the close of this run:

```
2026-09-06T17:13:14.654Z  quarter-note-rock  80bpm  kick 0 of 4 | hhClosed 0 of 8 | snare 0 of 4
2026-09-06T17:14:47.948Z  quarter-note-rock  80bpm  kick 0 of 4 | hhClosed 0 of 8 | snare 0 of 4
```

Both predate that run's revert, and both are the same groove, so by its own counting rule there
is exactly one first-ever attempt and it scored 0 of 16 pads. The instrumentation works; the
feature it was instrumented to measure was reverted whole, so the number says nothing about
whether showing the groove helps. **What it means for the next pick:** the drums metric is still
unanswered and will stay unanswered until DR-05 is rebuilt, so a drums run should not declare a
new metric before it settles this one.

### Cannot-sense register

none this run

### Next steps

- `T.39` — a cadence refusal names notes but never the rule; this run's only unfixed panel finding.
- `T.36` — repertoire play discards every dynamic; raw ledger leader at 10, deferred twice by the thread rule, nothing left to defer it.
- `T.35` — Today's session reads neither the onboarding goal nor the persisted level.
- `T.37` — the theory drill's typing hint offers a range that cannot answer its own prompt.
- `T.30` — the drums key draws notehead shape and not staff position; the standing blocker on rebuilding DR-05, without which the drums metric above stays unanswered.
- `T.24` — the same accidental spelled two ways two lines apart, still open from `2026-08-24-1`; and `ROADMAP.md` is at 93% of its 28000-token budget, so the next run that touches it should expect a compress pass.

## Run 2026-09-06-1

- **Persona:** Rusty returner — played a kit in a school band, back on an e-drum pad this month, whose goal is to read and play a printed rock groove at 80 bpm without being told it first (drums)
- **Tier:** L
- **Pick source:** 1d
- **Pick gap:** The Groove trainer never shows the pattern — no notation, no grid, no count; the learner must already know the groove by name, and the DR-05 gallery is a stub saying so
- **Previous pick source:** 1c
- **Class:** VOID
- **Claim:** After this ships, a learner who is on the Groove trainer and does not already know the selected groove will be able to read the pattern off the screen before they play it — which limb plays on which eighth, and where the hi-hat opens — and we will know because the Groove trainer screen shows a percussion staff for the selected groove, and a first attempt played from nothing but what that screen shows scores every pad n of n, where the same learner playing the other standard reading of the title `Money Beat (Open Hat)` scored `Open hi-hat — 0 of 2, 2 missed, 2 extra` (drive D8).
- **Refutation condition:** Read the rendered staff and only the staff — a notehead's pad from (vertical position, glyph shape), its instant from the drawn count row, the amount of music from the drawn `×N` — convert to milliseconds at the run's own tempo, play exactly that through the real pads, and demand every pad reports n of n. Nothing read from `referenceGrooves.ts`, from `planGrooveRun`, or from the grader. If the staff and the grader disagree on any groove the picker offers, the claim is false.
- **Metric:** PersistedDrumsHistory.attempts
- **Baseline:** 0 events, newly instrumented

  *On the Metric field.* The checker takes a bare declared field, so the counting rule cannot
  live on that line: read `attempts` as each `DrumsGrooveAttempt.pads[].matched` against its
  own `.expected`, on a FIRST-EVER attempt at a groove the learner does not already know by
  name — not the raw attempt count, which grows whenever the trainer is opened. Measured at
  the drive as
  `Open hi-hat — 0 of 2, 2 missed, 2 extra` (D8, driver drift 14.3 ms) against `2 of 2` for
  the other standard reading of the same title (D7, drift 12.3 ms).
- **Endorsement:** no
- **Outcome:** abort

### Ledger

| Gap | Source | Class | Blocked | Reach | Teacherliness | Unmatchable | Sum | Cost |
|---|---|---|---|---|---|---|---|---|
| The Groove trainer never shows the pattern — no notation, no grid, no count; the learner must already know the groove by name, and the DR-05 gallery is a stub saying so | 1d | VOID | 3 | 3 | 3 | 1 | 10 | L |
| Rudiments — single strokes, double strokes, paradiddles (Rockschool Groups A-C) have no drill | 1d | VOID | 2 | 3 | 3 | 1 | 9 | M |
| Fills (Group D) and Ear Test 1 fill playback — no toms, no fill drill | 1d | VOID | 2 | 2 | 3 | 2 | 9 | L |
| Three grooves, all one bar of straight-eighth rock — no fill, tom, ride, crash, sixteenths or other metre | 1b | THIN | 2 | 3 | 2 | 1 | 8 | M |
| 100 drums attempts persist with per-pad offsets; only the latest renders, and drums has no Progress screen | 1c | BLIND | 1 | 3 | 2 | 2 | 8 | S |
| Velocity: ghost/accent exist in core with zero importers; pads carry no velocity, so dynamics cannot be produced or graded | 1e | BLIND | 1 | 2 | 3 | 2 | 8 | M |

Leader G1 at 10, runner-up at 9, leader-gap 1. Rule checks: no harm gate fires; no prerequisite
is itself a ledger row; `prevPickSource` is `1c` and this pick is `1d`, so continue-then-rotate
is satisfied; the previous drums run's thread `drums-groove-then-velocity` was closed abandoned,
so no continuation binds; the pick is VOID, so the innovation quota is satisfied; this is drums
run 2, so the every-fourth-run register cadence does not fire. **VOID forces tier L.**

### Interview

no answer this run

The four questions were posted in chat at the top of the run, before any other source was read,
and nothing arrived before §2. Nothing was simulated in their place. The method's fallback — the
newest unstruck row of the standing Learner-said register — is a piano-side answer about review
scheduling (2026-08-24: "focus on having 'flashcard' review styled learning."), and the
persona rotation binds this run to drums, so it was carried into §2 as context and could not
select the pick. Verbatim in `runs/2026-09-06-1/interview.md`.

### Orphan signals

12 rows shown, 198 suppressed by the top-12 cap, all age 3. The HIGH rows, verbatim in
`runs/2026-09-06-1/orphan-signals.txt`: `TheoryQuizItem.answerSummary` (A, `theory.ts:114`),
`MidiControlChange.controller` (B, `midi.ts:37`), `ScoreNoteInput.velocity ?? DEFAULT_VELOCITY`
(D, `score.ts:163`), `EarSessionState.cards` (A, `session.ts:107`), `MidiPolyAftertouch.pressure`
(B, `midi.ts:50`), `EarItem.contextKey` (A, `item.ts:86`), `Tuplet.actual` (B, `tuplet.ts:21`),
`EarItem.contextTonicMidi` (A, `item.ts:56`), `PersistedAnnotations.byScoreId` (B,
`persistedShapes.ts:56`), `AssessmentResult.counts` (A, `assessment.ts:70`); two LOW rows on
`ScoreNote.durationTicks` and `MidiSustain.down`. Every one is piano-side, so none could select a
drums pick; the drums-side orphan this run did score is the velocity row in the ledger table above.

### Panel

Four seats — Skeptic (Opus high), Regression hunter (Sonnet), Teacher (Opus), Rival (Opus high) —
three rounds, prompts rendered from `docs/panel/` with the template hash unchanged across all
three. Every report verbatim in `runs/2026-09-06-1/panel-r{1,2,3}-<role>.md`.

| Round | BLOCKER | MAJOR | MINOR | Answered by |
|---|---|---|---|---|
| 1 | 1 | 9 | 15 | `00999cd` |
| 2 | 2 | 8 | 20 | `d765c31` |
| 3 | 1 | 9 | 26 | — (abort) |

**Round 1** — the Skeptic's BLOCKER killed the run's own refutation condition: with `relYOf`
stubbed to `return 1.5`, every notehead in every groove drew on one line and the spec still
reported `4 passed`, exit 0, because it compared `data-note-id` against the model those ids came
from. The condition was replaced with one that reads the drawing — position, glyph shape, the
count row, the drawn `×N` — and re-proved on the sabotaged tree. That replacement is the reason
the spec is kept in its round-1 form and not reverted with the code.

**Round 2** — three seats found the same root cause independently by instrumenting
`AudioContext` in the live page: a Listen preview of `Money Beat (Open Hat)` scheduled audio
byte-identical to a preview of `Money Beat`, because `hhOpen` and `hhClosed` shared pitch 88 and
a 60 ms ring. Two more: the preview played one bar while the staff drew `×2`, and the result
panel kept a verdict and a per-pad score under a groove it had never graded.

**Round 3** — all four seats independently re-ran the round-2 repros and confirmed all three
fixes. The Skeptic re-adjudicated the replaced condition with a new sabotage on the horizontal
axis (every notehead drawn one eighth right): `3 failed, 1 passed`, exit 1, against `4 passed`,
exit 0 on the built tree — `CONDITION: SOUND`. It still returned `VERDICT: REFUTED` and the
Teacher `ENDORSE: NO`, on defects the round-2 fix commit introduced:

- **Teacher, BLOCKER** — Listen encodes "open" as a pitch a minor third ABOVE the closed hat.
  Musically false: an open hi-hat is one instrument with the damping removed, not a higher second
  one, and the tone proxy is disclosed nowhere on screen. `gmNoteOf`, which does separate 42 from
  46, still reaches no audio path. Filed as `T.32`.
- **Skeptic MAJOR / Teacher MAJOR / Hunter MINOR / Rival MINOR** — the `resultPlanRef` gate
  un-hides (cycling back to the same groove resurrects the identical verdict with no run played)
  and fires on tempo changes (one click of Slower deletes the per-limb sentences at the moment
  the learner is acting on them). Filed as `T.31`, with the shape all four converged on.
- **All four seats** — `OPEN_TONE_MS`'s own comment checks the wrong bound: `MIN_BPM` is 40, not
  the 80 it calls the floor; the binding case is `MAX_BPM` 200; and the audible voice is
  `padToneMs + RELEASE_S` = 490 ms, not 240, which at 200 bpm covers the next three strokes.
  Folded into `T.32`.
- **Rival** — the same commit silently widened the LEARNER's own pad confirmation tone, so an
  open-hat pad press rings 490 ms against every other pad's 310 ms, breaking `PAD_TONE_MS`'s
  stated "sixteenths at 200 bpm do not blur" invariant. Same shape as the round-2 BLOCKER,
  mirrored. Folded into `T.32`.
- **Regression hunter, MAJOR** — `e2e/improve-DR-09.spec.ts` had been RED at HEAD since the slice
  `64de051`, which added a second, wrong statement of the pad-to-key mapping ("K the open hat" on
  grooves with no open-hat pad). Re-verified independently: `1 failed, 182 passed` over the whole
  e2e suite at the slice HEAD. It shipped because `npm run verify` is `check:* + typecheck + lint
  + test:all` and never invokes Playwright — which is `T.18`, still open. **Closed by the
  revert:** `4 passed` on the reverted tree.

The standing cross-seat consensus that outlives the revert is written into `T.30` for whoever
rebuilds: chiefly that the drum key draws notehead SHAPE only, so snare and kick are
byte-identical ellipses in the legend, and a reading with those two swapped scores
`0 of 4, 4 missed, 4 extra` on both limbs.

### Proof

- **RED at the spec commit.** In a detached worktree at `46cec4c`, on `E2E_PORT=5471`:
  `4 failed`, `EXIT=1` (`runs/2026-09-06-1/prove/red-as-committed.txt`). The replaced,
  non-void spec run against the same tree on `E2E_PORT=5472`: `4 failed`, `EXIT=1`
  (`prove/red-head-spec.txt`) — so the condition that actually guards the claim is red at the
  spec commit too, not only the one that was later proved void.
- **GREEN at the implementation HEAD.** `E2E_PORT=5473`, `d765c31`: `4 passed (12.9s)`,
  `EXIT=0` (`prove/green-head.txt`).
- **The refutation condition, run.** It is those four tests. On `d765c31` every pad reported
  n of n on all three grooves the picker offers, played from nothing but the drawing, with worst
  driver drift under 25 ms. The staff and the grader agreed.
- **Held-out goal — a groove that is not in 4/4.** Amended at §4 and recorded there rather than
  quietly swapped: the goal written at §3 was `ghostFunkBar`, and the geometry builder's brief
  then named it as a required example, so it stopped being held out. The replacement was a 3/4
  waltz — kick on 1, snare on 2 and 3, hi-hat on every eighth — added as CONTENT only. Result:
  `src/core/drums/engrave/staff.ts` untouched in the diff (`prove/heldout-waltz.diff`, one file
  changed), and the gallery drew the time signature `3/4`, a count row reading exactly
  `1 & 2 & 3 &`, six hi-hat crosses at even 2.2-space spacing, the kick in the bottom space on
  beat 1 and the snare in the third space on 2 and 3, in a bar 372 px wide with zero horizontal
  overflow — identical at 1280 and 1024, dark and light
  (`prove/waltz-gallery.json`, `prove/vp-waltz/*.png`). The aria-label read
  "Waltz Groove in 3/4. Kick: 1. Snare: 2, 3. Hi-hat: every eighth." The renderer generalised.
  The only breakage was two hard-coded `toHaveLength(4)` counts in
  `referenceGrooves.test.ts:20` and `musicxml/roundTrip.test.ts:47`; no geometry test moved.
- **Adaptivity claims:** n/a. This slice makes no adaptivity claim — it renders one authored
  score per groove, with no branch on learner state.
- **Experience gate at the implementation HEAD.** `npm run verify` green: 250 files, 5045 tests.
  Whole e2e suite: `1 failed, 182 passed` — the DR-09 regression above, which is the finding, not
  a flake. Visual pass on Groove at both widths and both themes, console clean.
- **Experience gate after the revert.** `npm run verify` green: 244 files, 4944 tests
  (`prove/verify-after-revert.txt`). Visual pass on Groove: four screenshots, console clean in all
  four, receipt written. `e2e/improve-DR-09.spec.ts` `4 passed`; `e2e/improve-DR-05.spec.ts`
  `4 failed, EXIT=1` — the durable red artefact this abort keeps.
- **Ledger correction, disclosed.** The round-3 Skeptic `panel` event was first recorded with
  `minors: 10` where the report carries 11 (`grep -c "^MINOR "`). The last line of
  `runs/ledger.ndjson` was corrected in place before it was ever committed, and
  `improve-run.mjs audit` re-run clean. It is the only in-place edit this run made to the ledger.

### Previous run's metric verdict

**none.** Run 2026-08-24-1 declared `PersistedFlashcards.cardsById`, counted as stored cards with
`lapses >= 1 && reps >= 1`, at a baseline of 0. That run's own hand-off predicted this reading:
the rotation sends the next run to drums, and no piano session ran between the two. Every arm of
this run's §1c drive used a cold profile with IndexedDB empty at the start, so the store this
metric reads has no card that has been missed and re-learned — it would read 0 by construction,
which is not a reading. Recorded as `verdict --none`. Two piano runs now stand unresolved, and
the next piano run inherits an unread metric rather than a number.

### Cannot-sense register

Added — **whether a learner can READ a chart, or has only memorised the grooves the trainer offers** (screen: Groove trainer, its result panel) — **OURS**, because `useDrumsHistoryStore` already records every attempt with its `grooveId`, so which grooves this learner has met before is on disk, and `gradeGrooveRun` never sees it: a first-sight reading and a fourth rehearsal of the same bar produce the same per-pad numbers. This run's entire claim was about the first of those two and it had no way to tell them apart. Countability challenge in the standing table.

### Next steps

- **The gate that let this run's own regression ship.** `T.18` — `npm run verify` has no e2e step, so `e2e/improve-DR-09.spec.ts` sat red at HEAD for two commits and three panel rounds before a seat found it by hand. It is the cheapest row here and it is why the next run cannot trust a green `verify` either.
- **The cheapest learner-facing lie on the drums side.** `T.31` — the Groove trainer keeps a graded marking under a groove and a tempo it never graded, driven and reproduced on the current tree. Pre-dates DR-05 and survives its revert, so it is fixable without rebuilding anything.
- **The wrong musical fact.** `T.32` — the open and the closed hi-hat share one voice, so the trainer cannot say "open" in sound, and `gmNoteOf` reaches no audio path at all. Four seats converged on the shape of the fix: release the open hat at the next hi-hat event, not on a wall-clock constant.
- **The baseline this run measured, still unfixed.** `T.33` — a wrong hi-hat articulation is graded as a miss plus an extra and named as neither. `Open hi-hat — 0 of 2, 2 missed, 2 extra` is the drive's own D8 line.
- **One invariant, cheap.** `T.34` — `validateGrooveScore` accepts an `hhOpen` note with no `open` articulation, so authored content is one omission away from a groove that is open in the model and closed on the page.
- **The rebuild.** `T.30` — DR-05 itself, with the spec kept RED and proved sound, the held-out 3/4 result showing the geometry generalises, and the panel's standing consensus written into the row. Largest of these and the one a learner feels most; a run of its own.
- **Before the next `/improve-app` can `start`:** the rotation sends the next run to piano, which inherits `PersistedFlashcards.cardsById` still at 0 — two runs now with no metric reading. It needs a real piano session in the running app before `verdict` can say anything, and `T.22` (three of four level-1 decks exhausted inside a minute) is why one session may still not produce one.

## Run 2026-08-24-1

- **Persona:** Rusty returner — played to about RCM Level 2 as a teenager, back at the keyboard this month, whose week's goal is to read a new elementary piece without stopping to work out the notes (piano)
- **Tier:** M
- **Pick source:** 1c
- **Pick gap:** A wrong flashcard or theory answer is never told what the right answer was. `FlashcardScreen.tsx:127` renders exactly `'Correct'` or `'Not quite — it comes back for review'`; `TheoryDrillPanel.tsx:172` the same. `card.answer` exists for all four kinds and dies at `GradeResult = { correct, grade }` (`flashcards.ts:277`). Ear training, one directory away, already names it (`EarTrainingScreen.tsx:478`).
- **Previous pick source:** 1d
- **Class:** BLIND
- **Claim:** After this ships, a learner who answers a flashcard or theory-drill question wrongly will be able to see what the right answer was, against the question that produced the error, and we will know because the Flashcards screen, on a wrong answer, keeps the missed card on the staff and shows a feedback line naming that card's own correct note (for example "Not quite — that was F3") with the matching key marked on the on-screen keyboard, until the learner presses Next.
- **Refutation condition:** Four arms in `e2e/improve-flashcard-answer-reveal.spec.ts`, all driven in the running app, all with the expected answer computed in the spec from the seeded card id rather than read out of the app. (1) One card due (`staff-to-key-64`), answered wrongly: the feedback names E4 and the staff still carries the `data-step` it had before the answer. (2) A different card due (`staff-to-key-60`): the feedback names C4 and must not contain E4, so a literal or a reveal naming the played note dies. (3) A correct answer reveals nothing and moves on, so a screen that always shows the answer dies. (4) The class, not the instance: the theory drill, deep-linked to `build-scale` level 1 (one scale type, one key signature, so the item is C major every run), answered one degree at a time — a correct degree draws no verdict at all, a wrong one names all eight notes, and the prompt is held with the keys live under the reveal.
- **Metric:** PersistedFlashcards.cardsById
- **Baseline:** 0

  *On the Metric field.* The checker takes a bare declared field, so the counting rule cannot
  live on that line: read `cardsById` as the stored cards with `lapses >= 1 && reps >= 1` —
  the recover-after-error the citation's mechanism predicts, not the raw card count, which
  grows whenever a deck is opened and would read as progress on its own.
- **Endorsement:** no
- **Outcome:** shipped-not-clean

### Ledger

| Gap | Source | Class | Blocked | Reach | Teacherliness | Unmatchable | Sum | Cost |
|---|---|---|---|---|---|---|---|---|
| A wrong flashcard or theory answer is never told what the right answer was. `FlashcardScreen.tsx:127` renders exactly `'Correct'` or `'Not quite — it comes back for review'`; `TheoryDrillPanel.tsx:172` the same. `card.answer` exists for all four kinds and dies at `GradeResult = { correct, grade }` (`flashcards.ts:277`). Ear training, one directory away, already names it (`EarTrainingScreen.tsx:478`). | 1c | BLIND | 2 | 3 | 3 | 1 | 9 | M |
| Hit velocity reaches no learner-visible output on either instrument — `velocityClassOf()` classifies accent/normal/ghost and nothing calls it (carried from run 2026-08-21-1, rescored for this persona) | 1e | BLIND | 0 | 1 | 2 | 2 | 5 +3 | M |
| The level-1 decks are 9 / 9 / 3 / 20 cards, so three of the four are exhausted in under a minute against a 6-minute Today's-session flashcard segment | 1c | THIN | 1 | 3 | 2 | 1 | 7 | M |
| An exhausted deck renders "No cards at this level yet — try a lower level or a different drill." at level 1, with 9 cards in the store — one string for two different states (`FlashcardScreen.tsx:213`) | 1c | BLIND | 1 | 3 | 2 | 0 | 6 | S |
| RCM L1 lets a candidate sing or hum the interval instead of identifying it; nothing on the piano side accepts sung input, while `core/audio/pitchDetection.ts` sits unused by any drill | 1d | VOID | 1 | 1 | 2 | 2 | 6 | L |
| `EarSessionState.cards` is carried into `earTrainingMilestone()` and never read | 1e | BLIND | 0 | 1 | 1 | 1 | 3 +3 | S |
| `PersistedAnnotations.byScoreId` is persisted and matched by no `.tsx` under `src/app/**` — score annotations survive a reload and reach no screen | 1e | BLIND | 1 | 1 | 1 | 0 | 3 +3 | M |

Leader G1 at 9, runner-up G7 at 8. Full table with the raw/age split and the four notes it
cannot carry — the G7 rescore that moves G1 into the lead, why HARMFUL was available for G1
and refused, the rotation check, and a HIGH-confidence orphan-signals row this run did not
believe (`Card.ease`, which `scheduler.ts:181` does read) — is `runs/2026-08-24-1/ledger.md`.
G2 and G3 are now `T.21` and `T.22` in `ROADMAP.md`.

### Interview

no answer this run

The four questions were posted at §1a and no answer arrived before §2. What the learner did
say, verbatim, in the turn that invoked the command:

> focus on having "flashcard" review styled learning.

That is a steer on the pick, not an answer to any of the four questions. It narrowed the
search and was not allowed to substitute for evidence: every ledger row carries its own
source. It is the first row of the Learner-said table above.

### Orphan signals

```
A  EarSessionState.cards                        src/core/eartraining/session.ts:107  HIGH  age 3
B  Tuplet.actual                                src/core/notation/tuplet.ts:21       HIGH  age 3
D  ScoreNoteInput.velocity ?? DEFAULT_VELOCITY  src/core/notation/score.ts:163       HIGH  age 3
A  EarItem.contextKey                           src/core/eartraining/item.ts:86      HIGH  age 3
B  PersistedAnnotations.byScoreId               src/app/state/persistedShapes.ts:56  HIGH  age 3
A  EarItem.contextTonicMidi                     src/core/eartraining/item.ts:56      HIGH  age 3
B  EarTrainingSnapshot.itemsById                src/core/progress/export.ts:172      HIGH  age 3
A  AssessmentResult.counts                      src/core/practice/assessment.ts:70   HIGH  age 3
B  PersistedInstrument.lastInstrument           src/app/state/persistedShapes.ts:90  HIGH  age 3
A  Card.ease                                    src/core/srs/scheduler.ts:65         HIGH  age 3   (false positive — see ledger.md)
A  MatchResult.expected -> ScoreNote.durationTicks  src/core/notation/score.ts:60    LOW   age 3
B  MidiSustain.down                             src/core/ports/midi.ts:24            LOW   age 3
[C] no findings
```

Every row is age 3: the scan has reported the same set since run 2026-08-20-1 and no run has
closed one. Two of them are ledger rows this run scored (G5, G6) and did not pick.

### Panel

Tier M: Skeptic (Opus, high effort), Regression hunter (Sonnet), Teacher (Opus). Two rounds —
M's re-panel cap. Verbatim reports in `runs/2026-08-24-1/panel-r{1,2}-<seat>.md`.

**Round 1 — 7 BLOCKER, 1 MAJOR, 4 MINOR.** Every BLOCKER and the MAJOR fixed in `9e09ef1`.

| # | Seat(s) | Finding | Disposition |
|---|---|---|---|
| 1 | all three | `TheoryDrillPanel` rendered `gradeTheoryStep`'s not-yet-settled result, so one **correct** press of a multi-group item printed "Not quite — <the whole answer>" | fixed — `handleNote` returns on `!result.done` |
| 2 | Skeptic, Teacher ×2 | `describeTheoryAnswer` re-spelled the answer from MIDI with `fromMidi`'s sharp table: F major named with A♯, a minor third above C as D♯ | fixed — `TheoryQuizItem.spelledAnswer`, with `answer` projected from it |
| 3 | Skeptic (duty 0a) | the claim spec's class arm passed against sabotaged code — one press of C3 matched the C major tonic by pitch class and was satisfied by finding 1's leak | fixed — arm rewritten against `/theory/build-scale/1`, one degree at a time |
| 4 | Teacher | neither reveal let the learner **play** the correction: `<fieldset disabled>` on Flashcards, `disabled={revealed}` on Theory, so the drill trained reading a marked rectangle and pressing Next | fixed — keys stay live, ungraded; three-state practice line and a counted echo |
| 5 | Skeptic | "Correct — graded good" kept the SRS jargon the wrong-answer copy had dropped | fixed — reads "Correct" |
| 6 | Regression hunter | the claim spec never exercised `gradeTheoryStep`'s `!done` branch | fixed by 3 |
| 7 | Teacher | the reveal names the whole answer, never **which** note was wrong, though `matchedGroups` is computed | deferred → `T.19` |
| 8 | Teacher | the flashcard reveal's black-key vocabulary is sharps only, in every key | deferred → `T.20` |

**Round 2 — 0 BLOCKER, 4 MAJOR, 7 MINOR.** The BLOCKER count fell 7 → 0. Round 2 is the cap,
and one MAJOR is unresolved, so this is **not clean**.

| # | Seat(s) | Finding | Disposition |
|---|---|---|---|
| 9 | Skeptic, Teacher | the echo shipped in `9e09ef1` matched by **exact MIDI at an exact index** while the grader matches by pitch class, order-free per group — a complete C major scale played an octave up counted "0 of 8" while the same keys graded "Correct"; an F major chord entered top-note-first stalled at "2 of 3" | fixed in `213044e` — `src/core/drills/theoryEcho.ts` matches the way `groupsMatch` does |
| 10 | Teacher | `name-key-signature` asks for a **count** of accidentals and revealed only a note: "How many flats has Bb major?" → "it was B♭4", with the number nowhere on screen | fixed in `213044e` — `answerSummary`, "2 flats, tonic B♭4" |
| 11 | Skeptic, Hunter, Teacher | a press the echo refuses is completely silent, while the flashcard sibling shipped in the same commit answers the same event | fixed in `213044e` — "Not that one — still 1 of 8" |
| 12 | Skeptic | the echo's only e2e cover was one press of its first target: replacing the body with an unconditional counter left the arm green | fixed in `213044e` — the arm now presses a note the echo must refuse and asserts the count holds, then presses the answer an octave away and asserts it moves |
| 13 | Teacher | **every** perfect authentic cadence the drill draws is voiced with its leading tone falling a fifth to the third of the tonic chord | **unresolved** → `T.23`. Pre-existing: `git show 85df305` has identical voicing semantics, and the fix belongs in `finalChordPitches`, not in the reveal that prints it |
| 14 | Skeptic | 73 of 770 items name a note above `KEYBOARD_HIGH` | half-answered — pitch-class matching makes them playable back and gradeable; the printed name is still off-keyboard → `T.25` |
| 15 | Teacher | the prompt says "Play Bb major" and the verdict beneath it says "B♭4" | deferred → `T.24` — `scaleName`/`keyName` are ASCII app-wide, so it is a cross-screen slice |
| 16 | Teacher | the flashcard reveal rings the correct key **before** the learner has produced it, so the practice press is copied off the ring rather than read off the staff | **not changed, by design.** The ring is the answer to the run's own claim — the correction has to be visible against the question that produced it, and a reveal that withholds it until a second wrong press is a different feature. What the seat is really naming is that this app cannot tell reading from copying at all; it is filed as this run's cannot-sense row instead |

### Proof

- **RED at the spec commit.** `31a3a99` checked out detached in an isolated worktree with
  `node_modules` linked, HEAD's spec copied in over it, `E2E_PORT=5401`: **3 failed, 1 passed,
  exit 1**. Log: `runs/2026-08-24-1/red-at-spec-commit.txt`. The one that passes is arm 3, which
  asserts an absence ("a correct answer reveals nothing") and is true of the unbuilt app too —
  that is what arms 1, 2 and 4 are for. Every port in this run is explicit and unique, per T.18.
- **GREEN on HEAD.** `E2E_PORT=5402`, **4 passed, exit 0**. Log:
  `runs/2026-08-24-1/green-at-head.txt`.
- **Refutation condition:** run, not refuted. The Skeptic seat adjudicated it SOUND at both
  rounds and returned `NOT REFUTED` at round 2 — with the note that the play-back counter added
  to answer round 1's MAJOR was stricter than the grader it reported on, which is finding 9 and
  is fixed.
- **Experience gate.** `npm run verify` green at every commit (4848 tests). `npm run test:e2e`
  at HEAD: **177 passed, 1 failed** — `osmd-teardown.spec.ts`, which passes alone in 49.2s
  against a 60s timeout and only fails under full-suite parallel load; filed as `T.26`.
  Two real regressions the e2e suite caught and `verify` did not, both this run's own copy
  changes, fixed in `b7f9282`: `theory-quiz-routing` and `acceptance-m3` were still pinned to
  the strings finding 5 and the reveal replaced. That is `T.18` charging rent for the second
  run running. Visual pass clean at 1280/1024 × dark/light on Flashcards (default) and Theory
  (driven into the reveal with a refused echo press), console clean in all four configurations
  each time; receipt `visual-pass/receipt.json`. **States**: empty (a level with no due card)
  and no-MIDI (every drive here is the on-screen keyboard) both exercised; loading and error
  are N/A — both screens are synchronous over an in-memory store. **Perf**: N/A, nothing on
  the score-rendering or playback path is touched. `verify:full` is red on `knip:prod:all`,
  pre-existing since `d6e1af9` and confirmed at that commit; filed as `T.27`.

### Previous run's metric verdict

**none.** Run 2026-08-21-1 declared `attempts` and its own entry records the metric as **void**:
the type it named existed only between `de2de98` and the revert `a9e87a8`, and the bare name
resolves through `PersistedTechniqueHistory.attempts`, a different feature. There is nothing to
read, so this run recorded `verdict --none`. It changes nothing about this pick — that run was
drums and an abort, this one is piano and source 1c — but it does mean two consecutive runs have
produced no metric reading, and the next drums run inherits `T.7`, not a number.

### Cannot-sense register

**Whether a learner read the note or copied the marked key** (screen: Flashcards) — PHYSICAL, no sensor in this rig reports where the learner looked, and this run's own reveal rings the correct key while the staff still shows the question, which is what the Teacher seat named at finding 16. Countability challenge: press latency — a note read off the staff carries a reading cost that scales with how unfamiliar the note is, and a key copied off a highlight does not; it stands in if presses made while a key is marked cluster at a shorter latency that is flat across note difficulty, while presses made with nothing marked do not. Until then the flashcard reveal cannot tell the two apart, and `T.20`'s deck-key work is the first place it would show.

### Next steps

- **Repair the gate first.** `T.27` is the cheapest row on this list and the most expensive to leave: `verify:full` exits at `knip:prod:all`, so it never reaches `test:e2e`, which is the whole point of `T.18`. Five findings, each a deletion or a recorded reason. Until it is green every future run's session gate stops one step short and nobody is told.
- **Then the flake.** `T.26` is the only spec in the suite whose pass depends on how many others are running. An 11-second margin under variable load will fail again in the run after next, and it will look like a real regression when it does.
- **Cheapest learner-facing lie.** `T.21` — a level with nine cards all scheduled forward says "No cards at this level yet, try a lower level" to a learner who has just answered everything right. One string, two states, and the advice is wrong for the common one.
- **Finish what this run started.** `T.19` names *which* note was wrong; `gradeTheoryStep` already computes `matchedGroups` and the panel throws it away. It is a rendering decision on a value that exists, and it is the other half of the reveal this run shipped.
- **The unresolved MAJOR.** `T.23` — every perfect authentic cadence the drill draws voices its leading tone falling a fifth. It is pre-existing and it is a harmony defect, so it wants a property test over `finalChordPitches` for every key and cadence type, not an example fix in the reveal.
- **Then the spelling and range work**, in this order: `T.25` (73 of 770 items name notes the keyboard does not draw), `T.20` (sharps-only vocabulary in flat keys), `T.24` (ASCII `Bb` above glyph `B♭`, two lines apart, and cross-screen).
- **Largest, and the one a learner feels most.** `T.22` — level-1 decks of 9 / 9 / 3 / 20 cards against a 6-minute flashcard segment. Content and generator work, so it is a run of its own rather than a slice.
- **Before the next `/improve-app` can `start`:** this run's metric needs a reading, and `PersistedFlashcards.cardsById` stays at its baseline of 0 until a card is actually missed and re-learned in the running app. `T.22` is why a single session may not produce one. The next run is drums-bound by the persona rotation, so it inherits `T.7`, not this number.

## Run 2026-08-21-1

- **Persona:** Total beginner, no e-kit, wants to play a rock beat with hats on eighths at 80 bpm for a minute (drums)
- **Tier:** L
- **Pick source:** 1d
- **Pick gap:** A drums learner cannot practise a groove at all — the whole drums surface is a "coming soon" placeholder, while moneyBeat() encodes Rockschool Debut's own backbeat and is read only by a MusicXML round-trip test
- **Previous pick source:** 1d
- **Class:** VOID
- **Claim:** After this ships, a learner who is on the drums side of the app with no e-kit and no drum experience will be able to practise the Rockschool Debut rock groove — closed hi-hat on every eighth, kick on 1 and 3, snare on 2 and 4 — at their own tempo and be told which limb was off, and we will know because the learner sees a "Groove" destination in the drums nav where there was none, plays the money beat on the three pads, and the screen then shows one result line per pad naming that pad's own mean offset in milliseconds (for example "Hi-hat — 16 of 16, 12 ms late"), which is still shown as the last attempt when they come back to the screen.
- **Refutation condition:** Two-armed at 80 bpm with all 24 hit instants hardcoded in the spec, so nothing is read out of the app's own score and a grader that agrees with itself cannot pass. Positive arm: hi-hat at 0/375/750/1125/1500/1875/2250/2625 ms, kick at 0 and 1500, snare at 750 and 2250, bar two the same plus 3000 — must grade clean, show 16 of 16 hi-hat, 4 of 4 snare, 4 of 4 kick, and persist an attempt that survives a reload. Negative arm: the same 24 instants and the same per-pad counts with the snare hits moved to 0 and 1500 and the kicks to 750 and 2250 — must not grade clean, and the snare line must read "Snare — 0 of 4" with its notes missed. Onset spacing is identical between the arms, so a grader that only measures spacing returns the same verdict for both and is caught — the failure mode that voided run 2026-08-20-1's condition.
- **Metric:** attempts
- **Baseline:** 0 events, newly instrumented
- **Endorsement:** no
- **Outcome:** abort
- **Thread:** drums-groove-then-velocity, run 1 of 2

  *On the Metric field.* §3 declared it as `PersistedDrumsHistory.attempts`. That type existed
  only between `de2de98` and the revert `a9e87a8` and is gone from `persistedShapes.ts`, so the
  name `check-improve-log.mjs` accepts is the bare `attempts` — which resolves through
  `PersistedTechniqueHistory.attempts`, a **different feature**. The metric is therefore void and
  the next run must not read it. The checker cannot currently express "the type this metric named
  was reverted"; that hole is real and is filed in the retro, not papered over here.

  *On the Thread field.* The §2 pick was a **prerequisites-win** redirect (`method.md` rule 2):
  the ledger leader is G5 at 11, G5 needs a hit to grade, its prerequisite G1 is itself a ledger
  row, so the ranking took the upstream row at 10. `method.md` says such a thread declares its
  payoff at run 1 with a cap of prereq-count plus one — here payoff G5, one prerequisite, cap 2.
  **The pick event recorded `thread: "none"` and no `--payoff`**, so `runs/ledger.ndjson` does not
  carry the thread this line names. That is a §2 defect of this run, disclosed rather than hidden;
  the thread is closed as abandoned in the same ledger at §8.

### Ledger

| Gap | Source | Class | Blocked | Reach | Teacherliness | Unmatchable | Sum | Cost |
|---|---|---|---|---|---|---|---|---|
| Hit velocity reaches no learner-visible output on either instrument — velocityClassOf() already turns a velocity into accent / normal / ghost and nothing calls it, so the app cannot tell a ghost note from an accent | 1e | BLIND | 1 | 3 | 3 | 1 | 8 +3 | M |
| A drums learner cannot practise a groove at all — the whole drums surface is a "coming soon" placeholder, while moneyBeat() encodes Rockschool Debut's own backbeat and is read only by a MusicXML round-trip test | 1d | VOID | 3 | 3 | 3 | 1 | 10 | L |
| Debut's Fill Playback ear test — one bar of snare fill, quarters and eighths, heard twice then reproduced — has no surface; clapback.ts grades exactly this shape and is wired to the piano side only | 1d | VOID | 2 | 2 | 2 | 1 | 7 | M |
| First-run setup cannot represent a drums learner: three experience options and four goals, every one piano-phrased, and OnboardingGateway renders only inside the piano Today route | 1c | MIS-GATED | 1 | 2 | 2 | 1 | 6 | S |
| The two things nearest the persona's goal are filed under the other instrument: DRUMS_NAV_GROUPS is empty, so Metronome and Rhythm need a switch back to Piano, and Rhythm is hard-locked to 120 bpm so the 80 bpm goal is unreachable there in principle | 1c | MIS-GATED | 2 | 2 | 1 | 1 | 6 | S |

Full table with the raw/age split: `runs/2026-08-21-1/ledger.md`. It carries a sixth row, `P1` —
the ten piano 1e rows from run 2026-08-20-1, carried unscored at age 3 because rule 3 binds this
run's pick to the persona's instrument. It has no axis scores, so it is not reproduced above.

### Interview

no answer this run

The four questions were posted at §1a and no answer arrived before §8. `no answer this run` is the
only permitted substitute and no answer was simulated. The Learner-said table is still empty, so
there were no prior verbatim rows to fall back to either.

### Orphan signals

Captured verbatim to `runs/2026-08-21-1/orphan-signals.txt` (8 rows shown under the top-N cap;
`orphan-signals-all.txt` holds every finding). The `evidence` column is long enough to swamp this
entry, so it lives in those files; the identifying columns are reproduced here unaltered:

```
scan  signal                                           declared at                          confidence  age
[C] no findings
A     EarSessionState.cards                            src/core/eartraining/session.ts:107  HIGH        3
B     PersistedAnnotations.byScoreId                   src/app/state/persistedShapes.ts:56  HIGH        3
D     ScoreNoteInput.velocity ?? DEFAULT_VELOCITY      src/core/notation/score.ts:163       HIGH        3
A     EarItem.contextKey                               src/core/eartraining/item.ts:86      HIGH        3
B     EarTrainingSnapshot.itemsById                    src/core/progress/export.ts:172      HIGH        3
A     EarItem.contextTonicMidi                         src/core/eartraining/item.ts:56      HIGH        3
B     PersistedInstrument.lastInstrument               src/app/state/persistedShapes.ts:86  HIGH        3
A     AssessmentResult.counts                          src/core/practice/assessment.ts:70   HIGH        3
```

Every row is age 3 — the same eight signals run 2026-08-20-1 reported at age 2. None was closed in
between. The `D` row is the same signal as the ledger's top row.

### Panel

Full verbatim reports: `runs/2026-08-21-1/panel-r{1,2,3}-*.md`. Prompts: `prompt-r{1,2,3}-*.md`,
rendered by `render-prompts.mjs` / `render-prompts-r2.mjs` / `render-prompts-r3.mjs`. Per
`docs/panel/README.md`, `DIFF_REF` and `BASE_SHA` stay pinned to the slice sha across all three
rounds; only `ROUND`, `PRIOR_FINDINGS` and `FIX_DIFF_REF` change.

**Round 1**, against the slice `de2de98` — teacher 3 BLOCKER / 5 MAJOR / 4 MINOR; rival 1/2/4;
regression-hunter 0/1/2; skeptic 1/4/2.

- *All four BLOCKERs answered in `19358f2`.* (a) The per-pad number was the **signed mean**, so
  early and late cancelled: 16 hi-hats dispatched alternately 80 ms early and 80 ms late,
  peak-to-peak 160 ms on a 375 ms eighth, returned `Clean run` and `Hi-hat — 16 of 16, 4 ms late`.
  The grader already computed `worstOffsetMs` per pad and the screen threw it away. (b) The
  tolerance was a fixed 100 ms that never consulted tempo or the grid, so at 200 bpm the window
  was 1.33 sixteenths wide: the teacher displaced a whole hi-hat line by one sixteenth and got
  `31 of 32, 4 ms late`; the skeptic played straight quarters against Ghost Funk's notated kick
  and got `Clean run / Kick — 8 of 8`. Raised independently by two seats. (c) The millisecond
  figure is the learner's timing plus their machine's keyboard and audio-output delay, with no
  calibration anywhere in `src/` and no word of it on screen, while the verdict read `Clean run` —
  a verdict on the pocket the app cannot earn. (d) The rival's market read: every product keeps
  accuracy **and** consistency as two numbers; the slice kept one.
- The fix renamed the verdict `clean` to `steady`, derived the window from the pad's own gaps, and
  added a spread figure and a disclosure sentence.

**Round 2**, against `19358f2` (+ `19e76a7`) — rival 1/3/8; teacher 3/5/2; regression-hunter
2/9/11. The skeptic seat was **not run**. Four BLOCKERs, answered in `5f972a8`.

- A kick 66 ms behind the hi-hat on 1 and 3 — a flam, not a beat — was certified `Steady run`,
  because round 1's fix made the verdict never come from the mean and judged each limb only
  against itself. Raised by the teacher and, from the market side, by the rival (a uniform 60 ms
  kick lag returned `Steady run` with `Kick — 4 of 4, 69 ms late`).
- The screen advertised that Ghost Funk Bar teaches ghost notes while `PRESS_VELOCITY = 90` was
  hardcoded and the grader read pad and time only — an advertised skill the rig cannot sense.
- A hi-hat line a whole sixteenth behind the click still reported `3 ms late`.
- The regression-hunter showed the round-1 window fix did not hold: the module doc claimed a
  neighbour match was "arithmetically impossible" and it was not.

**Round 3**, against `5f972a8` — teacher 2/7/4 with **ENDORSE: NO**; rival 3/5/3;
regression-hunter 4/7/13. The skeptic seat was **not run** in this round either. This is the round
that ended the run.

Nine BLOCKERs across three seats, consolidated to **eight distinct faults**, and **five of them
were created by `5f972a8`, the round-2 fix**:

1. The per-pad window derives from that pad's own smallest gap rather than the score's
   subdivision, so Ghost Funk's kick gets a window 1.2 sixteenths wide and straight quarters grade
   `8 of 8`. This **re-opens the round-1 skeptic's BLOCKER that round 2 had closed.**
2. `detectPhaseSlip` claims a slip whenever a shifted match beats a zero baseline, so 120 ms is
   reported as "two steps of the pattern behind the click".
3. The new flam sentence names pads the score never sounds together — it takes max-minus-min of
   each pad's run-long mean without ever asking whether the score puts two pads on a shared tick.
   On the money beat, kick and snare share no tick at all.
4. The Space-key exemption added for the pads has no run-phase check, so a run started with the
   mouse leaves Stop focused and the learner's first kick aborts it.
5. `isValidPadResult` gained required fields with no migration, so a stored attempt from the
   previous commit fails validation.
6. The tempo ramp reads evenness only, so six presses walk a beginner 80 to 200 bpm.
7. Both new gates are run-long averages, so a limb offset that grows across the run dilutes into
   them.
8. A rig 150 ms slow grades every pad `0 of n` and prints "Nothing registered on any pad" — the
   emptiness check tests **matches**, not hits, so 16 recorded strokes read as silence.

I verified each of these against the source before accepting it, per this run's own integrity
rule, rather than taking a seat's report at face value.

**Integrity notes this run carries** (recorded, not papered over):

1. **The skeptic seat ran in round 1 only.** Tier L calls for four seats; rounds 2 and 3 ran
   three. Round 3's outcome was already decided by the three that did run, and a fourth could only
   add findings at further budget cost — but the round-3 verdict is a three-seat verdict and is
   recorded as one.
2. `design.md`'s metric line says "whose verdict is clean". The field was renamed `clean` to
   `steady` at §6 in answer to the round-1 BLOCKERs. The frozen claim was not edited mid-run.
3. `design.md` cites Rockschool Debut as "closed hi-hat on every eighth". Debut's own stylistic
   line is a **quarter-note** hi-hat. The round-1 teacher raised this as a MAJOR and it was
   answered in the tree, not in the citation, which stands as written and wrong.
4. `design.md` maps hi-hat to `KeyF` and snare to `KeyJ`; the shipped mapping was the reverse,
   changed at §6 so the keys matched the hands the pads name.
5. The three round-2 seats were told "the working tree is clean at commit `19358f2`". That stopped
   being literally true once `19e76a7` landed on top, after they were launched.
6. The §2 pick did not open the prerequisites-win thread it should have (see the Thread note
   above).

### Proof

This is an ABORT, so the proof is of the blocker, not of the claim.

- **The kept spec is RED at HEAD.** `E2E_PORT=5392 npx playwright test e2e/improve-DR-09.spec.ts`
  → **3 failed, 1 passed, exit 1**. I ran this myself on an isolated port rather than trusting the
  regression-hunter's report, because the run had already been burned once by port reuse (below).
  The claim spec cannot pass at HEAD, so PROVE's GREEN arm does not exist.
- **RED at the spec commit.** Checked out `8bc7e80` in an isolated worktree: exit 1, 4 failed,
  every failure waiting for the `Groove` button in the main nav. Log:
  `runs/2026-08-21-1/red-at-spec-commit.txt`. The **first** attempt at this check reported
  "4 passed", which is impossible at a commit where `GrooveScreen.tsx` does not exist:
  `playwright.config.ts` defaults to port 5173 with `reuseExistingServer: !process.env.CI`, and a
  stale dev server on the main checkout was answering there, so the worktree run graded the main
  tree. Every port in this run's proof is therefore explicit and unique.
- **The green run recorded mid-run is superseded.** `runs/2026-08-21-1/green-at-head.txt` and
  `heldout-goal.txt` record exit 0 against `19358f2`/`19e76a7`. Both describe code that no longer
  exists. They are kept as the record of what was true then, not as proof of anything now.
- **The revert is green.** `a9e87a8` reverted the four implementation commits and kept both spec
  commits. `npm run verify` exit 0 — 227 files, 4678 tests; the pre-commit core suite is 88 files,
  2772 tests in 3.60 s. Driven in the running app on port 5273: `/drums/groove` returns the
  pre-run "coming soon" landing and `/practice` renders Twinkle Twinkle, console clean on both.
- **The revert was surgical, on the learner's instruction.** `de2de98` was not drums-only — it
  also carried a persistence refactor. `persistedEarShapes.ts` (0 drums references) and
  `writeQueue.ts` (0) survive whole; `persistenceHarness.ts` (2) and
  `persistence.collections.test.ts` (13) had their drums rows stripped. About 1500 lines of
  unrelated, working, unfaulted code was kept rather than thrown away with the fault.
- **Held-out goal:** written before the build and never shed — the same screen grading
  `moneyBeatOpenHat()` at 70 bpm. It **was** reached at `19e76a7` (exit 0, 2 passed, including a
  generalisation trap that a trainer treating the hi-hat as one limb would pass) and that code is
  now reverted, so it is recorded as reached-then-withdrawn, not as reached.
- **Not run because the slice no longer exists:** the §7 experience gate on the feature itself.
- **What `npm run verify` did not catch.** 4860 unit tests were green over a claim spec that was
  red, because `verify` is `docs:budget && typecheck && lint && test:all` and **contains no e2e
  step**. That is a repo-wide gate hole, not a drums one; filed as `T.18`.

### Previous run's metric verdict

**none.** Run 2026-08-20-1 declared `PersistedTechniqueHistory.attempts` — attempts whose
`drillId` is `triad-sequence-c-major-broken-hands-right` and whose `clean` is true — and voided it
in the same entry, because its abort reverted the drill that writes that id. The id exists again:
`T.7` shipped it at `be8e853` and `triadSequenceDrill(1, C, 'right', 'broken', 60)` is back in
`ALL_DRILLS`. That restoration happened in a `/next` session, outside the improve loop, so it
produced no baseline and no reading. Recorded as `verdict --none`, not as zero: zero would claim
the store was read and found empty, and this session cannot read the learner's IndexedDB. This
run's own metric is void for the same reason a run later — two consecutive aborts have now left
the metric column empty twice running, which is itself the signal.

### Cannot-sense register

**Where the learner's own timing sits, once device latency is taken out** (screen: Drums > Groove, not shipped this run) — `OURS`. Every instant this app grades has already been through a keyboard scan, a browser event queue and an audio output buffer, and none of that is measured, so a signed mean offset is the learner's placement plus an unknown constant: a drummer laying the snare back 25 ms and a rig 25 ms slow produce the same number, and nothing in the data separates them. Countability challenge: a calibration pass — one pad, one bar against the click, take the median offset as the rig's constant and report bias relative to it. It stands in if two rigs with known different output latency produce the same corrected bias for the same learner. Added to the standing table, undisclosed, because the screen that would have carried the disclosure sentence was reverted with the rest of the slice.

**The pocket, phrasing does not leave** (screen: Drums > Groove, not shipped this run) — the proxy this run built for it, a signed mean offset per limb, was reverted, so the row is exactly where run 2026-08-20-1 left it. Worth writing down anyway: the round-3 rival argued the proxy was aimed at the wrong quantity. A per-limb offset against the click is contaminated by the row above; the **difference between two limbs at an instant the score makes them coincide** is not, because a constant added to every hit cancels in the difference. That reframing is now the standing idea-register entry, and it is what this row's next proxy should be.

## Run 2026-08-20-1

- **Persona:** Total beginner working toward RCM Preparatory A, level 1, no MIDI device — plays on the on-screen keyboard (piano)
- **Tier:** L
- **Pick source:** 1d
- **Pick gap:** RCM Preparatory A's Triad Sequence — root-position diatonic triads, C major, broken and solid, hands separately, one octave ascending — has no drill at all; the only chord content in the app is inversions, gated to level 3
- **Previous pick source:** none
- **Class:** VOID
- **Claim:** After this ships, a learner who is at level 1 and has never played a chord in this app will be able to practise the RCM Preparatory A triad sequence in C major — the eight root-position diatonic triads, broken and solid, one octave ascending, hands separately — and get a clean-at-tempo verdict on it, and we will know because the learner sees the triad-sequence drills listed in the level-1 picker on the Technique screen, plays one correctly, and the Technique screen then shows "Best clean tempo: 60bpm" where it showed nothing before, and the Progress screen shows that run as a point on its "Technique tempo" card.
- **Refutation condition:** Two-armed, hardcoding the 24 syllabus pitches at 24 hardcoded instants so nothing is read out of the app's own score: the positive arm (the eight syllabus triads, played correctly at 333.333ms spacing) must be graded `Clean at 60bpm` and add one tempo-history point; the negative arm (identical instants and rhythm, every third lowered a semitone) must not be graded clean. This replaced the original condition, which the round-1 Skeptic proved void.
- **Metric:** PersistedTechniqueHistory.attempts
- **Baseline:** 0 events, newly instrumented
- **Endorsement:** no
- **Outcome:** abort

### Ledger

| Gap | Source | Class | Blocked | Reach | Teacherliness | Unmatchable | Sum | Cost |
|---|---|---|---|---|---|---|---|---|
| RCM Preparatory A's Triad Sequence — root-position diatonic triads, C major, broken and solid, hands separately, one octave ascending — has no drill at all; the only chord content in the app is inversions, gated to level 3 | 1d | VOID | 3 | 3 | 3 | 1 | 10 | M |
| Level-1 melodic dictation ignores its own difficulty ladder — `generateMelodicDictation` overrides the level config's `stepwiseOneDirection` to false, so a beginner is asked to sing back any diatonic degree with leaps up to 19 semitones, where Prep A Playback asks for degrees 1-2-3 from tonic or mediant | 1c | MIS-GRADED | 3 | 2 | 3 | 1 | 9 | S |
| MIDI velocity arrives on every note-on and reaches no learner-visible output — the app has no dynamics anywhere (axes sum 9; a +1 age bonus took it to 10 at §2, tying the pick, and the tie was settled to the VOID row on the innovation quota) | 1e | BLIND | 1 | 3 | 3 | 2 | 9 | M |

### Interview

no answer this run

### Orphan signals

Captured verbatim to `runs/2026-08-20-1/orphan-signals.txt` (12 rows shown, 172 more suppressed by the top-12 cap). The `evidence` column is long enough to swamp this entry, so it lives in that file; the identifying columns are reproduced here unaltered:

```
scan  signal                                           declared at                          confidence  age
[C] no findings
A     EarSessionState.cards                            src/core/eartraining/session.ts:107  HIGH        2
B     PersistedAnnotations.byScoreId                   src/app/state/persistedShapes.ts:56  HIGH        2
D     ScoreNoteInput.velocity ?? DEFAULT_VELOCITY      src/core/notation/score.ts:163       HIGH        2
A     EarItem.contextKey                               src/core/eartraining/item.ts:86      HIGH        2
B     EarTrainingSnapshot.itemsById                    src/core/progress/export.ts:172      HIGH        2
A     EarItem.contextTonicMidi                         src/core/eartraining/item.ts:56      HIGH        2
B     PersistedInstrument.lastInstrument               src/app/state/persistedShapes.ts:86  HIGH        2
A     AssessmentResult.counts                          src/core/practice/assessment.ts:70   HIGH        2
B     SightReadingRecord.pieceId                       src/core/sightreading/session.ts:56  HIGH        2
A     Card.ease                                        src/core/srs/scheduler.ts:65         HIGH        2
A     MatchResult.expected -> ScoreNote.durationTicks  src/core/notation/score.ts:60        LOW         2
B     MidiSustain.down                                 src/core/ports/midi.ts:24            LOW         2
```

The `D` row — `ScoreNoteInput.velocity` falling back to `DEFAULT_VELOCITY` — is the same signal as the third ledger row.

### Panel

Full verbatim reports: `runs/2026-08-20-1/panel-r1-*.md` and `panel-r2-*.md`. Prompts: `prompt-r{1,2}-*.md`, round-2 prompts differing from round-1 only in the round-specific tokens (a `make-r2-prompts.mjs` in the run dir does the substitution and refuses if a round-1 token survives).

**Round 1** — rival 1 BLOCKER / 0 MAJOR / 4 MINOR; teacher 1/3/2; regression-hunter 0/0/0; skeptic 1/3/2, verdict REFUTED.

- *Both BLOCKERs fixed in `ee9f5fe`.* (a) The broken form shipped 24 straight eighths, so the drill ran 12.0s where the syllabus's own ♩=60 gives 8.0s, four of eight triads started off the beat and two straddled a barline — raised independently by three seats. I verified the syllabus reading myself before accepting it, using a render made before the rival existed so the check could not be circular. Fixed by making the broken form eighth-note triplets with a 3:2 `Tuplet`, which also gave the MusicXML writer `<time-modification>`, `<tuplet>` and `<beam>`. (b) The run's own refutation condition passed against sabotaged code, because omitting every third also destroys onset spacing, so evenness hits 0 before pitch is consulted. Replaced with the Skeptic's two-armed condition.
- *Round-1 MAJORs carried forward:* the 80ms chord window, the verdict that cannot name a wrong note, the missing pentascale closing triad, and the Progress card that flattens two tempi onto one line.

**Round 2** — rival 1/2/1; teacher 1/5/2, **ENDORSE: NO**; regression-hunter 0/0/1; skeptic 4/5/1, **verdict REFUTED**. Valid as a re-panel: every seat re-ran earlier repros and each made an attempt no earlier round made (a `renderHook` tempo-seeding probe and a jitter binary search; 900dpi renders of the syllabus's Note Values cells and a 400-run onset simulation; a seeded two-drill Progress repro; hiding every `<text>` in the score SVG to count glyph-drawn tuplet numerals).

The four round-2 BLOCKERs, none of them fixed:

1. **The score the learner reads is wrong.** OSMD engraves only 2 of 8 triplet groups with a numeral, so bar 1 reads as 5 beats and bar 2 as 6 in a 4/4 score. The written MusicXML is schema-correct, so the defect is in the engraving — which the slice never asserted, having tested the XML string instead. → `T.8`
2. **The drill's target tempo stopped being applied**, and `ee9f5fe` — the round-1 fix — caused it. Its new `setSubdivision` call sits one line after `setBpm`, and `setSubdivision` rebuilds its draft from the render-closure `bpmState`, so the second call writes the old bpm back. Raised by the rival and the skeptic separately; I reproduced it myself with `renderHook` before accepting either: `setBpm(72)` then `setSubdivision(3)` in one `act()` leaves bpm at 100. Every attempt was therefore persisted at the wrong bpm — the exact field this run declared as its metric. → `T.9`
3. **The click became 180/min on a ♩=60 drill the syllabus requires from memory**, two of eight beats accented, so the machine performed the three-in-one grouping the drill exists to teach. Raised by the teacher as a BLOCKER and the skeptic as a MAJOR; the same `setSubdivision` call.
4. **The run's own artifacts do not evidence the triplet reading the whole slice was rebuilt around.** `runs/2026-08-20-1/syllabus.md` records neither a note value nor a tempo for that row, while `design.md` asserts ♩=60 and ♩=72 as verbatim. Two seats independently rendered the syllabus page at 900dpi and read triplets, and so did I, so the reading is very likely right — and it is nowhere in the run's evidence, which for this process is the same thing as unverified.
5. **The replacement refutation condition was recorded at the wrong note spacing** — 500ms, where the drill now plays 333.333ms — so as written in `design.md` it failed against working code.

Round-2 MAJORs, all filed rather than fixed: the evenness bar has no absolute floor and the triplet change halved it (`T.10`); the 80ms chord window is a cliff at both ends, and above 250bpm a triplet gap fits inside it so a jittery run scored "Evenness 100% — Clean at 300bpm" (`T.11`); the verdict cannot name a wrong note (`T.12`); `fiveFingerRun` omits the closing blocked triad (`T.13`); the Progress card flattens two tempi (`T.14`).

### Proof

This is an ABORT, so the proof is of the abort, not of the claim.

- **The kept spec is RED at HEAD.** `npx playwright test e2e/improve-triad-sequence.spec.ts` → `1 failed`, **exit 1**, failing at line 163 on `expect(offered).toContain('C major triad sequence, broken, right hand')` — the level-1 Drill picker offers no triad drill. `1120597` restored that file byte-identical to the spec commit `b8dd8dd` (`git diff --quiet b8dd8dd -- e2e/improve-triad-sequence.spec.ts` → no output).
- **The revert is green.** Pre-commit on `1120597` ran typecheck, lint and the core suite: **81 files, 2623 tests passed in 2.71s**, under the 3s cap.
- **The refutation condition, run.** The Skeptic executed both arms at the corrected 333.333ms spacing against HEAD-before-revert: positive arm `Evenness 88% — Clean at 60bpm`, `Best clean tempo: 60bpm`, 1 clean history point, console errors `[]`; negative arm (eight minor triads at identical instants) `Evenness 88% — Not yet clean`; **exit 0** on the working tree and **exit 1** against a tree with the triad module reverted — so the replacement discriminates where the original did not. It ran against code that is now reverted, so it evidences the fix that existed, not the app as it stands.
- **The original condition, disproved.** Against a sabotaged tree it produced `Evenness 0% — Not yet clean`, 0 clean history points, **exit 0** — byte-identical to its output on working code.
- **Held-out goal:** not reached. The run aborted at §6; the generalisation check (`triadSequenceDrill(1, G, …)` yielding F#) and the unaided left-hand-solid drive were never run. Recorded as not shed but not reached, which is a failure of the run, not a waiver.
- **Not run because the slice no longer exists:** the full experience gate at §7.

### Previous run's metric verdict

none — this is the first run in the ledger. The metric this run declared reads `PersistedTechniqueHistory.attempts`, counted as the attempts whose `drillId` is `triad-sequence-c-major-broken-hands-right` and whose `clean` is true. It is **void**: the drill id was reverted, so the next run reading that store finds nothing to count. `T.7` carries the gap forward with its RED spec attached.

### Cannot-sense register

**Chord roll direction and spread** (screen: Technique) — `OURS`. The three note-ons of a blocked triad arrive with distinct times, and `MATCHER_DEFAULTS.chordWindowMs = 80` folds everything inside the window into a single onset before grading, so whether the learner struck the triad as one sound or spread it bottom-to-top is gone by the time a verdict exists. A teacher grading the RCM solid form is grading exactly that. Countability challenge: keep the low-to-high span in ms per chord as the proxy; it stands in if chords a teacher calls rolled show a larger span than the ones they call blocked. Added to the standing table.
