/**
 * Drives `checkBudgets` with hand-built size maps — no filesystem, so the rules are
 * exercised directly rather than through whatever the real docs happen to weigh today.
 * `main()` (the CLI entry point) is exercised separately by spawning the real script, which
 * is the only way to see its exit code and its warning-vs-error stream split.
 *
 * The real budgets are asserted too, but only for the properties that must hold whatever
 * the numbers are: that CLAUDE.md's guard can actually fire, and that no aggregate is set
 * so loosely that it can never bind.
 */
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  checkBudgets,
  estimateTokens,
  measure,
  FILE_BUDGETS,
  READ_SETS,
  WARN_AT,
} from './check-docs-budget.mjs'

const SCRIPT = fileURLToPath(new URL('./check-docs-budget.mjs', import.meta.url))

const FILES = [
  ['a.md', 1000],
  ['b.md', 1000],
]
const SETS = [{ name: 'both', members: ['a.md', 'b.md'], budget: 1500 }]

const check = (sizes) => checkBudgets(sizes, FILES, SETS)

describe('estimateTokens', () => {
  it('counts bytes over four, rounded up', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('prices multi-byte characters at what they cost, not at one per character', () => {
    // The docs are full of these — E♭, ♩=120, en dashes. A character count would call this
    // 3 and under-report the real context cost by a third.
    expect(estimateTokens('E♭4')).toBe(estimateTokens('E___4'))
  })
})

describe('checkBudgets — per file', () => {
  it('passes a file under budget with nothing to say', () => {
    const { errors, warnings } = check({ 'a.md': 100, 'b.md': 100 })
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  it('fails a file over budget, and says archive or compress rather than raise', () => {
    const { errors } = check({ 'a.md': 1001, 'b.md': 100 })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('a.md: ~1001 tokens exceeds its budget of 1000')
    expect(errors[0]).toContain('Archive or compress it')
  })

  it('warns without failing at the warn band, and stays quiet one token below it', () => {
    const at = check({ 'a.md': 1000 * WARN_AT, 'b.md': 100 })
    expect(at.errors).toEqual([])
    expect(at.warnings).toHaveLength(1)
    expect(at.warnings[0]).toContain('90% of its 1000 budget')

    const below = check({ 'a.md': 1000 * WARN_AT - 1, 'b.md': 100 })
    expect(below.warnings).toEqual([])
  })

  it('does not warn about a file it is already failing — one message per file', () => {
    // Over its own cap of 1000, but the pair still sits well inside the set's 1500 — so the
    // file is the only thing being reported on, and it must be reported once.
    const { errors, warnings } = check({ 'a.md': 1200, 'b.md': 50 })
    expect(errors).toHaveLength(1)
    expect(warnings).toEqual([])
  })

  it('fails a budgeted file that is missing, rather than throwing or skipping it', () => {
    const { errors } = check({ 'a.md': null, 'b.md': 100 })
    expect(errors[0]).toContain('a.md: budgeted but missing')
  })

  it('reports every file over budget, not just the first', () => {
    const { errors } = check({ 'a.md': 2000, 'b.md': 2000 })
    expect(errors).toHaveLength(3) // both files, plus the set they are both in
  })
})

describe('checkBudgets — read-set aggregates', () => {
  it('fails a set whose total is over, even when every file in it is under its own cap', () => {
    const { errors } = check({ 'a.md': 900, 'b.md': 900 })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('read-set "both"')
    expect(errors[0]).toContain('~1800 tokens exceeds its budget of 1500')
    expect(errors[0]).toContain('the total is what a session pays')
  })

  it('allows a trade — one file grows, another sheds, the total holds', () => {
    expect(check({ 'a.md': 750, 'b.md': 750 }).errors).toEqual([])
    expect(check({ 'a.md': 950, 'b.md': 550 }).errors).toEqual([])
  })

  it('warns on a set at the band', () => {
    const { errors, warnings } = check({ 'a.md': 700, 'b.md': 650 })
    expect(errors).toEqual([])
    expect(warnings.some((w) => w.includes('read-set "both": ~1350'))).toBe(true)
  })

  it('skips a set with a missing member — the missing file is already the error', () => {
    const { errors } = check({ 'a.md': null, 'b.md': 100 })
    expect(errors).toHaveLength(1)
    expect(errors.some((e) => e.includes('read-set'))).toBe(false)
  })

  it('takes a Map as well as an object', () => {
    const sizes = new Map([
      ['a.md', 900],
      ['b.md', 900],
    ])
    expect(checkBudgets(sizes, FILES, SETS).errors).toHaveLength(1)
  })
})

describe('the real budgets', () => {
  const budgetOf = (file) => FILE_BUDGETS.find(([f]) => f === file)?.[1]

  it('are all met right now', () => {
    const { errors } = checkBudgets(measure())
    expect(errors).toEqual([])
  })

  // The 2026-08-20 entry existed only to catch AGENTS.md's body being re-inlined into
  // CLAUDE.md, and until 2026-08-25 it could not: its cap was larger than that body. This
  // pins the relationship rather than the number, so the guard cannot go vacuous again as
  // AGENTS.md grows.
  it("keep CLAUDE.md's guard able to fire — its cap is under the AGENTS.md body it guards", () => {
    expect(budgetOf('CLAUDE.md')).toBeLessThan(measure().get('AGENTS.md'))
  })

  it('keep every read-set tighter than the sum of its members caps, or it can never bind', () => {
    for (const { name, members, budget } of READ_SETS) {
      const sumOfCaps = members.reduce((sum, file) => sum + budgetOf(file), 0)
      expect(budget, `read-set "${name}"`).toBeLessThan(sumOfCaps)
    }
  })

  it('budget every member of every read-set', () => {
    for (const { members } of READ_SETS) {
      for (const file of members) expect(budgetOf(file)).toBeDefined()
    }
  })
})

describe('the CLI', () => {
  const run = () => spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })

  it('exits 0 on the real docs and prints nothing to stderr', () => {
    const result = run()
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
