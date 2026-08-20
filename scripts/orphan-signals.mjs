#!/usr/bin/env node
/**
 * Find every signal the app captures, persists or decodes, and then never
 * reads back — the innovation engine of the `/improve-app` loop.
 *
 * A prior investigation found that key-release times, sustain-pedal (CC64)
 * events and MIDI velocity are all captured, persisted or decoded, and then
 * read by no grader and shown on no screen. Nobody went looking for those on
 * purpose — a process that only looks for things that are BROKEN will never
 * surface them, because they don't break anything; they just sit there,
 * unread, as capability the app already paid for and never spent. This
 * script's job is to print that list mechanically, every run, so the
 * improvement loop reasons over a computed set instead of an imagined one.
 *
 * Two scans:
 *   A — every field of the persisted/exported shapes
 *       (`src/app/state/persistedShapes.ts`, `src/core/progress/export.ts`'s
 *       `ProgressSnapshot` and its collections) that no file under
 *       `src/app/**` reads.
 *   B — every field of the input-event shapes declared as a locally-defined
 *       union in `src/core/ports/*.ts` (currently just `MidiEvent` in
 *       `midi.ts`; no other file in that directory declares one — see the
 *       "what this cannot see" note below for how a future one would be
 *       picked up automatically) that no file under `src/core/**` consumes.
 *
 * ## Method: a syntax-only AST pass, not a type-checked one
 *
 * Every file in scope is parsed once with `ts.createSourceFile` (the
 * TypeScript compiler API's parser) and walked for three node shapes:
 * `PropertyAccessExpression` (`x.foo`), string-literal `ElementAccessExpression`
 * (`x['foo']`), and destructuring `BindingElement`s (`const { foo } = x`,
 * including the renamed form `const { foo: bar } = x`). This is deliberately
 * NOT a full `ts.Program` with a type checker: building and checking one
 * against the whole app would be slower and would need this script to track
 * the app's own path aliases and tsconfig, for a question ("is this the same
 * `foo`?") a syntax pass already answers well enough once its uncertainty is
 * reported honestly (see below). The target is under 5 seconds; a syntax-only
 * pass over this repo runs in a small fraction of that.
 *
 * ## The honesty requirement
 *
 * A plain name match is not proof. This repo has the same field name
 * (`velocity`) declared on at least six unrelated types (`MidiNoteOn`, a drum
 * hit, two internal MIDI-file note shapes, two score-note shapes) — a naive
 * grep for `.velocity` "clears" the real orphan this script exists to find,
 * because a *different* `velocity` is read constantly. So every match is
 * checked against a mechanically-computed ambiguity signal before it is
 * trusted:
 *
 *   - **Declared-name collision.** While parsing, every `PropertySignature`
 *     of every `type X = { ... }` / `interface X { ... }` declared in
 *     `src/core/**` (plus the scan's own declaration file(s)) is indexed by
 *     name -> set of owning type names. A field name declared by more than
 *     one type there is "ambiguous": a same-named read cannot be trusted to
 *     be about the right one. This corpus is deliberately `src/core/**`, even
 *     for Scan A (whose READER scope is `src/app/**`): an earlier version
 *     indexed `src/app/**` too and found that virtually every generic field
 *     name (`id`, `notes`, `level`, `score`, …) is also a prop on some
 *     component-local `XxxProps` / `UseXxxOptions` interface somewhere in
 *     this app's ~300 `.tsx`/`.ts` files — a real but USELESS signal, since
 *     it flagged every single field as ambiguous and made HIGH confidence
 *     nearly unreachable. `src/core` is where the real domain types these
 *     fields actually overlap with live (`Score`, `Card`, `DrumHit`, the
 *     other `MidiEvent` variants, …), so a collision found there is a
 *     meaningful false-clear risk; a collision only against an app-layer
 *     Props/Options/State type (often the SAME concept one layer up, e.g. a
 *     store's own `XxxStoreState` mirroring its `PersistedXxx` shape) mostly
 *     is not, and is not checked. This is a deliberate, stated blind spot,
 *     not an oversight — see "What this cannot see" below.
 *   - **Common-word list.** A short, explicit list of field names this
 *     repo's own contract named as generic (`level`, `session`, `attempts`,
 *     `history`, `notes`, `id`, `at`, `settings`, plus a handful more this
 *     scan's own false-positive testing turned up: `type`, `note`, `down`,
 *     `time`) is ALSO treated as ambiguous, even in a scope small enough
 *     that the collision detector alone would miss it (see this file's
 *     `COMMON_FIELD_NAMES`).
 *
 * A field is only silently cleared (not printed at all) when a plain
 * property/bracket-access match exists AND the name is unambiguous by both
 * checks above. Everything else becomes an orphan finding:
 *
 *   - No match anywhere, unambiguous name -> **HIGH** confidence orphan.
 *   - No match anywhere, ambiguous name -> **LOW** confidence orphan (a read
 *     could exist under an access this scan cannot distinguish from noise).
 *   - A match exists, but only as a **destructuring** binding -> always
 *     **LOW** confidence, printed as an orphan candidate, never silently
 *     cleared. Destructuring is detected but never trusted alone: without a
 *     type checker there is no way to confirm the object being destructured
 *     is actually the type in question (this is the deliberate choice
 *     between the two the contract allows for this case).
 *   - A match exists, but the name is ambiguous (either check above) -> LOW
 *     confidence orphan, evidence names the OTHER type(s) that also declare
 *     this field name, so a human can judge in seconds whether the match is
 *     real.
 *
 * ## What this cannot see
 *
 *   - No type information. A read is trusted only by name; the ambiguity
 *     checks reduce, but do not eliminate, false clears and false orphans.
 *   - Dynamic property access (`obj[someVariable]`) is invisible — only
 *     string-literal bracket access is matched.
 *   - The collision/ambiguity corpus is `src/core/**` only (see "Declared-name
 *     collision" above). A field whose ONLY same-named collision is an
 *     app-layer type is reported as unambiguous even though it theoretically
 *     could be a false clear; the earlier, wider version was tried and
 *     rejected as too noisy to be useful (see that note for the numbers).
 *   - A field reached through indirection — a selector, a getter, a mapped
 *     copy under a different local name with no matching property/binding
 *     text anywhere — is invisible.
 *   - Scan A's reader scope (`src/app/**`, tests excluded) deliberately
 *     excludes `persistedShapes.ts` ITSELF: its own `isValidXxx` structural
 *     validators touch nearly every field by construction (that is what
 *     structural validation means), so leaving them in would clear
 *     everything and defeat the scan. A field only clears via an actual
 *     consumer file.
 *   - Field enumeration for both scans is limited to `export type X = {...}`
 *     object shapes declared DIRECTLY in the named files (or, for scan B,
 *     the members of a locally-declared union in `src/core/ports/*.ts`).
 *     Fields nested inside a type imported from elsewhere (`EarSessionState`,
 *     `Card`, `Score`, …) are not enumerated, even though they are part of
 *     what actually gets persisted — widening that is future work, not
 *     something this pass attempts.
 *   - Ageing keys are `scan:Type.field`; a field renamed between runs is a
 *     brand-new signal (age resets to 1) and its old key is simply dropped
 *     from the next report (the stored age for it remains in the ages file
 *     until that file is deleted or hand-edited — nothing currently prunes
 *     it).
 *   - Files that fail to parse are skipped, not fatal (`--json`'s `blindSpots`
 *     and the human header both say so); the script only exits 1 when a file
 *     it NEEDS (the two Scan A sources, `src/core/ports/midi.ts`) cannot be
 *     read at all.
 *
 * Usage: `node scripts/orphan-signals.mjs [--json] [--ages <path>] [--root <repoRoot>]`
 * Exit 0 on a normal scan (finding orphans is the point). Exit 1 when the
 * analysis cannot complete (a required file is missing). Exit 2 on bad usage.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, globSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Field names this scan will never fully trust a plain-access match for, even
 * with no declared-name collision in scope. `level`, `session`, `attempts`,
 * `history`, `notes`, `id`, `at`, `settings` are the contract's own named
 * examples of common words in this repo; `type`, `note`, `down` and `time`
 * were added after they produced a real false-clear risk while building this
 * script (see the module doc comment's `velocity` example, and `waitmode.ts`'s
 * `event.type` / `event.note` / `this.down`, which are a DIFFERENT `type` /
 * `note` / `down` from any of this script's target types).
 */
