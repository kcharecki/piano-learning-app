#!/usr/bin/env node
/**
 * Find signal the app receives from the instrument or computes about a
 * session, and then never lets any learner-visible output depend on — the
 * innovation engine of the `/improve-app` loop.
 *
 * ## Version 2: from "is this name read" to "does output depend on this value"
 *
 * The first version of this script asked one question: does the field's NAME
 * appear as a property access anywhere in a reader scope? That is a naming
 * search, not a data-flow question, and it produced a table nobody could act
 * on: 3 useless certainties (export-file metadata) and 44 shrugs ("possible
 * read, but the name collides"). Worse, it MISSED the real orphans a manual
 * pass found, because in every real case the field's name DOES appear
 * somewhere in the codebase — just never on a path that reaches a grader or
 * a screen. `ScoreNote.durationTicks` is read by nothing in matching or
 * assessment, but a whole-repo name search for "durationTicks" would have
 * found a legitimate, unrelated read in playback code and wrongly cleared it.
 *
 * This version asks four narrower, more mechanical questions instead, each
 * scoped to a specific kind of boundary rather than "anywhere in the repo":
 *
 *   A — **Dropped at a boundary.** A function receives a value of a known
 *       shape and narrows it — via property access, only some of the shape's
 *       fields are ever touched — before that value (or whatever it produced)
 *       leaves the function. The untouched fields are candidates. This finds
 *       velocity (never touched by the app's MIDI-event handlers) and
 *       release timing (`ScoreNote.durationTicks`, carried inside
 *       `MatchResult.expected` all the way to `assess()`, which narrows it
 *       to `.measureIndex` and drops the rest).
 *   B — **Persisted but never rendered.** A field that reaches the
 *       persistence layer (`persistedShapes.ts`, `progress/export.ts`, and
 *       one layer of types they embed) whose name appears in no `.tsx` file
 *       under `src/app/**` — not even inside a JSX expression container, the
 *       only place a persisted value could actually reach the screen.
 *   C — **Computed then discarded.** An exported `src/core` function
 *       returning a known object shape, called somewhere that destructures
 *       the result and never names some of its fields. Those fields are
 *       produced and then provably unused by that caller.
 *   D — **A constant standing in for real input.** `x.field ?? CONST` (or
 *       `||`) where `x` is a known shape and `field` is one this scan's own
 *       boundary-discovery pass ALSO found being carried live on some other
 *       known shape (an input event, typically) — the live value exists
 *       somewhere in the system, and this call site throws it away in favour
 *       of a fixed stand-in. This is what finds `n.velocity ?? DEFAULT_VELOCITY`.
 *
 * ## Method: still a syntax-only AST pass, still no type checker
 *
 * Every scan is built from the same primitive: `ts.createSourceFile`
 * (syntax only, no `ts.Program`, no type resolution) walked for property
 * accesses, destructuring, call expressions, `for...of`, and the small
 * family of array methods (`map`/`forEach`/`filter`/`find`/`some`/`every`/
 * `flatMap`) that carry an element type forward without a fresh annotation.
 * "Known shapes" are exported `type X = { ... }` object-literal aliases
 * declared under `src/core/**`, plus exported unions of such aliases (the
 * `MidiEvent` pattern) discovered the same generic way the first version
 * found them — not a hardcoded list of type names.
 *
 * A function's parameter only becomes a boundary this scan reasons about
 * when its type is spelled out: `p: ScoreNote`, `p: readonly ScoreNote[]`,
 * `{ a, b }: ScoreNote`, or — the one indirect case this version adds — the
 * first parameter of a callback handed to a method whose OWN declared
 * signature (found in a `src/core/ports/*.ts` interface) says that callback
 * receives a known shape, e.g. `MidiInput.onEvent(handler: (event: MidiEvent)
 * => void)`. An inferred type with no annotation and no such traceable
 * origin is invisible to this scan — see "what this cannot see" below.
 *
 * ## Whole-value escapes are not narrowing
 *
 * A function that takes a `ScoreNote` and embeds it whole into its own
 * return value (`{ note, ms, chordSize }`, `return note`, `notes.push(note)`)
 * has not dropped anything — it deferred the question to whoever consumes
 * that return value next. This scan detects that shape (the bound
 * identifier, or an already-touched field of it, appearing as a bare
 * argument, a returned value, an array element, or an object-literal
 * property value) and suppresses boundary-drop reporting there, rather than
 * falsely accusing a pass-through function of dropping a field some LATER
 * function actually drops. `NoteMatcher.buildExpected` and `.attributed`
 * both pass `ScoreNote` through whole this way; `assess()` — which embeds
 * nothing, only ever reads `.expected.measureIndex` off it — is where the
 * chain actually narrows, and that is where scan A reports the drop.
 *
 * ## The honesty requirement, carried over
 *
 * A name match is still not proof. Every finding keeps the same two
 * ambiguity signals as the first version — a field name declared on more
 * than one type across `src/core/**`, and a short common-word list — and a
 * name that trips either one is capped at LOW confidence, never silently
 * trusted. A union's fields are matched by name only (no branch narrowing:
 * touching `.time` on one `MidiEvent` branch clears `.time` for every
 * union member that also has a `time` field, whichever branch's field it
 * "really" was) — documented, not hidden.
 *
 * ## What this cannot see
 *
 *   - No type information anywhere; every "known shape" match is by
 *     spelled-out annotation or by the one traced callback-signature path,
 *     never by inference. A parameter typed only implicitly (no annotation,
 *     not a traced callback) is invisible to scans A and D.
 *   - Chain-following (scan A's ".field.subfield" reasoning) goes exactly
 *     one level deep. A field of a field of a field is not tracked.
 *   - Escape detection looks at each reference's IMMEDIATE parent only. A
 *     value stashed in a local (`const copy = x`) and returned two
 *     statements later is not recognised as an escape of `x` itself — this
 *     scan would (wrongly) treat that as a drop. Rare in this codebase's
 *     style (which favours inline construction), not eliminated.
 *   - No shadowing awareness: a nested declaration reusing an outer bound
 *     identifier's name is not detected, and usages inside that inner scope
 *     are attributed to the outer binding.
 *   - Scan B's field enumeration recurses up to 3 levels through a field's
 *     own declared type, cycle-guarded (so `PersistedRecordings.recordings[]`
 *     `.events[]` reaches `MidiEvent`'s own members, e.g. `MidiSustain.down`)
 *     and no further.
 *   - Scan C only recognises object-destructuring at the call site
 *     (`const { a } = fn()`); array destructuring and functions with an
 *     inferred (unannotated) return type are not checked.
 *   - Scan D only flags `??`/`||` against a bound shape's own field; a
 *     default applied further from the source (a wrapper function, a second
 *     hop) is invisible.
 *   - Files that fail to parse are skipped, not fatal; the script only
 *     exits 1 when a file it structurally needs is missing entirely.
 *
 * ## Ageing
 *
 * `runs/orphan-ages.json` (overridable via `--ages`) means "this gap has
 * been proposed and passed over for N consecutive REAL runs" — so a run
 * started with `--dry-run` reads and reports ages as they stand but never
 * writes them, and the test suite never invokes `main()` at all (every test
 * calls the exported analysis functions directly), so no test run can ever
 * inflate an age. The file was reset to `{}` when this version shipped:
 * the age history under the old, name-search design measured the wrong
 * thing and would have misrepresented how long today's actual findings have
 * been sitting.
 *
 * ## Output discipline
 *
 * Findings are ranked HIGH confidence before LOW; within a tier, one-per-
 * scan round robin (each scan's own findings ordered by age descending, an
 * orphan that keeps reappearing outranking a first-time one) so scan A's
 * consistently larger finding count cannot crowd scans B/C/D out of the
 * capped rows — see `rankRows`'s own comment for why a plain sort was tried
 * and rejected. Capped at 12 rows by default; a `--all` flag lifts the cap.
 * Duplicate (scan, signal) findings from different call sites collapse to
 * one row before ranking — see `dedupeFindings`.
 * Every row's evidence names the receiving function or call site AND states
 * a learner-facing consequence in one clause, grounded in what was actually
 * traced (never "no grading exists anywhere", only "this specific function,
 * the one whose output is what gets persisted/rendered, never touches it").
 * A scan that finds nothing prints `no findings` for that scan — silence is
 * a fine result; noise is not.
 *
 * Usage: `node scripts/orphan-signals.mjs [--json] [--all] [--dry-run] [--ages <path>] [--root <repoRoot>]`
 * Exit 0 on a normal scan (finding orphans is the point). Exit 1 when the
 * analysis cannot complete (a required file is missing). Exit 2 on bad usage.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, globSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_ROWS_DEFAULT = 12
// HIGH-confidence volume varies wildly run to run (scan A alone routinely
// produces more HIGH findings than the 12-row cap), which would otherwise
// let HIGH fill every default row and make a LOW finding structurally
// unreachable no matter how strong its evidence — see `capDefaultRows`.
const MIN_LOW_ROWS_RESERVED = 2
const MAP_METHOD_NAMES = new Set(['map', 'forEach', 'filter', 'find', 'some', 'every', 'flatMap'])

/**
 * Field names this scan will never fully trust a plain-access match for.
 * `level`, `session`, `attempts`, `history`, `notes`, `id`, `at`, `settings`
 * are the contract's own named examples of common words in this repo;
 * `type`, `note`, `down`, `time` were added after they produced a real
 * false-clear risk while building this script's first version (see
 * `waitmode.ts`'s `event.type` / `event.note` / `this.down`, a DIFFERENT
 * `type` / `note` / `down` from any of this script's target types).
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

/**
 * P2 — bookkeeping fields are not signal. `ProgressSnapshot.exportedAt`,
 * `.version`, `RepertoirePieceLike.addedAt`, `AssessmentResult.completedAt`
 * all produced TRUE findings ("nothing reads exportedAt") that were useless:
 * these fields were never MEASURED from a performance, they are metadata
 * ABOUT the record itself (when was this written, what shape is it). This is
 * a field-NAME-shape rule, not a type-name list (per the contract's own
 * instruction) — any field ending in the `xxxAt` "timestamp of when an
 * operation happened" convention (`exportedAt`, `addedAt`, `completedAt`,
 * `introducedAt`, `recordedAt`, `startedAt`, `achievedAt`, ...) or literally
 * named `version` (a schema/format version marker) is record-keeping,
 * whatever type declares it. Checked against the real repo: every field
 * matching this shape under `src/core/**` is one of exactly these two kinds
 * — no counter-example where an `xxxAt` field carries genuine musical
 * signal was found.
 */
