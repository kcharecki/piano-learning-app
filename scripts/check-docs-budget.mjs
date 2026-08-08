// Hard line budgets for the docs every session re-reads. A budget failure means "archive
// or compress", never "raise the number without a reason in docs/retro-log.md".
import { readFileSync } from 'node:fs';

const BUDGETS = [
  ['ROADMAP.md', 800],
  ['CLAUDE.md', 160],
  ['docs/PROCESS.md', 160],
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