export const COMMON_FIELD_NAMES = new Set([
  'level', 'session', 'attempts', 'history', 'notes', 'id', 'at', 'settings',
  'type', 'note', 'down', 'time', 'name', 'status', 'value', 'values', 'data',
  'state', 'key', 'keys', 'event', 'events', 'index', 'item', 'items', 'kind',
  'list',
])

export function isCommonFieldName(name) {
  return name.length <= 2 || COMMON_FIELD_NAMES.has(name.toLowerCase())
}

function scriptKindFor(path) {
  return path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function isExported(node) {
  return !!(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export)
}

function memberName(member) {
  if (!member.name) return undefined
  if (ts.isIdentifier(member.name)) return member.name.text
  if (ts.isStringLiteral(member.name)) return member.name.text
  return undefined
}

// --------------------------------------------------------------- declaring

/**
 * Every field of every EXPORTED `type X = { ... }` object-literal alias in
 * `sourceText`, top-level only (no recursing into inline nested literals —
 * none of this script's target files have any). `file` is the label used in
 * `declaredAt`; pass a repo-relative path.
 */
export function parseTypeFields(sourceText, file) {
  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(file))
  const fields = []
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue
    if (!isExported(stmt)) continue
    if (!ts.isTypeLiteralNode(stmt.type)) continue
    const typeName = stmt.name.text
    for (const member of stmt.type.members) {
      if (!ts.isPropertySignature(member)) continue
      const fieldName = memberName(member)
      if (fieldName === undefined) continue
      const { line } = sf.getLineAndCharacterOfPosition(member.name.getStart(sf))
      fields.push({ typeName, fieldName, file, line: line + 1 })
    }
  }
  return fields
}

