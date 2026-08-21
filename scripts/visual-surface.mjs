#!/usr/bin/env node
/**
 * What "the visual surface" means, in one place.
 *
 * `scripts/visual-pass.mjs` stamps a receipt with this hash and
 * `scripts/check-visual-pass.mjs` re-computes it at commit time; if the two
 * scripts disagreed about which files count, the gate would either wave
 * through a changed screen or block on a file nobody can see. So both import
 * from here and neither owns the definition.
 *
 * The surface is the files that decide what a learner LOOKS at: React
 * components under `src/app` and the stylesheets under `src/design-system`.
 * Deliberately narrow — `.test.tsx` is excluded (a test cannot change a
 * pixel), and so is every `.ts` module, store and core file, because those are
 * what the 4700-test suite already covers. The gate is for the defect class
 * tests cannot see.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SURFACE_ROOTS = [
  { dir: join('src', 'app'), matches: (name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx') },
  { dir: join('src', 'design-system'), matches: (name) => name.endsWith('.css') },
]

function walk(root, dir, matches, found) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found // a root that does not exist yet is an empty surface, not a crash
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(root, full, matches, found)
    else if (matches(entry.name)) found.push(full)
  }
  return found
}

/** Every file on the visual surface, repo-relative and POSIX-separated, sorted. */
export function surfaceFiles(cwd) {
  const found = []
  for (const { dir, matches } of SURFACE_ROOTS) walk(cwd, join(cwd, dir), matches, found)
  return found.map((f) => relative(cwd, f).split(sep).join('/')).sort()
}

/**
 * A content hash of the whole surface. Content, not mtimes: a checkout, a
 * rebase or a `git stash pop` rewrites mtimes without changing a pixel, and a
 * gate that fired on those would teach the session to route around it.
 */
export function surfaceHash(cwd) {
  const digest = createHash('sha256')
  for (const file of surfaceFiles(cwd)) {
    digest.update(file)
    digest.update('\0')
    digest.update(createHash('sha256').update(readFileSync(join(cwd, file))).digest('hex'))
    digest.update('\n')
  }
  return digest.digest('hex')
}

/**
 * True for a staged path that this gate is about. Same rules as the walk above.
 *
 * Backslashes are normalised unconditionally, not via `path.sep`: `git diff`
 * reports POSIX paths even on Windows, so a `sep`-based split would be a
 * no-op there and the one platform that needs it is the one that would not
 * get it.
 */
export function isSurfacePath(path) {
  const p = path.replace(/\\/g, '/')
  if (p.startsWith('src/app/')) return p.endsWith('.tsx') && !p.endsWith('.test.tsx')
  if (p.startsWith('src/design-system/')) return p.endsWith('.css')
  return false
}
