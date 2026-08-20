#!/usr/bin/env node
/**
 * `docs/improve-log.md` is the ledger of the `/improve-app` session loop: every run is
 * supposed to name a persona, pick a candidate off a scored ledger, write a claim shaped
 * so it can actually fail, and record what happened. Written as prose, every one of those
 * rules is something an agent under deadline pressure can silently skip — a claim that
 * says "we will know because a hint appears" cannot fail, a pick that quietly disagrees
 * with its own ledger just means the ranking was decorative, and a "cannot sense" excuse
 * for data this app already captures (velocity, sustain, note-off, release time) hides a
 * signal that was there all along. This script turns each of those into a build failure
 * instead of a convention, so `verify` cannot go green on a run entry that skipped the
 * parts that keep the loop honest.
 *
 * If the file does not exist yet, this exits 0 silently — the loop has not been
 * bootstrapped and that must not turn `verify` red.
 *
 *   node scripts/check-improve-log.mjs [--file <path>]   (default: docs/improve-log.md)
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_FILE = 'docs/improve-log.md'

const REQUIRED_FIELDS = [
  'Persona',
  'Tier',
  'Pick source',
  'Previous pick source',
  'Claim',
  'Refutation condition',
  'Metric',
  'Baseline',
  'Outcome',
]

const VALID_TIERS = new Set(['Floor', 'M', 'L'])
const VALID_SOURCES = new Set(['1a', '1b', '1c', '1d', '1e', 'none'])
const VALID_OUTCOMES = new Set(['clean', 'shipped-not-clean', 'abort'])
const VALID_COSTS = new Set(['S', 'M', 'L'])

// The ways a claim gets written so that it structurally cannot fail. Denylisted rather
// than left to reviewer judgement, because judgement is exactly what a deadline erodes.
const CLAIM_DENYLIST = ['a test passes', 'tests pass', 'a hint appears', 'the code now']

// These are captured and already on disk (MIDI note-off, sustain pedal, velocity, and
// release time all reach the adapters layer). Calling one of them "cannot sense" in this
// register is a factual error, not a judgement call — the real gap belongs in the
// orphan-signals scan, which asks whether a captured signal is used, not whether it exists.
const CAPTURED_SIGNALS = ['note-off', 'sustain', 'velocity', 'release time']

const FIELD_LINE = /^-\s+\*\*([^*]+?):\*\*\s*(.*)$/
const RUN_HEADING = /^##\s+Run\b/
const H2_OR_H3_HEADING = /^#{2,3}\s+/
const LEDGER_HEADING = /^###\s+Ledger\b/
const REGISTER_HEADING = /^###\s+Cannot-sense register\b/
const TABLE_ROW = /^\s*\|.*\|\s*$/

/** True for a markdown table separator row (`| --- | :--: | ... |`), any column count. */
function isSeparatorRow(line) {
  const stripped = line.replace(/[|:\-\s]/g, '')
  return stripped === '' && line.includes('-')
}

/** Split a `| a | b | c |` row into trimmed cells, dropping the wrapping pipes. */
function splitRow(line) {
  const trimmed = line.trim()
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((c) => c.trim())
}

const FENCE_LINE = /^(`{3,}|~{3,})/

/**
 * Blank out the contents of fenced code blocks (``` ... ``` or ~~~ ... ~~~, any info
 * string) so nothing inside them — including a literal `## Run` heading used as a schema
 * example in `docs/improve-log.md`'s own "Entry schema" section — is parsed as a real run
 * entry. Lines are replaced with `''` in place, never removed, so every surviving line keeps
 * its true 1-based line number for violation reporting.
 */
function stripFencedCode(lines) {
  const result = lines.slice()
  let fenceChar = null
  let fenceLen = 0
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (fenceChar === null) {
      const open = FENCE_LINE.exec(trimmed)
      if (open) {
        fenceChar = open[1][0]
        fenceLen = open[1].length
        result[i] = ''
      }
      continue
    }
    result[i] = ''
    const close = new RegExp(`^\\${fenceChar}{${fenceLen},}\\s*$`).exec(trimmed)
    if (close) {
      fenceChar = null
      fenceLen = 0
    }
  }
  return result
}

/**
 * Collect the `- **Label:** value` lines inside [start, end) of a run entry.
 * Returns a Map from label to { value, line } (1-based line number), first occurrence wins.
 */