/**
 * Every EXPORTED `type X = A | B | C` in `sourceText` where every member is a
 * reference to another EXPORTED, locally-declared object-literal type alias —
 * the shape of `MidiEvent = MidiNoteOn | MidiNoteOff | MidiSustain` in
 * `midi.ts`. Generic on purpose: it does not look for `MidiEvent` by name, so
 * a second input-event union added later to any file in `src/core/ports/`
 * (an audio-input port, say) is picked up the same way without this script
 * changing.
 */
export function parseEventUnions(sourceText, file) {
  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(file))
  const objectAliases = new Set()
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && isExported(stmt) && ts.isTypeLiteralNode(stmt.type)) {
      objectAliases.add(stmt.name.text)
    }
  }
  const unions = []
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || !isExported(stmt)) continue
    if (!ts.isUnionTypeNode(stmt.type)) continue
    const memberNames = []
    let allLocalObjectRefs = stmt.type.types.length > 0
    for (const t of stmt.type.types) {
      if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && objectAliases.has(t.typeName.text)) {
        memberNames.push(t.typeName.text)
      } else {
        allLocalObjectRefs = false
      }
    }
    if (allLocalObjectRefs) unions.push({ unionName: stmt.name.text, memberNames })
  }
  return unions
}

/**
 * Index every `PropertySignature` name (of every `type X = {...}` object
 * literal AND every `interface X {...}`, exported or not — an internal type
 * still creates a real ambiguity risk) across `sourceFiles` to its set of
 * owning type names. Used only to decide whether a name is safe to trust a
 * plain-access match for; see the module doc comment.
 */
export function collectDeclaredFieldNames(sourceFiles) {
  const owners = new Map()
  const record = (ownerName, name) => {
    if (!owners.has(name)) owners.set(name, new Set())
    owners.get(name).add(ownerName)
  }
  const recordMembers = (ownerName, members) => {
    for (const member of members) {
      if (!ts.isPropertySignature(member)) continue
      const name = memberName(member)
      if (name !== undefined) record(ownerName, name)
    }
  }
  for (const { path, text } of sourceFiles) {
    let sf
    try {
      sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path))
    } catch {
      continue // unparseable file — not fatal, see module doc comment
    }
    for (const stmt of sf.statements) {
      if (ts.isTypeAliasDeclaration(stmt) && ts.isTypeLiteralNode(stmt.type)) {
        recordMembers(stmt.name.text, stmt.type.members)
      } else if (ts.isInterfaceDeclaration(stmt)) {
        recordMembers(stmt.name.text, stmt.members)
      }
    }
  }
  return owners
}

// ------------------------------------------------------------------ reading

function bindingElementKey(node) {
  const nameNode = node.propertyName ?? (ts.isIdentifier(node.name) ? node.name : undefined)
  if (!nameNode) return undefined
  if (ts.isIdentifier(nameNode)) return nameNode.text
  if (ts.isStringLiteral(nameNode)) return nameNode.text
  return undefined
}

