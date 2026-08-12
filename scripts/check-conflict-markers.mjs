// Fails the build if a merge-conflict marker survived into a tracked file.
//
// Added 2026-08-12, after one did: a twelve-branch parallel round put ROADMAP.md
// through eight merges, and a hand-resolved conflict left a `<<<<<<< HEAD` line
// behind. `verify` stayed green the whole time, because nothing lints markdown —
// typecheck, eslint and vitest all have no opinion about a prose file. The rule
// "resolve every marker" is exactly the kind that gets mostly followed, so it
// belongs in the gate rather than in a doc.
//
// Scans `git ls-files` (tracked, non-binary only) rather than walking the tree,
// so worktrees, node_modules and build output are excluded for free.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Anchored at line start, and `=======` needs its own guard: a markdown h1
// underline is exactly that string, so it only counts as a marker when one of
// the other two is present in the same file.
const START = /^<{7}( |$)/m;
const END = /^>{7}( |$)/m;
const MIDDLE = /^={7}$/m;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const offenders = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  } catch {
    continue; // deleted-but-tracked, or unreadable as UTF-8 (binary)
  }
  if (text.includes('\0')) continue;
  const hasFence = START.test(text) || END.test(text);
  if (!hasFence && !MIDDLE.test(text)) continue;
  if (!hasFence) continue;
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (/^(<{7}|={7}|>{7})( |$)/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
  }
}

if (offenders.length > 0) {
  console.error('Merge-conflict markers left in tracked files:');
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
