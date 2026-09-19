# Drum session — hand-off for the next orchestration session

Written 2026-09-19 after wave 14. Read this before `docs/drums/ROADMAP.md`. Keep it short;
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
1. Check the tree is clean and `git log -1` is the wave-14 docs commit; then waves of
   three slices, each with disjoint file ownership, each proven by the experience gate
   before commit. Candidates in "What is next" below.

Rules that bit us (full list in NEXT-SESSION.md "Watch out for"): never start on a dirty
tree; never --no-verify; commit only on green verify; every builder brief says "pass a
function the fields it reads, not the record they live on"; read what replaced a removed
throw; compute brief example numbers from the code, never by hand; a review fix to
timing/audio code is re-reviewed by the same Opus agent until it says green; when a
brief's contract names the unit a pass shifts by, say which grid — nominal or swung; a
contract that sets a threshold or a guard cites the existing constant it must match, and
names the degenerate inputs the guard must survive; a diagnosis-sentence contract
enumerates the input space and demands a hard-coded expected string per regime.
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

## What is next (after wave 14)

| Item | Roadmap | Notes |
|---|---|---|
| Dynamics sentence denominator + coverage-note gaps | DR-07 | the denominator is graded instants, not notated ones — "Snare: 1 of 2 ghost notes came out full" on a 16-ghost groove when 18 strokes were missed; the coverage note covers unclassified strokes only, never unmatched ones, and stays silent when notated dynamics exist and nothing matched |
| Reading trainer between-grid / step-0 counts / ms readout | DR-08/DR-11 | a learner one quarter late on a level-1 exercise whose grid is a half note is undiagnosable (between grid positions); the detail counts sit at step 0 next to the slip line; the ms readout disappears whenever the slip line fires |
| macOS Alt → `event.code` | DR-03 | `Alt+letter` rewrites `event.key` on macOS, so the ghost modifier is dead there while the coverage note still says "Use Shift and Alt" — `useKeyboardPads` should key on `event.code` instead |
| Per-level timing windows | DR-07 | velocity classes landed `288f31b`; the window narrowing by level is still open |
| Core-suite wall time | — | `npm test` still runs at or over the ~3 s budget (3.44–3.80 s this wave); `scripts/orphan-signals.test.mjs` "the real scan" alone is ~2.7 s — move it out of `npm test` or cache the scan |
| Between-grid-steps sentence | DR-07 | a snare 101–199 ms late at 100 bpm (between two grid steps) yields no diagnosis sentence today; a "between grid positions" sentence is a candidate |
| `DynamicsLegend` muted-plan + aria | DR-03/DR-07 | keys on the unmuted plan, so it still shows with the snare muted on ghost funk (when grading has nothing to apply it to); no aria link from the pad buttons |
| WebMidi double invalidate, cosmetic | DR-06 | `WebMidiOutputAdapter` invalidates its device cache twice per statechange (`webmidi.ts:69`, then `:319` via `refresh()`) — idempotent, one line to drop |
| Sampled kit behind the DR-06 port | DR-B5 | only if the synth grates |

## Watch out for (findings from waves 1–14, newest first)

1. **A contract for a diagnosis sentence enumerates the generator's whole input space —
   every grid, level and regime the sentence will be asked to name — and demands one
   hard-coded expected string per regime; a property over the template is not a test of
   the sentence.** Nine of wave 14's ten reds were architect-written sentence specs (grid
   vocabulary, coverage claims, a hard-coded "one", a "cannot happen" claim) that builders
   implemented faithfully — the shared `stepName` floored every grid coarser than a beat
   to "beat", "Every onset was on the grid" overclaimed at the grader's own 0.75 coverage,
   dynamics graded at the step-0 pairing instead of the pad's own shift, and a "cannot
   happen" old-port panic turned out to be necessary.
2. **The docs agent commits before any builder of the next wave starts.** The pre-commit
   hook typechecks the whole tree, so a docs commit cannot land while any builder has a
   mid-edit type error under `src/` — wave 13's docs sat staged for a whole wave because
   the integrator committed it only after that wave's builders were done.
3. **A contract that sets a threshold or a guard cites the existing constant it must
   match (`SLIP_COVERAGE`, not a fresh fraction) and names the degenerate inputs the
   guard must survive (one pad played, a two-stroke pad, no expected strokes).** Two of
   wave 13's three reds were architect-written rules that a builder implemented
   faithfully: a half-coverage rule diagnosed a displaced limb from one late stroke on a
   two-stroke snare, and a guard let a learner who played only the hi-hat be told the
   silent limbs were "right."
