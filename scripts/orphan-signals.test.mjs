/**
 * Tests for `orphan-signals.mjs`'s ANALYSIS FUNCTIONS, not its CLI printing —
 * per house style (`scripts/worktree-isolation.test.mjs`), a rule that cannot
 * be "mostly followed" is asserted, not just described in a header comment.
 *
 * v2 rewrite: the v1 API (`classifyField`) is gone, replaced by four
 * independent scans (A/B/C/D) plus a precision layer (P1-P4, see
 * `orphan-signals.mjs`'s own comments) that turns "every name read nowhere"
 * into "every value no learner-visible output can depend on". Each scan gets
 * a fixture test proving it finds its own intended shape; each precision
 * rule gets a test that fails if the rule is removed — those are the ones
 * most likely to silently rot, since a broken precision rule doesn't crash
 * anything, it just quietly lets false positives back in. Fixture tests use
 * small in-memory sources, no disk I/O, so the whole file stays fast; only
 * ONE test (`the real scan`, at the bottom) runs the four scans against
 * this actual repo.
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
  buildTypeCatalog,
  findCallbackBindings,
  discoverBoundaries,
  findBoundaryDrops,
  findNeverRendered,
  findDestructuredOmissions,
  findConstantSubstitutions,
  dedupeFindings,
  foldCrossScanDuplicates,
  isNotSignalFieldName,
  rankRows,
  capDefaultRows,
  updateAges,
  capAge,
  runScanA,
  runScanB,
  runScanC,
  runScanD,
} from './orphan-signals.mjs'

// -------------------------------------------------------------- scan A

describe('scan A — dropped at a function boundary', () => {
  it('reports a field a boundary function never touches while constructing a new structured value', () => {
    const declText = 'export type Foo = { readonly bar: string; readonly baz: number }'
    const useText = "export function useFoo(x: Foo): { out: string } {\n  return { out: x.bar }\n}"
    const catalog = buildTypeCatalog([{ path: 'fixtures/decl.ts', text: declText }])
    const declaredIndex = collectDeclaredFieldNames([{ path: 'fixtures/decl.ts', text: declText }])
    const boundaries = discoverBoundaries([{ path: 'fixtures/use.ts', text: useText }], catalog, [])

    const findings = findBoundaryDrops(boundaries, catalog, declaredIndex)
    expect(findings).toHaveLength(1)
    expect(findings[0].signal).toBe('Foo.baz')
    expect(findings[0].confidence).toBe('HIGH')
  })

  it('P2 — does not report a bookkeeping field (a timestamp-suffixed name) even though it is equally dropped', () => {
    const declText = 'export type Foo = { readonly bar: string; readonly baz: number; readonly introducedAt: string }'
    const useText = "export function useFoo(x: Foo): { out: string } {\n  return { out: x.bar }\n}"
    const catalog = buildTypeCatalog([{ path: 'fixtures/decl.ts', text: declText }])
    const declaredIndex = collectDeclaredFieldNames([{ path: 'fixtures/decl.ts', text: declText }])
    const boundaries = discoverBoundaries([{ path: 'fixtures/use.ts', text: useText }], catalog, [])

    const findings = findBoundaryDrops(boundaries, catalog, declaredIndex)
    const signals = findings.map((f) => f.signal)
    expect(signals).toContain('Foo.baz')
    expect(signals).not.toContain('Foo.introducedAt') // P2 — record-keeping, not signal
  })
})

// -------------------------------------------------------------- scan B

describe('scan B — persisted but never rendered', () => {
  it('reports a persisted field with no matching property access in any render file', () => {
    const declText = 'export type PersistedFoo = { readonly shown: string; readonly hidden: number }'
    const catalog = buildTypeCatalog([{ path: 'fixtures/decl.ts', text: declText }])
    const declaredIndex = collectDeclaredFieldNames([{ path: 'fixtures/decl.ts', text: declText }])
    const declaredFields = parseTypeFields(declText, 'fixtures/decl.ts')
    const renderFiles = [{ path: 'fixtures/App.tsx', text: 'function App(p) { return <div>{p.shown}</div> }' }]

    const findings = findNeverRendered(declaredFields, catalog, renderFiles, declaredIndex)
    const signals = findings.map((f) => f.signal)
    expect(signals).toContain('PersistedFoo.hidden')
    expect(signals).not.toContain('PersistedFoo.shown')
  })

  it('P3 — collapses the same field reached via two different persisted-container paths into one row, not one per path', () => {
    const itemText = 'export type Item = { readonly ease: number }'
    const containersText =
      'export type ContainerA = { readonly items: Item[] }\n' + 'export type ContainerB = { readonly itemsAgain: Item[] }'
    const files = [
      { path: 'fixtures/item.ts', text: itemText },
      { path: 'fixtures/containers.ts', text: containersText },
    ]
    const catalog = buildTypeCatalog(files)
    const declaredIndex = collectDeclaredFieldNames(files)
    // Deliberately only the two container roots — no direct top-level `Item`
    // entry — so BOTH paths to `Item.ease` are equal-depth (one hop), and
    // the only thing preventing two rows is `signal` excluding `via` (the
    // actual P3 fix). If `via` were folded back into the dedup key, this
    // would report `Item.ease` twice.
    const declaredFields = parseTypeFields(containersText, 'fixtures/containers.ts')

    // `findNeverRendered` itself returns one RAW finding per path (that is
    // `expandPersistedFields`'s job — enumerate every reachable path); the
    // collapsing is `dedupeFindings`'s job, exactly as `main()` wires it.
    // Two raw findings here (equal-depth, one per container) is correct
    // input to the real assertion below.
    const raw = findNeverRendered(declaredFields, catalog, [], declaredIndex)
    expect(raw.filter((f) => f.fieldName === 'ease')).toHaveLength(2)

    const deduped = dedupeFindings(raw)
    const easeFindings = deduped.filter((f) => f.fieldName === 'ease')
    expect(easeFindings).toHaveLength(1)
    expect(easeFindings[0].evidence).toMatch(/other location/)
  })

  it('P3 — dedupeFindings keeps the SHORTEST reachability path as evidence, regardless of input order', () => {
    // Hand-built findings (bypassing the scan itself) so the tie-break is
    // exercised directly: the deeper path arrives FIRST in the input array,
    // so a naive "keep whichever is seen first" implementation would keep
    // the wrong (deep) one — only an explicit hops comparison passes this.
    const findings = [
      { scan: 'B', pattern: 'never-rendered', signal: 'Item.ease', pathHops: 2, confidence: 'HIGH', declaredAt: 'fixtures/deep.ts:9', evidence: 'deep evidence' },
      { scan: 'B', pattern: 'never-rendered', signal: 'Item.ease', pathHops: 1, confidence: 'HIGH', declaredAt: 'fixtures/shallow.ts:3', evidence: 'shallow evidence' },
    ]
    const deduped = dedupeFindings(findings)
    expect(deduped).toHaveLength(1)
    expect(deduped[0].declaredAt).toBe('fixtures/shallow.ts:3')
    expect(deduped[0].evidence).toMatch(/^shallow evidence/)
  })
})

// -------------------------------------------------------------- scan C

describe('scan C — computed then discarded by every caller', () => {
  it('reports a field an exported function computes that its only call site never destructures', () => {
    const declText =
      'export type Foo = { readonly bar: string; readonly baz: number }\n' +
      "export function computeFoo(): Foo {\n  return { bar: 'x', baz: 1 }\n}"
    const catalog = buildTypeCatalog([{ path: 'fixtures/decl.ts', text: declText }])
    const declaredIndex = collectDeclaredFieldNames([{ path: 'fixtures/decl.ts', text: declText }])
    const callSiteFiles = [
      { path: 'fixtures/use.ts', text: "import { computeFoo } from './decl'\nfunction use() { const { bar } = computeFoo(); return bar }" },
    ]

    const findings = findDestructuredOmissions([{ path: 'fixtures/decl.ts', text: declText }], callSiteFiles, catalog, declaredIndex)
    expect(findings).toHaveLength(1)
    expect(findings[0].signal).toContain('Foo.baz')
    expect(findings[0].signal).toContain('computeFoo()')
  })
})

// -------------------------------------------------------------- scan D

describe('scan D — a constant standing in for real input', () => {
  /** A minimal captured/event shape: a port interface whose subscribe-style
   *  method hands out a unioned event type, the same `onEvent(handler:
   *  (event: MidiEvent) => void)` pattern the real MIDI port uses. */
  const eventsText =
    'export type NoteOn = { readonly velocity: number; readonly note: number }\n' +
    'export type NoteOff = { readonly note: number }\n' +
    'export type Event = NoteOn | NoteOff\n' +
    'export interface Port {\n  onEvent(handler: (event: Event) => void): void\n}'

  it('flags a default substituted for a field whose live value is carried on a verified captured type', () => {
    const inputText =
      'export type NoteInput = { readonly velocity?: number; readonly note: number }\n' +
      'export function buildNote(input: NoteInput) {\n  const velocity = input.velocity ?? DEFAULT_VELOCITY\n  return { velocity, note: input.note }\n}'
    const files = [
      { path: 'fixtures/events.ts', text: eventsText },
      { path: 'fixtures/input.ts', text: inputText },
    ]
    const catalog = buildTypeCatalog(files)
    const callbackBindings = findCallbackBindings([{ path: 'fixtures/events.ts', text: eventsText }], catalog)
    const boundaries = discoverBoundaries([{ path: 'fixtures/input.ts', text: inputText }], catalog, callbackBindings)

    const findings = findConstantSubstitutions(boundaries, catalog, callbackBindings)
    expect(findings).toHaveLength(1)
    expect(findings[0].signal).toBe('NoteInput.velocity ?? DEFAULT_VELOCITY')
    expect(findings[0].confidence).toBe('HIGH')
  })

  it('P1 — does NOT flag a default merely because an unrelated, non-captured type happens to declare the same field name (ordinary *Options design)', () => {
    // `BandParams` is declared, and does share the field name "band" with
    // `AdaptOptions" — but nothing in this fixture proves `BandParams` is a
    // captured/live-event shape (no callback binding, no union at all). A
    // pre-P1 implementation that treated "declared on some other type" as
    // sufficient carrier evidence would flag this; P1 requires the carrier
    // to be independently proven captured.
    const optsText =
      'export type BandParams = { readonly band: number }\n' +
      'export type AdaptOptions = { readonly band?: number }\n' +
      'export function adapt(opts: AdaptOptions) {\n  const band = opts.band ?? DEFAULT_BAND\n  return { band }\n}'
    const catalog = buildTypeCatalog([{ path: 'fixtures/opts.ts', text: optsText }])
    const boundaries = discoverBoundaries([{ path: 'fixtures/opts.ts', text: optsText }], catalog, [])

    const findings = findConstantSubstitutions(boundaries, catalog, [])
    expect(findings.some((f) => f.signal.includes('AdaptOptions.band'))).toBe(false)
  })

  it('P1 — rejects a type name ending in "Options" as a carrier even if it were otherwise captured', () => {
    // Construct a pathological case where an `*Options`-suffixed type IS a
    // callback-bound union member, to prove the `Options` suffix check is a
    // real, independent guard rather than something the union check alone
    // already handles.
    const text =
      'export type WeirdOptions = { readonly band: number }\n' +
      'export type Other = { readonly note: number }\n' +
      'export type Event = WeirdOptions | Other\n' +
      'export interface Port {\n  onEvent(handler: (event: Event) => void): void\n}\n' +
      'export type AdaptOptions = { readonly band?: number }\n' +
      'export function adapt(opts: AdaptOptions) {\n  const band = opts.band ?? DEFAULT_BAND\n  return { band }\n}'
    const catalog = buildTypeCatalog([{ path: 'fixtures/weird.ts', text }])
    const callbackBindings = findCallbackBindings([{ path: 'fixtures/weird.ts', text }], catalog)
    const boundaries = discoverBoundaries([{ path: 'fixtures/weird.ts', text }], catalog, callbackBindings)

    const findings = findConstantSubstitutions(boundaries, catalog, callbackBindings)
    expect(findings.some((f) => f.signal.includes('AdaptOptions.band'))).toBe(false)
  })
})

