/**
 * Drives `validateImproveLog` with inline fixture strings — no filesystem, so this stays
 * fast and exercises every rule in the frozen contract directly rather than through
 * `docs/improve-log.md`, which does not exist yet (the loop is not bootstrapped).
 *
 * `main()` (the CLI entry point) is exercised separately by spawning the real script, since
 * that is the only way to see its argv parsing and its "file does not exist" exit-0 path.
 *
 * The `Metric`-membership check reads real source files on disk (`collectMetricFields`); to
 * keep `validateImproveLog` itself pure, every fixture test below either omits the second
 * argument (skips the check, same as "sources missing") or passes a hand-built fake
 * `metricFields` object — never a real `collectMetricFields()` call. That keeps this file free
 * of real filesystem IO, per the repo's testing rules.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { validateImproveLog } from './check-improve-log.mjs'

const SCRIPT = fileURLToPath(new URL('./check-improve-log.mjs', import.meta.url))

/** 1-based line number of the first line containing `needle`, for assertions that don't
 * want to hardcode line numbers a fixture edit would silently invalidate. */
function lineOf(text, needle) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.includes(needle))
  if (i === -1) throw new Error(`fixture has no line containing "${needle}"`)
  return i + 1
}

const VALID_RUN = `## Run 1
- **Persona:** Beginner adult returning after a break (piano)
- **Tier:** M
- **Pick source:** 1b
- **Pick gap:** Metronome drifts under rubato
- **Previous pick source:** none
- **Class:** BLIND
- **Claim:** The learner will be able to find the tempo slider within one screen, and we will know because the learner sees the tempo slider appear on the Practice screen within 10s of lesson start.
- **Refutation condition:** The slider-open event does not fire within 10s for 3 consecutive sessions.
- **Metric:** time-to-slider-open (ms)
- **Baseline:** 0 events, newly instrumented
- **Outcome:** clean
- **Endorsement:** yes

### Ledger
| Gap | Source | Class | Blocked | Reach | Teacherliness | Unmatchable | Sum | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tempo slider hard to find | 1a | THIN | 1 | 1 | 1 | 0 | 3 | S |
| Metronome drifts under rubato | 1b | BLIND | 3 | 2 | 2 | 2 | 9 | M |
| Fingering hints too sparse | 1c | FLAT | 2 | 1 | 1 | 1 | 5 | S |

### Cannot-sense register
none this run

## Idea register
| Idea | From run | Status |
| --- | --- | --- |
| *(none yet)* | | |
`

