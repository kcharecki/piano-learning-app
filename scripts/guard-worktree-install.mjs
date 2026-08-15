#!/usr/bin/env node
/**
 * npm "preinstall" guard: refuse to run npm install / ci / prune inside a git
 * worktree.
 *
 * Why this exists (2026-08-15): every worktree gets a `node_modules` JUNCTION
 * back to the main checkout's tree (scripts/worktrees.mjs, docs/WORKTREES.md),
 * so npm running in a worktree mutates the SHARED tree — and it does so
 * against the worktree branch's package.json/lockfile, which is usually
 * behind master. A UI-37 session's `npm ci` pruned the main checkout's
 * node_modules down to 343 packages against a stale package.json and broke
 * `vitest` for every parallel session at once. A rule that can be violated
 * silently will be, so it is enforced here, not in prose.
 *
 * Escape hatch for a deliberate, single-session repair:
 *   ALLOW_WORKTREE_INSTALL=1 npm install
 */
import { execFileSync } from 'node:child_process'

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

if (process.env.ALLOW_WORKTREE_INSTALL === '1') process.exit(0)

const gitDir = git(['rev-parse', '--absolute-git-dir'])
const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'])

// Not a repo, or the main checkout: fine.
if (!gitDir || !commonDir || gitDir === commonDir) process.exit(0)

console.error(
  '\nREFUSED: npm install/ci inside a git worktree.\n' +
    'node_modules here is a junction to the MAIN checkout\'s shared tree; npm run here\n' +
    'would rewrite that shared tree against this branch\'s stale package.json and break\n' +
    'every parallel session (it happened: docs/retro-log.md, 2026-08-15).\n' +
    'If a dependency is missing, report it to the integrator session instead.\n' +
    'Deliberate override (main-checkout repair only): ALLOW_WORKTREE_INSTALL=1 npm install\n',
)
process.exit(1)
