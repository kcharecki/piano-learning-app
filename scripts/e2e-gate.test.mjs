/**
 * The e2e commit gate (`scripts/e2e-gate.mjs`, roadmap T.18).
 *
 * Both directions are pinned. A gate that only ever goes red is switched off
 * within a week, and this project genuinely does commit claim specs before the
 * feature they claim — so "red on purpose stays green" is as much the contract
 * as "red turns the build red".
 */
import { describe, expect, it } from 'vitest'
import { e2eGateVerdict, flattenReport, openRoadmapIdsFrom } from './e2e-gate.mjs'

const ROADMAP = ['T.30', 'DR-09']

/** One valid registry entry; tests override the field under examination. */
const entry = (overrides = {}) => ({
  spec: 'improve-DR-05.spec.ts',
  test: '*',
  roadmap: 'T.30',
  reason: 'the implementation was reverted and the spec is kept as the proof a rebuild must pass',
  ...overrides,
})

const row = (overrides = {}) => ({
  spec: 'improve-DR-05.spec.ts',
  title: 'the staff states the selected groove',
  failed: false,
  flaky: false,
  skipped: false,
  ...overrides,
})

const verdict = (input) =>
  e2eGateVerdict({
    results: [],
    entries: [],
    specFiles: ['e2e/improve-DR-05.spec.ts', 'e2e/smoke.spec.ts'],
    openRoadmapIds: ROADMAP,
    ...input,
  })

describe('flattenReport', () => {
  const report = {
    suites: [
      {
        file: 'smoke.spec.ts',
        specs: [{ file: 'smoke.spec.ts', title: 'boots', tests: [{ status: 'expected' }] }],
        suites: [
          {
            file: 'smoke.spec.ts',
            specs: [
              { file: 'smoke.spec.ts', title: 'nested and broken', tests: [{ status: 'unexpected' }] },
              { file: 'smoke.spec.ts', title: 'nested and skipped', tests: [{ status: 'skipped' }] },
            ],
          },
        ],
      },
    ],
  }

  it('reaches specs inside describe blocks, which is where half of them live', () => {
    expect(flattenReport(report).map((r) => r.title)).toEqual(['boots', 'nested and broken', 'nested and skipped'])
  })

  it('reads Playwright’s vocabulary: unexpected is failed, skipped is neither', () => {
    const rows = flattenReport(report)
    expect(rows.map((r) => r.failed)).toEqual([false, true, false])
    expect(rows.map((r) => r.skipped)).toEqual([false, false, true])
  })

  /**
   * The gate grants one retry, so flaky means "failed once on a loaded
   * machine". What the gate exists to catch fails every attempt, so flaky is
   * reported by name and is not failed — see `flattenReport`'s comment and
   * `playwright.config.ts`'s `retries`.
   */
  it('separates flaky from failed rather than folding one into the other', () => {
    const flaky = { suites: [{ specs: [{ file: 'a.spec.ts', title: 'sometimes', tests: [{ status: 'flaky' }] }] }] }
    expect(flattenReport(flaky)[0]).toEqual({ spec: 'a.spec.ts', title: 'sometimes', failed: false, flaky: true, skipped: false })
  })

  it('survives a report with no suites at all rather than throwing over it', () => {
    expect(flattenReport({})).toEqual([])
    expect(flattenReport(undefined)).toEqual([])
  })
})

describe('e2eGateVerdict — the red direction', () => {
  it('is green over a passing run with nothing declared', () => {
    expect(verdict({ results: [row()] })).toEqual({ ok: true, problems: [], expectedRed: 0 })
  })

  it('names the failing spec and test when nothing declared it', () => {
    const { ok, problems } = verdict({ results: [row({ failed: true })] })
    expect(ok).toBe(false)
    expect(problems).toEqual(['FAILED: improve-DR-05.spec.ts › the staff states the selected groove'])
  })

  it('holds a declared spec to the tests it declared, not to the whole file', () => {
    const { problems } = verdict({
      results: [row({ title: 'declared', failed: true }), row({ title: 'undeclared', failed: true })],
      entries: [entry({ test: 'declared' })],
    })
    expect(problems).toEqual(['FAILED: improve-DR-05.spec.ts › undeclared'])
  })
})