/**
 * One pass per file (not one pass per field): walk every file in
 * `sourceFiles` once and bucket every `PropertyAccessExpression`,
 * string-literal `ElementAccessExpression` and destructuring `BindingElement`
 * whose name is in `fieldNames` into a `Map<fieldName, match[]>`. A `match` is
 * `{ path, line, kind }`, `kind` one of `'plain'` (property/bracket access —
 * trustworthy modulo the ambiguity check) or `'destructure'` (never fully
 * trusted alone; see the module doc comment).
 */
export function scanFieldUsages(fieldNames, sourceFiles) {
  const wanted = new Set(fieldNames)
  const result = new Map(fieldNames.map((n) => [n, []]))
  const push = (name, node, sf, path, kind) => {
    if (!wanted.has(name)) return
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    result.get(name).push({ path, line: line + 1, kind })
  }
  for (const { path, text } of sourceFiles) {
    let sf
    try {
      sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path))
    } catch {
      continue // unparseable file — not fatal, see module doc comment
    }
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node)) {
        push(node.name.text, node.name, sf, path, 'plain')
      } else if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression)
      ) {
        push(node.argumentExpression.text, node.argumentExpression, sf, path, 'plain')
      } else if (ts.isBindingElement(node)) {
        const key = bindingElementKey(node)
        if (key !== undefined) push(key, node, sf, path, 'destructure')
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return result
}

// ------------------------------------------------------------ classification

/**
 * Decide whether `declared` (`{ typeName, fieldName, file, line }`) is an
 * orphan, given its usage `matches` (from `scanFieldUsages`) and the
 * declared-name ownership index (from `collectDeclaredFieldNames`). Returns
 * `null` when the field is cleared (not printed), or a finding
 * `{ signal, declaredAt, confidence, evidence }` when it is an orphan
 * candidate. See the module doc comment for the full decision table.
 */
export function classifyField(declared, matches, declaredIndex) {
  const signal = `${declared.typeName}.${declared.fieldName}`
  const declaredAt = `${declared.file}:${declared.line}`
  const owners = declaredIndex.get(declared.fieldName)
  const otherOwners = owners ? [...owners].filter((o) => o !== declared.typeName) : []
  const ambiguous = otherOwners.length > 0 || isCommonFieldName(declared.fieldName)

  const plain = matches.filter((m) => m.kind === 'plain')
  const destructure = matches.filter((m) => m.kind === 'destructure')

  if (plain.length > 0 && !ambiguous) return null // cleared — a trustworthy, unambiguous read exists

  if (plain.length > 0) {
    const first = plain[0]
    const why =
      otherOwners.length > 0
        ? `"${declared.fieldName}" is also declared on ${otherOwners.join(', ')}`
        : `"${declared.fieldName}" is a common field name`
    return {
      signal,
      declaredAt,
      confidence: 'LOW',
      evidence: `possible read at ${first.path}:${first.line}, but ${why} — cannot confirm this read is about ${declared.typeName} without a type checker`,
    }
  }

  if (destructure.length > 0) {
    const first = destructure[0]
    return {
      signal,
      declaredAt,
      confidence: 'LOW',
      evidence: `only a destructured read found, at ${first.path}:${first.line} — destructuring cannot be reliably attributed to ${declared.typeName} without a type checker, so it is not trusted to clear this field`,
    }
  }

  return {
    signal,
    declaredAt,
    confidence: ambiguous ? 'LOW' : 'HIGH',
    evidence: ambiguous
      ? `no read found under the scanned scope; low confidence because ${otherOwners.length > 0 ? `"${declared.fieldName}" is also declared on ${otherOwners.join(', ')}` : `"${declared.fieldName}" is a common field name`} and could be read in a way this scan cannot see`
      : `no read found anywhere under the scanned scope`,
  }
}

// ----------------------------------------------------------------- ageing

/**
 * `previousAges` and the returned map are `{ "<scan>:<type>.<field>": count }`.
 * Every key in `currentKeys` gets `(previous ?? 0) + 1`; every key that was in
 * `previousAges` but is NOT in `currentKeys` (no longer an orphan) resets to
 * `0` rather than being deleted — the script owns this file, and a `0` is a
 * readable "this used to be an orphan" marker for whoever reads the raw JSON,
 * not just for the table (which only ever shows CURRENT orphans, so `0`
 * entries never appear there).
 */