const NOT_SIGNAL_EXACT_NAMES = new Set(['version'])
const TIMESTAMP_SUFFIX_RE = /[a-z0-9]At$/

export function isNotSignalFieldName(name) {
  return NOT_SIGNAL_EXACT_NAMES.has(name) || TIMESTAMP_SUFFIX_RE.test(name)
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

// --------------------------------------------------------- type resolution

/**
 * Reduce a type node to `{ name, isArray }` when it is (transitively through
 * `readonly`, `T[]`, `ReadonlyArray<T>`, and a `T | undefined` optional
 * union) a bare reference to a named type — the only shapes this scan can
 * follow without a type checker. Anything else (inline object types, other
 * unions, generics with >1 argument, ...) resolves to `undefined`: invisible
 * to this scan, not guessed at.
 */
function unwrapTypeRef(typeNode) {
  let t = typeNode
  if (t === undefined) return undefined
  if (ts.isParenthesizedTypeNode(t)) t = t.type
  if (ts.isTypeOperatorNode(t) && t.operator === ts.SyntaxKind.ReadonlyKeyword) t = t.type
  if (ts.isArrayTypeNode(t)) {
    let el = t.elementType
    if (ts.isParenthesizedTypeNode(el)) el = el.type
    if (ts.isTypeReferenceNode(el) && ts.isIdentifier(el.typeName)) {
      return { name: el.typeName.text, isArray: true }
    }
    return undefined
  }
  if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
    if (
      (t.typeName.text === 'ReadonlyArray' || t.typeName.text === 'Array') &&
      t.typeArguments?.length === 1
    ) {
      const inner = t.typeArguments[0]
      if (ts.isTypeReferenceNode(inner) && ts.isIdentifier(inner.typeName)) {
        return { name: inner.typeName.text, isArray: true }
      }
      return undefined
    }
    return { name: t.typeName.text, isArray: false }
  }
  if (ts.isUnionTypeNode(t)) {
    const nonUndefined = t.types.filter((m) => m.kind !== ts.SyntaxKind.UndefinedKeyword)
    if (nonUndefined.length === 1) return unwrapTypeRef(nonUndefined[0])
  }
  return undefined
}

// --------------------------------------------------------------- declaring

/**
 * Every field of every EXPORTED `type X = { ... }` object-literal alias in
 * `sourceText`, top-level only. Each field also carries `typeRef` — the
 * field's OWN type, resolved the same way `unwrapTypeRef` resolves a
 * parameter, when it is a bare/array/optional reference to another named
 * type — used by scan A to follow one level of chaining and by scan B to
 * recurse (up to 3 levels) into a persisted field's own shape.
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
      const ref = member.type ? unwrapTypeRef(member.type) : undefined
      fields.push({
        typeName,
        fieldName,
        file,
        line: line + 1,
        typeRef: ref?.name,
        typeRefIsArray: ref?.isArray ?? false,
        optional: member.questionToken !== undefined,
      })
    }
  }
  return fields
}

/**
 * Every EXPORTED `type X = A | B | C` in `sourceText` where every member is a
 * reference to another EXPORTED, locally-declared object-literal type alias —
 * the shape of `MidiEvent = MidiNoteOn | MidiNoteOff | MidiSustain`. Generic
 * on purpose: it does not look for `MidiEvent` by name, so a second event
 * union declared later anywhere under `src/core` is picked up the same way.
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
 * literal AND every `interface X {...}`, exported or not) across
 * `sourceFiles` to its set of owning type names — the declared-name
 * collision half of the ambiguity check. Deliberately scoped to whatever
 * `sourceFiles` it is given by the caller; every real scan below passes
 * `src/core/**`, not `src/app/**` — seeded from the same lesson the first
 * version of this script learned the hard way (see git history / prior
 * report): the ~300-file React app has enough component-local `XxxProps` /
 * `UseXxxOptions` interfaces sharing generic field names that indexing it
 * made almost every field "ambiguous" and HIGH confidence unreachable.
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

/** Every top-level `type X = ...` name declared in `sourceText`, exported or not, any shape — used only for shadow detection, see `resolveTypeNameInFile`. */
function collectLocalTypeAliasNames(sourceText, file) {
  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(file))
  const names = new Set()
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt)) names.add(stmt.name.text)
  }
  return names
}

/**
 * `Map<typeName, fieldInfo[]>` of every EXPORTED object-literal type alias
 * across `sourceFiles`, plus `Map<unionName, memberTypeNames[]>` for every
 * union of such aliases — the "known shapes" catalog scans A/B/D bind
 * function parameters against. Built once from `src/core/**` per run.
 *
 * Also returns `localNamesByFile: Map<file, Set<typeName>>` — every type
 * alias name (exported or not) declared IN each file, used to detect a real
 * hazard found while validating this scan against the actual repo: two
 * unrelated files can each declare a type of the SAME name (one exported and
 * catalogued, one a local, non-exported, differently-shaped type of the same
 * name) — e.g. `src/core/practice/matcher.ts` exports a `MatchResult`, and
 * `src/core/rhythm/clapback.ts` separately declares its OWN, unrelated,
 * non-exported local `MatchResult`. Without a type checker there is no way
 * to know which declaration a bare `param: MatchResult` annotation in a
 * THIRD file refers to; but a param annotated `MatchResult` in clapback.ts
 * ITSELF unambiguously means clapback's own local type, not matcher.ts's —
 * `resolveTypeNameInFile` uses `localNamesByFile` to prefer/require that
 * same-file reading and refuse to bind to a foreign catalog entry when the
 * current file shadows the name locally.
 */
export function buildTypeCatalog(sourceFiles) {
  const types = new Map()
  const unions = new Map()
  const localNamesByFile = new Map()
  for (const { path, text } of sourceFiles) {
    let fields, memberUnions, localNames
    try {
      fields = parseTypeFields(text, path)
      memberUnions = parseEventUnions(text, path)
      localNames = collectLocalTypeAliasNames(text, path)
    } catch {
      continue
    }
    for (const f of fields) {
      if (!types.has(f.typeName)) types.set(f.typeName, [])
      types.get(f.typeName).push(f)
    }
    for (const u of memberUnions) unions.set(u.unionName, u.memberNames)
    if (localNames.size > 0) localNamesByFile.set(path, localNames)
  }
  return { types, unions, localNamesByFile }
}

/** Every field of `typeName` per the catalog: its own fields, or (for a union) the flattened fields of every member. */
function fieldsOf(typeName, catalog) {
  if (catalog.types.has(typeName)) return catalog.types.get(typeName)
  const members = catalog.unions.get(typeName)
  if (members === undefined) return undefined
  const out = []
  for (const m of members) out.push(...(catalog.types.get(m) ?? []))
  return out
}

/**
 * Resolve a bare type name referenced in `file` against `catalog`, refusing
 * the match when `file` locally declares a SAME-NAMED type that is not
 * itself the catalog's source for that name (see `buildTypeCatalog`'s doc
 * comment). Returns the type name to actually use for `fieldsOf`, or
 * `undefined` when the reference is a confirmed local shadow of an unrelated
 * type — in which case this scan has no reliable shape to check and skips
 * the boundary rather than risk a false positive.
 */
function resolveTypeNameInFile(typeName, file, catalog) {
  const localNames = catalog.localNamesByFile.get(file)
  if (!localNames || !localNames.has(typeName)) return typeName // not shadowed in this file
  const catalogFields = catalog.types.get(typeName)
  if (catalogFields && catalogFields.some((f) => f.file === file)) return typeName // this file IS a/the catalog source
  if (catalog.unions.has(typeName)) return typeName // unions are not locally re-declared in practice; accept
  return undefined // shadowed by an unrelated local declaration — unresolvable without a type checker
}