describe('e2eGateVerdict — red on purpose', () => {
  it('lets a whole declared spec fail without turning the gate red', () => {
    const { ok, expectedRed } = verdict({
      results: [row({ failed: true }), row({ title: 'second arm', failed: true })],
      entries: [entry()],
    })
    expect(ok).toBe(true)
    expect(expectedRed).toBe(1)
  })

  /**
   * The whole point of the registry over a comment: an exemption nobody needs
   * is one nobody re-reads, so the gate takes the feature landing as its cue
   * to make somebody look.
   */
  it('goes red when a declared-red test starts passing', () => {
    const { ok, problems } = verdict({ results: [row()], entries: [entry()] })
    expect(ok).toBe(false)
    expect(problems[0]).toContain('PASSES now')
    expect(problems[0]).toContain('T.30')
  })

  /** A declared-red spec that passes on a retry is not reliably red either. */
  it('treats a declared-red test that went flaky as passing, so somebody looks at it', () => {
    const { ok, problems } = verdict({ results: [row({ failed: false, flaky: true })], entries: [entry()] })
    expect(ok).toBe(false)
    expect(problems[0]).toContain('PASSES now')
  })

  it('goes red when the declared test is not in the run — a renamed title stops proving anything', () => {
    const { problems } = verdict({ results: [row({ title: 'renamed' })], entries: [entry({ test: 'old title' })] })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('matched no test in this run')
  })

  /** `-- e2e/one.spec.ts` runs one file on purpose; the others are missing, not renamed. */
  it('says nothing about an unmatched entry when the run was scoped to some other spec', () => {
    const { ok } = verdict({
      results: [{ spec: 'smoke.spec.ts', title: 'boots', failed: false, flaky: false, skipped: false }],
      entries: [entry()],
      scoped: true,
    })
    expect(ok).toBe(true)
  })
})

describe('e2eGateVerdict — the registry cannot be used as a mute button', () => {
  it('refuses an entry naming a spec file that no longer exists', () => {
    const { problems } = verdict({ entries: [entry({ spec: 'deleted.spec.ts' })] })
    expect(problems[0]).toContain('is not a spec file')
  })

  it('refuses an entry whose roadmap id is not an open box', () => {
    const { problems } = verdict({
      results: [row({ failed: true })],
      entries: [entry({ roadmap: 'T.23' })],
    })
    expect(problems.some((p) => p.includes('not an open box'))).toBe(true)
    // and the failure it tried to excuse is still reported
    expect(problems.some((p) => p.startsWith('FAILED:'))).toBe(true)
  })

  it.each([
    ['spec', { spec: '' }, 'needs a "spec"'],
    ['test', { test: '' }, 'needs a "test"'],
    ['roadmap', { roadmap: '' }, 'needs a "roadmap" id'],
    ['reason', { reason: 'reverted' }, 'needs a "reason"'],
  ])('refuses an entry with no %s', (_field, override, expected) => {
    const { problems } = verdict({ entries: [entry(override)] })
    expect(problems[0]).toContain(expected)
  })
})

describe('openRoadmapIdsFrom', () => {
  const md = [
    '- [ ] T.30 **The Groove trainer still cannot show the learner what to play.**',
    '- [x] T.23 **Every perfect authentic cadence the drill draws.**',
    '- [ ] DR-09 **The drums side teaches nothing.**',
    '- [ ] 5.53 **A leap ceiling graded by pedagogy.**',
    'not a box at all',
  ].join('\n')

  it('reads the open boxes and skips the ticked ones', () => {
    expect(openRoadmapIdsFrom(md)).toEqual(['T.30', 'DR-09', '5.53'])
  })
})