describe('validateImproveLog', () => {
  it('reports zero violations for a fully valid single-run document', () => {
    expect(validateImproveLog(VALID_RUN)).toEqual([])
  })

  it('reports a missing required field, naming the field and the heading line', () => {
    const fixture = VALID_RUN.split('\n')
      .filter((l) => !l.startsWith('- **Metric:**'))
      .join('\n')
    const violations = validateImproveLog(fixture)
    const headingLine = lineOf(fixture, '## Run 1')
    expect(
      violations.some((v) => v.line === headingLine && v.message.includes('"Metric"')),
    ).toBe(true)
  })

  it('rejects a bad Tier, a bad Pick source, and a bad Outcome, each on its own line', () => {
    const fixture = VALID_RUN.replace('- **Tier:** M', '- **Tier:** XL')
      .replace('- **Pick source:** 1b', '- **Pick source:** 1z')
      .replace('- **Outcome:** clean', '- **Outcome:** maybe')
    const violations = validateImproveLog(fixture)

    expect(
      violations.some(
        (v) => v.line === lineOf(fixture, '- **Tier:**') && v.message.includes('Tier "XL"'),
      ),
    ).toBe(true)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, '- **Pick source:**') &&
          v.message.includes('Pick source "1z"'),
      ),
    ).toBe(true)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, '- **Outcome:**') && v.message.includes('Outcome "maybe"'),
      ),
    ).toBe(true)
  })

  it('accepts the bootstrap Baseline string and rejects a non-numeric one', () => {
    expect(validateImproveLog(VALID_RUN).some((v) => v.message.includes('Baseline'))).toBe(false)

    const fixture = VALID_RUN.replace(
      '- **Baseline:** 0 events, newly instrumented',
      '- **Baseline:** soon',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) => v.line === lineOf(fixture, '- **Baseline:**') && v.message.includes('Baseline "soon"'),
      ),
    ).toBe(true)
  })

  it('rejects a Claim containing a denylisted non-observable, accepts a well-formed one', () => {
    expect(validateImproveLog(VALID_RUN).some((v) => v.message.includes('Claim'))).toBe(false)

    const fixture = VALID_RUN.replace(
      'we will know because the learner sees the tempo slider appear on the Practice screen within 10s of lesson start.',
      'we will know because a hint appears when the learner pauses.',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, '- **Claim:**') &&
          v.message.includes('"a hint appears"'),
      ),
    ).toBe(true)
  })

  it('rejects a Claim whose observable clause uses a widened denylist phrase (codebase-fact, not learner-fact)', () => {
    const fixture = VALID_RUN.replace(
      'we will know because the learner sees the tempo slider appear on the Practice screen within 10s of lesson start.',
      'we will know because the test suite covers the slider-open path.',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, '- **Claim:**') &&
          v.message.includes('"the test suite"'),
      ),
    ).toBe(true)
  })

  it('rejects a Claim whose observable clause names nothing learner-visible, even with no denylisted phrase', () => {
    const fixture = VALID_RUN.replace(
      'we will know because the learner sees the tempo slider appear on the Practice screen within 10s of lesson start.',
      'we will know because the timer elapses.',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, '- **Claim:**') &&
          v.message.includes("observable is not stated in learner-visible terms"),
      ),
    ).toBe(true)
  })

  it('rejects a Persona that does not end with (piano) or (drums), accepts one that does', () => {
    expect(validateImproveLog(VALID_RUN).some((v) => v.message.includes('Persona'))).toBe(false)

    const fixture = VALID_RUN.replace(
      '- **Persona:** Beginner adult returning after a break (piano)',
      '- **Persona:** Beginner adult returning after a break',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, '- **Persona:**') &&
          v.message.includes('must end with "(piano)" or "(drums)"'),
      ),
    ).toBe(true)
  })

  it('validates the optional Thread field shape and the k <= cap constraint', () => {
    const badShape = VALID_RUN.replace(
      '- **Outcome:** clean',
      '- **Outcome:** clean\n- **Thread:** tempo-slider run 2',
    )
    expect(
      validateImproveLog(badShape).some(
        (v) => v.line === lineOf(badShape, '- **Thread:**') && v.message.includes('Thread'),
      ),
    ).toBe(true)

    const badCap = VALID_RUN.replace(
      '- **Outcome:** clean',
      '- **Outcome:** clean\n- **Thread:** tempo-slider, run 4 of 3',
    )
    expect(
      validateImproveLog(badCap).some(
        (v) =>
          v.line === lineOf(badCap, '- **Thread:**') &&
          v.message.includes('greater than its cap'),
      ),
    ).toBe(true)

    const good = VALID_RUN.replace(
      '- **Outcome:** clean',
      '- **Outcome:** clean\n- **Thread:** tempo-slider, run 2 of 3',
    )
    expect(validateImproveLog(good).some((v) => v.message.includes('Thread'))).toBe(false)
  })

  it('requires a "### Proof" section when Outcome is abort', () => {
    const fixture = VALID_RUN.replace('- **Outcome:** clean', '- **Outcome:** abort')
      // an unendorsed slice may abort; keep Endorsement "yes" so this test isolates Proof
      .replace('- **Outcome:** abort\n- **Endorsement:** yes', '- **Outcome:** abort\n- **Endorsement:** yes')
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, '- **Outcome:** abort') &&
          v.message.includes('"### Proof"'),
      ),
    ).toBe(true)

    const withProof = fixture.replace(
      '### Cannot-sense register',
      '### Proof\nRED at the spec commit, GREEN on HEAD.\n\n### Cannot-sense register',
    )
    expect(
      validateImproveLog(withProof).some((v) => v.message.includes('"### Proof"')),
    ).toBe(false)
  })

  it('rejects a ledger row with the wrong column count, and one with an empty Gap', () => {
    const badColumns = VALID_RUN.replace(
      '| Fingering hints too sparse | 1c | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
      '| 1c | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
    )
    expect(validateImproveLog(badColumns).some((v) => v.message.includes('expected 9'))).toBe(
      true,
    )

    const emptyGap = VALID_RUN.replace(
      '| Fingering hints too sparse | 1c | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
      '|  | 1c | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
    )
    expect(
      validateImproveLog(emptyGap).some((v) => v.message.includes('"Gap" column is empty')),
    ).toBe(true)
  })

  it('rejects a ledger axis score of 4, accepts a score of 3', () => {
    expect(validateImproveLog(VALID_RUN).some((v) => v.message.includes('axis score'))).toBe(
      false,
    )

    const fixture = VALID_RUN.replace(
      '| Tempo slider hard to find | 1a | THIN | 1 | 1 | 1 | 0 | 3 | S |',
      '| Tempo slider hard to find | 1a | THIN | 4 | 1 | 1 | 0 | 3 | S |',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, '| Tempo slider hard to find | 1a | THIN | 4 |') &&
          v.message.includes('axis score "4"'),
      ),
    ).toBe(true)
  })

  it('rejects an age bonus on a non-1e ledger row, and a Sum that disagrees with the axis scores', () => {
    const badBonus = VALID_RUN.replace(
      '| Fingering hints too sparse | 1c | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
      '| Fingering hints too sparse | 1c | FLAT | 2 | 1 | 1 | 1 | 5 +1 | S |',
    )
    const bonusViolations = validateImproveLog(badBonus)
    expect(
      bonusViolations.some(
        (v) =>
          v.line === lineOf(badBonus, 'Fingering hints too sparse') &&
          v.message.includes('not 1e'),
      ),
    ).toBe(true)

    const badSum = VALID_RUN.replace(
      '| Fingering hints too sparse | 1c | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
      '| Fingering hints too sparse | 1c | FLAT | 2 | 1 | 1 | 1 | 9 | S |',
    )
    const sumViolations = validateImproveLog(badSum)
    expect(
      sumViolations.some(
        (v) =>
          v.line === lineOf(badSum, 'Fingering hints too sparse') &&
          v.message.includes('disagrees with the four axis scores'),
      ),
    ).toBe(true)
  })

  it('ranks the ledger by Sum including the age bonus, not by the axis scores alone', () => {
    const fixture = VALID_RUN.replace(
      '- **Pick source:** 1b',
      '- **Pick source:** 1e',
    )
      .replace(
        '- **Pick gap:** Metronome drifts under rubato',
        '- **Pick gap:** Fingering feels stale for a returning player',
      )
      .replace(
        '| Tempo slider hard to find | 1a | THIN | 1 | 1 | 1 | 0 | 3 | S |',
        '| Fingering feels stale for a returning player | 1e | BLIND | 1 | 3 | 3 | 1 | 8 +2 | M |',
      )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some((v) => v.message.includes('does not match the top-scoring ledger row')),
    ).toBe(false)
  })

  it('rejects a Pick gap disagreeing with the top ledger row, accepts it with an evidenced Harm gate', () => {
    const disagreeing = VALID_RUN.replace(
      '- **Pick gap:** Metronome drifts under rubato',
      '- **Pick gap:** Tempo slider hard to find',
    )
    const violations = validateImproveLog(disagreeing)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(disagreeing, '- **Pick gap:**') &&
          v.message.includes('does not match the top-scoring ledger row'),
      ),
    ).toBe(true)

    const withEvidencedOverride = disagreeing.replace(
      '- **Outcome:** clean',
      '- **Outcome:** clean\n- **Harm gate:** src/core/practice/assessment.ts:142 surfaces a mid-lesson dialog, see "never interrupt a phrase in progress" (docs/DESIGN.md).',
    )
    expect(
      validateImproveLog(withEvidencedOverride).some((v) =>
        v.message.includes('does not match the top-scoring ledger row'),
      ),
    ).toBe(false)
  })

  it('rejects a Pick gap that matches no row in the ledger table', () => {
    const fixture = VALID_RUN.replace(
      '- **Pick gap:** Metronome drifts under rubato',
      '- **Pick gap:** A gap nobody wrote a ledger row for',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, '- **Pick gap:**') &&
          v.message.includes('does not match any row'),
      ),
    ).toBe(true)
  })

  it('refuses the "Harm gate: trust me" bypass — an unevidenced override does not clear the top-row check', () => {
    const disagreeing = VALID_RUN.replace(
      '- **Pick gap:** Metronome drifts under rubato',
      '- **Pick gap:** Tempo slider hard to find',
    ).replace('- **Outcome:** clean', '- **Outcome:** clean\n- **Harm gate:** trust me')
    const violations = validateImproveLog(disagreeing)

    expect(
      violations.some(
        (v) =>
          v.line === lineOf(disagreeing, '- **Harm gate:**') &&
          v.message.includes('claimed but not evidenced'),
      ),
    ).toBe(true)
    expect(
      violations.some((v) => v.message.includes('does not match the top-scoring ledger row')),
    ).toBe(true)
  })

  it('accepts a disagreeing Pick gap overridden by a valid Thread line, with no Harm gate at all', () => {
    const fixture = VALID_RUN.replace(
      '- **Pick gap:** Metronome drifts under rubato',
      '- **Pick gap:** Tempo slider hard to find',
    ).replace(
      '- **Outcome:** clean',
      '- **Outcome:** clean\n- **Thread:** tempo-slider, run 2 of 3',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some((v) => v.message.includes('does not match the top-scoring ledger row')),
    ).toBe(false)
  })

  it('rejects a cannot-sense entry missing (screen: ...), accepts "none this run"', () => {
    expect(validateImproveLog(VALID_RUN).some((v) => v.message.includes('register'))).toBe(
      false,
    )

    const fixture = VALID_RUN.replace(
      '### Cannot-sense register\nnone this run',
      '### Cannot-sense register\n- Cannot tell whether the learner glanced away',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, 'glanced away') &&
          v.message.includes('missing "(screen: <name>)"'),
      ),
    ).toBe(true)
  })

  it('rejects a cannot-sense register that lists velocity, pointing at the orphan-signals scan', () => {
    const fixture = VALID_RUN.replace(
      '### Cannot-sense register\nnone this run',
      '### Cannot-sense register\n- Cannot tell note velocity (screen: Practice)',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, 'Cannot tell note velocity') &&
          v.message.includes('velocity') &&
          v.message.includes('orphan-signals scan'),
      ),
    ).toBe(true)
  })

  // ------------------------------------------------------------ Next steps (§8 hand-off)
  //
  // The section is scoped by run id: dated entries from NEXT_STEPS_FROM on must carry it,
  // and everything else — the undated fixtures above included — is out of scope. Every test
  // here therefore builds its own dated heading rather than reusing VALID_RUN's `## Run 1`.
  describe('Next steps', () => {
    const DATED = VALID_RUN.replace('## Run 1', '## Run 2026-09-01-1')
    const withSteps = (body) =>
      DATED.replace('### Cannot-sense register\nnone this run', `### Next steps\n${body}\n\n$&`)

    it('leaves an undated run entry alone — the rule starts at a dated id', () => {
      expect(validateImproveLog(VALID_RUN).some((v) => v.message.includes('Next steps'))).toBe(
        false,
      )
    })

    it('leaves a dated entry from before the cutoff alone', () => {
      const fixture = VALID_RUN.replace('## Run 1', '## Run 2026-08-21-1')
      expect(validateImproveLog(fixture).some((v) => v.message.includes('Next steps'))).toBe(false)
    })

    it('requires the section on a dated entry from the cutoff on', () => {
      const violations = validateImproveLog(DATED)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(DATED, '## Run 2026-09-01-1') &&
            v.message.includes('missing required "### Next steps" section'),
        ),
      ).toBe(true)
    })

    it('accepts the "nothing queued this run" line on its own', () => {
      const fixture = withSteps('nothing queued this run')
      expect(validateImproveLog(fixture).some((v) => v.message.includes('Next steps'))).toBe(false)
    })

    it('rejects "nothing queued this run" alongside real steps', () => {
      const fixture = withSteps('nothing queued this run\n- Then `T.19`')
      const violations = validateImproveLog(fixture)
      expect(
        violations.some((v) => v.message.includes('must be the only line in "### Next steps"')),
      ).toBe(true)
    })

    it('rejects an empty section', () => {
      const fixture = withSteps('')
      expect(
        validateImproveLog(fixture).some((v) =>
          v.message.includes('"### Next steps" section is empty'),
        ),
      ).toBe(true)
    })

    it('rejects a step that is prose with no roadmap id', () => {
      const fixture = withSteps('- Probably tidy up the theory screen a bit')
      const violations = validateImproveLog(fixture)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(fixture, 'Probably tidy up') &&
            v.message.includes('cites no roadmap id in backticks'),
        ),
      ).toBe(true)
    })

    it('accepts a step citing a roadmap id, and takes the T./U./DR- shapes', () => {
      const fixture = withSteps('- Repair `T.27` first, then `U.3`, then `DR-02`')
      expect(validateImproveLog(fixture).some((v) => v.message.includes('Next steps'))).toBe(false)
    })

    it('rejects an id that names no row in ROADMAP.md, when the ids are supplied', () => {
      const fixture = withSteps('- Repair `T.27`, then `T.999`')
      const roadmapIds = new Set(['T.27'])
      const violations = validateImproveLog(fixture, null, roadmapIds)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(fixture, 'T.999') &&
            v.message.includes('`T.999`, which is not a task row in ROADMAP.md'),
        ),
      ).toBe(true)
      expect(violations.some((v) => v.message.includes('`T.27`, which is not'))).toBe(false)
    })

    it('skips the membership half when no ids are supplied', () => {
      const fixture = withSteps('- Repair `T.999`')
      expect(validateImproveLog(fixture).some((v) => v.message.includes('Next steps'))).toBe(false)
    })
  })

  it('reports every violation in the file, not just the first', () => {
    const fixture = VALID_RUN.replace('- **Tier:** M', '- **Tier:** XL')
      .replace('- **Outcome:** clean', '- **Outcome:** maybe')
      .replace(
        '- **Baseline:** 0 events, newly instrumented',
        '- **Baseline:** soon',
      )
    const violations = validateImproveLog(fixture)
    expect(violations.some((v) => v.message.includes('Tier "XL"'))).toBe(true)
    expect(violations.some((v) => v.message.includes('Outcome "maybe"'))).toBe(true)
    expect(violations.some((v) => v.message.includes('Baseline "soon"'))).toBe(true)
    expect(violations.length).toBeGreaterThanOrEqual(3)
  })

  it('ignores a ## Run heading inside a fenced code block, and reports true line numbers for real violations after it', () => {
    const fenced = `Some prose before the schema.

\`\`\`markdown
## Run 2026-08-21-1

- **Persona:** <stage + concrete musical goal> (piano|drums)
- **Tier:** Floor|M|L
- **Outcome:** clean|shipped-not-clean|abort
\`\`\`

${VALID_RUN.replace('## Run 1', '## Run 2').replace('- **Tier:** M', '- **Tier:** XL')}`

    const violations = validateImproveLog(fenced)

    // The fenced template's placeholder values must never be reported as violations.
    expect(violations.some((v) => v.message.includes('Floor|M|L'))).toBe(false)
    expect(violations.some((v) => v.message.includes('(piano|drums)'))).toBe(false)
    expect(violations.some((v) => v.message.includes('clean|shipped-not-clean|abort'))).toBe(
      false,
    )

    // The real entry's bad Tier, which sits after the fence, must be reported at its true
    // (post-fence) line number in the combined fixture, not at the placeholder's line.
    const tierLine = lineOf(fenced, '- **Tier:** XL')
    expect(
      violations.some((v) => v.line === tierLine && v.message.includes('Tier "XL"')),
    ).toBe(true)
  })

  // ---------------------------------------------------------------- Endorsement (§1)

  describe('Endorsement', () => {
    it('requires a real Endorsement at Tier M/L — missing, or "n/a — Floor tier", is refused', () => {
      const missing = VALID_RUN.replace('- **Endorsement:** yes\n', '')
      expect(
        validateImproveLog(missing).some((v) =>
          v.message.includes('requires a real Teacher Endorsement'),
        ),
      ).toBe(true)

      const floorNa = VALID_RUN.replace('- **Endorsement:** yes', '- **Endorsement:** n/a — Floor tier')
      expect(
        validateImproveLog(floorNa).some((v) =>
          v.message.includes('requires a real Teacher Endorsement'),
        ),
      ).toBe(true)
    })

    it('requires exactly "n/a — Floor tier" at Tier Floor, refusing "yes" or "no"', () => {
      const fixture = VALID_RUN.replace('- **Tier:** M', '- **Tier:** Floor')
      expect(
        validateImproveLog(fixture).some((v) => v.message.includes('requires Endorsement')),
      ).toBe(true)

      const fixed = fixture.replace('- **Endorsement:** yes', '- **Endorsement:** n/a — Floor tier')
      expect(
        validateImproveLog(fixed).some((v) => v.message.includes('requires Endorsement')),
      ).toBe(false)
    })

    it('rejects Endorsement "no" paired with Outcome "clean" — an unendorsed slice cannot ship clean', () => {
      const fixture = VALID_RUN.replace('- **Endorsement:** yes', '- **Endorsement:** no')
      const violations = validateImproveLog(fixture)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(fixture, '- **Endorsement:**') &&
            v.message.includes('cannot pair with Outcome "clean"'),
        ),
      ).toBe(true)

      const shippedNotClean = fixture.replace(
        '- **Outcome:** clean',
        '- **Outcome:** shipped-not-clean',
      )
      expect(
        validateImproveLog(shippedNotClean).some((v) =>
          v.message.includes('cannot pair with Outcome'),
        ),
      ).toBe(false)
    })

    it('rejects an Endorsement value outside yes/no/n-a-Floor-tier', () => {
      const fixture = VALID_RUN.replace('- **Endorsement:** yes', '- **Endorsement:** maybe')
      expect(
        validateImproveLog(fixture).some(
          (v) =>
            v.line === lineOf(fixture, '- **Endorsement:**') &&
            v.message.includes('Endorsement "maybe"'),
        ),
      ).toBe(true)
    })
  })

  // ------------------------------------------------------------- Idea register (§3)

  describe('Idea register', () => {
    it('reports a violation when the "## Idea register" section is missing entirely', () => {
      const fixture = VALID_RUN.replace(
        /\n## Idea register\n[\s\S]*$/,
        '\n',
      )
      expect(
        validateImproveLog(fixture).some((v) =>
          v.message.includes('missing required "## Idea register" section'),
        ),
      ).toBe(true)
      // and the placeholder-row original has no such violation
      expect(
        validateImproveLog(VALID_RUN).some((v) => v.message.includes('Idea register')),
      ).toBe(false)
    })

    it('rejects an idea row with the wrong column count', () => {
      const fixture = VALID_RUN.replace(
        '| *(none yet)* | | |',
        '| Add a metronome flash | run-1 |',
      )
      expect(
        validateImproveLog(fixture).some((v) =>
          v.message.includes('idea register row has 2 column(s), expected 3'),
        ),
      ).toBe(true)
    })

    it('rejects an idea row with an empty Idea cell, accepts the *(none yet)* placeholder', () => {
      const fixture = VALID_RUN.replace('| *(none yet)* | | |', '|  | run-1 | open |')
      expect(
        validateImproveLog(fixture).some((v) => v.message.includes('"Idea" column is empty')),
      ).toBe(true)
    })

    it('rejects an idea row with a Status outside open / shipped in <run> / struck — <reason>', () => {
      const fixture = VALID_RUN.replace(
        '| *(none yet)* | | |',
        '| Add a metronome flash | run-1 | pending |',
      )
      const violations = validateImproveLog(fixture)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(fixture, 'Add a metronome flash') &&
            v.message.includes('Status "pending"'),
        ),
      ).toBe(true)

      const open = fixture.replace('| pending |', '| open |')
      expect(validateImproveLog(open).some((v) => v.message.includes('Status'))).toBe(false)

      const shipped = fixture.replace('| pending |', '| shipped in run-3 |')
      expect(validateImproveLog(shipped).some((v) => v.message.includes('Status'))).toBe(false)

      const struck = fixture.replace('| pending |', '| struck — superseded by run-2 |')
      expect(validateImproveLog(struck).some((v) => v.message.includes('Status'))).toBe(false)
    })
  })

  // ------------------------------------------ Cannot-sense register (standing) (§Also)

  describe('Cannot-sense register (standing)', () => {
    const STANDING_TABLE = `
## Cannot-sense register (standing)

| Unsensable | Why | Countability challenge | Disclosed on |
|---|---|---|---|
| Tone, touch, voicing | **PHYSICAL** — lives in the sound, not the event stream | Velocity variance across a phrase is a proxy for touch evenness | *(not yet disclosed)* |
`

    it('reports zero violations for a well-formed standing table', () => {
      expect(validateImproveLog(VALID_RUN + STANDING_TABLE)).toEqual([])
    })

    it('rejects a standing-table row with the wrong column count', () => {
      const fixture = (VALID_RUN + STANDING_TABLE).replace(
        '| Tone, touch, voicing | **PHYSICAL** — lives in the sound, not the event stream | Velocity variance across a phrase is a proxy for touch evenness | *(not yet disclosed)* |',
        '| Tone, touch, voicing | **PHYSICAL** — lives in the sound | *(not yet disclosed)* |',
      )
      expect(
        validateImproveLog(fixture).some((v) =>
          v.message.includes('cannot-sense register (standing) row has 3 column(s), expected 4'),
        ),
      ).toBe(true)
    })

    it('rejects a standing-table "Why" that does not begin with **PHYSICAL** or **OURS**', () => {
      const fixture = (VALID_RUN + STANDING_TABLE).replace(
        '**PHYSICAL** — lives in the sound, not the event stream',
        'Lives in the sound, not the event stream',
      )
      expect(
        validateImproveLog(fixture).some((v) =>
          v.message.includes('"Why" must begin with "**PHYSICAL**" or "**OURS**"'),
        ),
      ).toBe(true)
    })

    it('rejects a standing-table row with an empty Countability challenge', () => {
      const fixture = (VALID_RUN + STANDING_TABLE).replace(
        '| Velocity variance across a phrase is a proxy for touch evenness |',
        '|  |',
      )
      expect(
        validateImproveLog(fixture).some((v) =>
          v.message.includes('empty "Countability challenge"'),
        ),
      ).toBe(true)
    })

    it('rejects a standing-table row whose Disclosed on is neither a screen tag nor the not-yet-disclosed placeholder', () => {
      const fixture = (VALID_RUN + STANDING_TABLE).replace(
        '*(not yet disclosed)*',
        'not disclosed yet',
      )
      expect(
        validateImproveLog(fixture).some((v) => v.message.includes('"Disclosed on" is missing')),
      ).toBe(true)

      const withScreen = (VALID_RUN + STANDING_TABLE).replace(
        '*(not yet disclosed)*',
        '(screen: Practice)',
      )
      expect(
        validateImproveLog(withScreen).some((v) => v.message.includes('"Disclosed on" is missing')),
      ).toBe(false)
    })

    it('rejects a standing-table row whose Unsensable column names a captured signal', () => {
      const fixture = (VALID_RUN + STANDING_TABLE).replace(
        'Tone, touch, voicing',
        'Note velocity',
      )
      const violations = validateImproveLog(fixture)
      expect(
        violations.some(
          (v) => v.message.includes('velocity') && v.message.includes('orphan-signals scan'),
        ),
      ).toBe(true)
    })
  })

  // ---------------------------------------------------------------------- Metric (§3)

  describe('Metric field-name membership', () => {
    const FAKE_METRIC_FIELDS = {
      allFieldNames: new Set(['level', 'accuracy', 'history']),
      fieldsByType: new Map([
        ['PersistedSightReadingHistory', new Set(['level', 'history'])],
        ['StoredAssessmentLike', new Set(['accuracy', 'kind'])],
      ]),
    }

    it('is skipped by default (no metricFields argument) — a fabricated Metric passes', () => {
      const fixture = VALID_RUN.replace(
        '- **Metric:** time-to-slider-open (ms)',
        '- **Metric:** totallyMadeUpField',
      )
      expect(validateImproveLog(fixture).some((v) => v.message.includes('Metric'))).toBe(false)
    })

    it('refuses a fabricated Metric field name when metricFields is supplied', () => {
      const fixture = VALID_RUN.replace(
        '- **Metric:** time-to-slider-open (ms)',
        '- **Metric:** totallyMadeUpField',
      )
      const violations = validateImproveLog(fixture, FAKE_METRIC_FIELDS)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(fixture, '- **Metric:**') &&
            v.message.includes('Metric "totallyMadeUpField"'),
        ),
      ).toBe(true)
    })

    it('accepts a bare declared field name and a "<Type>.<field>" dotted form', () => {
      const bare = VALID_RUN.replace(
        '- **Metric:** time-to-slider-open (ms)',
        '- **Metric:** level',
      )
      expect(validateImproveLog(bare, FAKE_METRIC_FIELDS).some((v) => v.message.includes('Metric'))).toBe(
        false,
      )

      const dotted = VALID_RUN.replace(
        '- **Metric:** time-to-slider-open (ms)',
        '- **Metric:** StoredAssessmentLike.accuracy',
      )
      expect(
        validateImproveLog(dotted, FAKE_METRIC_FIELDS).some((v) => v.message.includes('Metric')),
      ).toBe(false)
    })

    it('rejects a dotted "<Type>.<field>" naming a real type but an undeclared field on it', () => {
      const fixture = VALID_RUN.replace(
        '- **Metric:** time-to-slider-open (ms)',
        '- **Metric:** StoredAssessmentLike.madeUp',
      )
      expect(
        validateImproveLog(fixture, FAKE_METRIC_FIELDS).some((v) => v.message.includes('Metric')),
      ).toBe(true)
    })

    it('skips the check when metricFields is null (missing source files)', () => {
      const fixture = VALID_RUN.replace(
        '- **Metric:** time-to-slider-open (ms)',
        '- **Metric:** totallyMadeUpField',
      )
      expect(validateImproveLog(fixture, null).some((v) => v.message.includes('Metric'))).toBe(
        false,
      )
    })
  })

  // ------------------------------------------------------- Class entry field (§C1)

  describe('Class entry field', () => {
    it('rejects a missing Class field, naming the field and the heading line', () => {
      const fixture = VALID_RUN.split('\n')
        .filter((l) => !l.startsWith('- **Class:**'))
        .join('\n')
      const violations = validateImproveLog(fixture)
      const headingLine = lineOf(fixture, '## Run 1')
      expect(
        violations.some((v) => v.line === headingLine && v.message.includes('"Class"')),
      ).toBe(true)
    })

    it('rejects a Class value outside the eight legal classes', () => {
      const fixture = VALID_RUN.replace('- **Class:** BLIND', '- **Class:** BANANA')
      const violations = validateImproveLog(fixture)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(fixture, '- **Class:**') && v.message.includes('Class "BANANA"'),
        ),
      ).toBe(true)
    })

    it('accepts every one of the eight legal classes with no Class violation', () => {
      for (const c of [
        'HARMFUL',
        'MIS-GRADED',
        'MIS-GATED',
        'VOID',
        'BLIND',
        'UNREACHABLE',
        'THIN',
        'FLAT',
      ]) {
        // Also re-class the picked ledger row to match, so this loop isolates the legal-value
        // check from the pick/ledger Class cross-check (§C5) tested separately below.
        const fixture = VALID_RUN.replace('- **Class:** BLIND', `- **Class:** ${c}`).replace(
          '| Metronome drifts under rubato | 1b | BLIND | 3 | 2 | 2 | 2 | 9 | M |',
          `| Metronome drifts under rubato | 1b | ${c} | 3 | 2 | 2 | 2 | 9 | M |`,
        )
        expect(validateImproveLog(fixture).some((v) => v.message.includes('Class'))).toBe(false)
      }
    })
  })

  // ------------------------------------------------------- Ledger Class column (§C2)

  describe('Ledger Class column', () => {
    it('rejects a ledger row with an invalid Class value', () => {
      const fixture = VALID_RUN.replace(
        '| Fingering hints too sparse | 1c | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
        '| Fingering hints too sparse | 1c | BOGUS | 2 | 1 | 1 | 1 | 5 | S |',
      )
      const violations = validateImproveLog(fixture)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(fixture, 'Fingering hints too sparse') &&
            v.message.includes('ledger row Class "BOGUS"'),
        ),
      ).toBe(true)
    })

    it('reports zero Class or column-count violations for the well-formed 9-column ledger', () => {
      const violations = validateImproveLog(VALID_RUN)
      expect(violations.some((v) => v.message.includes('ledger row Class'))).toBe(false)
      expect(violations.some((v) => v.message.includes('expected 9'))).toBe(false)
    })
  })

  // --------------------------------- Pick source / ledger Source accept reg, idea (§C3)

  describe('Pick source, Previous pick source, and ledger Source accept reg and idea', () => {
    it('accepts "reg" and "idea" as Pick source', () => {
      for (const v of ['reg', 'idea']) {
        const fixture = VALID_RUN.replace('- **Pick source:** 1b', `- **Pick source:** ${v}`)
        expect(
          validateImproveLog(fixture).some((viol) => viol.message.includes('Pick source')),
        ).toBe(false)
      }
    })

    it('rejects "none" as a Pick source — only Previous pick source may be "none"', () => {
      const fixture = VALID_RUN.replace('- **Pick source:** 1b', '- **Pick source:** none')
      const violations = validateImproveLog(fixture)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(fixture, '- **Pick source:**') &&
            v.message.includes('Pick source "none"'),
        ),
      ).toBe(true)
    })

    it('accepts "reg", "idea", and "none" as Previous pick source', () => {
      for (const v of ['reg', 'idea', 'none']) {
        const fixture = VALID_RUN.replace(
          '- **Previous pick source:** none',
          `- **Previous pick source:** ${v}`,
        )
        expect(
          validateImproveLog(fixture).some((viol) =>
            viol.message.includes('Previous pick source'),
          ),
        ).toBe(false)
      }
    })

    it('rejects a bad Previous pick source value', () => {
      const fixture = VALID_RUN.replace(
        '- **Previous pick source:** none',
        '- **Previous pick source:** 1z',
      )
      expect(
        validateImproveLog(fixture).some((v) => v.message.includes('Previous pick source "1z"')),
      ).toBe(true)
    })

    it('accepts "reg" and "idea" as a ledger row Source', () => {
      const fixture = VALID_RUN.replace(
        '| Fingering hints too sparse | 1c | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
        '| Fingering hints too sparse | reg | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
      )
      expect(validateImproveLog(fixture).some((v) => v.message.includes('ledger row source'))).toBe(
        false,
      )
    })

    it('rejects a ledger row Source outside 1a-1e, reg, idea', () => {
      const fixture = VALID_RUN.replace(
        '| Fingering hints too sparse | 1c | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
        '| Fingering hints too sparse | 9z | FLAT | 2 | 1 | 1 | 1 | 5 | S |',
      )
      expect(
        validateImproveLog(fixture).some((v) => v.message.includes('ledger row source "9z"')),
      ).toBe(true)
    })
  })

  // --------------------------------------------- Register cadence exemption (§C4)

  describe('Register cadence override exemption', () => {
    it('accepts a disagreeing Pick gap overridden by a Register cadence line, with no Harm gate or Thread', () => {
      const fixture = VALID_RUN.replace(
        '- **Pick gap:** Metronome drifts under rubato',
        '- **Pick gap:** Tempo slider hard to find',
      )
        .replace('- **Class:** BLIND', '- **Class:** THIN') // agree with the newly picked row (§C5)
        .replace(
          '- **Outcome:** clean',
          '- **Outcome:** clean\n- **Register cadence:** every-fourth-run cadence mandated a register pick this run (docs/improve/method.md).',
        )
      const violations = validateImproveLog(fixture)
      expect(
        violations.some((v) => v.message.includes('does not match the top-scoring ledger row')),
      ).toBe(false)
    })

    it('rejects a blank Register cadence line as an unexplained override, and the top-row mismatch still stands', () => {
      const fixture = VALID_RUN.replace(
        '- **Pick gap:** Metronome drifts under rubato',
        '- **Pick gap:** Tempo slider hard to find',
      ).replace('- **Outcome:** clean', '- **Outcome:** clean\n- **Register cadence:**')
      const violations = validateImproveLog(fixture)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(fixture, '- **Register cadence:**') &&
            v.message.includes('claimed but left blank'),
        ),
      ).toBe(true)
      expect(
        violations.some((v) => v.message.includes('does not match the top-scoring ledger row')),
      ).toBe(true)
    })
  })

  // ----------------------------------- Class vs. picked ledger row cross-check (§C5)

  describe('Class cross-check against the picked ledger row', () => {
    it("rejects a Class that disagrees with the picked ledger row's Class column", () => {
      const fixture = VALID_RUN.replace('- **Class:** BLIND', '- **Class:** VOID')
      const violations = validateImproveLog(fixture)
      expect(
        violations.some(
          (v) =>
            v.line === lineOf(fixture, '- **Class:**') &&
            v.message.includes(
              'Class "VOID" disagrees with the picked ledger row\'s Class column ("BLIND")',
            ),
        ),
      ).toBe(true)
    })

    it("accepts a Class that agrees with the picked ledger row's Class column", () => {
      expect(
        validateImproveLog(VALID_RUN).some((v) =>
          v.message.includes("disagrees with the picked ledger row"),
        ),
      ).toBe(false)
    })
  })
})