// ------------------------------------------------------- callback bindings

/**
 * Scan every INTERFACE method in `sourceFiles` (normally `src/core/ports/*.ts`)
 * for a parameter that is itself a function type with exactly one parameter,
 * that parameter typed as a known shape in `catalog` — the
 * `onEvent(handler: (event: MidiEvent) => void)` pattern. Returns
 * `{ methodName, typeName }[]`, generic over method/type names: a second
 * port adding a second such method is picked up the same way.
 */
export function findCallbackBindings(sourceFiles, catalog) {
  const bindings = []
  for (const { path, text } of sourceFiles) {
    let sf
    try {
      sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path))
    } catch {
      continue
    }
    for (const stmt of sf.statements) {
      if (!ts.isInterfaceDeclaration(stmt)) continue
      for (const member of stmt.members) {
        if (!ts.isMethodSignature(member)) continue
        const methodName = memberName(member)
        if (methodName === undefined) continue
        for (const param of member.parameters) {
          if (!param.type || !ts.isFunctionTypeNode(param.type)) continue
          if (param.type.parameters.length !== 1) continue
          const inner = param.type.parameters[0].type
          const resolved = inner ? unwrapTypeRef(inner) : undefined
          if (resolved && !resolved.isArray && (catalog.types.has(resolved.name) || catalog.unions.has(resolved.name))) {
            bindings.push({ methodName, typeName: resolved.name })
          }
        }
      }
    }
  }
  return bindings
}

// ---------------------------------------------------------- field-use walk

const ESCAPE_PARENT_KINDS = new Set([
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.ShorthandPropertyAssignment,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.SpreadAssignment,
  ts.SyntaxKind.SpreadElement,
])

/** Is `node`, sitting under `parent`, in a position where the whole value it names escapes (is forwarded) rather than being narrowed? */
function isEscapePosition(node, parent) {
  if (!parent) return false
  if (ESCAPE_PARENT_KINDS.has(parent.kind)) return true
  if (ts.isArrowFunction(parent) && parent.body === node) return true // concise-body arrow returning it directly
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) return true // `{ x: value }`
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) return true // `const x = value`
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node)) return true
  return false
}

/**
 * Walk `bodyNode` once, tracking every bare reference to `identifierName`.
 * Returns:
 *   - `touched`: field names accessed as `identifierName.field` / `?.field`
 *     anywhere in the body.
 *   - `escaped`: true if the BARE identifier (not a `.field` access of it)
 *     was ever forwarded whole (returned, embedded in an object/array
 *     literal, assigned to a variable, passed as a call argument) — when
 *     true, this boundary's top-level fields are deferred, not reported.
 *   - `chainTouched`: `Map<field, Set<subfield>>` for `identifierName.field.subfield`
 *     accesses — one level of chaining.
 *   - `chainEscapedFields`: fields whose OWN `.field` access escaped whole
 *     (so its subfields are deferred rather than reported as dropped).
 */
export function collectFieldUsage(bodyNode, identifierName) {
  const touched = new Set()
  const chainTouched = new Map()
  const chainEscapedFields = new Set()
  let escaped = false

  function visit(node, parent) {
    if (ts.isIdentifier(node) && node.text === identifierName) {
      const isDeclarationName =
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isParameter(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.name === node)
      if (!isDeclarationName) {
        if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
          const field = parent.name.text
          touched.add(field)
          const grandparent = parent.parent
          if (grandparent && ts.isPropertyAccessExpression(grandparent) && grandparent.expression === parent) {
            const sub = grandparent.name.text
            if (!chainTouched.has(field)) chainTouched.set(field, new Set())
            chainTouched.get(field).add(sub)
          } else if (isEscapePosition(parent, grandparent)) {
            chainEscapedFields.add(field)
          }
        } else if (
          parent &&
          ts.isElementAccessExpression(parent) &&
          parent.expression === node &&
          parent.argumentExpression &&
          ts.isStringLiteralLike(parent.argumentExpression)
        ) {
          touched.add(parent.argumentExpression.text)
        } else if (isEscapePosition(node, parent)) {
          escaped = true
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, node))
  }
  visit(bodyNode, bodyNode.parent)
  return { touched, escaped, chainTouched, chainEscapedFields }
}

/**
 * Every `identifierName.field ?? CONST` / `identifierName.field || CONST`
 * in `bodyNode`, where `CONST` is a `DEFAULT_*`/`FALLBACK_*`-named
 * identifier or a literal (number/string/boolean). Returns
 * `{ field, constant, isNamedDefault, line }[]`. `isNamedDefault` (a real
 * `DEFAULT_*`/`FALLBACK_*` constant, not a bare literal) is the stronger
 * signal — see scan D's confidence rule.
 */
export function findDefaultSubstitutions(bodyNode, identifierName, sf) {
  const found = []
  function isDefaultish(node) {
    if (ts.isIdentifier(node)) return /^(DEFAULT|FALLBACK)_/i.test(node.text)
    return (
      ts.isNumericLiteral(node) ||
      ts.isStringLiteralLike(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword
    )
  }
  function visit(node) {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === identifierName &&
      isDefaultish(node.right)
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      found.push({
        field: node.left.name.text,
        constant: node.right.getText(sf),
        isNamedDefault: ts.isIdentifier(node.right),
        line: line + 1,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(bodyNode)
  return found
}

// ---------------------------------------------------------- boundary find

function functionLabel(fn, sf, file) {
  const { line } = sf.getLineAndCharacterOfPosition(fn.getStart(sf))
  let name
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) {
    name = fn.name.getText(sf)
  } else if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.parent) {
    if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) name = fn.parent.name.text
  }
  return { label: name ? `${name}()` : 'anonymous function', file, line: line + 1 }
}

function findFunctionLikeNodes(sf) {
  const nodes = []
  function visit(n) {
    if (
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n)) &&
      n.body
    ) {
      nodes.push(n)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return nodes
}

/** `for (const V of ARRAY_IDENT) {...}` and `ARRAY_IDENT.map/forEach/filter/find/some/every/flatMap((V) => ...)` inside `scopeNode`. */
function findElementBindings(scopeNode, arrayIdentName) {
  const results = []
  function visit(n) {
    if (
      ts.isForOfStatement(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === arrayIdentName &&
      ts.isVariableDeclarationList(n.initializer)
    ) {
      const decl = n.initializer.declarations[0]
      if (decl && ts.isIdentifier(decl.name)) {
        results.push({ identifierName: decl.name.text, bodyNode: n.statement })
      }
    } else if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === arrayIdentName &&
      MAP_METHOD_NAMES.has(n.expression.name.text)
    ) {
      const cb = n.arguments[0]
      if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
        const p0 = cb.parameters[0]
        if (p0 && ts.isIdentifier(p0.name)) results.push({ identifierName: p0.name.text, bodyNode: cb.body })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(scopeNode)
  return results
}

/**
 * Discover every place, across `sourceFiles`, where a value of a known shape
 * (from `catalog`) becomes bound to a single identifier this scan can then
 * check for narrowing. Four sources, all generic (no hardcoded names):
 * a directly-typed named parameter, a destructured-object parameter, the
 * element type of an array-typed parameter (via `for...of` or a map-family
 * call inside that same function), and the first parameter of a callback
 * handed to a method matched by `callbackBindings`.
 *
 * Returns `{ typeName, fields, identifierName, bodyNode, destructuredNames,
 * fn: {label, file, line} }[]`. `fields` is `undefined` for a destructured
 * binding (nothing to walk — the destructuring pattern IS the field list).
 */
export function discoverBoundaries(sourceFiles, catalog, callbackBindings) {
  const boundaries = []
  const byCallbackMethod = new Map(callbackBindings.map((b) => [b.methodName, b.typeName]))

  for (const { path, text } of sourceFiles) {
    let sf
    try {
      sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path))
    } catch {
      continue
    }

    for (const fn of findFunctionLikeNodes(sf)) {
      const label = functionLabel(fn, sf, path)
      for (const param of fn.parameters) {
        if (!param.type) continue
        const resolved = unwrapTypeRef(param.type)
        if (!resolved) continue
        const resolvedName = resolveTypeNameInFile(resolved.name, path, catalog)
        if (resolvedName === undefined) continue // shadowed by an unrelated local type of the same name in this file
        const fields = fieldsOf(resolvedName, catalog)
        if (fields === undefined) continue

        if (!resolved.isArray && ts.isIdentifier(param.name)) {
          boundaries.push({
            typeName: resolvedName,
            fields,
            identifierName: param.name.text,
            bodyNode: fn.body,
            enclosingBodyNode: fn.body,
            destructuredNames: undefined,
            fn: label,
          })
        } else if (!resolved.isArray && ts.isObjectBindingPattern(param.name)) {
          const names = []
          let hasRest = false
          for (const el of param.name.elements) {
            if (el.dotDotDotToken) hasRest = true
            else if (ts.isIdentifier(el.name)) names.push((el.propertyName ?? el.name).getText(sf))
          }
          boundaries.push({
            typeName: resolvedName,
            fields,
            identifierName: undefined,
            bodyNode: fn.body,
            enclosingBodyNode: fn.body,
            destructuredNames: hasRest ? null : names, // null = rest present, whole value escapes together
            fn: label,
          })
        } else if (resolved.isArray && ts.isIdentifier(param.name)) {
          // The loop/callback BODY (`el.bodyNode`) is the right, narrow scope
          // to check what fields of the element get touched. But the actual
          // construction of a reduced output (e.g. `assess()`'s accumulator
          // buckets, returned after the loop ends) usually happens in the
          // ENCLOSING function, not inside the loop body itself — so the
          // "does this actually build something" gate must look at the
          // enclosing function's body (`fn.body`), a wider scope than the
          // one field-usage is walked against.
          for (const el of findElementBindings(fn.body, param.name.text)) {
            boundaries.push({
              typeName: resolvedName,
              fields,
              identifierName: el.identifierName,
              bodyNode: el.bodyNode,
              enclosingBodyNode: fn.body,
              destructuredNames: undefined,
              fn: label,
            })
          }
        }
      }

      // Callback-binding source: this function-like node itself, passed as
      // an argument to a call matching a known subscribe-style method.
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        const parent = fn.parent
        if (
          parent &&
          ts.isCallExpression(parent) &&
          parent.arguments[0] === fn &&
          ts.isPropertyAccessExpression(parent.expression) &&
          byCallbackMethod.has(parent.expression.name.text)
        ) {
          const typeName = byCallbackMethod.get(parent.expression.name.text)
          const fields = fieldsOf(typeName, catalog)
          const p0 = fn.parameters[0]
          if (fields !== undefined && p0 && ts.isIdentifier(p0.name)) {
            boundaries.push({
              typeName,
              fields,
              identifierName: p0.name.text,
              bodyNode: fn.body,
              enclosingBodyNode: fn.body,
              destructuredNames: undefined,
              fn: { label: `callback passed to .${parent.expression.name.text}()`, file: path, line: label.line },
            })
          }
        }
      }
    }
  }
  return boundaries
}