function collectFields(lines, start, end) {
  const fields = new Map()
  for (let i = start; i < end; i++) {
    const m = FIELD_LINE.exec(lines[i])
    if (!m) continue
    const label = m[1].trim()
    if (!fields.has(label)) fields.set(label, { value: m[2].trim(), line: i + 1 })
  }
  return fields
}

/**
 * Parse the `### Ledger` table inside [start, end). Pushes a violation for each malformed
 * row and for a missing section/table entirely. Returns the VALID rows only — a malformed
 * row cannot be ranked, so it is excluded from the "does Pick source match the top row"
 * check rather than silently treated as a candidate.
 */
function parseLedger(lines, start, end, headingLine, violations) {
  let ledgerStart = -1
  for (let i = start; i < end; i++) {
    if (LEDGER_HEADING.test(lines[i])) {
      ledgerStart = i
      break
    }
  }
  if (ledgerStart === -1) {
    violations.push({
      line: headingLine,
      message: 'missing required "### Ledger" section. Add one with the scoring table.',
    })
    return []
  }

  let ledgerEnd = end
  for (let i = ledgerStart + 1; i < end; i++) {
    if (H2_OR_H3_HEADING.test(lines[i])) {
      ledgerEnd = i
      break
    }
  }

  const tableLines = []
  for (let i = ledgerStart + 1; i < ledgerEnd; i++) {
    if (TABLE_ROW.test(lines[i])) tableLines.push({ line: lines[i], num: i + 1 })
  }

  if (tableLines.length < 2) {
    violations.push({
      line: headingLine,
      message:
        '"### Ledger" section has no table. Add a markdown table with a header row and one row per candidate.',
    })
    return []
  }

  // Row 0 is the header. Row 1 is the separator if it looks like one; otherwise there was
  // no separator row and row 1 is already data.
  const dataStart = isSeparatorRow(tableLines[1].line) ? 2 : 1

  const rows = []
  for (let i = dataStart; i < tableLines.length; i++) {
    const { line, num } = tableLines[i]
    const cells = splitRow(line)
    if (cells.length !== 8) {
      violations.push({
        line: num,
        message: `ledger row has ${cells.length} column(s), expected 8 (gap, source, 4 axis scores, sum, cost). Fix the row.`,
      })
      continue
    }
    const [gap, source, a1, a2, a3, a4, sumCell, cost] = cells
    const scores = [a1, a2, a3, a4]
    let rowOk = true

    if (gap === '') {
      violations.push({
        line: num,
        message: 'ledger row "Gap" column is empty. Add a short description of the gap.',
      })
      rowOk = false
    }
    if (!/^1[a-e]$/.test(source)) {
      violations.push({
        line: num,
        message: `ledger row source "${source}" is not one of 1a, 1b, 1c, 1d, 1e. Fix the value.`,
      })
      rowOk = false
    }
    for (const s of scores) {
      if (!/^[0-3]$/.test(s)) {
        violations.push({
          line: num,
          message: `ledger axis score "${s}" is out of range — must be an integer 0-3. Fix the value.`,
        })
        rowOk = false
      }
    }
    if (!VALID_COSTS.has(cost)) {
      violations.push({
        line: num,
        message: `ledger cost "${cost}" is not one of S, M, L. Fix the value.`,
      })
      rowOk = false
    }

    // Sum is the four axis scores, optionally followed by " +N" — a 1e-only age bonus. The
    // bonus is folded into `total`, which is what ranking against Pick source uses, per the
    // "rank on Sum including the age bonus" rule.
    const sumMatch = /^(\d+)(?:\s*\+\s*(\d+))?$/.exec(sumCell)
    let total = null
    if (!sumMatch) {
      violations.push({
        line: num,
        message: `ledger row Sum "${sumCell}" is not a valid integer, or an integer with a " +N" age bonus. Fix the value.`,
      })
      rowOk = false
    } else {
      const base = Number(sumMatch[1])
      const bonus = sumMatch[2] === undefined ? undefined : Number(sumMatch[2])

      if (scores.every((s) => /^[0-3]$/.test(s))) {
        const axisSum = scores.reduce((acc, s) => acc + Number(s), 0)
        if (base !== axisSum) {
          violations.push({
            line: num,
            message: `ledger row Sum "${sumCell}" disagrees with the four axis scores (which total ${axisSum}). Fix the value.`,
          })
          rowOk = false
        }
      }

      if (bonus !== undefined) {
        if (source !== '1e') {
          violations.push({
            line: num,
            message: `ledger row carries a " +${bonus}" age bonus but source "${source}" is not 1e. Age bonuses are only legal for 1e rows.`,
          })
          rowOk = false
        }
        if (bonus < 1 || bonus > 3) {
          violations.push({
            line: num,
            message: `ledger row age bonus "+${bonus}" is out of range — must be an integer 1-3. Fix the value.`,
          })
          rowOk = false
        }
      }

      total = base + (bonus ?? 0)
    }

    if (rowOk) {
      rows.push({ source, sum: total, line: num })
    }
  }

  return rows
}