// ------------------------------------------------------------ P2 (isNotSignalFieldName)

describe('P2 — isNotSignalFieldName', () => {
  it('matches bookkeeping/timestamp-shaped field names', () => {
    for (const name of ['exportedAt', 'completedAt', 'addedAt', 'introducedAt', 'recordedAt', 'version']) {
      expect(isNotSignalFieldName(name)).toBe(true)
    }
  })

  it('does not match ordinary domain field names, including ones ending in "at" as part of a longer word', () => {
    for (const name of ['velocity', 'accuracy', 'durationTicks', 'down', 'seat']) {
      expect(isNotSignalFieldName(name)).toBe(false)
    }
  })
})

// ------------------------------------------------------------ P4 (foldCrossScanDuplicates)

describe('P4 — foldCrossScanDuplicates', () => {
  it('folds the exact same (type, field) tuple found by two different scans into one row', () => {
    const findings = [
      { scan: 'A', pattern: 'dropped-at-boundary', signal: 'Foo.bar', typeName: 'Foo', fieldName: 'bar', confidence: 'HIGH', evidence: 'scan A evidence' },
      { scan: 'B', pattern: 'never-rendered', signal: 'Foo.bar', typeName: 'Foo', fieldName: 'bar', confidence: 'HIGH', evidence: 'scan B evidence' },
    ]
    const folded = foldCrossScanDuplicates(findings)
    expect(folded).toHaveLength(1)
    expect(folded[0].scan).toBe('A') // priority order A, D, C, B — see the function's own comment
    expect(folded[0].evidence).toMatch(/scan B/)
  })

  it('does NOT fold two different owning types that merely share a bare field name', () => {
    // The rejected alternative design (fold by field name alone) would wrongly
    // merge these — `ScoreNote.durationTicks` and `Measure.durationTicks` are
    // unrelated orphans that happen to share a name.
    const findings = [
      { scan: 'A', signal: 'ScoreNote.durationTicks', typeName: 'ScoreNote', fieldName: 'durationTicks', confidence: 'LOW', evidence: 'a' },
      { scan: 'B', signal: 'Measure.durationTicks', typeName: 'Measure', fieldName: 'durationTicks', confidence: 'HIGH', evidence: 'b' },
    ]
    const folded = foldCrossScanDuplicates(findings)
    expect(folded).toHaveLength(2)
  })

  it('leaves a (type, field) found by only one scan untouched', () => {
    const findings = [{ scan: 'A', signal: 'Foo.bar', typeName: 'Foo', fieldName: 'bar', confidence: 'HIGH', evidence: 'a' }]
    expect(foldCrossScanDuplicates(findings)).toEqual(findings)
  })
})

