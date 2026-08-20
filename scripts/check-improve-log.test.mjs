/**
 * Drives `validateImproveLog` with inline fixture strings — no filesystem, so this stays
 * fast and exercises every rule in the frozen contract directly rather than through
 * `docs/improve-log.md`, which does not exist yet (the loop is not bootstrapped).
 *
 * `main()` (the CLI entry point) is exercised separately by spawning the real script, since
 * that is the only way to see its argv parsing and its "file does not exist" exit-0 path.
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
- **Previous pick source:** none
- **Claim:** The learner will be able to find the tempo slider within one screen, and we will know because the slider-open event fires within 10s of lesson start.
- **Refutation condition:** The slider-open event does not fire within 10s for 3 consecutive sessions.
- **Metric:** time-to-slider-open (ms)
- **Baseline:** 0 events, newly instrumented
- **Outcome:** clean

### Ledger
| Gap | Source | Blocked | Reach | Teacherliness | Unmatchable | Sum | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tempo slider hard to find | 1a | 1 | 1 | 1 | 0 | 3 | S |
| Metronome drifts under rubato | 1b | 3 | 2 | 2 | 2 | 9 | M |
| Fingering hints too sparse | 1c | 2 | 1 | 1 | 1 | 5 | S |

### Cannot-sense register
none this run
`

describe('validateImproveLog', () => {
  it('reports zero violations for a fully valid single-run entry', () => {
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
      'we will know because the slider-open event fires within 10s of lesson start.',
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
      '| Fingering hints too sparse | 1c | 2 | 1 | 1 | 1 | 5 | S |',
      '| 1c | 2 | 1 | 1 | 1 | 5 | S |',
    )
    expect(validateImproveLog(badColumns).some((v) => v.message.includes('expected 8'))).toBe(
      true,
    )

    const emptyGap = VALID_RUN.replace(
      '| Fingering hints too sparse | 1c | 2 | 1 | 1 | 1 | 5 | S |',
      '|  | 1c | 2 | 1 | 1 | 1 | 5 | S |',
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
      '| Tempo slider hard to find | 1a | 1 | 1 | 1 | 0 | 3 | S |',
      '| Tempo slider hard to find | 1a | 4 | 1 | 1 | 0 | 3 | S |',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(fixture, '| Tempo slider hard to find | 1a | 4 |') &&
          v.message.includes('axis score "4"'),
      ),
    ).toBe(true)
  })

  it('rejects an age bonus on a non-1e ledger row, and a Sum that disagrees with the axis scores', () => {
    const badBonus = VALID_RUN.replace(
      '| Fingering hints too sparse | 1c | 2 | 1 | 1 | 1 | 5 | S |',
      '| Fingering hints too sparse | 1c | 2 | 1 | 1 | 1 | 5 +1 | S |',
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
      '| Fingering hints too sparse | 1c | 2 | 1 | 1 | 1 | 5 | S |',
      '| Fingering hints too sparse | 1c | 2 | 1 | 1 | 1 | 9 | S |',
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
    const fixture = VALID_RUN.replace('- **Pick source:** 1b', '- **Pick source:** 1e').replace(
      '| Tempo slider hard to find | 1a | 1 | 1 | 1 | 0 | 3 | S |',
      '| Fingering feels stale for a returning player | 1e | 1 | 3 | 3 | 1 | 8 +2 | M |',
    )
    const violations = validateImproveLog(fixture)
    expect(
      violations.some((v) => v.message.includes('does not match the top-scoring ledger row')),
    ).toBe(false)
  })

  it('rejects a Pick source disagreeing with the top ledger row, accepts it with a Harm gate override', () => {
    const disagreeing = VALID_RUN.replace('- **Pick source:** 1b', '- **Pick source:** 1a')
    const violations = validateImproveLog(disagreeing)
    expect(
      violations.some(
        (v) =>
          v.line === lineOf(disagreeing, '- **Pick source:**') &&
          v.message.includes('does not match the top-scoring ledger row'),
      ),
    ).toBe(true)

    const withOverride = disagreeing.replace(
      '- **Outcome:** clean',
      '- **Outcome:** clean\n- **Harm gate:** 1b would surface a mid-lesson dialog; picked 1a instead.',
    )
    expect(
      validateImproveLog(withOverride).some((v) =>
        v.message.includes('does not match the top-scoring ledger row'),
      ),
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
