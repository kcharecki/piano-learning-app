#!/usr/bin/env node
/**
 * Parallel-session coordination for /next (docs/WORKTREES.md).
 *
 *   node scripts/worktrees.mjs status         every claim, both kinds, one table
 *   node scripts/worktrees.mjs claim <id>     atomic main-checkout claim (fails if taken)
 *   node scripts/worktrees.mjs release <id>   release a main-checkout claim
 *
 * Two claim kinds, both visible to every session through the shared .git:
 *
 *  - WORKTREE claim: a branch named `task/<id>`. Made by renaming the worktree's
 *    branch (`git branch -m task/<id>`); the rename FAILS if the branch exists,
 *    so a race between two sessions self-resolves — the loser picks another task.
 *  - MAIN-CHECKOUT claim: a ref `refs/claims/<id>`, created here with the
 *    create-only form of update-ref (old value = ""), so it is atomic too.
 *    `main-checkout` is a reserved id: it is the integrator lock. A /next that
 *    fails to claim it must NOT work in the main checkout — a session is already
 *    there — and moves itself into a worktree instead (docs/WORKTREES.md).
 *
 * Why two kinds: git worktrees may not share a working tree, so a worktree
 * session's claim is naturally its branch; but a main-checkout session works on
 * master and has no branch to claim with — 2026-08-08, two /next sessions both
 * landed in the main checkout, both saw "no claims", and both started T.2.
 *
 * Each branch claim also gets a deterministic dev/e2e PORT (5200–5899, hashed
 * from the branch name) so parallel sessions never share a server or an origin —
 * a shared origin means a shared IndexedDB, and playwright's
 * `reuseExistingServer` would test one session's specs against another
 * session's app. The main checkout keeps 5173.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Gives the current worktree a `node_modules` link back to the main checkout's,
 * if it is a worktree and has none. Returns the path it created, or undefined.
 *
 * Node's own resolver walks ancestor directories, and worktrees live under the
 * repo root, so `npm test`, `tsc` and `eslint` all work in a fresh worktree with
 * zero setup — which is exactly why this went unnoticed. `knip` is the one tool
 * in `verify:full` that does NOT walk: it classifies dependencies against a
 * `node_modules` directory inside the workspace it is pointed at, finds none,
 * and exits 1. So `npm run verify:full` — the only gate that runs e2e — could
 * not pass anywhere except the main checkout, while most sessions work in a
 * worktree. The 2026-08-12 M4 acceptance pass spent a criterion mis-filing that
 * as a repo defect before its control experiment found the real cause.
 *
 * A junction (Windows) or directory symlink (POSIX) costs no install and no
 * disk. It is created here rather than documented as a manual step because a
 * setup instruction that can be skipped silently will be
 * (docs/PROCESS.md: enforce in automation, not prose). `git worktree remove`
 * deletes it with the rest of the worktree.
 */