describe('collectMetricFields', () => {
  it('collects real declared field names from the repo\'s persisted/export shape files', () => {
    // Import lazily so a failure here reports as a real assertion failure, not a module-load
    // error hiding the rest of the suite.
    return import('./check-improve-log.mjs').then(({ collectMetricFields }) => {
      const root = fileURLToPath(new URL('..', import.meta.url))
      const result = collectMetricFields(root)
      expect(result).not.toBeNull()
      expect(result.allFieldNames.size).toBeGreaterThan(0)
      // PersistedSightReadingHistory.level is a real, stable field in persistedShapes.ts.
      expect(result.fieldsByType.get('PersistedSightReadingHistory')?.has('level')).toBe(true)
    })
  })

  it('returns null when a source file is missing', () => {
    return import('./check-improve-log.mjs').then(({ collectMetricFields }) => {
      const dir = mkdtempSync(join(tmpdir(), 'metric-fields-'))
      expect(collectMetricFields(dir)).toBeNull()
    })
  })
})

describe('check-improve-log.mjs CLI entry point', () => {
  it('exits 0 with no output when the target file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'improve-log-'))
    const missing = join(dir, 'does-not-exist.md')

    const result = spawnSync(process.execPath, [SCRIPT, '--file', missing], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr.trim()).toBe('')
  })
})
