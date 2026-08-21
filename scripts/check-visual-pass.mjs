#!/usr/bin/env node
/**
 * The experience gate's visual step, as a commit gate.
 *
 * `AGENTS.md` says a slice is done only when it has had "a visual pass against
 * `docs/DESIGN.md` (both widths, both themes)", and `scripts/visual-pass.mjs`
 * has done exactly that in one command since 2026-08-08. Both are prose a
 * session can walk past, and the 2026-08-21 session did: it hand-drove a
 * browser pane instead, and the pass — once actually run — found three
 * learner-facing defects in one invocation that 4783 green tests could not
 * see. A run-state chip that read as a second disabled button, a Previous/Next
 * pair wearing the tempo stepper's own glyphs, and two verdicts on screen at
 * once. None of those is a thing a test can fail on.
 *
 * So: if a commit stages a file on the visual surface, there must be a receipt
 * from a CLEAN `visual-pass.mjs` run whose surface hash matches this tree.
 * Narrow on purpose — see `scripts/visual-surface.mjs` for what counts, which
 * is components and stylesheets only.
 *
 *   node scripts/check-visual-pass.mjs [--out <dir>]   (default: ./visual-pass)
 *
 * Escape hatch: `VISUAL_PASS_SKIP="<reason>"` passes the gate and prints the
 * reason. It exists so that a false positive has an auditable route out — the
 * alternative is `git commit --no-verify`, which skips typecheck, lint and the
 * core suite as well, and which `AGENTS.md` forbids outright. A gate with no
 * escape teaches the session to reach for the one that disables everything.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSurfacePath, surfaceHash } from './visual-surface.mjs'

const DEFAULT_OUT = './visual-pass'

/**
 * The whole decision, as a function of three inputs, so the arms are testable
 * without a git index, a browser or a filesystem.
 *
 * @param {{staged: readonly string[], receipt: unknown, hash: string}} input
 * @returns {{ok: boolean, message: string}}
 */
export function visualPassVerdict({ staged, receipt, hash }) {
  const surface = staged.filter(isSurfacePath)
  if (surface.length === 0) return { ok: true, message: '' }

  const listed = surface.slice(0, 5).join(', ') + (surface.length > 5 ? `, +${surface.length - 5} more` : '')
  if (receipt === undefined || receipt === null) {
    return {
      ok: false,
      message:
        `${surface.length} visual-surface file(s) staged (${listed}) but no visual-pass receipt.\n` +
        `  Run the pass on the screen you changed, with the dev server up:\n` +
        `    node scripts/visual-pass.mjs <nav destination>`,
    }
  }
  if (receipt.surfaceHash !== hash) {
    return {
      ok: false,
      message:
        `visual-pass receipt is stale: it covers a different tree.\n` +
        `  Receipt: ${receipt.destination ?? '(unnamed)'} at ${receipt.at ?? '(undated)'}\n` +
        `  Staged:  ${listed}\n` +
        `  Re-run: node scripts/visual-pass.mjs <nav destination>`,
    }
  }
  return { ok: true, message: `visual-pass receipt: ${receipt.destination} at ${receipt.at}` }
}

/** Reads the receipt, treating an absent or unparseable one the same: no evidence. */
export function readReceipt(path) {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function main() {
  const skip = process.env.VISUAL_PASS_SKIP
  if (skip !== undefined && skip.trim() !== '') {
    process.stdout.write(`visual pass skipped: ${skip}\n`)
    return
  }

  let out = DEFAULT_OUT
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1] !== undefined) {
      out = argv[i + 1]
      i++
    } else {
      console.error('usage: node scripts/check-visual-pass.mjs [--out <dir>]')
      process.exit(2)
      return
    }
  }

  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)

  const verdict = visualPassVerdict({
    staged,
    receipt: readReceipt(resolve(process.cwd(), out, 'receipt.json')),
    hash: surfaceHash(process.cwd()),
  })

  if (!verdict.ok) {
    console.error(verdict.message)
    console.error('  Or, if this really needs no pass: VISUAL_PASS_SKIP="<reason>" git commit …')
    process.exit(1)
  }
  if (verdict.message !== '') process.stdout.write(`${verdict.message}\n`)
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) main()
