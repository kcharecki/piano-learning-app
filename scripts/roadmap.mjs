#!/usr/bin/env node
/**
 * Print the open Triage items from the MAIN CHECKOUT's `ROADMAP.md`, whatever
 * directory this is run from.
 *
 * Why this exists: on 2026-08-25 a `cd` into `.claude/worktrees/w-dr02` inside
 * one Bash call persisted into the next, and the session then read
 * `ROADMAP.md`, `docs/PROCESS.md` and `docs/drums/ROADMAP.md` out of a
 * nine-day-old worktree. It triaged against that file — believed four items
 * were open when ten were, and planned to tick four boxes that were already
 * ticked on `master`. Nothing failed; the files were real, readable and wrong.
 * It surfaced only because an unrelated assertion happened to disagree.
 *
 * `git rev-parse --git-common-dir` is the fix: from a worktree it resolves to
 * the MAIN checkout's `.git`, so the roadmap this prints is always the one the
 * integrator merges into, and a stale copy in the working directory cannot be
 * mistaken for it. The path it read is printed with every run — no output here
 * is anonymous, because "which file was this?" is exactly the question the
 * incident could not answer.
 *
 *   node scripts/roadmap.mjs            open Triage items
 *   node scripts/roadmap.mjs --all      every open item, all sections
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The main checkout's root, from its `.git` directory. Worktrees resolve to the same one. */
export function mainCheckoutRoot(gitCommonDir) {
  return resolve(dirname(resolve(gitCommonDir)))
}

/**
 * Open checklist rows, as `{id, title}`.
 *
 * A row is `- [ ] <id> <title…>` and continues over indented lines until the
 * next row or heading; only the first line is kept, because the point is to
 * see WHAT IS OPEN at a glance, not to reproduce the file (which is what blew
 * the read-set budget the docs gate now measures).
 *
 * `[~]` counts as open — `docs/drums/ROADMAP.md` uses it for a task whose core
 * slice landed and whose app half has not, and a partially-done task is
 * emphatically not a done one.
 */
export function openItems(markdown, { section } = {}) {
  const lines = markdown.split('\n')
  const out = []
  let inSection = section === undefined
  for (const line of lines) {
    if (line.startsWith('## ')) {
      inSection = section === undefined || line.slice(3).trim().startsWith(section)
      continue
    }
    if (!inSection) continue
    const match = /^- \[([ ~])\] (?:\*\*)?([A-Za-z0-9.\-]+)\)?\s*(.*)$/.exec(line)
    if (match === null) continue
    const title = (match[3] ?? '').replace(/\*\*/g, '').trim()
    out.push({ mark: match[1], id: match[2], title })
  }
  return out
}

function main() {
  const all = process.argv.includes('--all')
  const gitCommonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim()
  const root = mainCheckoutRoot(gitCommonDir)
  const path = join(root, 'ROADMAP.md')
  const markdown = readFileSync(path, 'utf8')
  const items = openItems(markdown, all ? {} : { section: 'Triage' })

  console.log(`ROADMAP.md — ${path}`)
  const here = resolve(process.cwd())
  if (!here.startsWith(root)) console.log(`  (read from the main checkout; cwd is ${here})`)
  console.log(`${items.length} open ${all ? 'item' : 'Triage item'}(s):`)
  for (const item of items) {
    console.log(`  [${item.mark}] ${item.id}  ${item.title.slice(0, 96)}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