// ------------------------------------------------------------ ambiguity

function ambiguityOf(fieldName, typeName, declaredIndex) {
  const owners = declaredIndex.get(fieldName)
  const otherOwners = owners ? [...owners].filter((o) => o !== typeName) : []
  return { ambiguous: otherOwners.length > 0 || isCommonFieldName(fieldName), otherOwners }
}

/**
 * Does this function body actually BUILD a new structured value (an object
 * or array literal, returned directly or via a local accumulator variable
 * later returned)? This is the difference between `assess()` — which
 * narrows `MatchResult[]` down to an `AssessmentResult` it constructs — and
 * `passesThreshold()` or `dueCards()` — which narrow their input to compute
 * a boolean/primitive and are not "dropping" anything, just answering a
 * question with the fields they need. Only the former is what the contract
 * means by "constructs/returns a different type using a strict subset" —
 * without this gate, EVERY predicate/query function that reads fewer than
 * all of a type's fields reports a "drop", which is exactly the
 * flood-of-shrugs failure mode this version was built to eliminate (it was
 * verified against the real repo: without this gate scan A reports 800+
 * findings, almost all of them predicate functions like `dueCards()`
 * legitimately not needing `Card.ease`).
 */
function constructsStructuredReturn(bodyNode) {
  if (!ts.isBlock(bodyNode)) {
    let expr = bodyNode
    if (ts.isParenthesizedExpression(expr)) expr = expr.expression
    return ts.isObjectLiteralExpression(expr) || ts.isArrayLiteralExpression(expr)
  }
  const localStructuredNames = new Set()
  let found = false
  function visit(node) {
    if (found) return
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const init = node.initializer
      if (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)) {
        localStructuredNames.add(node.name.text)
      }
    }
    if (ts.isReturnStatement(node) && node.expression) {
      let expr = node.expression
      if (ts.isParenthesizedExpression(expr)) expr = expr.expression
      if (ts.isObjectLiteralExpression(expr) || ts.isArrayLiteralExpression(expr)) found = true
      else if (ts.isIdentifier(expr) && localStructuredNames.has(expr.text)) found = true
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(bodyNode)
  return found
}

// ----------------------------------------------------------------- scan A

/**
 * Given the boundaries `discoverBoundaries` found, report every field of a
 * bound shape never touched within that boundary (top-level), and — for a
 * touched field whose OWN type is also known and which itself did not
 * escape whole — every subfield never touched via that one-level chain.
 * Destructured-parameter boundaries are checked directly against the
 * destructured names, no walk needed. Either way, a boundary is only
 * reported when its function actually constructs a new structured value —
 * see `constructsStructuredReturn`.
 */
export function findBoundaryDrops(boundaries, catalog, declaredIndex, capturedTypeNames = new Set()) {
  const findings = []

  for (const b of boundaries) {
    if (b.destructuredNames === null) continue // rest element present — whole value escapes together
    if (b.enclosingBodyNode === undefined || !constructsStructuredReturn(b.enclosingBodyNode)) continue
    if (b.destructuredNames !== undefined) {
      for (const f of b.fields) {
        if (b.destructuredNames.includes(f.fieldName)) continue
        if (isNotSignalFieldName(f.fieldName)) continue // P2 — record-keeping, not signal
        const { ambiguous, otherOwners } = ambiguityOf(f.fieldName, f.typeName, declaredIndex)
        findings.push(
          dropFinding(
            f,
            b,
            ambiguous,
            otherOwners,
            `destructured as { ${b.destructuredNames.join(', ')} }`,
            undefined,
            capturedTypeNames.has(f.typeName),
          ),
        )
      }
      continue
    }

    const usage = collectFieldUsage(b.bodyNode, b.identifierName)
    if (usage.escaped) continue // whole value forwarded — defer to its next consumer

    const fieldNames = new Set(b.fields.map((f) => f.fieldName))
    const touchedList = [...usage.touched].filter((n) => fieldNames.has(n)).sort()
    for (const f of b.fields) {
      if (usage.touched.has(f.fieldName)) continue
      if (isNotSignalFieldName(f.fieldName)) continue // P2 — record-keeping, not signal
      const { ambiguous, otherOwners } = ambiguityOf(f.fieldName, f.typeName, declaredIndex)
      const touchedNote = touchedList.length > 0 ? `touches only [${touchedList.join(', ')}]` : 'touches none of its fields'
      findings.push(dropFinding(f, b, ambiguous, otherOwners, touchedNote, undefined, capturedTypeNames.has(f.typeName)))
    }

    // One level of chaining: for a field that WAS touched, whose own type is
    // known, and which did not itself escape whole, check its subfields.
    for (const [outerField, subTouched] of usage.chainTouched) {
      if (usage.chainEscapedFields.has(outerField)) continue
      const outerDecl = b.fields.find((f) => f.fieldName === outerField && f.typeRef && !f.typeRefIsArray)
      if (!outerDecl) continue
      const nestedTypeName = resolveTypeNameInFile(outerDecl.typeRef, outerDecl.file, catalog)
      if (nestedTypeName === undefined) continue
      const nestedFields = fieldsOf(nestedTypeName, catalog)
      if (nestedFields === undefined) continue
      for (const nf of nestedFields) {
        if (subTouched.has(nf.fieldName)) continue
        if (isNotSignalFieldName(nf.fieldName)) continue // P2 — record-keeping, not signal
        const { ambiguous, otherOwners } = ambiguityOf(nf.fieldName, nf.typeName, declaredIndex)
        findings.push(
          dropFinding(
            nf,
            b,
            ambiguous,
            otherOwners,
            `via ${b.typeName}.${outerField} (${outerDecl.typeRef}), which touches only [${[...subTouched].sort().join(', ')}]`,
            `${b.typeName}.${outerField} -> ${nf.typeName}.${nf.fieldName}`,
            capturedTypeNames.has(nf.typeName),
          ),
        )
      }
    }
  }
  return findings
}

/**
 * `chained` (true only for the one-level nested-narrowing case, i.e. when
 * `signalOverride` is given) and `capturedField` (true when `field.typeName`
 * is itself a verified real-time/event-captured shape — see
 * `collectCapturedTypeNames`'s comment near scan D, reused here) are ranking
 * hints only, consumed by `rankRows`'s `evidenceStrength`. They do not affect
 * confidence, which stays governed solely by `ambiguous` — see the module's
 * "honesty requirement".
 */
function dropFinding(field, boundary, ambiguous, otherOwners, touchedNote, signalOverride, capturedField = false) {
  const signal = signalOverride ?? `${field.typeName}.${field.fieldName}`
  const why = otherOwners.length > 0 ? `also declared on ${otherOwners.join(', ')}` : `a common field name`
  const confidence = ambiguous ? 'LOW' : 'HIGH'
  const evidence =
    `${boundary.fn.label} (${boundary.fn.file}:${boundary.fn.line}) receives ${boundary.typeName}, ${touchedNote}, never "${field.fieldName}"` +
    (ambiguous ? ` — LOW because "${field.fieldName}" is ${why}` : '')
  const consequence = `whatever "${field.fieldName}" carried cannot affect ${boundary.fn.label}'s output, so nothing downstream of it (grading, persistence, or the screen) can depend on it`
  return {
    scan: 'A',
    pattern: 'dropped-at-boundary',
    signal,
    typeName: field.typeName,
    fieldName: field.fieldName,
    // Ranking hints only — see the comment on this function's own signature.
    chained: signalOverride !== undefined,
    capturedField,
    declaredAt: `${field.file}:${field.line}`,
    confidence,
    evidence: `${evidence}. ${consequence}.`,
  }
}

