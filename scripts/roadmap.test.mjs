import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mainCheckoutRoot, openItems } from './roadmap.mjs'

describe('mainCheckoutRoot', () => {
  it('resolves a `.git` directory to the checkout that contains it', () => {
    expect(mainCheckoutRoot('/repo/app/.git')).toBe(resolve('/repo/app'))
  })

  /**
   * The contract this module exists for, asserted against real git rather than
   * against a restatement of the implementation: run `git rev-parse
   * --git-common-dir` INSIDE a worktree and it must resolve to the main
   * checkout — the directory holding this test file's own repo — not to the
   * worktree. A test that fed the same string in twice would prove nothing;
   * this one fails if git's behaviour is not what the module assumes.
   *
   * Skipped when no worktree exists, which is the normal state of a fresh
   * clone. `scripts/worktree-isolation.test.mjs` already establishes that
   * pattern for worktree-dependent checks.
   */
  it('resolves a real worktree to the main checkout, not to itself', () => {
    const here = resolve(import.meta.dirname, '..')
    const worktrees = join(here, '.claude', 'worktrees')
    if (!existsSync(worktrees)) return
    const first = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: here, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length))
      .find((path) => resolve(path) !== here)
    if (first === undefined) return

    const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: first,
      encoding: 'utf8',
    }).trim()
    expect(mainCheckoutRoot(commonDir)).toBe(here)
    expect(mainCheckoutRoot(commonDir)).not.toBe(resolve(first))
  })
})

const SAMPLE = `# Roadmap

## Triage — before any feature work

- [x] T.1 Something already done
      with a continuation line that must not be listed
- [ ] T.18 **\`npm run verify\` has no e2e step.**
      Detail line, deliberately dropped.
- [~] T.30 Half-landed: core slice in, app half pending

## Phase 5

- [ ] 5.99 A feature that is not triage
`

describe('openItems', () => {
  it('lists only the open rows of the named section, one line each', () => {
    expect(openItems(SAMPLE, { section: 'Triage' })).toEqual([
      { mark: ' ', id: 'T.18', title: '`npm run verify` has no e2e step.' },
      { mark: '~', id: 'T.30', title: 'Half-landed: core slice in, app half pending' },
    ])
  })

  it('counts `[~]` as open — a partly-done task is not a done one', () => {
    const marks = openItems(SAMPLE, { section: 'Triage' }).map((i) => i.mark)
    expect(marks).toContain('~')
  })

  it('never lists a ticked row', () => {
    const ids = openItems(SAMPLE, {}).map((i) => i.id)
    expect(ids).not.toContain('T.1')
  })

  it('drops continuation lines — the output is a glance, not the file', () => {
    for (const item of openItems(SAMPLE, {})) {
      expect(item.title).not.toContain('continuation')
      expect(item.title).not.toContain('Detail line')
    }
  })

  it('reaches every section when no section is named', () => {
    expect(openItems(SAMPLE, {}).map((i) => i.id)).toEqual(['T.18', 'T.30', '5.99'])
  })

  it('is empty for a roadmap with nothing open', () => {
    expect(openItems('## Triage\n\n- [x] T.1 done\n', { section: 'Triage' })).toEqual([])
  })
})