4. **When a brief's contract names the unit a pass shifts by, the architect states which
   grid it is — nominal vs swung — and the builder's first test proves a one-step
   displacement reads as one step.** A wrong displacement number is the F1 bug class, and
   it survived a green suite twice: wave 11's slip-step pass measured swung gaps against
   the nominal grid, and wave 12's fix itself first shifted by the smallest SWUNG gap (158
   ticks) instead of the nominal cell (240 ticks) before the root cause was isolated.
5. **The pre-commit hook's visual-pass receipt hashes `src/app/**/*.tsx` INCLUDING test
   files** — a test-only edit under `src/app` after the passes makes the receipt stale.
   Run the passes last.
6. **A review fix to timing/audio code is re-reviewed by the same Opus agent until it
   says green.** The architect never accepts "all findings applied" as green. Wave 13's
   MIDI-nits review needed a third round because the architect's own suggested fix (reset
   the hat on every `MIDIAccess` statechange) dropped a genuinely ringing hat's note-off
   when an unrelated device — the learner's piano — was plugged in; wave 11's swing and
   MIDI-out reviews each needed a second and third round for the same reason.
7. **The orphan-signals scan is a gate on every slice.** A function that takes a core
   record and reads one field adds a row that pushes a ground-truth row out of the capped
   table, and `npm run verify` goes red on a test about something else. Three builders were
   sent back for this. Every brief for `src/core/drums` says: pass the fields, not the record.
8. **When a builder removes a throw, read what replaced it.** The openings builder swapped a
   throw for a fallback plan; the UI happily ran and graded the fallback under a "nothing to
   drill" line. Empty states must disable the control, not only show text.
9. **Brief examples must come from the code.** The swing brief said 240→320; the code's
   `subdivisionCellTick` rounds to 322. The builder followed the code (right), but a weaker
   builder would have followed the brief. Run the function before writing the number.
10. **A field carried through the types but never rendered is dead data.** Milestone `how`
    text existed in core and reached nobody until the main-thread read caught it.
11. **Visual-pass receipt hashes the whole working tree** (`src/app/**/*.tsx` +
    `src/design-system/**/*.css`). Run the passes once per wave after every `.tsx` has
    settled, copy the last receipt, then commit. Any later `.tsx` edit invalidates it.
    `VISUAL_PASS_SKIP="<reason>"` is the sanctioned escape; `--no-verify` is not.
12. **Per-spec e2e ports.** Builders run `E2E_PORT=5291|5292|5293 npx playwright test
    e2e/<spec>` (one port per builder) so three parallel builders never share a server.
    `npm run verify`'s e2e gate picks its own random port.
13. **Node ICU renders September as "Sept" in en-GB.** Tests compute expected dates through
    the same formatter (`formatDay`) rather than hard-coding the string.
14. **A killed builder leaves an empty output file.** Its report is lost; its edits stay in
    the tree. Let a builder finish, or ask it (SendMessage) for a report before stopping it.
15. **`npm run verify` takes about ten minutes.** Run it once per wave, in the background,
    logged to the scratchpad; read the tail with `grep -E "passed|failed|error"`.
16. **Context compaction happens.** Keep `next-steps-wave<N>.md` in the scratchpad and a
    memory pointer current at the end of every wave so a resume costs one file read.
17. **Grader tolerance after swing.** The smallest subdivision gap on a swung groove is 158
    ticks (not 240); check the tolerance cap and wait-mode boundaries in the Opus review.
18. **Run `visual-pass.mjs` with the default `--out` (`./visual-pass`), or copy the receipt
    there before committing.** The pre-commit hook reads only `./visual-pass/receipt.json`;
    wave 11's passes wrote receipts into scratchpad `--out` dirs, and the hook called the
    receipt stale until the newest one was copied to the default path.
19. **A disabled control whose only enabler is the control itself is a deadlock.** The
    wave-11 Settings "MIDI out" option was disabled until connected, but only selecting it
    connected. The test must click through the UI, not seed the route programmatically —
    a seeded-state test passed while the real deadlock stood.
20. **Out-of-order scheduling.** Trainers dispatch a pass up front with future `atMs` while
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