// ----------------------------------------------------------------- scan B

const PERSISTED_FIELD_EXPANSION_DEPTH = 3

/**
 * Recurse through a persisted field's own declared type, up to
 * `PERSISTED_FIELD_EXPANSION_DEPTH` levels deep (cycle-safe via a visited
 * `typeName` set per branch) — reaches e.g. `PersistedRecordings.recordings[]`
 * (depth 1: `Recording`) `.events[]` (depth 2: `MidiEvent`, a union) `.down`
 * (depth 2's own fields — the sustain-pedal field), without depth capped at
 * one, which stops one hop short of that case.
 */
function expandPersistedFields(topFields, catalog) {
  const expanded = topFields.map((f) => ({ ...f, via: undefined }))
  const queue = topFields.map((f) => ({ field: f, via: undefined, depth: 0, seen: new Set([f.typeName]) }))
  while (queue.length > 0) {
    const { field: f, via, depth, seen } = queue.shift()
    if (!f.typeRef || depth >= PERSISTED_FIELD_EXPANSION_DEPTH || seen.has(f.typeRef)) continue
    const nestedTypeName = resolveTypeNameInFile(f.typeRef, f.file, catalog)
    if (nestedTypeName === undefined) continue
    const nested = fieldsOf(nestedTypeName, catalog)
    if (nested === undefined) continue
    const nextVia = via ? `${via} -> ${f.typeName}.${f.fieldName}${f.typeRefIsArray ? '[]' : ''}` : `${f.typeName}.${f.fieldName}${f.typeRefIsArray ? '[]' : ''}`
    const nextSeen = new Set(seen).add(f.typeRef)
    for (const nf of nested) {
      expanded.push({ ...nf, via: nextVia })
      queue.push({ field: nf, via: nextVia, depth: depth + 1, seen: nextSeen })
    }
  }
  return expanded
}

/**
 * Persisted fields (top-level from `declaredSourceFiles`, plus up to 3
 * levels of recursion through the catalog) whose name never appears as a property/
 * bracket access in `renderFiles` (`.tsx` under `src/app/**` — the only
 * place a persisted value could reach the screen; JSX expression containers
 * compile to ordinary property accesses, so no separate JSX-specific
 * handling is needed).
 */
export function findNeverRendered(declaredFields, catalog, renderFiles, declaredIndex, capturedTypeNames = new Set()) {
  const expanded = expandPersistedFields(declaredFields, catalog)
  const usage = scanFieldUsages(
    expanded.map((f) => f.fieldName),
    renderFiles,
  )
  const findings = []
  for (const f of expanded) {
    if (isNotSignalFieldName(f.fieldName)) continue // P2 — record-keeping, not signal
    const matches = (usage.get(f.fieldName) ?? []).filter((m) => m.kind === 'plain')
    const { ambiguous, otherOwners } = ambiguityOf(f.fieldName, f.typeName, declaredIndex)
    if (matches.length > 0 && !ambiguous) continue // a trustworthy render-surface read exists
    const via = f.via ? ` (reached via ${f.via})` : ''
    let evidence
    if (matches.length > 0) {
      const why = otherOwners.length > 0 ? `also declared on ${otherOwners.join(', ')}` : `a common field name`
      evidence = `possible render match at ${matches[0].path}:${matches[0].line}, but "${f.fieldName}" is ${why} — cannot confirm it is this field without a type checker`
    } else {
      evidence = `no match in any .tsx file under src/app/**${via} — nothing on screen can be showing it`
    }
    findings.push({
      scan: 'B',
      pattern: 'never-rendered',
      // P3 — signal is deliberately the bare (type, field) pair, NOT the
      // reachability path: the same field is often reached by several
      // different persisted containers (`Card.ease` via `ProgressSnapshot
      // .srsCards[]` AND via `EarTrainingSnapshot.session -> ...`), and a
      // path-qualified signal would make `dedupeFindings` treat every path
      // as a different finding — exactly the P3 bug. The `via` chain still
      // lives in `evidence` (below) and in `pathHops`, which lets
      // `dedupeFindings` pick the SHORTEST one as the kept evidence.
      signal: `${f.typeName}.${f.fieldName}`,
      typeName: f.typeName,
      fieldName: f.fieldName,
      pathHops: f.via ? f.via.split(' -> ').length : 0,
      capturedField: capturedTypeNames.has(f.typeName),
      declaredAt: `${f.file}:${f.line}`,
      confidence: ambiguous ? 'LOW' : 'HIGH',
      evidence,
    })
  }
  return findings
}

/** One pass per file: bucket every plain/bracket property access and destructuring binding whose name is in `fieldNames`. */
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
      continue
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
        const nameNode = node.propertyName ?? (ts.isIdentifier(node.name) ? node.name : undefined)
        const key = nameNode && ts.isIdentifier(nameNode) ? nameNode.text : nameNode && ts.isStringLiteral(nameNode) ? nameNode.text : undefined
        if (key !== undefined) push(key, node, sf, path, 'destructure')
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return result
}

// ----------------------------------------------------------------- scan C

/**
 * Exported `src/core` functions with an explicit return type resolving to a
 * known object shape, whose call sites (anywhere in `callSiteFiles`)
 * destructure the result and omit some of its fields. Array-returning
 * functions and call sites that bind the whole result to a name are out of
 * scope (see the module doc's "what this cannot see").
 */
export function findDestructuredOmissions(declFiles, callSiteFiles, catalog, declaredIndex, capturedTypeNames = new Set()) {
  const returningFns = [] // { fnName, typeName, fields, file }
  for (const { path, text } of declFiles) {
    let sf
    try {
      sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path))
    } catch {
      continue
    }
    for (const stmt of sf.statements) {
      if (!ts.isFunctionDeclaration(stmt) || !isExported(stmt) || !stmt.name || !stmt.type) continue
      const resolved = unwrapTypeRef(stmt.type)
      if (!resolved || resolved.isArray) continue
      const resolvedName = resolveTypeNameInFile(resolved.name, path, catalog)
      if (resolvedName === undefined) continue // shadowed by an unrelated local type of the same name in this file
      const fields = fieldsOf(resolvedName, catalog)
      if (fields === undefined) continue
      returningFns.push({ fnName: stmt.name.text, typeName: resolvedName, fields, file: path })
    }
  }
  if (returningFns.length === 0) return []

  const byName = new Map(returningFns.map((f) => [f.fnName, f]))
  const findings = []
  for (const { path, text } of callSiteFiles) {
    let sf
    try {
      sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path))
    } catch {
      continue
    }
    const visit = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        byName.has(node.initializer.expression.text) &&
        ts.isObjectBindingPattern(node.name)
      ) {
        const fn = byName.get(node.initializer.expression.text)
        let hasRest = false
        const names = []
        for (const el of node.name.elements) {
          if (el.dotDotDotToken) hasRest = true
          else if (ts.isIdentifier(el.name)) names.push((el.propertyName ?? el.name).getText(sf))
        }
        if (!hasRest) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          for (const f of fn.fields) {
            if (names.includes(f.fieldName)) continue
            if (isNotSignalFieldName(f.fieldName)) continue // P2 — record-keeping, not signal
            const { ambiguous, otherOwners } = ambiguityOf(f.fieldName, f.typeName, declaredIndex)
            const why = otherOwners.length > 0 ? `also declared on ${otherOwners.join(', ')}` : `a common field name`
            findings.push({
              scan: 'C',
              pattern: 'computed-then-discarded',
              signal: `${f.typeName}.${f.fieldName} (from ${fn.fnName}())`,
              typeName: f.typeName,
              fieldName: f.fieldName,
              capturedField: capturedTypeNames.has(f.typeName),
              declaredAt: `${f.file}:${f.line}`,
              confidence: ambiguous ? 'LOW' : 'HIGH',
              evidence:
                `${path}:${line + 1} calls ${fn.fnName}() and destructures only { ${names.join(', ')} }, never "${f.fieldName}"` +
                (ambiguous ? ` — LOW because "${f.fieldName}" is ${why}` : '') +
                `. ${fn.fnName}() computed it; this caller cannot act on a value it never named.`,
            })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return findings
}

// ---------------------------------------------------------------- ageing

/**
 * `previousAges` and the returned map are `{ "<scan>:<signal>": count }`.
 * Every key in `currentKeys` gets `(previous ?? 0) + 1`; every key that was
 * in `previousAges` but is NOT in `currentKeys` resets to `0` (kept, not
 * deleted — a readable "this used to be an orphan" marker for the raw JSON;
 * the table only ever shows CURRENT orphans, so a `0` entry never appears
 * there).
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
  if (!existsSync(abs)) throw new Error(`required file missing: ${relPath}`)
  return { abs, text: readFileSync(abs, 'utf8') }
}

// ------------------------------------------------------- shared corpus
//
// runScanA/B/C/D each independently ask for the src/core (+ src/app) corpus
// and rebuild the type catalog from it — one real CLI invocation (and,
// worse, one test that calls all four scans against the real repo) did the
// same directory glob, the same file reads, AND the same
// buildTypeCatalog/collectDeclaredFieldNames walk of ~250 files up to FOUR
// times before a single scan-specific line of analysis ran. That duplicate
// I/O+parse work was most of the tool's own runtime and is pure waste:
// nothing about scan B changes what scan A already read off disk for the
// same root.
//
// Both caches below are explicit, small, and keyed on the resolved `root`
// path — not a hidden module-level global that would silently share state
// across two different roots in the same process. A caller scanning two
// different roots in one process still gets two correct, independent
// entries. This file's own fixture tests never touch either cache: they
// bypass this whole file-scope layer and hand hand-built {path,text}[]
// arrays straight to buildTypeCatalog/findBoundaryDrops/etc., so caching
// here cannot affect fixture-test results. Nothing cached is ever mutated
// in place afterward (no scan calls .set/.add/.push on a cached catalog's
// Maps/Sets — verified by grep), so sharing the same object across scans
// A-D within one process is safe, not just fast.
const sourceFilesCache = new Map() // `${root}::${patterns.join('|')}` -> {path, text}[]
const catalogCache = new Map() // root -> { core, catalog, callbackBindings, declaredIndex }

function readSourceFilesCached(root, patterns) {
  const key = `${root}::${patterns.join('|')}`
  const cached = sourceFilesCache.get(key)
  if (cached !== undefined) return cached
  const files = readSourceFiles(root, patterns, [])
  sourceFilesCache.set(key, files)
  return files
}

function coreFiles(root) {
  return readSourceFilesCached(root, ['src/core/**/*.ts'])
}

