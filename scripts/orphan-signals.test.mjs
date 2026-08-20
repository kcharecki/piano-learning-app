/**
 * Tests for `orphan-signals.mjs`'s ANALYSIS FUNCTIONS, not its CLI printing —
 * per house style (`scripts/worktree-isolation.test.mjs`), a rule that cannot
 * be "mostly followed" is asserted, not just described in a header comment.
 * `classifyField`'s decision table (plain match / destructured-only match /
 * common-or-collided name / no match at all) is exactly that kind of rule, so
 * it is exercised directly against small fixture sources here rather than
 * only indirectly through a real-repo run.
 *
 * Runs as part of the `core` vitest project (node environment, 5s timeout,
 * `scripts/**\/*.test.mjs` is in that project's `include`) — see
 * `vitest.config.ts`.
 */
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  parseTypeFields,
  scanFieldUsages,
  collectDeclaredFieldNames,
  classifyField,
  updateAges,
  capAge,
  runScanA,
  runScanB,
} from './orphan-signals.mjs'

/** Build the declared-name ambiguity index from exactly the fixture sources given —
 *  the real scans widen this to `src/core/**`, but a fixture test wants a scope it
 *  fully controls. */
const declaredIndexOf = (sources) => collectDeclaredFieldNames(sources)

describe('classifyField', () => {
  it('reports a field declared in a fixture type and read nowhere as an orphan', () => {
    const declText = 'export type Foo = { readonly bar: string }'
    const declared = parseTypeFields(declText, 'fixtures/decl.ts')
    expect(declared).toEqual([{ typeName: 'Foo', fieldName: 'bar', file: 'fixtures/decl.ts', line: 1 }])

    const usage = scanFieldUsages(['bar'], [])
    const declaredIndex = declaredIndexOf([{ path: 'fixtures/decl.ts', text: declText }])

    const finding = classifyField(declared[0], usage.get('bar'), declaredIndex)
    expect(finding).not.toBeNull()
    expect(finding.signal).toBe('Foo.bar')
    expect(finding.declaredAt).toBe('fixtures/decl.ts:1')
  })

  it('does NOT report a field read via a plain property access (x.foo) as an orphan', () => {
    const declText = 'export type Foo = { readonly bar: string }'
    const declared = parseTypeFields(declText, 'fixtures/decl.ts')
    const readerFiles = [{ path: 'fixtures/reader.ts', text: 'function use(x) { return x.bar }' }]

    const usage = scanFieldUsages(['bar'], readerFiles)
    const declaredIndex = declaredIndexOf([{ path: 'fixtures/decl.ts', text: declText }, ...readerFiles])

    const finding = classifyField(declared[0], usage.get('bar'), declaredIndex)
    expect(finding).toBeNull()
  })

  /**
   * Contract's own words: "A field read via destructuring is NOT reported as
   * a HIGH-confidence orphan (either it is cleared, or it is downgraded to
   * LOW — assert whichever your implementation does, and make the file's
   * header comment state that choice)." This implementation's choice (stated
   * in `orphan-signals.mjs`'s own header, under "The honesty requirement"):
   * a destructured-only match is NEVER trusted enough to clear a field —
   * it is always downgraded to a LOW-confidence orphan, since without a type
   * checker there is no way to confirm the destructured object is really the
   * type in question.
   */
  it('downgrades a field read only via destructuring to a LOW-confidence orphan, never HIGH', () => {
    const declText = 'export type Foo = { readonly bar: string }'
    const declared = parseTypeFields(declText, 'fixtures/decl.ts')
    const readerFiles = [{ path: 'fixtures/reader.ts', text: 'function use(x) { const { bar } = x; return bar }' }]

    const usage = scanFieldUsages(['bar'], readerFiles)
    const declaredIndex = declaredIndexOf([{ path: 'fixtures/decl.ts', text: declText }, ...readerFiles])

    const finding = classifyField(declared[0], usage.get('bar'), declaredIndex)
    expect(finding).not.toBeNull()
    expect(finding.confidence).toBe('LOW')
    expect(finding.evidence).toMatch(/destructur/i)
  })

  it('reports a common-word field name (e.g. "level") at LOW confidence even when no read is found', () => {
    const declText = 'export type Foo = { readonly level: number }'
    const declared = parseTypeFields(declText, 'fixtures/decl.ts')

    const usage = scanFieldUsages(['level'], [])
    const declaredIndex = declaredIndexOf([{ path: 'fixtures/decl.ts', text: declText }])

    const finding = classifyField(declared[0], usage.get('level'), declaredIndex)
    expect(finding).not.toBeNull()
    expect(finding.confidence).toBe('LOW')
  })

  it('reports a distinctive, unambiguous, unread field at HIGH confidence', () => {
    const declText = 'export type Foo = { readonly sustainPedalCurve: string }'
    const declared = parseTypeFields(declText, 'fixtures/decl.ts')

    const usage = scanFieldUsages(['sustainPedalCurve'], [])
    const declaredIndex = declaredIndexOf([{ path: 'fixtures/decl.ts', text: declText }])

    const finding = classifyField(declared[0], usage.get('sustainPedalCurve'), declaredIndex)
    expect(finding).not.toBeNull()
    expect(finding.confidence).toBe('HIGH')
  })

  it('downgrades a distinctive name to LOW when a same-named plain match exists but a DIFFERENT type in scope also declares it', () => {
    // Mirrors the real `velocity` case this script was built around: the same
    // field name declared on two unrelated shapes, one of which is read.
    const declText = 'export type Foo = { readonly velocity: number }'
    const otherText = 'export type Bar = { readonly velocity: number }'
    const declared = parseTypeFields(declText, 'fixtures/decl.ts')
    const readerFiles = [{ path: 'fixtures/reader.ts', text: 'function use(x) { return x.velocity }' }]

    const usage = scanFieldUsages(['velocity'], readerFiles)
    const declaredIndex = declaredIndexOf([
      { path: 'fixtures/decl.ts', text: declText },
      { path: 'fixtures/other.ts', text: otherText },
      ...readerFiles,
    ])

    const finding = classifyField(declared[0], usage.get('velocity'), declaredIndex)
    expect(finding).not.toBeNull()
    expect(finding.confidence).toBe('LOW')
    expect(finding.evidence).toContain('Bar')
  })
})

