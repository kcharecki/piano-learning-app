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

if (failures > 0) {
  console.error(`\ncheck-css: ${failures} problem(s).`)
  process.exit(1)
}
console.log(`check-css: ${files.length} stylesheets parsed, all imports resolve.`)
