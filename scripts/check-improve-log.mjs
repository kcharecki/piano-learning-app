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
import ts from 'typescript'

const DEFAULT_FILE = 'docs/improve-log.md'

// The two files that between them describe everything this app persists and exports — the
// only legal vocabulary for `Metric`. See `collectMetricFields` below.
const METRIC_SOURCE_FILES = ['src/app/state/persistedShapes.ts', 'src/core/progress/export.ts']

const REQUIRED_FIELDS = [
  'Persona',
  'Tier',
  'Pick source',
  'Pick gap',
  'Previous pick source',
  'Class',
  'Claim',
  'Refutation condition',
  'Metric',
  'Baseline',
  'Outcome',
  'Endorsement',
]

const VALID_TIERS = new Set(['Floor', 'M', 'L'])
// "Pick source" and "Previous pick source" are documented with different legal value sets
// (`docs/improve-log.md`'s Entry schema, lines 22-23): only "Previous pick source" may be
// "none" — a run always picked *something*, but the very first run has no predecessor.
const VALID_PICK_SOURCES = new Set(['1a', '1b', '1c', '1d', '1e', 'reg', 'idea'])
const VALID_PREV_PICK_SOURCES = new Set(['1a', '1b', '1c', '1d', '1e', 'reg', 'idea', 'none'])
// The ledger table's Source column takes the same set as "Pick source" (never "none" — every
// ledger row is a real candidate).
const VALID_LEDGER_SOURCE = /^(1[a-e]|reg|idea)$/
const VALID_CLASSES = new Set([
  'HARMFUL',
  'MIS-GRADED',
  'MIS-GATED',
  'VOID',
  'BLIND',
  'UNREACHABLE',
  'THIN',
  'FLAT',
])
const VALID_OUTCOMES = new Set(['clean', 'shipped-not-clean', 'abort'])
const VALID_COSTS = new Set(['S', 'M', 'L'])
const VALID_ENDORSEMENTS = new Set(['yes', 'no', 'n/a — Floor tier'])
const FLOOR_ENDORSEMENT = 'n/a — Floor tier'

// The ways a claim gets written so that it structurally cannot fail. Denylisted rather
// than left to reviewer judgement, because judgement is exactly what a deadline erodes.
const CLAIM_DENYLIST = [
  'a test passes',
  'tests pass',
  'a hint appears',
  'the code now',
  'the test suite',
  'the spec passes',
  'is implemented',
  'is wired',
  'the function returns',
  'the component renders',
  'no console errors',
  'coverage',
  'typecheck',
  'the field is set',
  'the store contains',
  'it compiles',
]

// Terms whose presence marks a claim's "we will know because" clause as describing
// something a learner can observe in the running app — a screen, an action, a sense —
// rather than a fact about the code or the test suite. Widen this list only with evidence
// (a real claim that should pass and currently doesn't); do not add a word because it
// "sounds" observable.
export const OBSERVABLE_ALLOWLIST = [
  'sees',
  'hears',
  'plays',
  'shows',
  'displays',
  'reads back',
  'on screen',
  'the learner can',
]

// A claim also counts as observable when it names a screen ("the Practice screen", "the
// tempo-slider screen") — one or two words immediately before the word "screen".
const SCREEN_NAME = /\b[\w-]+(?:\s+[\w-]+)?\s+screen\b/i

const WATCH_MARKER = 'we will know because'

// These are captured and already on disk (MIDI note-off, sustain pedal, velocity, and
// release time all reach the adapters layer). Calling one of them "cannot sense" in this
// register is a factual error, not a judgement call — the real gap belongs in the
// orphan-signals scan, which asks whether a captured signal is used, not whether it exists.
const CAPTURED_SIGNALS = ['note-off', 'sustain', 'velocity', 'release time']