describe('ageing', () => {
  it('a signal present in two consecutive runs has age 2', () => {
    const afterRun1 = updateAges({}, ['A:Foo.bar'])
    expect(afterRun1['A:Foo.bar']).toBe(1)
    const afterRun2 = updateAges(afterRun1, ['A:Foo.bar'])
    expect(afterRun2['A:Foo.bar']).toBe(2)
  })

  it('a signal absent in the next run resets to 0', () => {
    const afterRun2 = { 'A:Foo.bar': 2 }
    const afterRun3 = updateAges(afterRun2, [])
    expect(afterRun3['A:Foo.bar']).toBe(0)
  })

  it('a brand-new signal starts at age 1, not 0', () => {
    const ages = updateAges({}, ['A:New.field'])
    expect(ages['A:New.field']).toBe(1)
  })

  it('the reported age caps at 3', () => {
    expect(capAge(1)).toBe(1)
    expect(capAge(3)).toBe(3)
    expect(capAge(4)).toBe(3)
    expect(capAge(11)).toBe(3)
  })
})

describe('the real scan', () => {
  it('runs against this actual repo and returns a non-empty, well-evidenced result', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const findings = [...runScanA(root), ...runScanB(root)]

    // Not asserting specific field names — those may legitimately change as
    // the app grows. Asserting structure and that every finding carries real
    // evidence and a confidence, which is the actual contract.
    expect(findings.length).toBeGreaterThan(0)
    const scans = new Set(findings.map((f) => f.scan))
    expect(scans.has('A')).toBe(true)
    expect(scans.has('B')).toBe(true)

    for (const finding of findings) {
      expect(['A', 'B']).toContain(finding.scan)
      expect(typeof finding.signal).toBe('string')
      expect(finding.signal.length).toBeGreaterThan(0)
      expect(finding.signal).toContain('.')
      expect(typeof finding.declaredAt).toBe('string')
      expect(finding.declaredAt).toMatch(/:\d+$/)
      expect(['HIGH', 'LOW']).toContain(finding.confidence)
      expect(typeof finding.evidence).toBe('string')
      expect(finding.evidence.length).toBeGreaterThan(0)
    }
  })
})