function appAndCoreFiles(root) {
  return [
    ...readSourceFilesCached(root, ['src/core/**/*.ts']),
    ...readSourceFilesCached(root, ['src/app/**/*.ts', 'src/app/**/*.tsx']),
  ]
}

function buildCatalogAndBindings(root) {
  const cached = catalogCache.get(root)
  if (cached !== undefined) return cached
  const core = coreFiles(root)
  const catalog = buildTypeCatalog(core)
  const portFiles = readSourceFilesCached(root, ['src/core/ports/*.ts'])
  const callbackBindings = findCallbackBindings(portFiles, catalog)
  const declaredIndex = collectDeclaredFieldNames(core)
  const result = { core, catalog, callbackBindings, declaredIndex }
  catalogCache.set(root, result)
  return result
}

// ---------------------------------------------------------------- scan A

/** Fields dropped at a function boundary — see the module doc comment. */
export function runScanA(root) {
  const { catalog, callbackBindings, declaredIndex } = buildCatalogAndBindings(root)
  const scanFiles = appAndCoreFiles(root)
  const boundaries = discoverBoundaries(scanFiles, catalog, callbackBindings)
  const capturedTypeNames = collectCapturedTypeNames(catalog, callbackBindings)
  return findBoundaryDrops(boundaries, catalog, declaredIndex, capturedTypeNames)
}

// ---------------------------------------------------------------- scan B

/** Persisted fields never rendered anywhere under src/app/**\/*.tsx — see the module doc comment. */
export function runScanB(root) {
  const persistedShapes = requireFile(root, 'src/app/state/persistedShapes.ts')
  const exportShapes = requireFile(root, 'src/core/progress/export.ts')
  const { catalog, callbackBindings, declaredIndex } = buildCatalogAndBindings(root)

  const declared = [
    ...parseTypeFields(persistedShapes.text, 'src/app/state/persistedShapes.ts'),
    ...parseTypeFields(exportShapes.text, 'src/core/progress/export.ts'),
  ]
  const renderFiles = readSourceFilesCached(root, ['src/app/**/*.tsx'])
  const capturedTypeNames = collectCapturedTypeNames(catalog, callbackBindings)
  return findNeverRendered(declared, catalog, renderFiles, declaredIndex, capturedTypeNames)
}

// ---------------------------------------------------------------- scan C

/** Fields an exported core function computes that every destructuring caller omits — see the module doc comment. */
export function runScanC(root) {
  const { core, catalog, callbackBindings, declaredIndex } = buildCatalogAndBindings(root)
  const callSites = appAndCoreFiles(root)
  const capturedTypeNames = collectCapturedTypeNames(catalog, callbackBindings)
  return findDestructuredOmissions(core, callSites, catalog, declaredIndex, capturedTypeNames)
}

// ---------------------------------------------------------------- scan D

/**
 * P1 — every type this scan's OWN discovery passes have already proven is
 * "captured" data: the parameter type of a traced callback binding
 * (`findCallbackBindings` — the `onEvent(handler: (event: MidiEvent) =>
 * void)` pattern `discoverBoundaries` also resolves, found today only in
 * `src/core/ports/midi.ts`) and, when that parameter type is itself a union
 * (`MidiEvent = MidiNoteOn | MidiNoteOff | MidiSustain`), its members. This
 * is deliberately narrower than "every known shape in the catalog": an
 * `*Options` bag is ALSO a known shape with a same-named field, but it was
 * never proven to carry a live, per-instance measured value — only that a
 * second, unrelated feature happens to expose a similarly-named knob. A
 * type name ending in `Options` is rejected outright even if it somehow
 * slipped into the captured set, since configuration is never "captured"
 * data by definition.
 *
 * Earlier version of this rule seeded `names` from EVERY union
 * `parseEventUnions` finds in `src/core`, not just callback-bound ones —
 * reasoned (wrongly) that "an exported discriminated union of local object
 * shapes" was itself evidence of an event-like source. It is not: `Flashcard
 * = IntervalOnStaffCard | NoteNameCard | StaffToKeyCard | KeySignatureCard |
 * TheoryQuizItem` matches that same shape and has nothing to do with
 * outside-the-app input. It happened not to produce a scan D false positive
 * (no Flashcard-family field pairs with a matching `?? DEFAULT_*` carrier
 * elsewhere), so the mistake was invisible there — but it surfaced once
 * `capturedField` was reused as a ranking signal for scans A/B/C: `answer`/
 * `id` fields declared on every `*Card` variant were outranking the real
 * chained orphan (`MatchResult.expected -> ScoreNote.durationTicks`) inside
 * scan A's own LOW tier, because they were wrongly scored as "captured".
 * Restricting to callback-BOUND unions only removes that false signal while
 * keeping `MidiEvent` (bound via `onEvent` above) intact, since a union this
 * scan cannot show is ever received from outside the app is not evidence of
 * anything.
 *
 * A type name ending in `Input` was tried as an ADDITIONAL positive signal
 * (it is this codebase's own convention for "raw data before construction",
 * and matches `ScoreNoteInput`) and rejected on evidence: `GrooveNoteInput
 * .dynamics ?? DEFAULT_DYNAMICS` and `GrooveScoreInput.{swingPercent,
 * swingUnit,timeSignature} ?? DEFAULT_*` all pass an `*Input`-suffix check
 * too, but their only "carrier" is `GrooveNote`/`Groove` — the very domain
 * shape *constructed from* that same input, one step later in the same
 * pipeline, not an independent live source. Trusting the naming convention
 * alone re-admitted exactly the false-positive shape P1 exists to remove.
 * The callback-binding check has no such failure mode: it only trusts a
 * carrier this scan can actually show receives events from outside the app
 * (the instrument), never a shape built by the code under test itself, and
 * never a shape merely shaped like a union.
 */
function collectCapturedTypeNames(catalog, callbackBindings) {
  const names = new Set()
  for (const b of callbackBindings) {
    names.add(b.typeName)
    const members = catalog.unions.get(b.typeName)
    if (members) for (const m of members) names.add(m)
  }
  return names
}

function isCapturedDataTypeName(typeName, capturedTypeNames) {
  if (typeName.endsWith('Options')) return false
  return capturedTypeNames.has(typeName)
}

/**
 * Pure core of scan D, taking already-discovered `boundaries` (see
 * `discoverBoundaries`) so it can be exercised against small fixture sources
 * with no disk I/O — `runScanD` below is just this wired to a real repo root.
 */
