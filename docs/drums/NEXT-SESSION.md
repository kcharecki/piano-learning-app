# Drum session — hand-off for the next orchestration session

Written 2026-09-18 after wave 10. Read this before `docs/drums/ROADMAP.md`. Keep it short;
rewrite it at the end of every session (it is a hand-off, not a log — the log is
`docs/retro-log.md`).

## Prompt to paste

```
Orchestrate the drum part of this app (docs/drums/ROADMAP.md, hand-off in
docs/drums/NEXT-SESSION.md). Goal: keep shipping proven drum slices until the 5-hour token
window runs out. Keep this session for orchestration, integration, verification and commits;
build with Sonnet agents, review timing/grading/audio code with Opus agents. Adjust the spec
when a better version is obvious, and say so in the commit body.

Order of work:
1. Recover: 33cbe48 (wave 10: swing in the run plan, jazz ride drills, milestones, kit-map
   picker) was committed and pushed WITHOUT the gate. Run `npm run verify`, launch an Opus
   review of src/core/drums/model/swing.ts + src/core/drums/practice/plan.ts, run the
   kit-map slice's acceptance (E2E_PORT=5292 npx playwright test e2e/drums-latency.spec.ts
   e2e/drums-input-monitor.spec.ts; node scripts/orphan-signals.mjs --all | grep -i kitmap),
   visual passes for Coordination, Progress and Latency, fix what they find, commit.
2. Wave-10 docs: ROADMAP DR-15 and DR-23 close, DR-02 preset picker landed (wizard still
   open); retro entry (30 slices / 10 waves). Commit with runs/orphan-ages.json.
3. Then waves of three slices, each with disjoint file ownership, each proven by the
   experience gate before commit. Candidates in "What is next" below.

Rules that bit us (full list in NEXT-SESSION.md "Watch out for"): never start on a dirty
tree; never --no-verify; commit only on green verify; every builder brief says "pass a
function the fields it reads, not the record they live on"; read what replaced a removed
throw; compute brief example numbers from the code, never by hand.
```

## What is next (after recovery)

| Item | Roadmap | Notes |
|---|---|---|
| Kit-map MIDI-learn wizard + link from the calibration screen to the monitor | DR-02 | preset picker landed in 33cbe48; the wizard is the open half |
| MIDI-out channel on `MidiOutput` | DR-05 | small; adapter + settings |
| Velocity classes in grading + keyboard dynamics | DR-07, DR-03 | timing/grading code → Opus review mandatory |
| Six unverified stickings in the rudiment table | DR-10 | content check against a cited source |
| Swing marking engraved on the staff | DR-15 tail | the plan swings, the notation does not say so yet |

## Watch out for (findings from waves 1–10, newest first)

1. **33cbe48 is unverified.** Treat it as triage item 1. Do not build on it until verify,
   the Opus swing review and the visual passes are green.
2. **The orphan-signals scan is a gate on every slice.** A function that takes a core
   record and reads one field adds a row that pushes a ground-truth row out of the capped
   table, and `npm run verify` goes red on a test about something else. Three builders were
   sent back for this. Every brief for `src/core/drums` says: pass the fields, not the record.
3. **When a builder removes a throw, read what replaced it.** The openings builder swapped a
   throw for a fallback plan; the UI happily ran and graded the fallback under a "nothing to
   drill" line. Empty states must disable the control, not only show text.
4. **Brief examples must come from the code.** The swing brief said 240→320; the code's
   `subdivisionCellTick` rounds to 322. The builder followed the code (right), but a weaker
   builder would have followed the brief. Run the function before writing the number.
5. **A field carried through the types but never rendered is dead data.** Milestone `how`
   text existed in core and reached nobody until the main-thread read caught it.
6. **Visual-pass receipt hashes the whole working tree** (`src/app/**/*.tsx` +
   `src/design-system/**/*.css`). Run the passes once per wave after every `.tsx` has
   settled, copy the last receipt, then commit. Any later `.tsx` edit invalidates it.
   `VISUAL_PASS_SKIP="<reason>"` is the sanctioned escape; `--no-verify` is not.
7. **Per-spec e2e ports.** Builders run `E2E_PORT=5291|5292|5293 npx playwright test
   e2e/<spec>` (one port per builder) so three parallel builders never share a server.
   `npm run verify`'s e2e gate picks its own random port.
8. **Node ICU renders September as "Sept" in en-GB.** Tests compute expected dates through
   the same formatter (`formatDay`) rather than hard-coding the string.
9. **A killed builder leaves an empty output file.** Its report is lost; its edits stay in
   the tree. Let a builder finish, or ask it (SendMessage) for a report before stopping it.
10. **`npm run verify` takes about ten minutes.** Run it once per wave, in the background,
    logged to the scratchpad; read the tail with `grep -E "passed|failed|error"`.
11. **Context compaction happens.** Keep `next-steps-wave<N>.md` in the scratchpad and a
    memory pointer current at the end of every wave so a resume costs one file read.
12. **Grader tolerance after swing.** The smallest subdivision gap on a swung groove is 158
    ticks (not 240); check the tolerance cap and wait-mode boundaries in the Opus review.

## Using sub-agents well

- **Three Sonnet builders per wave, disjoint files.** Each brief (scratchpad
  `brief-<slice>.md`, template in `docs/efficiency-guide.md` Appendix A) holds: rules
  digest, exact owned files, frozen contract with signatures, acceptance commands, and
  "report file list + test-count tails only, no diffs". Never "read AGENTS.md", never
  "explore".
- **Opus review in parallel, not after.** As soon as a timing/grading/audio builder reports,
  launch the Opus reviewer as a background agent with a numbered question list (cell
  agreement, odd meters, window narrowing, consumers comparing nominal with swung ticks,
  tautological tests). Next wave's builders start while it runs.
- **Fix with the same agent.** `SendMessage` to the builder that owns the files keeps its
  context; a fresh fixer re-orients from zero.
- **Main thread reads diffs, not files.** `git diff -- <owned timing files>` after a builder
  reports; only integration glue is typed on the main thread. PROCESS.md: review-driven fixes
  to timing/grading/adaptation code are read on the main thread before commit.
- **Commit per slice, in sequence,** with a pre-written message file:
  `git commit -q -F <scratch>/msg-<slice>.txt > <scratch>/commit-<slice>.log 2>&1`.
- **Docs edits through a script.** `docs-wave<N>.py` with asserted unique anchors edits
  ROADMAP.md and retro-log.md in one call; nobody reads the 1500-line roadmap into context.
- Check `TaskOutput` before spawning: a duplicate agent on the same files is a merge conflict
  waiting to happen.

## Spending fewer tokens

| Habit | Why |
|---|---|
| Bash first: `sed -n`, `grep -n`, `tail`, `wc` | one tool result instead of a whole file |
| Hook and verify output to a log, then `tail`/`grep` it | the pre-commit hook prints 3.5k tests |
| Agents paste tails, not transcripts | the main thread only needs pass/fail and file lists |
| Batch independent tool calls in one message | fewer round trips |
| Scoped `npx vitest run <dir>` everywhere except the once-per-wave verify | seconds, not minutes |
| Caveman mode for chat; code, commits and docs stay normal | ~75% fewer output tokens on replies |
| Rewrite this file and the scratchpad note at wave end | a compaction or a new session resumes from one page |
| Stop when the user says stop; note state; do not "finish quickly" | the note is cheaper than a redo |