function ensureNodeModulesLink() {
  const gitDir = git(['rev-parse', '--absolute-git-dir'])
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (!gitDir || !commonDir || gitDir === commonDir) return undefined // main checkout
  const top = git(['rev-parse', '--show-toplevel'])
  if (!top) return undefined
  const link = join(top, 'node_modules')
  if (existsSync(link)) return undefined
  const target = join(dirname(commonDir), 'node_modules')
  if (!existsSync(target)) return undefined
  try {
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    return link
  } catch {
    // Best effort only: a sandbox that forbids symlinks still leaves every
    // other tool working, and `knip` is skippable (see WORKTREES.md).
    return undefined
  }
}

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (err) {
    if (opts.orThrow) throw err
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

const [command = 'status', id] = process.argv.slice(2)

if (command === 'claim') {
  if (!id) {
    console.error('usage: worktrees.mjs claim <task-id | main-checkout>')
    process.exit(2)
  }
  // The two claim kinds never cross-check each other automatically — a
  // worktree session claims by `git branch -m task/<id>`, a raw git command
  // this script cannot intercept, so it can only guard its OWN half: refuse a
  // main-checkout claim for an id a worktree branch already holds. (2026-08-08:
  // a main-checkout session claimed 5.5a via this ref while a worktree session
  // independently renamed onto `task/5.5a`, and neither side's claim was
  // visible to the other's check — both implemented the same roadmap task.)
  if (id !== 'main-checkout' && git(['rev-parse', '--verify', '--quiet', `refs/heads/task/${id}`])) {
    console.error(`ALREADY CLAIMED: ${id} — a worktree branch task/${id} already holds it. ` +
      'Pick a different task.')
    process.exit(1)
  }
  try {
    // Create-only: old value "" means the ref must not exist. Atomic under races.
    git(['update-ref', `refs/claims/${id}`, 'HEAD', ''], { orThrow: true })
    console.log(`claimed ${id} (refs/claims/${id})`)
  } catch {
    console.error(`ALREADY CLAIMED: ${id} — another session holds it. Pick a different task` +
      (id === 'main-checkout' ? ', or move this session into a worktree (docs/WORKTREES.md).' : '.'))
    process.exit(1)
  }
} else if (command === 'release') {
  if (!id) {
    console.error('usage: worktrees.mjs release <task-id | main-checkout>')
    process.exit(2)
  }
  git(['update-ref', '-d', `refs/claims/${id}`])
  console.log(`released ${id}`)
} else {
  // Every worktree session runs `status` before it picks up work
  // (docs/WORKTREES.md), which makes it the one reliable place to repair the
  // worktree's own tooling — see `ensureNodeModulesLink`.
  const linked = ensureNodeModulesLink()
  if (linked) console.log(`linked ${linked} -> the main checkout's node_modules, so knip (and thus verify:full) works here`)

  const entries = worktreeEntries()
  const main = entries[0]
  const byBranch = new Map(entries.slice(1).map((e) => [e.branch, e]))
  const taskBranches = git(['branch', '--list', 'task/*', '--format=%(refname:short)'])
    .split('\n')
    .filter(Boolean)
  const refClaims = git(['for-each-ref', 'refs/claims', '--format=%(refname:lstrip=2)'])
    .split('\n')
    .filter(Boolean)

  const lock = refClaims.includes('main-checkout')
  console.log(`main checkout: ${main?.path ?? '?'} (branch ${main?.branch ?? '?'}, port 5173) — ` +
    (lock ? 'LOCKED by an active session; any other session must work in a worktree' : 'no session lock'))

  for (const e of entries.slice(1).filter((e) => !e.branch?.startsWith('task/'))) {
    console.log(`worktree with NO claim yet: ${e.path} (branch ${e.branch ?? 'detached'}) — /next there should claim by renaming the branch to task/<id>`)
  }

  const mainClaims = refClaims.filter((c) => c !== 'main-checkout')
  if (taskBranches.length === 0 && mainClaims.length === 0) {
    console.log('claims: none — every roadmap task is up for grabs.')
  } else {
    console.log('claims:')
    for (const branch of taskBranches) {
      const taskId = branch.slice('task/'.length)
      const wt = byBranch.get(branch)
      const last = git(['log', '-1', '--format=%cr — %s', branch]) || 'no commits'
      const ahead = git(['rev-list', '--count', `${main?.branch ?? 'master'}..${branch}`]) || '0'
      const dirty = wt ? (git(['status', '--porcelain'], { cwd: wt.path }) ? 'DIRTY' : 'clean') : null
      const state = wt
        ? `active in ${wt.path} (${dirty}, ${ahead} commit(s) ahead)`
        : ahead === '0'
          ? 'STALE: no worktree, no commits ahead — delete the branch'
          : `AWAITING MERGE: worktree gone, ${ahead} commit(s) ahead — integrate from the main checkout`
      console.log(`  task ${taskId}  [worktree branch ${branch}]  port ${portFor(branch)}  last: ${last}`)
      console.log(`           ${state}`)
    }
    for (const claim of mainClaims) {
      const at = git(['log', '-1', '--format=%cr', `refs/claims/${claim}`]) || '?'
      console.log(`  task ${claim}  [main-checkout claim]  claimed at or after a commit from ${at}`)
      console.log(`           active in the main checkout — release with: node scripts/worktrees.mjs release ${claim}`)
    }
  }
}