export function findConstantSubstitutions(boundaries, catalog, callbackBindings) {
  const capturedTypeNames = collectCapturedTypeNames(catalog, callbackBindings)
  const findings = []
  for (const b of boundaries) {
    if (b.identifierName === undefined || b.bodyNode === undefined) continue
    const subs = findDefaultSubstitutionsInBoundary(b)
    for (const sub of subs) {
      const ownField = b.fields.find((f) => f.fieldName === sub.field)
      if (!ownField) continue
      const carrierTypes = [...catalog.types.entries()]
        .filter(([typeName, fields]) => typeName !== b.typeName && fields.some((f) => f.fieldName === sub.field))
        .map(([typeName]) => typeName)
        .filter((typeName) => isCapturedDataTypeName(typeName, capturedTypeNames)) // P1
      if (carrierTypes.length === 0) continue
      // Confidence here is deliberately NOT `ambiguityOf`'s "declared on
      // another type" signal — that signal is this scan's own QUALIFYING
      // condition (see `carrierTypes` above), not evidence against it; using
      // it as a penalty would cap every real finding at LOW, including
      // velocity. A common/generic name (e.g. "note", "window") is still a
      // real false-positive risk on its own and stays LOW.
      const commonName = isCommonFieldName(sub.field)
      const confidence = commonName ? 'LOW' : sub.isNamedDefault ? 'HIGH' : 'LOW'
      findings.push({
        scan: 'D',
        pattern: 'constant-substituted',
        signal: `${b.typeName}.${sub.field} ?? ${sub.constant}`,
        typeName: b.typeName,
        fieldName: sub.field,
        declaredAt: `${ownField.file}:${ownField.line}`,
        confidence,
        evidence:
          `${b.fn.label} (${b.fn.file}:${sub.line}) falls back to ${sub.constant} when "${sub.field}" is missing, ` +
          `but a live "${sub.field}" is carried on ${carrierTypes.join(', ')} elsewhere in src/core` +
          (commonName ? ` — confidence capped LOW ("${sub.field}" is a common/generic field name, so the match could be coincidental)` : '') +
          (!commonName && !sub.isNamedDefault ? ` — LOW because ${sub.constant} is a bare literal, not a named domain constant, so this may just be an ordinary schema default` : '') +
          `. Real per-instance variation in "${sub.field}" can never reach whatever consumes ${b.typeName} through this path.`,
      })
    }
  }
  return findings
}

/** `field ?? DEFAULT_*` where a live value for that field name exists on some other known CAPTURED shape — see the module doc comment and `findConstantSubstitutions`'s P1 comment. */
export function runScanD(root) {
  const { catalog, callbackBindings } = buildCatalogAndBindings(root)
  const scanFiles = appAndCoreFiles(root)
  const boundaries = discoverBoundaries(scanFiles, catalog, callbackBindings)
  return findConstantSubstitutions(boundaries, catalog, callbackBindings)
}

function findDefaultSubstitutionsInBoundary(b) {
  // Re-parse is unnecessary: bodyNode already belongs to a live SourceFile
  // (created once in discoverBoundaries' pass over the file), so its own
  // `.getSourceFile()` gives correct line numbers directly.
  const sf = b.bodyNode.getSourceFile()
  return findDefaultSubstitutions(b.bodyNode, b.identifierName, sf)
}

// ------------------------------------------------------------------- CLI

const HEADER =
  'orphan-signals: syntax-only AST pass (TypeScript compiler API), no type checker.\n' +
  'Four scans ask "does any learner-visible output depend on this value" instead of\n' +
  '"is this name read anywhere": A dropped at a function boundary, B persisted but\n' +
  'never rendered, C computed then discarded by every caller, D a constant standing\n' +
  "in for real input. Ambiguous names never reach HIGH confidence. Capped at the\n" +
  'top-ranked rows below; pass --all to see every finding. See this file\'s own\n' +
  'header comment for the full method and what it cannot see.'