// ------------------------------------------------------- ranking / default cap

describe('rankRows / capDefaultRows', () => {
  it('a LOW finding with strong evidenceStrength (capturedField or chained) is reserved a default row even when HIGH findings alone exceed the cap', () => {
    const high = Array.from({ length: 20 }, (_, i) => ({
      scan: 'A',
      signal: `Bulk.field${i}`,
      fieldName: `field${i}`,
      confidence: 'HIGH',
      age: 1,
      evidence: 'bulk',
    }))
    const weakLow = { scan: 'A', signal: 'Weak.thing', fieldName: 'thing', confidence: 'LOW', age: 1, evidence: 'weak', chained: false, capturedField: false }
    const strongLow = {
      scan: 'B',
      signal: 'MidiSustain.down',
      fieldName: 'down',
      confidence: 'LOW',
      age: 1,
      evidence: 'strong',
      capturedField: true,
    }
    const ranked = rankRows([...high, weakLow, strongLow])
    const shown = capDefaultRows(ranked)
    expect(shown.some((f) => f.signal === 'MidiSustain.down')).toBe(true)
  })

  it('capDefaultRows returns everything unchanged when there is nothing to cap', () => {
    const small = [{ scan: 'A', signal: 'Foo.bar', confidence: 'HIGH', age: 1, evidence: 'x' }]
    expect(capDefaultRows(small)).toEqual(small)
  })
})