// A Harm gate override must cite a `file:line` location and either a URL or a quoted
// passage — the same evidence bar `docs/improve/method.md` sets for a HARMFUL finding.
// Anything looser (a lone sentence with no citation) is not evidence, it is an off switch.
const HARM_GATE_LOCATION = /\S+\.\w+:\d+/
const HARM_GATE_URL = /https?:\/\/\S+/
const HARM_GATE_QUOTE = /"[^"]+"/

const FIELD_LINE = /^-\s+\*\*([^*]+?):\*\*\s*(.*)$/
const RUN_HEADING = /^##\s+Run\b/
const H2_HEADING = /^##\s+/
const H2_OR_H3_HEADING = /^#{2,3}\s+/
const LEDGER_HEADING = /^###\s+Ledger\b/
const REGISTER_HEADING = /^###\s+Cannot-sense register\b/
const NEXT_STEPS_HEADING = /^###\s+Next steps\b/
const STANDING_REGISTER_HEADING = /^##\s+Cannot-sense register\b/
const IDEA_REGISTER_HEADING = /^##\s+Idea register\b/
const IDEA_PLACEHOLDER = '*(none yet)*'

// `### Next steps` was added to the schema on 2026-08-25, at the user's direction: a run that
// ends without saying what it left behind makes the next session re-derive the queue from the
// roadmap, which is the rediscovery this whole file exists to stop. Entries older than the
// cutoff predate the rule and are not retro-fitted; ids that are not date-stamped (the test
// fixtures' `## Run 1`) are out of scope, since `improve-run.mjs start` only ever mints dates.
const NEXT_STEPS_FROM = '2026-08-24'
const DATED_RUN_ID = /^##\s+Run\s+(\d{4}-\d{2}-\d{2})\S*/
const NEXT_STEPS_NONE = 'nothing queued this run'
// A next step is a pointer at a committed roadmap row (`T.19`, `U.3`, `DR-02`), never prose.
const CITED_ROADMAP_ID = /`([A-Z]{1,4}[.-]\d+)`/g
// `- [ ] T.19 **...**` / `- [x] DR-02 **...**` — how ROADMAP.md opens every task row.
const ROADMAP_ROW_ID = /^\s*-\s+\[[ x~]\]\s+([A-Z]{1,4}[.-]\d+)\b/
const VALID_IDEA_STATUS = /^(open|shipped in .+|struck — .+)$/
const NOT_YET_DISCLOSED = /^\*\(not yet disclosed\)\*$/i
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
 * row cannot be ranked, so it is excluded from the "does Pick gap match the top row"
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
    if (cells.length !== 9) {
      violations.push({
        line: num,
        message: `ledger row has ${cells.length} column(s), expected 9 (gap, source, class, 4 axis scores, sum, cost). Fix the row.`,
      })
      continue
    }
    const [gap, source, cls, a1, a2, a3, a4, sumCell, cost] = cells
    const scores = [a1, a2, a3, a4]
    let rowOk = true

    if (gap === '') {
      violations.push({
        line: num,
        message: 'ledger row "Gap" column is empty. Add a short description of the gap.',
      })
      rowOk = false
    }
    if (!VALID_LEDGER_SOURCE.test(source)) {
      violations.push({
        line: num,
        message: `ledger row source "${source}" is not one of 1a, 1b, 1c, 1d, 1e, reg, idea. Fix the value.`,
      })
      rowOk = false
    }
    if (!VALID_CLASSES.has(cls)) {
      violations.push({
        line: num,
        message: `ledger row Class "${cls}" is not one of ${[...VALID_CLASSES].join(', ')}. Fix the value.`,
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
      rows.push({ gap, source, cls, sum: total, line: num })
    }
  }

  return rows
}

/**
 * Validate the standing `## Cannot-sense register (standing)` table: 4 columns (Unsensable,
 * Why, Countability challenge, Disclosed on). `Why` must classify PHYSICAL or OURS, every row
 * must carry a written countability challenge (the doc's own words: a row without one "is
 * not defended, it is unexamined"), `Disclosed on` must name a screen or the not-yet-disclosed
 * placeholder, and `Unsensable` may never name a signal this app already captures. This is a
 * standing, file-level section — validated once per file, not once per run entry.
 */
