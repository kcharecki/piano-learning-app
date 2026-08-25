// Hard budgets for the docs every session re-reads. A budget failure means "archive or
// compress", never "raise the number without a reason in docs/retro-log.md".
//
// Measured in ESTIMATED TOKENS, not lines. These files are consumed as LLM context and
// context is priced in tokens; lines were a poor proxy twice over. Density across the
// budgeted set ran 56 to 89 bytes per line, so one "160-line" budget bought very different
// amounts of context depending on the file. And lines were gameable: rewrapping at 100
// columns instead of 80 cut the count by a quarter while saving nothing at all. Bytes/4 is
// deterministic, needs no tokenizer dependency, and lands within ~10% on markdown — plenty
// for a budget. It also prices tables and code fences at what they actually cost.
//
// Two mechanisms, because there are two different failure modes:
//
//   Per-file caps stop any one doc from eating the whole allowance, and are set with real
//   headroom — roughly current + 25%. The unit of growth here is one rule, 100 to 300
//   tokens, and headroom has to fit two or three of those. When it fits zero, a new rule can
//   only be paid for by deleting an existing one, which is how this gate spent 2026-08-24
//   and 2026-08-25 being raised reactively on the day a rule landed.
//
//   Read-set aggregates bound what a session actually pays, which is a sum, not a maximum.
//   They are what makes a trade possible without a deletion: PROCESS.md may grow 400 tokens
//   if AGENTS.md sheds 400, and the total stays put. docs/PROCESS.md already tracked this
//   sum as a prose retro metric; it lives here now, per the standing rule that a hard rule
//   belongs in automation rather than in a sentence.
//
// A warning band at 90% is the other half of the fix. The first signal used to be a red
// build on the day a rule landed, which forced raise-or-delete under pressure. A warning
// nagging for three sessions makes the compress pass a scheduled choice instead.
//
// History of the numbers:
//   2026-08-11  ROADMAP.md raised 800 -> 1500 lines at the user's explicit direction ("let's
//               drop this 800 budget, it can be longer"), after a twelve-session parallel
//               round pushed it to 929 lines in one day. 800 was forcing an archive pass
//               mid-round, which is not what the budget is for.
//   2026-08-20  CLAUDE.md's budget went vacuous when its body moved to AGENTS.md and it
//               became a one-line `@AGENTS.md` include — the 101 real lines were unbudgeted.
//               AGENTS.md was budgeted under the same number; CLAUDE.md kept its entry so
//               re-inlining the body could not slip through.
//   2026-08-25  Two things at once. CLAUDE.md's guard was found never to have been able to
//               fire: its cap (160 lines) was larger than the AGENTS.md body it guards
//               against (126), so the re-inlining it exists to catch would have passed. Its
//               budget is now 50 tokens, comfortably under any real body and over the
//               include itself. And the whole gate moved from lines to tokens, with the
//               aggregates and the warning band above. Recorded in docs/retro-log.md.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Warn once a file or set is at this fraction of its budget. Non-fatal. */
export const WARN_AT = 0.9;

/** Per-file ceilings in estimated tokens. Backstops, not the main gate — see READ_SETS. */
export const FILE_BUDGETS = [
  ['ROADMAP.md', 28000],
  ['CLAUDE.md', 50],
  ['AGENTS.md', 2300],
  ['docs/PROCESS.md', 3500],
  ['docs/commands/improve-app.md', 4600],
  ['docs/improve/method.md', 3500],
];

// What a session actually pays, by how these docs are really loaded. ROADMAP.md is in no
// set on purpose: sessions triage it, skimming rows, and never read it in full.
export const READ_SETS = [
  { name: 'every session', members: ['CLAUDE.md', 'AGENTS.md'], budget: 2300 },
  { name: '/next', members: ['CLAUDE.md', 'AGENTS.md', 'docs/PROCESS.md'], budget: 5500 },
  {
    name: '/improve-app',
    members: ['CLAUDE.md', 'AGENTS.md', 'docs/commands/improve-app.md', 'docs/improve/method.md'],
    budget: 10000,
  },
];

/** Estimated tokens for a markdown document. Bytes/4 — see the header for why. */
export function estimateTokens(text) {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

/**
 * Check measured sizes against the budgets. Pure — no filesystem — so tests drive it
 * directly. `sizes` maps each budgeted file to its estimated token count, or to `null` when
 * the file could not be read. Returns `{ errors, warnings }`, both arrays of strings; a
 * non-empty `errors` is what fails the build.
 */
export function checkBudgets(sizes, fileBudgets = FILE_BUDGETS, readSets = READ_SETS) {
  const errors = [];
  const warnings = [];
  const sizeOf = (file) => (sizes instanceof Map ? sizes.get(file) : sizes[file]);

  for (const [file, budget] of fileBudgets) {
    const tokens = sizeOf(file);
    if (tokens === null || tokens === undefined) {
      errors.push(`${file}: budgeted but missing. Restore it, or drop its budget entry.`);
      continue;
    }
    if (tokens > budget) {
      errors.push(
        `${file}: ~${tokens} tokens exceeds its budget of ${budget}. Archive or compress it.`,
      );
    } else if (tokens >= budget * WARN_AT) {
      warnings.push(
        `${file}: ~${tokens} tokens is ${Math.round((tokens / budget) * 100)}% of its ${budget} budget. Plan a compress pass before it fails.`,
      );
    }
  }

  for (const { name, members, budget } of readSets) {
    if (members.some((file) => sizeOf(file) === null || sizeOf(file) === undefined)) continue;
    const total = members.reduce((sum, file) => sum + sizeOf(file), 0);
    if (total > budget) {
      errors.push(
        `read-set "${name}" (${members.join(' + ')}): ~${total} tokens exceeds its budget of ${budget}. Compress one of them, or trade between them — the total is what a session pays.`,
      );
    } else if (total >= budget * WARN_AT) {
      warnings.push(
        `read-set "${name}": ~${total} tokens is ${Math.round((total / budget) * 100)}% of its ${budget} budget. Plan a compress pass before it fails.`,
      );
    }
  }

  return { errors, warnings };
}

/** Measure every budgeted file, `null` for one that cannot be read. */
export function measure(fileBudgets = FILE_BUDGETS, root = new URL('../', import.meta.url)) {
  const sizes = new Map();
  for (const [file] of fileBudgets) {
    try {
      sizes.set(file, estimateTokens(readFileSync(new URL(file, root), 'utf8')));
    } catch {
      sizes.set(file, null);
    }
  }
  return sizes;
}

function main() {
  const { errors, warnings } = checkBudgets(measure());
  for (const warning of warnings) console.log(`docs budget warning — ${warning}`);
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
