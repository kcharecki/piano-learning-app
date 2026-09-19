# Drum session — hand-off for the next orchestration session

Written 2026-09-19 after wave 13. Read this before `docs/drums/ROADMAP.md`. Keep it short;
rewrite it at the end of every session (it is a hand-off, not a log — the log is
`docs/retro-log.md`).

## Prompt to paste

```
Orchestrate the drum part of this app (docs/drums/ROADMAP.md, hand-off in
docs/drums/NEXT-SESSION.md). Goal: keep shipping proven drum slices until the 5-hour token
window runs out. This session is the ARCHITECT: it triages, writes contracts and briefs,
adjusts the spec and the process, and judges evidence. It does not code, integrate, verify
or commit — sub-agents do (roles table in NEXT-SESSION.md): Sonnet builders, an Opus
reviewer for timing/grading/audio code, one serial Sonnet integrator for shared files and
commits, a Sonnet verifier for verify/visual passes/driven proof, a Sonnet docs agent.
Adjust the spec when a better version is obvious, and have the integrator say so in the
commit body.

Order of work:
1. Check the tree is clean and `git log -1` is the wave-13 docs commit; then waves of
   three slices, each with disjoint file ownership, each proven by the experience gate
   before commit. Candidates in "What is next" below.

Rules that bit us (full list in NEXT-SESSION.md "Watch out for"): never start on a dirty
tree; never --no-verify; commit only on green verify; every builder brief says "pass a
function the fields it reads, not the record they live on"; read what replaced a removed
throw; compute brief example numbers from the code, never by hand; a review fix to
timing/audio code is re-reviewed by the same Opus agent until it says green; when a
brief's contract names the unit a pass shifts by, say which grid — nominal or swung; a
contract that sets a threshold or a guard cites the existing constant it must match, and
names the degenerate inputs the guard must survive.
```

## Roles (user direction 2026-09-18: the main session architects; workers do the rest)

| Role | Model | Does | Reads | Returns |
|---|---|---|---|---|
| Architect (this session) | main thread | triage, contracts, briefs, spec and process changes, evidence judgement, routing of findings | agent reports only; a file or diff only when a decision needs it | briefs, decisions |
| Builder (up to 3 in parallel) | Sonnet | code + co-located tests in its owned files; scoped tests | its brief, its files | file list, test-count tails, ambiguities |
| Reviewer | Opus, high effort | adversarial review of timing/grading/audio diffs against a numbered question list | the named diffs | findings with severity; sent to the builder via the architect |
| Integrator (one at a time, serial) | Sonnet | shared files (Shell, routes, stores, index re-exports), cross-slice consistency, commit message per slice, `git commit -q -F`, push | builder reports, `git diff --stat`, the shared files | commit hashes, hook tails |
| Verifier | Sonnet | `npm run verify`, per-spec e2e, visual passes, drives the app for the proof action, console check | logs | evidence tails, screenshot paths, receipt copied; red → which builder owns it |
| Docs | Sonnet | ROADMAP / retro / this file via an anchored script | the anchors | script output |

Flow per wave: architect writes 3 briefs → builders run in parallel → reviewer runs on any
timing slice while the others build → architect routes findings back to the owning builder
(`SendMessage`, same agent) → integrator wires shared files and commits slice by slice →
verifier proves each commit (verify, visual passes, driven proof) → docs agent closes the
wave. The architect never types code; if glue is needed, the integrator types it.

## What is next (after wave 13)

| Item | Roadmap | Notes |
|---|---|---|
| Velocity classes in grading + keyboard dynamics | DR-07, DR-03 | timing/grading code → Opus review mandatory; `GrooveHit` has no velocity field, `GrooveTrainerScreen`'s `onHit: (pad) => hitRef.current(pad)` drops it, and `groovePadHooks.ts` ignores shift/alt |
| Slip sentence for the reading trainer | DR-08/DR-11 | `readingResultLines()` (`src/app/drums/reading/readingRun.ts:49`) reads only pads and steady, so a slipped reading run gets no slip sentence — orphan-scan HIGH finding, wave 12 |
| MIDI output port switch mid-session | DR-06 | `ensureMidiTarget`'s rebuild guard is instance-only, so switching the Settings port reuses the voice bound to the old port and a ringing open hat's note-off goes to the new port while the old one keeps ringing; fix: cache `selectedDeviceId` next to the instance, `allNotesOff()` the old port and rebuild on change |
| Core-suite wall time | — | `npm test` is 3.55 s, over the ~3 s budget; `scripts/orphan-signals.test.mjs` "the real scan" alone is ~2.7 s — move it out of `npm test` or cache the scan |
| Between-grid-steps sentence | DR-07 | a snare 101–199 ms late at 100 bpm (between two grid steps) yields no diagnosis sentence today; a "between grid positions" sentence is a candidate |
| Sampled kit behind the DR-06 port | DR-B5 | only if the synth grates |

## Watch out for (findings from waves 1–13, newest first)

1. **A contract that sets a threshold or a guard cites the existing constant it must
   match (`SLIP_COVERAGE`, not a fresh fraction) and names the degenerate inputs the
   guard must survive (one pad played, a two-stroke pad, no expected strokes).** Two of
   wave 13's three reds were architect-written rules that a builder implemented
   faithfully: a half-coverage rule diagnosed a displaced limb from one late stroke on a
   two-stroke snare, and a guard let a learner who played only the hi-hat be told the
   silent limbs were "right."