function validateStandingCannotSenseTable(lines, violations) {
  let headingLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (STANDING_REGISTER_HEADING.test(lines[i])) {
      headingLine = i
      break
    }
  }
  if (headingLine === -1) return

  let sectionEnd = lines.length
  for (let i = headingLine + 1; i < lines.length; i++) {
    if (H2_HEADING.test(lines[i])) {
      sectionEnd = i
      break
    }
  }

  const tableLines = []
  for (let i = headingLine + 1; i < sectionEnd; i++) {
    if (TABLE_ROW.test(lines[i])) tableLines.push({ line: lines[i], num: i + 1 })
  }
  if (tableLines.length < 2) return

  const dataStart = isSeparatorRow(tableLines[1].line) ? 2 : 1
  for (let i = dataStart; i < tableLines.length; i++) {
    const { line, num } = tableLines[i]
    const cells = splitRow(line)
    if (cells.length !== 4) {
      violations.push({
        line: num,
        message: `cannot-sense register (standing) row has ${cells.length} column(s), expected 4 (Unsensable, Why, Countability challenge, Disclosed on). Fix the row.`,
      })
      continue
    }
    const [unsensable, why, challenge, disclosedOn] = cells

    if (!/^\*\*(PHYSICAL|OURS)\*\*/.test(why)) {
      violations.push({
        line: num,
        message: `cannot-sense register (standing) row "Why" must begin with "**PHYSICAL**" or "**OURS**": "${why}"`,
      })
    }
    if (challenge === '') {
      violations.push({
        line: num,
        message:
          'cannot-sense register (standing) row has an empty "Countability challenge" — an unexamined row is not defended. Add one.',
      })
    }
    if (!NOT_YET_DISCLOSED.test(disclosedOn) && !/\(screen:\s*[^)]+\)/.test(disclosedOn)) {
      violations.push({
        line: num,
        message: `cannot-sense register (standing) row "Disclosed on" is missing "(screen: <name>)" or the "*(not yet disclosed)*" placeholder: "${disclosedOn}"`,
      })
    }
    const lowerUnsensable = unsensable.toLowerCase()
    for (const signal of CAPTURED_SIGNALS) {
      if (lowerUnsensable.includes(signal)) {
        violations.push({
          line: num,
          message: `"${signal}" is captured and on disk — it belongs to the orphan-signals scan, not the cannot-sense register. Remove it from this entry.`,
        })
      }
    }
  }
}

/**
 * Validate the standing `## Idea register` table: 3 columns (Idea, From run, Status), every
 * data row's Idea non-empty (or the accepted `*(none yet)*` empty-state placeholder, skipped
 * like the per-run register's "none this run"), and Status one of `open`, `shipped in <run-id>`,
 * `struck — <reason>`. Missing entirely is a violation — this section exists so the Rival
 * seat's unshipped output is written down instead of discarded.
 */
