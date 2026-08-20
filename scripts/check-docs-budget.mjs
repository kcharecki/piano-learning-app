// Hard line budgets for the docs every session re-reads. A budget failure means "archive
// or compress", never "raise the number without a reason in docs/retro-log.md".
import { readFileSync } from 'node:fs';

// ROADMAP.md was raised from 800 to 1500 on 2026-08-11, at the user's explicit direction
// ("let's drop this 800 budget, it can be longer"), after a twelve-session parallel round
// pushed it to 929 lines in one day. The budget exists to stop the silting that once made
// this file 1685 lines of proof prose re-read every session; it is not meant to force an
// archive pass mid-round, which is what 800 was doing. CLAUDE.md and PROCESS.md keep their
// tighter budgets deliberately — those two are read in full every session, ROADMAP.md is
// triaged from. Recorded in docs/retro-log.md, per the rule above.
// 2026-08-20: CLAUDE.md's budget went vacuous when its body moved to AGENTS.md and it became a
// one-line `@AGENTS.md` include — the 101 real lines were unbudgeted. AGENTS.md is budgeted here
// under the same number, and CLAUDE.md keeps its entry so re-inlining the body cannot slip
// through. The two /improve-app docs are budgeted on the same criterion as the rest: they are
// re-read in full at the start of every run of that command.
const BUDGETS = [
  ['ROADMAP.md', 1500],
  ['CLAUDE.md', 160],
  ['AGENTS.md', 160],
  ['docs/PROCESS.md', 160],
  ['docs/commands/improve-app.md', 200],
  ['docs/improve/method.md', 160],
];

let failed = false;
for (const [file, budget] of BUDGETS) {
  const lines = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n').length;
  if (lines > budget) {
    console.error(`${file}: ${lines} lines exceeds its budget of ${budget}. Archive or compress it.`);
    failed = true;
  }
}
if (failed) process.exit(1);