/**
 * Validate the `### Cannot-sense register` inside [start, end): either exactly the line
 * "none this run", or one or more entries each naming a screen via `(screen: <name>)` and
 * never naming a signal this app already captures.
 */
function validateRegister(lines, start, end, headingLine, violations) {
  let regStart = -1
  for (let i = start; i < end; i++) {
    if (REGISTER_HEADING.test(lines[i])) {
      regStart = i
      break
    }
  }
  if (regStart === -1) {
    violations.push({
      line: headingLine,
      message:
        'missing required "### Cannot-sense register" section. Add one, or the line "none this run".',
    })
    return
  }

  let regEnd = end
  for (let i = regStart + 1; i < end; i++) {
    if (H2_OR_H3_HEADING.test(lines[i])) {
      regEnd = i
      break
    }
  }

  const body = []
  for (let i = regStart + 1; i < regEnd; i++) {
    const text = lines[i].trim()
    if (text !== '') body.push({ text, num: i + 1 })
  }

  if (body.length === 0) {
    violations.push({
      line: headingLine,
      message:
        '"### Cannot-sense register" section is empty. Add "none this run" or a screen-tagged entry.',
    })
    return
  }

  if (body.length === 1 && body[0].text === 'none this run') return

  for (const { text, num } of body) {
    if (text === 'none this run') {
      violations.push({
        line: num,
        message:
          '"none this run" must be the only line in the register. Remove the other entries, or remove this line.',
      })
      continue
    }
    if (!/\(screen:\s*[^)]+\)/.test(text)) {
      violations.push({
        line: num,
        message: `cannot-sense register entry is missing "(screen: <name>)": "${text}"`,
      })
    }
    const lower = text.toLowerCase()
    for (const signal of CAPTURED_SIGNALS) {
      if (lower.includes(signal)) {
        violations.push({
          line: num,
          message: `"${signal}" is captured and on disk — it belongs to the orphan-signals scan, not the cannot-sense register. Remove it from this entry.`,
        })
      }
    }
  }
}

