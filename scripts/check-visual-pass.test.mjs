/**
 * The visual-pass commit gate (`scripts/check-visual-pass.mjs`).
 *
 * Both arms are pinned, not just the failing one: a gate that fires on
 * everything is as useless as one that fires on nothing, and this one is meant
 * to be silent for the many commits that touch no screen.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readReceipt, visualPassVerdict } from './check-visual-pass.mjs'
import { isSurfacePath, surfaceFiles, surfaceHash } from './visual-surface.mjs'

const HASH = 'a'.repeat(64)
const receipt = (overrides = {}) => ({
  destination: 'Groove',
  at: '2026-08-21T22:00:00.000Z',
  surfaceHash: HASH,
  ...overrides,
})

describe('isSurfacePath', () => {
  it('counts components and stylesheets, which are what a learner looks at', () => {
    expect(isSurfacePath('src/app/drums/groove/GrooveTrainerScreen.tsx')).toBe(true)
    expect(isSurfacePath('src/design-system/css/feature-drums-groove.css')).toBe(true)
  })

  /** A test cannot change a pixel, and a store's shape is what the 4700-test suite is for. */
  it('ignores tests, non-component modules and every layer below the UI', () => {
    expect(isSurfacePath('src/app/drums/groove/GrooveTrainerScreen.test.tsx')).toBe(false)
    expect(isSurfacePath('src/app/state/drumsHistoryStore.ts')).toBe(false)
    expect(isSurfacePath('src/core/drums/practice/grade.ts')).toBe(false)
    expect(isSurfacePath('docs/PROCESS.md')).toBe(false)
  })

  it('reads a Windows path the same as a POSIX one, because git and the walk disagree', () => {
    expect(isSurfacePath(String.raw`src\app\drums\DrumsTodayScreen.tsx`)).toBe(true)
  })
})

describe('surfaceFiles / surfaceHash', () => {
  it('finds the real surface, sorted, tests excluded', () => {
    const files = surfaceFiles(process.cwd())
    expect(files).toContain('src/app/drums/groove/GrooveTrainerScreen.tsx')
    expect(files).toContain('src/design-system/css/feature-drums-groove.css')
    expect(files.some((f) => f.endsWith('.test.tsx'))).toBe(false)
    expect([...files].sort()).toEqual(files)
  })

  it('hashes content, so the same tree hashes the same twice', () => {
    expect(surfaceHash(process.cwd())).toBe(surfaceHash(process.cwd()))
  })

  it('is an empty surface, not a crash, when the roots do not exist', () => {
    const empty = mkdtempSync(join(tmpdir(), 'surface-'))
    expect(surfaceFiles(empty)).toEqual([])
    expect(surfaceHash(empty)).toHaveLength(64)
  })
})

describe('visualPassVerdict', () => {
  it('says nothing at all when the commit touches no screen', () => {
    const verdict = visualPassVerdict({
      staged: ['src/core/drums/practice/grade.ts', 'ROADMAP.md'],
      receipt: undefined,
      hash: HASH,
    })
    expect(verdict).toEqual({ ok: true, message: '' })
  })

  it('fails a staged screen with no receipt, and names the command that makes one', () => {
    const verdict = visualPassVerdict({
      staged: ['src/app/drums/groove/GrooveTrainerScreen.tsx'],
      receipt: undefined,
      hash: HASH,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('scripts/visual-pass.mjs')
  })

  /** The defect this exists for: a pass that ran, then edits that landed after it. */
  it('fails a receipt taken against a different tree', () => {
    const verdict = visualPassVerdict({
      staged: ['src/design-system/css/feature-drums-groove.css'],
      receipt: receipt(),
      hash: 'b'.repeat(64),
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('stale')
    expect(verdict.message).toContain('Groove')
  })

  it('passes a receipt whose hash matches, and says which screen it covers', () => {
    const verdict = visualPassVerdict({
      staged: ['src/app/drums/groove/GrooveTrainerScreen.tsx'],
      receipt: receipt(),
      hash: HASH,
    })
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toContain('Groove')
  })

  it('lists at most five staged files, so a wide refactor does not bury the message', () => {
    const staged = Array.from({ length: 9 }, (_, i) => `src/app/a/S${i}.tsx`)
    const verdict = visualPassVerdict({ staged, receipt: undefined, hash: HASH })
    expect(verdict.message).toContain('+4 more')
  })
})

describe('readReceipt', () => {
  it('treats a corrupt receipt as no receipt rather than throwing mid-commit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'receipt-'))
    const path = join(dir, 'receipt.json')
    writeFileSync(path, '{ not json')
    expect(readReceipt(path)).toBeUndefined()
  })

  it('is undefined when the file is absent', () => {
    expect(readReceipt(join(mkdtempSync(join(tmpdir(), 'receipt-')), 'receipt.json'))).toBeUndefined()
  })
})

describe('the CLI', () => {
  const run = (args, env = {}) =>
    execFileSync(process.execPath, ['scripts/check-visual-pass.mjs', ...args], {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    })

  it('lets an explicit, stated skip through — the auditable alternative to --no-verify', () => {
    expect(run([], { VISUAL_PASS_SKIP: 'comment-only edit' })).toContain('comment-only edit')
  })

  it('exits 2 on an unknown flag rather than passing silently', () => {
    expect(() => run(['--nonsense'])).toThrow(/Command failed/)
  })
})