2. **When a brief's contract names the unit a pass shifts by, the architect states which
   grid it is — nominal vs swung — and the builder's first test proves a one-step
   displacement reads as one step.** A wrong displacement number is the F1 bug class, and
   it survived a green suite twice: wave 11's slip-step pass measured swung gaps against
   the nominal grid, and wave 12's fix itself first shifted by the smallest SWUNG gap (158
   ticks) instead of the nominal cell (240 ticks) before the root cause was isolated.
3. **The pre-commit hook's visual-pass receipt hashes `src/app/**/*.tsx` INCLUDING test
   files** — a test-only edit under `src/app` after the passes makes the receipt stale.
   Run the passes last.
4. **A review fix to timing/audio code is re-reviewed by the same Opus agent until it
   says green.** The architect never accepts "all findings applied" as green. Wave 13's
   MIDI-nits review needed a third round because the architect's own suggested fix (reset
   the hat on every `MIDIAccess` statechange) dropped a genuinely ringing hat's note-off
   when an unrelated device — the learner's piano — was plugged in; wave 11's swing and
   MIDI-out reviews each needed a second and third round for the same reason.
5. **The orphan-signals scan is a gate on every slice.** A function that takes a core
   record and reads one field adds a row that pushes a ground-truth row out of the capped
   table, and `npm run verify` goes red on a test about something else. Three builders were
   sent back for this. Every brief for `src/core/drums` says: pass the fields, not the record.
6. **When a builder removes a throw, read what replaced it.** The openings builder swapped a
   throw for a fallback plan; the UI happily ran and graded the fallback under a "nothing to
   drill" line. Empty states must disable the control, not only show text.
7. **Brief examples must come from the code.** The swing brief said 240→320; the code's
   `subdivisionCellTick` rounds to 322. The builder followed the code (right), but a weaker
   builder would have followed the brief. Run the function before writing the number.
8. **A field carried through the types but never rendered is dead data.** Milestone `how`
   text existed in core and reached nobody until the main-thread read caught it.
9. **Visual-pass receipt hashes the whole working tree** (`src/app/**/*.tsx` +
   `src/design-system/**/*.css`). Run the passes once per wave after every `.tsx` has
   settled, copy the last receipt, then commit. Any later `.tsx` edit invalidates it.
   `VISUAL_PASS_SKIP="<reason>"` is the sanctioned escape; `--no-verify` is not.
10. **Per-spec e2e ports.** Builders run `E2E_PORT=5291|5292|5293 npx playwright test
    e2e/<spec>` (one port per builder) so three parallel builders never share a server.
    `npm run verify`'s e2e gate picks its own random port.
11. **Node ICU renders September as "Sept" in en-GB.** Tests compute expected dates through
    the same formatter (`formatDay`) rather than hard-coding the string.
12. **A killed builder leaves an empty output file.** Its report is lost; its edits stay in
    the tree. Let a builder finish, or ask it (SendMessage) for a report before stopping it.
13. **`npm run verify` takes about ten minutes.** Run it once per wave, in the background,
    logged to the scratchpad; read the tail with `grep -E "passed|failed|error"`.
14. **Context compaction happens.** Keep `next-steps-wave<N>.md` in the scratchpad and a
    memory pointer current at the end of every wave so a resume costs one file read.
15. **Grader tolerance after swing.** The smallest subdivision gap on a swung groove is 158
    ticks (not 240); check the tolerance cap and wait-mode boundaries in the Opus review.
16. **Run `visual-pass.mjs` with the default `--out` (`./visual-pass`), or copy the receipt
    there before committing.** The pre-commit hook reads only `./visual-pass/receipt.json`;
    wave 11's passes wrote receipts into scratchpad `--out` dirs, and the hook called the
    receipt stale until the newest one was copied to the default path.
17. **A disabled control whose only enabler is the control itself is a deadlock.** The
    wave-11 Settings "MIDI out" option was disabled until connected, but only selecting it
    connected. The test must click through the UI, not seed the route programmatically —
    a seeded-state test passed while the real deadlock stood.
18. **Out-of-order scheduling.** Trainers dispatch a pass up front with future `atMs` while
    live hits arrive at `now()`; any stateful voice (open hat) must tolerate a release that
    precedes its own onset.

## Using sub-agents well

- **Three Sonnet builders per wave, disjoint files.** Each brief (scratchpad
  `brief-<slice>.md`, template in `docs/efficiency-guide.md` Appendix A) holds: rules
  digest, exact owned files, frozen contract with signatures, acceptance commands, and
  "report file list + test-count tails only, no diffs". Never "read AGENTS.md", never
  "explore".
- **Opus review in parallel, not after.** As soon as a timing/grading/audio builder reports,
  launch the Opus reviewer as a background agent with a numbered question list (cell
  agreement, odd meters, window narrowing, consumers comparing nominal with swung ticks,
  tautological tests, degenerate inputs to the contract's own thresholds). Next wave's
  builders start while it runs.
- **Fix with the same agent.** `SendMessage` to the builder that owns the files keeps its
  context; a fresh fixer re-orients from zero.
- **The architect reads reports, not files.** A diff reaches the main thread only when
  two reports disagree (builder vs reviewer) and the architect must decide. PROCESS.md's
  "review-driven fixes to timing/grading code are read before commit" is satisfied by the
  Opus reviewer re-reading the fix, not by the main thread.
- **The integrator commits per slice, in sequence,** with a pre-written message file:
  `git commit -q -F <scratch>/msg-<slice>.txt > <scratch>/commit-<slice>.log 2>&1`, then
  reports the hash and the hook tail.
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