/** Validate one `## Run` entry spanning lines [start, end) of the file. */
function validateRunEntry(lines, start, end, violations) {
  const headingLine = start + 1
  const fields = collectFields(lines, start, end)

  for (const label of REQUIRED_FIELDS) {
    if (!fields.has(label)) {
      violations.push({
        line: headingLine,
        message: `missing required field "${label}". Add a "- **${label}:**" line to this run entry.`,
      })
    }
  }

  const persona = fields.get('Persona')
  if (persona && !/\((piano|drums)\)\s*$/.test(persona.value)) {
    violations.push({
      line: persona.line,
      message: `Persona "${persona.value}" must end with "(piano)" or "(drums)". Fix the value.`,
    })
  }

  const tier = fields.get('Tier')
  if (tier && !VALID_TIERS.has(tier.value)) {
    violations.push({
      line: tier.line,
      message: `Tier "${tier.value}" is not one of Floor, M, L. Fix the value.`,
    })
  }

  const pickSource = fields.get('Pick source')
  if (pickSource && !VALID_SOURCES.has(pickSource.value)) {
    violations.push({
      line: pickSource.line,
      message: `Pick source "${pickSource.value}" is not one of 1a, 1b, 1c, 1d, 1e, none. Fix the value.`,
    })
  }

  const prevPickSource = fields.get('Previous pick source')
  if (prevPickSource && !VALID_SOURCES.has(prevPickSource.value)) {
    violations.push({
      line: prevPickSource.line,
      message: `Previous pick source "${prevPickSource.value}" is not one of 1a, 1b, 1c, 1d, 1e, none. Fix the value.`,
    })
  }

  const outcome = fields.get('Outcome')
  if (outcome && !VALID_OUTCOMES.has(outcome.value)) {
    violations.push({
      line: outcome.line,
      message: `Outcome "${outcome.value}" is not one of clean, shipped-not-clean, abort. Fix the value.`,
    })
  }
  if (outcome && outcome.value === 'abort') {
    const hasProof = lines.slice(start, end).some((l) => /^###\s+Proof\b/.test(l))
    if (!hasProof) {
      violations.push({
        line: outcome.line,
        message:
          'Outcome "abort" requires a "### Proof" section recording proof of the blocker. Add one.',
      })
    }
  }

  const thread = fields.get('Thread')
  if (thread) {
    const m = /^(.+),\s*run\s+(\d+)\s+of\s+(\d+)\s*$/.exec(thread.value)
    if (!m) {
      violations.push({
        line: thread.line,
        message: `Thread "${thread.value}" does not match "<slug>, run k of <cap>". Fix the value.`,
      })
    } else {
      const k = Number(m[2])
      const cap = Number(m[3])
      if (k > cap) {
        violations.push({
          line: thread.line,
          message: `Thread "${thread.value}" has run ${k} greater than its cap ${cap}. Fix the value.`,
        })
      }
    }
  }

  const baseline = fields.get('Baseline')
  if (baseline) {
    const isNumber = /^\d+(\.\d+)?$/.test(baseline.value)
    const isBootstrap = baseline.value === '0 events, newly instrumented'
    if (!isNumber && !isBootstrap) {
      violations.push({
        line: baseline.line,
        message: `Baseline "${baseline.value}" is neither a number nor "0 events, newly instrumented". Fix the value.`,
      })
    }
  }

  const claim = fields.get('Claim')
  if (claim) {
    const lower = claim.value.toLowerCase()
    if (!lower.includes('will be able to') || !lower.includes('we will know because')) {
      violations.push({
        line: claim.line,
        message:
          'Claim does not match the template shape (needs "will be able to" and "we will know because"). Rewrite it to the template.',
      })
    }
    for (const phrase of CLAIM_DENYLIST) {
      if (lower.includes(phrase)) {
        violations.push({
          line: claim.line,
          message: `Claim contains the non-observable phrase "${phrase}". Name an observable instead.`,
        })
      }
    }
  }

  const ledgerRows = parseLedger(lines, start, end, headingLine, violations)

  if (pickSource && VALID_SOURCES.has(pickSource.value) && ledgerRows.length > 0) {
    const hasOverride = fields.has('Harm gate') || fields.has('Thread')
    if (!hasOverride) {
      const topSum = Math.max(...ledgerRows.map((r) => r.sum))
      const topSources = ledgerRows.filter((r) => r.sum === topSum).map((r) => r.source)
      if (!topSources.includes(pickSource.value)) {
        violations.push({
          line: pickSource.line,
          message: `Pick source "${pickSource.value}" does not match the top-scoring ledger row (${topSources.join(', ')}). Fix the pick, or add a "- **Harm gate:**" or "- **Thread:**" line documenting the override.`,
        })
      }
    }
  }

  validateRegister(lines, start, end, headingLine, violations)
}

/**
 * Validate the full text of `docs/improve-log.md` and return every violation found, each
 * as `{ line, message }` (1-based line number). Pure — no filesystem access — so tests can
 * drive it directly with fixture strings.
 */
export function validateImproveLog(text) {
  const lines = stripFencedCode(text.replace(/\r\n/g, '\n').split('\n'))
  const violations = []

  const runStarts = []
  lines.forEach((line, i) => {
    if (RUN_HEADING.test(line)) runStarts.push(i)
  })

  for (let r = 0; r < runStarts.length; r++) {
    const start = runStarts[r]
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) {
        end = i
        break
      }
    }
    validateRunEntry(lines, start, end, violations)
  }

  return violations
}

function main() {
  const argv = process.argv.slice(2)
  let file = DEFAULT_FILE

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1] !== undefined) {
      file = argv[i + 1]
      i++
    } else {
      console.error('usage: node scripts/check-improve-log.mjs [--file <path>]')
      process.exit(2)
      return
    }
  }

  const target = resolve(process.cwd(), file)
  if (!existsSync(target)) process.exit(0)

  const text = readFileSync(target, 'utf8')
  const violations = validateImproveLog(text)

  if (violations.length > 0) {
    for (const v of violations) console.error(`${file}:${v.line}: ${v.message}`)
    process.exit(1)
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) main()
