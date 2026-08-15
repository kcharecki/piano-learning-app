#!/usr/bin/env node
/**
 * Parse every stylesheet the app ships and fail on a syntax error.
 *
 * Why this exists: `npm run verify` runs typecheck, eslint and vitest, and
 * NONE of them look at CSS. During the 2026-08-14 UI overhaul a stray `*​/`
 * left five lines of English prose sitting outside a comment block in
 * `base.css`, and the whole gate went green — eslint does not lint `.css`,
 * and no test imports a stylesheet. Vite would have surfaced it eventually,
 * but only for whoever next loaded the page, which is exactly the class of
 * "green suite, broken app" defect this project keeps paying for.
 *
 * The overhaul has ~13 more agents writing CSS into per-screen feature
 * stylesheets, so this is a hard gate rather than a habit.
 *
 * It also checks that every `@import` in the design-system entry point
 * resolves to a real file — a typo'd import is silently ignored by the
 * browser, which is how a whole feature stylesheet can end up never loading.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'
import { globSync } from 'node:fs'
import postcss from 'postcss'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(root, 'src/design-system/styles.css')

const files = globSync('src/**/*.css', { cwd: root }).map((p) => resolve(root, p))

let failures = 0

for (const file of files) {
  const css = readFileSync(file, 'utf8')
  let parsed
  try {
    parsed = postcss.parse(css, { from: file })
  } catch (err) {
    failures += 1
    console.error(`CSS PARSE ERROR  ${relative(root, file)}\n  ${err.message}`)
    continue
  }

  // A parse error is the easy case. The nastier one — the one that actually
  // shipped here — is prose left OUTSIDE a comment by a stray `*/`: postcss
  // raises nothing, it just absorbs the loose text and the rule that follows
  // into one garbage selector, so the rule silently matches nothing. Any
  // comment delimiter surviving inside a selector means exactly that.
  parsed.walkRules((rule) => {
    if (rule.selector.includes('*/') || rule.selector.includes('/*')) {
      failures += 1
      const line = rule.source?.start?.line ?? '?'
      console.error(
        `COMMENT LEAKED INTO SELECTOR  ${relative(root, file)}:${line}\n` +
          `  A stray comment delimiter left prose outside a comment; the rule below it\n` +
          `  is now part of the selector and matches nothing. Selector begins:\n` +
          `    ${rule.selector.replace(/\s+/g, ' ').slice(0, 120)}`,
      )
    }
  })
}