function parseArgs(argv) {
  const opts = { json: false, ages: undefined, root: undefined, all: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      opts.json = true
    } else if (arg === '--all') {
      opts.all = true
    } else if (arg === '--dry-run') {
      opts.dryRun = true
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

function readAges(path) {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function writeAges(path, ages) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(ages, Object.keys(ages).sort(), 2)}\n`)
}

function pad(s, width) {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

function printTable(rows, suppressedCount, allFindings) {
  console.log(HEADER)
  console.log('')
  // "no findings" is judged against the FULL ranked result (allFindings),
  // never the capped `rows` — a scan whose findings all fell below the
  // top-12 cutoff still found something, and must not be reported silent.
  for (const scan of ['A', 'B', 'C', 'D']) {
    const scanHasAny = allFindings.some((r) => r.scan === scan)
    if (!scanHasAny) console.log(`[${scan}] no findings`)
  }
  if (rows.length === 0) {
    console.log('')
    console.log('No orphan signals found.')
    return
  }
  console.log('')
  const cols = ['scan', 'signal', 'declared at', 'confidence', 'age', 'evidence']
  const widths = cols.map((c, i) =>
    Math.max(
      c.length,
      ...rows.map((r) => String([r.scan, r.signal, r.declaredAt, r.confidence, r.age, r.evidence][i]).length),
    ),
  )
  const line = (values) => values.map((v, i) => pad(String(v), widths[i])).join('  ')
  console.log(line(cols))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const r of rows) console.log(line([r.scan, r.signal, r.declaredAt, r.confidence, r.age, r.evidence]))
  console.log('')
  console.log(
    `${rows.length} shown` +
      (suppressedCount > 0 ? `, ${suppressedCount} more suppressed by the top-12 cap — pass --all to see them.` : '.'),
  )
}

/**
 * The same (scan, signal) pair can legitimately fire from several different
 * receiving functions/call sites — e.g. `Score.maxNoteDurationTicks` is
 * dropped identically by half a dozen unrelated query functions that all
 * only need `.measures`. Reported once each, that would flood a 12-row cap
 * with near-duplicates of the same underlying orphan and crowd out
 * different ones. Collapse to one row per (scan, signal), keeping the
 * strongest (HIGH-over-LOW) occurrence's evidence and noting how many other
 * sites also showed it.
 */
export function dedupeFindings(findings) {
  const bySignal = new Map()
  for (const f of findings) {
    const key = `${f.scan}:${f.signal}`
    const existing = bySignal.get(key)
    if (!existing) {
      bySignal.set(key, { ...f, occurrences: 1 })
    } else {
      // P3 — when several findings collapse to the same (scan, signal), HIGH
      // still always beats LOW (unchanged); but scan B's `signal` is now the
      // bare (type, field) pair (see `findNeverRendered`), so the SAME field
      // reached via several different persisted containers collapses here
      // too — `Card.ease` via `ProgressSnapshot.srsCards[]` (1 hop) and via
      // `EarTrainingSnapshot.session -> EarSessionState.cards[]` (2 hops)
      // are the same underlying orphan, and the shorter path is the clearer,
      // more direct evidence to keep. `pathHops` is `0`/`undefined` for every
      // scan but B, so this tie-break is a no-op for A/C/D.
      const existingHops = existing.pathHops ?? 0
      const newHops = f.pathHops ?? 0
      const keepNew =
        (existing.confidence === 'LOW' && f.confidence === 'HIGH') ||
        (existing.confidence === f.confidence && newHops < existingHops)
      bySignal.set(key, { ...(keepNew ? f : existing), occurrences: existing.occurrences + 1 })
    }
  }
  return [...bySignal.values()].map(({ occurrences, pathHops, ...f }) => ({
    ...f,
    evidence:
      occurrences > 1
        ? `${f.evidence} (also found at ${occurrences - 1} other location${occurrences - 1 === 1 ? '' : 's'} — pass --all for the full list)`
        : f.evidence,
  }))
}

const CROSS_SCAN_FOLD_PRIORITY = ['A', 'D', 'C', 'B']

/**
 * P4 — cross-scan dedupe. `dedupeFindings` above only collapses duplicates
 * WITHIN one scan (same scan, same signal). An orphan can also be
 * independently discovered by MORE THAN ONE scan under the exact same
 * (typeName, fieldName): `Card.ease` is dropped at a boundary (scan A) AND
 * persisted-but-never-rendered (scan B); `ScoreNote.velocity` the same.
 * Reported as separate rows, one real orphan costs two (or three) of the
 * twelve capped slots.
 *
 * The fold key is the EXACT (typeName, fieldName) pair — never the bare
 * field name alone. `ScoreNoteInput.velocity` (scan D) does NOT fold with
 * `ScoreNote.velocity` (scan A/B) here, even though a human reader would
 * call them "the same signal": `ScoreNoteInput` is the shape data arrives in
 * before construction, `ScoreNote` is the shape the app operates on after —
 * nothing in this syntax-only pass can prove those name the same field
 * without a type checker. Folding on the bare name was tried and rejected on
 * evidence: `ScoreNote.durationTicks` and `Measure.durationTicks` are two
 * UNRELATED real orphans (a note's own length vs. a measure's length) that
 * happen to share a field name — a bare-name fold would have silently
 * merged them into one misleading row. An exact (typeName, fieldName) match
 * has no such risk: it is the identical declared field, full stop.
 *
 * When a fold group ties on confidence, the kept row is picked by
 * `CROSS_SCAN_FOLD_PRIORITY`: scans A and D both point at a specific line
 * that narrows or substitutes the field (the most concrete evidence a
 * reader can go check), scan C points at a specific discarding call site,
 * and scan B only asserts a global absence ("no match anywhere in src/app")
 * — the weakest, least specific claim — so it is preferred last.
 */
export function foldCrossScanDuplicates(findings) {
  const byTuple = new Map()
  for (const f of findings) {
    if (f.typeName === undefined || f.fieldName === undefined) continue
    const key = `${f.typeName}.${f.fieldName}`
    if (!byTuple.has(key)) byTuple.set(key, [])
    byTuple.get(key).push(f)
  }
  const replacementEvidence = new Map()
  const drop = new Set()
  for (const [key, group] of byTuple) {
    if (new Set(group.map((f) => f.scan)).size < 2) continue // single scan — not this rule's job, see P3 above
    const sorted = [...group].sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence === 'HIGH' ? -1 : 1
      return CROSS_SCAN_FOLD_PRIORITY.indexOf(a.scan) - CROSS_SCAN_FOLD_PRIORITY.indexOf(b.scan)
    })
    const [primary, ...rest] = sorted
    const otherScans = [...new Set(rest.map((r) => r.scan))].sort()
    replacementEvidence.set(
      primary,
      `${primary.evidence} (the same ${key} is independently flagged by scan ${otherScans.join(', ')} too — collapsed here so one orphan does not cost multiple rows)`,
    )
    for (const r of rest) drop.add(r)
  }
  return findings.filter((f) => !drop.has(f)).map((f) => (replacementEvidence.has(f) ? { ...f, evidence: replacementEvidence.get(f) } : f))
}

/**
 * Within a scan bucket, a finding whose OWN type is a verified captured/
 * event shape (`capturedField` — set by scans A/B/C via the same
 * `collectCapturedTypeNames` scan D's P1 rule uses) is the strongest kind of
 * evidence this tool can produce without a type checker: it is not just "a
 * plausible name", it is a name declared on a shape independently proven to
 * carry live, per-instance data from outside the app. A `chained` finding
 * (scan A's one-level nested-narrowing case — `dropFinding`'s
 * `signalOverride` path) is the next strongest: it survived narrowing
 * through TWO structures, not one, so it is less likely to be an unrelated
 * same-named field. Both are ranking hints ONLY, never confidence — see
 * `dropFinding`'s own comment. This mirrors the real gap the ranking had:
 * `MidiSustain.down` (capturedField) and `MatchResult.expected ->
 * ScoreNote.durationTicks` (chained) are both real orphans this tool proved
 * with the strongest evidence it has, yet plain age+alphabetical sorting
 * left them dozens of rows deep inside their own LOW bucket, unreachable
 * under any single-digit row cap. Promoting them within their bucket (never
 * across the HIGH/LOW boundary) is what makes them reachable.
 */
function evidenceStrength(f) {
  return (f.capturedField ? 2 : 0) + (f.chained ? 1 : 0)
}

/**
 * HIGH confidence always ranks above LOW. Within a tier, findings are
 * round-robined one-per-scan (A, then B, then C, then D, repeat), each
 * scan's own findings pre-sorted by `evidenceStrength` (see above), then age
 * (older/more-passed-over first), then field name (not the full signal —
 * sorting by full signal alphabetizes by the OWNING TYPE name first, which
 * buries e.g. `MidiSustain.down` behind every `MidiNoteOn.*`/`MidiNoteOff.*`
 * finding purely because "MidiNoteOn" < "MidiSustain"; field name is the
 * part a reader actually scans for). A strict global sort (confidence, then
 * age, then scan letter, then signal) was tried first and rejected on
 * evidence: scan A alone produces far more HIGH-confidence findings than
 * B/C/D combined (different kinds of orphan are not equally numerous in
 * this codebase), so a plain sort let scan A's volume fill all 12 capped
 * rows on every real run, regardless of run-to-run age — scan D's velocity
 * finding and scan B's sustain-pedal finding, both HIGH, never appeared in
 * the capped table even though nothing about them was weaker. The
 * round-robin keeps HIGH strictly ahead of LOW (the actual confidence
 * signal is never overridden) while guaranteeing every scan that found
 * something gets a fair share of the capped rows — which is the point of
 * running four differently-shaped scans in the first place.
 */
export function rankRows(findings) {
  const tiers = { HIGH: [], LOW: [] }
  for (const f of findings) tiers[f.confidence].push(f)
  const out = []
  for (const tier of ['HIGH', 'LOW']) {
    const byScan = new Map()
    for (const f of tiers[tier]) {
      if (!byScan.has(f.scan)) byScan.set(f.scan, [])
      byScan.get(f.scan).push(f)
    }
    for (const bucket of byScan.values()) {
      bucket.sort(
        (a, b) =>
          evidenceStrength(b) - evidenceStrength(a) ||
          b.age - a.age ||
          (a.fieldName ?? a.signal).localeCompare(b.fieldName ?? b.signal) ||
          a.signal.localeCompare(b.signal),
      )
    }
    const scanOrder = ['A', 'B', 'C', 'D'].filter((s) => byScan.has(s))
    for (let i = 0; ; i++) {
      let any = false
      for (const s of scanOrder) {
        const bucket = byScan.get(s)
        if (i < bucket.length) {
          out.push(bucket[i])
          any = true
        }
      }
      if (!any) break
    }
  }
  return out
}

/**
 * `rankRows` puts every HIGH finding ahead of every LOW finding, on purpose
 * (see its own comment) — but that ordering, combined with a flat
 * `slice(0, MAX_ROWS_DEFAULT)`, means a run with >= 12 HIGH findings shows
 * NO LOW finding by default, ever, regardless of how strong a specific LOW
 * finding's evidence is (`MidiSustain.down` and `MatchResult.expected ->
 * ScoreNote.durationTicks` are both real, verified orphans that are LOW only
 * because their field name collides with another type — see the module's
 * honesty requirement — not because the evidence for THIS field is weak).
 * `capDefaultRows` reserves up to `MIN_LOW_ROWS_RESERVED` of the default
 * rows for the top of the LOW tier (already evidence-ranked by `rankRows`)
 * whenever LOW findings exist, at HIGH's expense, then re-sorts the
 * selection back to HIGH-before-LOW for display. This changes which rows
 * are SHOWN by default; it never changes `ranked`'s full order or drops a
 * finding — `--all` still shows everything in the original tiered order.
 *
 * PLAINLY: this reservation is the ONLY reason `MidiSustain.down` and
 * `MatchResult.expected -> ScoreNote.durationTicks` are on the default
 * table at all — as of this writing they sit at rows 11-12 of 12, exactly
 * the two reserved slots, not because HIGH-tier ranking rated them highly.
 * Deleting this function (falling back to a flat `ranked.slice(0,
 * MAX_ROWS_DEFAULT)`) silently drops both from the default view — no error,
 * no warning, just two real orphans a learner-facing "what's missing"
 * command no longer mentions. `scripts/orphan-signals.test.mjs`'s "the real
 * scan" test asserts against this function's OWN output (`capDefaultRows
 * (rankRows(...))`), not against `--all`, specifically so that regression
 * is what fails, not a laxer "is it in the finding set somewhere" check.
 */
export function capDefaultRows(ranked) {
  if (ranked.length <= MAX_ROWS_DEFAULT) return ranked
  const low = ranked.filter((f) => f.confidence === 'LOW')
  if (low.length === 0) return ranked.slice(0, MAX_ROWS_DEFAULT)
  const reserved = Math.min(MIN_LOW_ROWS_RESERVED, low.length)
  const high = ranked.filter((f) => f.confidence === 'HIGH')
  const selected = new Set([...high.slice(0, MAX_ROWS_DEFAULT - reserved), ...low.slice(0, reserved)])
  return ranked.filter((f) => selected.has(f)) // preserve rankRows' original HIGH-then-LOW order
}

export async function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.error) {
    console.error(`orphan-signals: ${parsed.error}`)
    console.error('usage: node scripts/orphan-signals.mjs [--json] [--all] [--dry-run] [--ages <path>] [--root <repoRoot>]')
    return 2
  }
  const { opts } = parsed
  const root = opts.root ? resolve(opts.root) : DEFAULT_ROOT
  const agesPath = opts.ages ? resolve(opts.ages) : resolve(root, 'runs/orphan-ages.json')

  let findings
  try {
    const raw = [...runScanA(root), ...runScanB(root), ...runScanC(root), ...runScanD(root)]
    findings = foldCrossScanDuplicates(dedupeFindings(raw)) // P3 then P4, in that order — see each function's own comment
  } catch (err) {
    console.error(`orphan-signals: could not complete analysis: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const previousAges = readAges(agesPath)
  const currentKeys = findings.map((f) => `${f.scan}:${f.signal}`)
  const nextAges = opts.dryRun ? previousAges : updateAges(previousAges, currentKeys)
  if (!opts.dryRun) writeAges(agesPath, nextAges)

  const withAge = findings.map((f) => ({
    ...f,
    age: capAge((opts.dryRun ? previousAges[`${f.scan}:${f.signal}`] : nextAges[`${f.scan}:${f.signal}`]) ?? 1),
  }))
  const ranked = rankRows(withAge)
  const shown = opts.all ? ranked : capDefaultRows(ranked)
  const suppressed = ranked.length - shown.length

  if (opts.json) {
    const noFindingScans = ['A', 'B', 'C', 'D'].filter((scan) => !ranked.some((r) => r.scan === scan))
    console.log(
      JSON.stringify(
        { header: HEADER, findings: shown, suppressedCount: suppressed, totalFindings: ranked.length, noFindingScans },
        null,
        2,
      ),
    )
  } else {
    printTable(shown, suppressed, ranked)
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
