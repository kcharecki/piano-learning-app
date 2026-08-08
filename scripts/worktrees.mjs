#!/usr/bin/env node
/**
 * Parallel-session coordination for /next (docs/WORKTREES.md).
 *
 *   node scripts/worktrees.mjs status   the one command; prints every claim
 *
 * A CLAIM is a branch named `task/<roadmap-id>` (e.g. task/5.1). The branch
 * list is shared by every worktree through the common .git directory, so any
 * session — main checkout or worktree — sees the same table without a lock
 * file or a registry that could go stale. Branch gone = claim gone.
 *
 * Each claim also gets a deterministic dev/e2e PORT (5200–5899, hashed from
 * the branch name) so parallel sessions never share a server or an origin —
 * a shared origin would mean a shared IndexedDB, and playwright's
 * `reuseExistingServer` would happily test one session's specs against
 * another session's app. The main checkout keeps 5173.
 */
import { execFileSync } from 'node:child_process'

function git(args, cwd) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

/** Stable port in 5200–5899 for a branch name; the main checkout uses 5173. */
export function portFor(branch) {
  let h = 0
  for (const ch of branch) h = (h * 31 + ch.codePointAt(0)) % 700
  return 5200 + h
}

function worktreeEntries() {
  const out = git(['worktree', 'list', '--porcelain'])
  const entries = []
  let current = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) current = { path: line.slice(9) }
    else if (line.startsWith('branch refs/heads/')) current.branch = line.slice(18)
    else if (line === '' && current.path) {
      entries.push(current)
      current = {}
    }
  }
  if (current.path) entries.push(current)
  return entries
}

const entries = worktreeEntries()
const main = entries[0]
const byBranch = new Map(entries.slice(1).map((e) => [e.branch, e]))
const taskBranches = git(['branch', '--list', 'task/*', '--format=%(refname:short)'])
  .split('\n')
  .filter(Boolean)

console.log(`main checkout: ${main?.path ?? '?'} (branch ${main?.branch ?? '?'}, port 5173)`)

const unclaimedWorktrees = entries.slice(1).filter((e) => !e.branch?.startsWith('task/'))
for (const e of unclaimedWorktrees) {
  console.log(`worktree with NO claim yet: ${e.path} (branch ${e.branch ?? 'detached'}) — /next there should claim a task by renaming the branch to task/<id>`)
}

if (taskBranches.length === 0) {
  console.log('claims: none — every roadmap task is up for grabs.')
} else {
  console.log('claims:')
  for (const branch of taskBranches) {
    const id = branch.slice('task/'.length)
    const wt = byBranch.get(branch)
    const last = git(['log', '-1', '--format=%cr — %s', branch]) || 'no commits'
    const ahead = git(['rev-list', '--count', `${main?.branch ?? 'master'}..${branch}`]) || '0'
    const dirty = wt ? (git(['status', '--porcelain'], wt.path) ? 'DIRTY' : 'clean') : null
    const state = wt
      ? `active in ${wt.path} (${dirty}, ${ahead} commit(s) ahead)`
      : ahead === '0'
        ? 'STALE: no worktree, no commits ahead — delete the branch'
        : `AWAITING MERGE: worktree gone, ${ahead} commit(s) ahead — integrate from the main checkout`
    console.log(`  task ${id}  [${branch}]  port ${portFor(branch)}  last: ${last}`)
    console.log(`           ${state}`)
  }
}