export function updateAges(previousAges, currentKeys) {
  const currentSet = new Set(currentKeys)
  const next = {}
  for (const key of currentKeys) next[key] = (previousAges[key] ?? 0) + 1
  for (const key of Object.keys(previousAges)) {
    if (!currentSet.has(key)) next[key] = 0
  }
  return next
}

/** The reported age is capped at 3; the stored age is not. */
export function capAge(age) {
  return Math.min(age, 3)
}

// -------------------------------------------------------------- file scope

function readSourceFiles(root, patterns, excludeAbsPaths) {
  const excluded = new Set(excludeAbsPaths)
  return globSync(patterns, { cwd: root })
    .map((p) => resolve(root, p))
    .filter((p) => !excluded.has(p))
    .filter((p) => !/\.test\.tsx?$/.test(p))
    .map((p) => ({ path: relative(root, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }))
}

function requireFile(root, relPath) {
  const abs = resolve(root, relPath)
  if (!existsSync(abs)) {
    throw new Error(`required file missing: ${relPath}`)
  }
  return { abs, text: readFileSync(abs, 'utf8') }
}

// ---------------------------------------------------------------- scan A

/**
 * Persisted fields nothing under `src/app/**` reads. See the module doc
 * comment for why `persistedShapes.ts` itself is excluded from the reader
 * scope (its own structural validators touch nearly every field, which would
 * clear everything) and why only object-literal type aliases declared
 * directly in the two named files are enumerated.
 */
export function runScanA(root) {
  const persistedShapes = requireFile(root, 'src/app/state/persistedShapes.ts')
  const exportShapes = requireFile(root, 'src/core/progress/export.ts')

  const declared = [
    ...parseTypeFields(persistedShapes.text, 'src/app/state/persistedShapes.ts'),
    ...parseTypeFields(exportShapes.text, 'src/core/progress/export.ts'),
  ]

  const readerFiles = readSourceFiles(root, ['src/app/**/*.ts', 'src/app/**/*.tsx'], [persistedShapes.abs])

  // The ambiguity/collision corpus is deliberately `src/core/**`, NOT
  // `src/app/**` — see the module doc comment's "why the app layer is
  // excluded from the collision corpus" note. In short: this app's `src/app`
  // is ~300 files of small, component-local `XxxProps` / `UseXxxOptions`
  // interfaces with generic field names (`id`, `notes`, `level`, `score`, …),
  // and including them made EVERY persisted field "ambiguous" — the signal
  // drowned in React boilerplate that has nothing to do with these shapes.
  // `src/core` is where the real domain types these fields actually
  // represent or overlap with live (`Score`, `Card`, `DrumHit`, …), so a
  // collision found there is a meaningful false-clear risk.
  const coreFiles = readSourceFiles(root, ['src/core/**/*.ts'], [])
  const declaredIndexFiles = [
    { path: 'src/app/state/persistedShapes.ts', text: persistedShapes.text },
    { path: 'src/core/progress/export.ts', text: exportShapes.text },
    ...coreFiles,
  ]

  const declaredIndex = collectDeclaredFieldNames(declaredIndexFiles)
  const usage = scanFieldUsages(
    declared.map((d) => d.fieldName),
    readerFiles,
  )

  const findings = []
  for (const field of declared) {
    const finding = classifyField(field, usage.get(field.fieldName) ?? [], declaredIndex)
    if (finding) findings.push({ scan: 'A', ...finding })
  }
  return findings
}

// ---------------------------------------------------------------- scan B

/**
 * Input-event fields nothing under `src/core/**` consumes. Every `.ts` file
 * directly inside `src/core/ports/` is checked for a locally-declared event
 * union (see `parseEventUnions`), so an audio-input port event type — none
 * exists today, `audio.ts` in that directory declares only the
 * method-shaped `AudioOutput`, which this deliberately does not enumerate —
 * would be picked up the same way `MidiEvent` is, without this script
 * changing.
 */
export function runScanB(root) {
  const midi = requireFile(root, 'src/core/ports/midi.ts')

  const portFiles = globSync('src/core/ports/*.ts', { cwd: root })
    .filter((p) => !p.endsWith('.test.ts'))
    .map((p) => ({ path: p.replace(/\\/g, '/'), text: readFileSync(resolve(root, p), 'utf8') }))
  if (!portFiles.some((f) => f.path === 'src/core/ports/midi.ts')) {
    portFiles.push({ path: 'src/core/ports/midi.ts', text: midi.text })
  }

  const declared = []
  for (const file of portFiles) {
    const unions = parseEventUnions(file.text, file.path)
    if (unions.length === 0) continue
    const memberTypeNames = new Set(unions.flatMap((u) => u.memberNames))
    for (const field of parseTypeFields(file.text, file.path)) {
      if (memberTypeNames.has(field.typeName)) declared.push(field)
    }
  }

  const readerFiles = readSourceFiles(root, ['src/core/**/*.ts'], [])
  const declaredIndex = collectDeclaredFieldNames(readerFiles)
  const usage = scanFieldUsages(
    declared.map((d) => d.fieldName),
    readerFiles,
  )

  const findings = []
  for (const field of declared) {
    const finding = classifyField(field, usage.get(field.fieldName) ?? [], declaredIndex)
    if (finding) findings.push({ scan: 'B', ...finding })
  }
  return findings
}

// ---------------------------------------------------------------- ages I/O

function readAges(path) {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {} // a corrupt or hand-edited ages file starts fresh rather than crashing the scan
  }
}