function validateIdeaRegister(lines, violations) {
  let headingLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (IDEA_REGISTER_HEADING.test(lines[i])) {
      headingLine = i
      break
    }
  }
  if (headingLine === -1) {
    violations.push({
      line: 1,
      message: 'missing required "## Idea register" section. Add one with the ideas table.',
    })
    return
  }

  let sectionEnd = lines.length
  for (let i = headingLine + 1; i < lines.length; i++) {
    if (H2_HEADING.test(lines[i])) {
      sectionEnd = i
      break
    }
  }

  const tableLines = []
  for (let i = headingLine + 1; i < sectionEnd; i++) {
    if (TABLE_ROW.test(lines[i])) tableLines.push({ line: lines[i], num: i + 1 })
  }
  if (tableLines.length < 2) {
    violations.push({
      line: headingLine + 1,
      message: '"## Idea register" section has no table. Add a markdown table with a header row and one row per idea.',
    })
    return
  }

  const dataStart = isSeparatorRow(tableLines[1].line) ? 2 : 1
  for (let i = dataStart; i < tableLines.length; i++) {
    const { line, num } = tableLines[i]
    const cells = splitRow(line)
    if (cells.length !== 3) {
      violations.push({
        line: num,
        message: `idea register row has ${cells.length} column(s), expected 3 (Idea, From run, Status). Fix the row.`,
      })
      continue
    }
    const [idea, , status] = cells
    if (idea === IDEA_PLACEHOLDER) continue

    if (idea === '') {
      violations.push({
        line: num,
        message: `idea register row "Idea" column is empty. Add the idea, or use the "${IDEA_PLACEHOLDER}" placeholder row.`,
      })
    }
    if (!VALID_IDEA_STATUS.test(status)) {
      violations.push({
        line: num,
        message: `idea register row Status "${status}" is not one of "open", "shipped in <run-id>", "struck — <reason>". Fix the value.`,
      })
    }
  }
}

/**
 * Collect every field name declared on an exported `type X = { ... }` object-literal alias in
 * `src/app/state/persistedShapes.ts` and `src/core/progress/export.ts` — the two files that
 * between them describe everything this app persists and exports. Used to keep `Metric`
 * honest: a run cannot defer its verdict to a field name nobody declared. Returns `null` when
 * either source file is missing — skip the check, the same convention as a missing target
 * file — rather than failing every run.
 *
 * A small, independent reimplementation of the AST walk `scripts/orphan-signals.mjs`'s
 * `parseTypeFields` already does over these same two files, not an import of it: the two
 * scripts read the same files for a related but distinct reason and stay decoupled anyway.
 */
export function collectMetricFields(root = process.cwd()) {
  const fieldsByType = new Map()
  const allFieldNames = new Set()

  for (const rel of METRIC_SOURCE_FILES) {
    const abs = resolve(root, rel)
    if (!existsSync(abs)) return null
    const text = readFileSync(abs, 'utf8')
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const stmt of sf.statements) {
      if (!ts.isTypeAliasDeclaration(stmt)) continue
      if (!(ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export)) continue
      if (!ts.isTypeLiteralNode(stmt.type)) continue
      const typeName = stmt.name.text
      if (!fieldsByType.has(typeName)) fieldsByType.set(typeName, new Set())
      for (const member of stmt.type.members) {
        if (!ts.isPropertySignature(member) || !member.name) continue
        const fieldName =
          ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
            ? member.name.text
            : undefined
        if (fieldName === undefined) continue
        fieldsByType.get(typeName).add(fieldName)
        allFieldNames.add(fieldName)
      }
    }
  }

  return { fieldsByType, allFieldNames }
}

/** True when `value` names a declared field (bare) or `<Type>.<field>` naming one. */
function isDeclaredMetric(value, metricFields) {
  if (metricFields.allFieldNames.has(value)) return true
  const dot = value.indexOf('.')
  if (dot > 0 && dot < value.length - 1) {
    const typeName = value.slice(0, dot)
    const fieldName = value.slice(dot + 1)
    const set = metricFields.fieldsByType.get(typeName)
    if (set && set.has(fieldName)) return true
  }
  return false
}

/** The clause of a Claim that names the observable — the text after "we will know because",
 * or the whole Claim when that marker is absent (already flagged by the template-shape check
 * this runs alongside). */
function observableClause(claimValue) {
  const lower = claimValue.toLowerCase()
  const idx = lower.indexOf(WATCH_MARKER)
  return idx === -1 ? claimValue : claimValue.slice(idx + WATCH_MARKER.length)
}

/** True when `value` cites a `file:line` location and either a URL or a quoted passage —
 * the evidence bar a Harm gate override must clear to count as anything but an off switch. */