// ---------------------------------------------------------------- ageing

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

// ------------------------------------------------------------- the real scan

describe('the real scan', () => {
  /**
   * The ONE test in this file allowed to touch the real repo (see the
   * module's own rules digest). Runs all four scans, then the same
   * dedupe -> fold -> rank -> cap pipeline `main()` runs (minus ageing and
   * printing, neither of which this test cares about), and checks the three
   * verified ground-truth orphans this v2 rewrite was built to surface:
   * `ScoreNoteInput.velocity ?? DEFAULT_VELOCITY` (scan D), `ScoreNote
   * .durationTicks` reached via `MatchResult.expected` (scan A), and
   * `MidiSustain.down` (scan B). Asserted against the finding SET, never an
   * exact position — ranking is allowed to shuffle as the codebase grows;
   * only "does it survive the cap" is a contract.
   *
   * Deliberately asserted against `capDefaultRows(rankRows(...))` — the
   * actual DEFAULT (12-row) output a learner sees — not against the raw
   * `findings` set and not against `--all`. Two of these three ground
   * truths are LOW confidence and only reach the default table via
   * `capDefaultRows`'s reserved LOW slots (see that function's own "PLAINLY"
   * comment); asserting against the unfiltered finding set would pass even
   * if that reservation were deleted, which defeats the point of this test.
   */
  it('surfaces all three verified ground-truth orphans within the default-capped output', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const raw = [...runScanA(root), ...runScanB(root), ...runScanC(root), ...runScanD(root)]
    const findings = foldCrossScanDuplicates(dedupeFindings(raw))

    // Structural contract: every finding, from every scan, carries real
    // evidence and a confidence — not asserting specific field names here,
    // that's what the ground-truth checks below are for.
    expect(findings.length).toBeGreaterThan(0)
    for (const finding of findings) {
      expect(['A', 'B', 'C', 'D']).toContain(finding.scan)
      expect(typeof finding.signal).toBe('string')
      expect(finding.signal.length).toBeGreaterThan(0)
      expect(typeof finding.declaredAt).toBe('string')
      expect(finding.declaredAt).toMatch(/:\d+$/)
      expect(['HIGH', 'LOW']).toContain(finding.confidence)
      expect(typeof finding.evidence).toBe('string')
      expect(finding.evidence.length).toBeGreaterThan(0)
    }

    const withAge = findings.map((f) => ({ ...f, age: 1 }))
    const shown = capDefaultRows(rankRows(withAge))

    const hasVelocityDefault = shown.some((f) => f.scan === 'D' && f.signal.includes('velocity') && f.signal.includes('DEFAULT_VELOCITY'))
    const hasDurationTicks = shown.some((f) => f.scan === 'A' && f.typeName === 'ScoreNote' && f.fieldName === 'durationTicks')
    const hasSustainDown = shown.some((f) => f.scan === 'B' && f.typeName === 'MidiSustain' && f.fieldName === 'down')

    expect(hasVelocityDefault).toBe(true)
    expect(hasDurationTicks).toBe(true)
    expect(hasSustainDown).toBe(true)
    // Four real scans over the whole repo. ~2s uninstrumented, ~11s under v8
    // coverage — which is over the core project's 5s default, so `npm run
    // test:cov` failed here and wrote no report at all, leaving the 90% gate
    // AGENTS.md calls non-negotiable with nothing to check. Same shape of fix
    // `pitchDetection.test.ts` already uses for its own slow property.
  }, 30_000)
})