function writeAges(path, ages) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(ages, Object.keys(ages).sort(), 2)}\n`)
}

// ------------------------------------------------------------------- CLI

const HEADER =
  'orphan-signals: syntax-only AST pass (TypeScript compiler API), no type checker.\n' +
  'A match is name-based; ambiguous names (declared on more than one type in the\n' +
  'scanned scope, or on the common-word list) never silently clear a field, and a\n' +
  'destructured-only read never does either — both end up LOW confidence, printed\n' +
  'as candidates for a human to confirm rather than asserted as fact. See this\n' +
  "file's own header comment for the full method and what it cannot see."

function parseArgs(argv) {
  const opts = { json: false, ages: undefined, root: undefined }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      opts.json = true
    } else if (arg === '--ages') {
      const value = argv[++i]
      if (value === undefined) return { error: '--ages requires a path argument' }
      opts.ages = value
    } else if (arg === '--root') {
      const value = argv[++i]
      if (value === undefined) return { error: '--root requires a path argument' }
      opts.root = value
    } else {
      return { error: `unknown argument: ${arg}` }
    }
  }
  return { opts }
}

function pad(s, width) {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

function printTable(rows) {
  console.log(HEADER)
  console.log('')
  if (rows.length === 0) {
    console.log('No orphan signals found.')
    return
  }
  const cols = ['signal', 'declared at', 'confidence', 'age', 'evidence']
  const widths = cols.map((c, i) =>
    Math.max(
      c.length,
      ...rows.map((r) => String([r.signal, r.declaredAt, r.confidence, r.age, r.evidence][i]).length),
    ),
  )
  const line = (values) => values.map((v, i) => pad(String(v), widths[i])).join('  ')
  console.log(line(cols))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const r of rows) console.log(line([r.signal, r.declaredAt, r.confidence, r.age, r.evidence]))
  console.log('')
  console.log(`${rows.length} orphan signal(s).`)
}

export async function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.error) {
    console.error(`orphan-signals: ${parsed.error}`)
    console.error('usage: node scripts/orphan-signals.mjs [--json] [--ages <path>] [--root <repoRoot>]')
    return 2
  }
  const { opts } = parsed
  const root = opts.root ? resolve(opts.root) : DEFAULT_ROOT
  const agesPath = opts.ages ? resolve(opts.ages) : resolve(root, 'runs/orphan-ages.json')

  let findings
  try {
    findings = [...runScanA(root), ...runScanB(root)]
  } catch (err) {
    console.error(`orphan-signals: could not complete analysis: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const previousAges = readAges(agesPath)
  const currentKeys = findings.map((f) => `${f.scan}:${f.signal}`)
  const nextAges = updateAges(previousAges, currentKeys)
  writeAges(agesPath, nextAges)

  const rows = findings
    .map((f) => ({ ...f, age: capAge(nextAges[`${f.scan}:${f.signal}`] ?? 1) }))
    .sort((a, b) => a.scan.localeCompare(b.scan) || a.signal.localeCompare(b.signal))

  if (opts.json) {
    console.log(JSON.stringify({ header: HEADER, findings: rows }, null, 2))
  } else {
    printTable(rows)
  }
  return 0
}

function isMainModule() {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  } catch {
    return false
  }
}

if (isMainModule()) {
  const code = await main(process.argv.slice(2))
  process.exit(code)
}
