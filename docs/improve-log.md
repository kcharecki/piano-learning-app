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
| Chord roll direction and spread | **OURS** — the note-ons carry real times and `MATCHER_DEFAULTS.chordWindowMs = 80` collapses everything inside the window into one onset, so whether a blocked triad was struck as one sound or rolled bottom-to-top is discarded before grading. Not a fact about MIDI | Keep the per-chord spread: the signed low-to-high span in ms is the proxy for blocked-vs-rolled, and it stands in if chords a teacher calls rolled show a larger span than the ones they call blocked | *(not yet disclosed)* |

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