function harmGateHasEvidence(value) {
  return HARM_GATE_LOCATION.test(value) && (HARM_GATE_URL.test(value) || HARM_GATE_QUOTE.test(value))
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

/**
 * Collect every task id declared in `ROADMAP.md`'s task rows. Used to keep `### Next steps`
 * honest: a run cannot hand the next session a pointer at a row nobody filed. Returns `null`
 * when the file is missing — skip the check, the same convention as `collectMetricFields`.
 */
export function collectRoadmapIds(root = process.cwd()) {
  const abs = resolve(root, 'ROADMAP.md')
  if (!existsSync(abs)) return null
  const ids = new Set()
  for (const line of readFileSync(abs, 'utf8').split('\n')) {
    const m = ROADMAP_ROW_ID.exec(line)
    if (m) ids.add(m[1])
  }
  return ids
}

/**
 * Validate the `### Next steps` inside [start, end): either exactly the line
 * "nothing queued this run", or one or more lines each citing at least one roadmap id in
 * backticks. `roadmapIds` is the result of `collectRoadmapIds`, or `null` to skip the
 * membership half of the check and take any well-formed id.
 */
function validateNextSteps(lines, start, end, headingLine, violations, roadmapIds) {
  const dated = DATED_RUN_ID.exec(lines[start])
  if (!dated || dated[1] < NEXT_STEPS_FROM) return

  let secStart = -1
  for (let i = start; i < end; i++) {
    if (NEXT_STEPS_HEADING.test(lines[i])) {
      secStart = i
      break
    }
  }
  if (secStart === -1) {
    violations.push({
      line: headingLine,
      message: `missing required "### Next steps" section. Add one naming the roadmap rows this run leaves for the next session, or the line "${NEXT_STEPS_NONE}".`,
    })
    return
  }

  let secEnd = end
  for (let i = secStart + 1; i < end; i++) {
    if (H2_OR_H3_HEADING.test(lines[i])) {
      secEnd = i
      break
    }
  }

  const body = []
  for (let i = secStart + 1; i < secEnd; i++) {
    const text = lines[i].trim()
    if (text !== '') body.push({ text, num: i + 1 })
  }

  if (body.length === 0) {
    violations.push({
      line: headingLine,
      message: `"### Next steps" section is empty. Add "${NEXT_STEPS_NONE}" or a line per roadmap row.`,
    })
    return
  }

  if (body.length === 1 && body[0].text === NEXT_STEPS_NONE) return

  for (const { text, num } of body) {
    if (text === NEXT_STEPS_NONE) {
      violations.push({
        line: num,
        message: `"${NEXT_STEPS_NONE}" must be the only line in "### Next steps". Remove the other lines, or remove this line.`,
      })
      continue
    }
    const cited = [...text.matchAll(CITED_ROADMAP_ID)].map((m) => m[1])
    if (cited.length === 0) {
      violations.push({
        line: num,
        message: `"### Next steps" line cites no roadmap id in backticks (e.g. \`T.19\`): "${text}"`,
      })
      continue
    }
    if (roadmapIds === null) continue
    for (const id of cited) {
      if (!roadmapIds.has(id)) {
        violations.push({
          line: num,
          message: `"### Next steps" cites \`${id}\`, which is not a task row in ROADMAP.md. File the row, or fix the id.`,
        })
      }
    }
  }
}

/** Validate one `## Run` entry spanning lines [start, end) of the file. `metricFields` is the
 * result of `collectMetricFields`, or `null` to skip the Metric-membership check;
 * `roadmapIds` likewise for the `### Next steps` membership check. */
function validateRunEntry(lines, start, end, violations, metricFields, roadmapIds) {
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
  if (pickSource && !VALID_PICK_SOURCES.has(pickSource.value)) {
    violations.push({
      line: pickSource.line,
      message: `Pick source "${pickSource.value}" is not one of 1a, 1b, 1c, 1d, 1e, reg, idea. Fix the value.`,
    })
  }

  const cls = fields.get('Class')
  if (cls && !VALID_CLASSES.has(cls.value)) {
    violations.push({
      line: cls.line,
      message: `Class "${cls.value}" is not one of ${[...VALID_CLASSES].join(', ')}. Fix the value.`,
    })
  }

  const endorsement = fields.get('Endorsement')
  if (endorsement && !VALID_ENDORSEMENTS.has(endorsement.value)) {
    violations.push({
      line: endorsement.line,
      message: `Endorsement "${endorsement.value}" is not one of yes, no, "${FLOOR_ENDORSEMENT}". Fix the value.`,
    })
  }
  if (tier && (tier.value === 'M' || tier.value === 'L')) {
    if (!endorsement || endorsement.value === FLOOR_ENDORSEMENT) {
      violations.push({
        line: endorsement ? endorsement.line : headingLine,
        message: `Tier "${tier.value}" requires a real Teacher Endorsement ("yes" or "no") — a missing field or "${FLOOR_ENDORSEMENT}" is not enough. Fix the value.`,
      })
    }
  }
  if (tier && tier.value === 'Floor' && endorsement && endorsement.value !== FLOOR_ENDORSEMENT) {
    violations.push({
      line: endorsement.line,
      message: `Tier "Floor" requires Endorsement "${FLOOR_ENDORSEMENT}", not "${endorsement.value}". Fix the value.`,
    })
  }

  const prevPickSource = fields.get('Previous pick source')
  if (prevPickSource && !VALID_PREV_PICK_SOURCES.has(prevPickSource.value)) {
    violations.push({
      line: prevPickSource.line,
      message: `Previous pick source "${prevPickSource.value}" is not one of 1a, 1b, 1c, 1d, 1e, reg, idea, none. Fix the value.`,
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
  if (endorsement && endorsement.value === 'no' && outcome && outcome.value === 'clean') {
    violations.push({
      line: endorsement.line,
      message:
        'Endorsement "no" cannot pair with Outcome "clean" — an unendorsed slice may ship as shipped-not-clean or abort, never clean. Fix the Outcome, or get the endorsement.',
    })
  }

  const thread = fields.get('Thread')
  let threadShapeValid = false
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
      } else {
        threadShapeValid = true
      }
    }
  }

  const harmGate = fields.get('Harm gate')
  let harmGateValid = false
  if (harmGate) {
    harmGateValid = harmGateHasEvidence(harmGate.value)
    if (!harmGateValid) {
      violations.push({
        line: harmGate.line,
        message:
          'Harm gate override was claimed but not evidenced — it must cite a "file:line" location and either an http(s) URL or a quoted passage. Fix the value.',
      })
    }
  }

  // A third override-exemption line (`docs/improve-log.md` line 67-68), for a run whose pick
  // was mandated by the cannot-sense register's every-fourth-run cadence
  // (`docs/improve/method.md`'s "Cadence") rather than by the ledger's own ranking. Unlike
  // Harm gate, the docs give no evidence format for this line — only that it must "explain the
  // override" — so this checks presence of a non-empty explanation, not a specific shape.
  const registerCadence = fields.get('Register cadence')
  let registerCadenceValid = false
  if (registerCadence) {
    registerCadenceValid = registerCadence.value.trim() !== ''
    if (!registerCadenceValid) {
      violations.push({
        line: registerCadence.line,
        message:
          'Register cadence override was claimed but left blank — it must say what mandated the cadence pick and why. Fix the value.',
      })
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

  const metric = fields.get('Metric')
  if (metric && metricFields && !isDeclaredMetric(metric.value, metricFields)) {
    violations.push({
      line: metric.line,
      message: `Metric "${metric.value}" does not name a field declared in ${METRIC_SOURCE_FILES.join(' or ')}. Use a declared field name, or "<Type>.<field>". Fix the value.`,
    })
  }

  const claim = fields.get('Claim')
  if (claim) {
    const lower = claim.value.toLowerCase()
    if (!lower.includes('will be able to') || !lower.includes(WATCH_MARKER)) {
      violations.push({
        line: claim.line,
        message:
          'Claim does not match the template shape (needs "will be able to" and "we will know because"). Rewrite it to the template.',
      })
    }
    const clause = observableClause(claim.value)
    const clauseLower = clause.toLowerCase()
    for (const phrase of CLAIM_DENYLIST) {
      if (clauseLower.includes(phrase)) {
        violations.push({
          line: claim.line,
          message: `Claim contains the non-observable phrase "${phrase}". Name an observable instead.`,
        })
      }
    }
    const hasObservable =
      OBSERVABLE_ALLOWLIST.some((term) => clauseLower.includes(term)) || SCREEN_NAME.test(clause)
    if (!hasObservable) {
      violations.push({
        line: claim.line,
        message: `claim's observable is not stated in learner-visible terms: "${clause.trim()}"`,
      })
    }
  }

  const ledgerRows = parseLedger(lines, start, end, headingLine, violations)
  const pickGap = fields.get('Pick gap')

  if (pickGap && ledgerRows.length > 0) {
    const pickedRow = ledgerRows.find((r) => r.gap === pickGap.value)
    if (!pickedRow) {
      violations.push({
        line: pickGap.line,
        message: `Pick gap "${pickGap.value}" does not match any row's Gap cell in the ledger table. Fix the value, or add the row.`,
      })
    } else {
      const topSum = Math.max(...ledgerRows.map((r) => r.sum))
      if (pickedRow.sum !== topSum) {
        const hasEvidencedOverride = harmGateValid || threadShapeValid || registerCadenceValid
        if (!hasEvidencedOverride) {
          const topGaps = ledgerRows
            .filter((r) => r.sum === topSum)
            .map((r) => `"${r.gap}"`)
            .join(', ')
          violations.push({
            line: pickGap.line,
            message: `Pick gap "${pickGap.value}" (sum ${pickedRow.sum}) does not match the top-scoring ledger row (${topGaps}). Fix the pick, or add an evidenced "- **Harm gate:**", a valid "- **Thread:**", or a "- **Register cadence:**" line documenting the override.`,
          })
        }
      }

      // The pick's own Class must agree with the Class column of the ledger row it picked —
      // same "the pick cannot silently disagree with its own ledger" motive as the Pick-gap
      // vs. top-row check above, extended per docs line 70-72's "Class is required on the pick
      // and on every ledger row".
      if (cls && VALID_CLASSES.has(cls.value) && pickedRow.cls !== cls.value) {
        violations.push({
          line: cls.line,
          message: `Class "${cls.value}" disagrees with the picked ledger row's Class column ("${pickedRow.cls}") for gap "${pickGap.value}". Fix whichever one is wrong.`,
        })
      }
    }
  }

  validateRegister(lines, start, end, headingLine, violations)
  validateNextSteps(lines, start, end, headingLine, violations, roadmapIds)
}

/**
 * Validate the full text of `docs/improve-log.md` and return every violation found, each
 * as `{ line, message }` (1-based line number). Pure — no filesystem access — so tests can
 * drive it directly with fixture strings. `metricFields` is the result of
 * `collectMetricFields`, or `null`/omitted to skip the Metric-membership check (the
 * "sources missing, skip" convention — also what every fixture-only test gets by default).
 */
export function validateImproveLog(text, metricFields = null, roadmapIds = null) {
  const lines = stripFencedCode(text.replace(/\r\n/g, '\n').split('\n'))
  const violations = []

  validateStandingCannotSenseTable(lines, violations)
  validateIdeaRegister(lines, violations)

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
    validateRunEntry(lines, start, end, violations, metricFields, roadmapIds)
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
  const metricFields = collectMetricFields(process.cwd())
  const roadmapIds = collectRoadmapIds(process.cwd())
  const violations = validateImproveLog(text, metricFields, roadmapIds)

  if (violations.length > 0) {
    for (const v of violations) console.error(`${file}:${v.line}: ${v.message}`)
    process.exit(1)
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) main()