// Every @import in the entry point must resolve. A typo here is invisible:
// the browser skips the rule and the feature simply has no styles.
if (existsSync(entry)) {
  const entryDir = dirname(entry)
  const imports = [...readFileSync(entry, 'utf8').matchAll(/@import\s+["']([^"']+)["']/g)].map(
    (m) => m[1],
  )
  for (const spec of imports) {
    const target = resolve(entryDir, spec)
    if (!existsSync(target)) {
      failures += 1
      console.error(`UNRESOLVED @import  src/design-system/styles.css -> ${spec}`)
    }
  }
  // And every feature stylesheet must actually be imported by the entry point,
  // or it is dead weight that looks alive.
  const importedSet = new Set(imports.map((s) => resolve(entryDir, s)))
  for (const file of files) {
    if (!file.startsWith(resolve(root, 'src/design-system'))) continue
    if (file === entry) continue
    if (!importedSet.has(file)) {
      failures += 1
      console.error(
        `ORPHAN STYLESHEET  ${relative(root, file)} is never imported by src/design-system/styles.css`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Orphaned RULES (roadmap UI-31)
// ---------------------------------------------------------------------------
//
// The checks above catch an orphaned FILE — a stylesheet nothing imports. They
// say nothing about a rule inside a live file whose selector no longer matches
// anything, and the UI overhaul produced those by the dozen: every screen that
// moved into its own `feature-*.css` left its old `domain.css` block stranded.
// Dead CSS is not inert — it is read by the next author as a description of the
// app, and two of UI-24's nine invisible bugs were a stale rule still winning a
// specificity fight against the live one that replaced it.
//
// Method: collect every class name any selector mentions, then look for that
// name as a whole token anywhere in the app's own source. Deliberately a TOKEN
// search over `src/**/*.ts(x)` and `index.html` rather than a parse of
// `className=` attributes — a class can legitimately reach the DOM through a
// template literal, a lookup table, a `classList.add`, or a prop threaded
// through three components, and a stricter matcher would report all of those as
// dead. This under-reports rather than over-reports: a name that appears
// NOWHERE in source cannot possibly be emitted, which is the only claim made
// here.
//
// The known blind spot, stated concretely so the next person can look for it:
// a string used for something OTHER than a class still counts as a hit.
// `.eartraining-stats` survived this check for exactly that reason — the only
// occurrence in source was `<SrsSummary idPrefix="eartraining-stats" …>`, a
// `data-testid` prefix, while the component's own className is
// `card card--sunken srs-summary`. Forty lines of CSS that matched nothing.
// It was found by hand and deleted (roadmap UI-31). If you are hunting more
// dead CSS, the candidates are classes whose only source occurrence is a
// string prop rather than a `className`.
const RUNTIME_CLASS_PREFIXES = [
  // OpenSheetMusicDisplay writes these into the SVG it engraves at runtime;
  // `osmdEngraver.ts` styles them but never names them in source.
  'osmd',
  // VexFlow's own note/stave classes, inside OSMD's output. Same reason.
  'vf-',
]

/** Classes that ARE emitted, but never as a literal this token search can see. */
const RUNTIME_CLASS_ALLOWLIST = new Set([
  // Set by the browser on a native <dialog>; we only style it.
  'backdrop',
])

const sourceBlob = globSync(['src/**/*.ts', 'src/**/*.tsx', 'index.html'], { cwd: root })
  .map((p) => readFileSync(resolve(root, p), 'utf8'))
  .join('\n')

const declaredClasses = new Map() // class name -> "file:line" of its first declaration
for (const file of files) {
  let parsed
  try {
    parsed = postcss.parse(readFileSync(file, 'utf8'), { from: file })
  } catch {
    continue // already reported above
  }
  parsed.walkRules((rule) => {
    for (const m of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      const name = m[1]
      if (declaredClasses.has(name)) continue
      declaredClasses.set(name, `${relative(root, file)}:${rule.source?.start?.line ?? '?'}`)
    }
  })
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Is this class built by interpolation rather than written whole?
 *
 * `LessonBody.tsx` emits `` `lesson-body-diagram-${diagram.kind}` ``, so the
 * literal `lesson-body-diagram-staff` appears nowhere in source even though it
 * is very much on screen — the e2e that asserts it passes. A token search alone
 * reports those as dead, and a gate that calls live code dead is a gate someone
 * turns off. So for `a-b-c`, also accept any proper prefix followed by an
 * interpolation: `a-b-${` or `a-${`.
 */
function isComposed(name) {
  const parts = name.split('-')
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('-')
    if (new RegExp(`${escape(prefix)}-\\$\\{`).test(sourceBlob)) return true
  }
  return false
}

const orphanRules = []
for (const [name, where] of declaredClasses) {
  if (RUNTIME_CLASS_ALLOWLIST.has(name)) continue
  if (RUNTIME_CLASS_PREFIXES.some((p) => name.startsWith(p))) continue
  // Whole-token match, so `.stat` is not satisfied by `stat-group` appearing.
  const token = new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`)
  if (token.test(sourceBlob)) continue
  if (isComposed(name)) continue
  orphanRules.push({ name, where })
}

if (orphanRules.length > 0) {
  failures += orphanRules.length
  console.error(`\nORPHANED CSS RULES — declared in a stylesheet, emitted by no source file:`)
  for (const { name, where } of orphanRules) console.error(`  .${name}  (${where})`)
  console.error(
    `\n  Delete the rule, or — if it is emitted at runtime by something this token\n` +
      `  search cannot see — add it to RUNTIME_CLASS_ALLOWLIST in this file WITH a\n` +
      `  reason. An allowlist entry nobody can justify is how an audit rots.`,
  )
}

if (failures > 0) {
  console.error(`\ncheck-css: ${failures} problem(s).`)
  process.exit(1)
}
console.log(
  `check-css: ${files.length} stylesheets parsed, all imports resolve, ` +
    `${declaredClasses.size} classes all emitted.`,
)
