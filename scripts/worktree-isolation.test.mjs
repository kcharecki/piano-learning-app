/**
 * The main checkout must not lint, format-check or otherwise judge the code
 * inside `.claude/worktrees/**` — those are OTHER sessions' checkouts
 * (docs/WORKTREES.md), and each one runs the same tooling against itself.
 *
 * Why this is a test and not a comment: when worktrees landed, `eslint .` in
 * the main checkout immediately started failing on a parallel session's
 * half-written module. The main checkout is the only session allowed to merge,
 * so a red lint there blocks integration for every session at once. That is
 * a rule that cannot be "mostly followed", so it is asserted rather than
 * described.
 *
 * These assert the tools' OWN resolution of their ignore rules, not the text
 * of the config files — a glob that is present but does not actually match is
 * exactly the failure this is here to catch.
 */
import { describe, expect, it } from 'vitest'
import { fileURLToPath, URL as NodeURL } from 'node:url'

const repoRoot = fileURLToPath(new NodeURL('..', import.meta.url))
const abs = (relative) => fileURLToPath(new NodeURL(`../${relative}`, import.meta.url))

/** A file inside a sibling session's worktree, and its main-checkout twin. */
const IN_WORKTREE = '.claude/worktrees/some-session/src/core/notation/musicxml.ts'
const IN_MAIN = 'src/core/notation/musicxml.ts'

describe('worktree isolation from the main checkout tooling', () => {
  it('eslint ignores other sessions’ worktrees but still lints our own src', async () => {
    const { ESLint } = await import('eslint')
    const eslint = new ESLint({ cwd: repoRoot })

    await expect(eslint.isPathIgnored(abs(IN_WORKTREE))).resolves.toBe(true)
    // The guard must be specific: if it ever widened to swallow real source,
    // lint would go quiet everywhere and nothing else would notice.
    await expect(eslint.isPathIgnored(abs(IN_MAIN))).resolves.toBe(false)
  })

  it('prettier ignores other sessions’ worktrees but still checks our own src', async () => {
    const prettier = await import('prettier')
    const ignorePath = abs('.prettierignore')

    const inWorktree = await prettier.getFileInfo(abs(IN_WORKTREE), { ignorePath })
    const inMain = await prettier.getFileInfo(abs(IN_MAIN), { ignorePath })

    expect(inWorktree.ignored).toBe(true)
    expect(inMain.ignored).toBe(false)
  })

  it('the tools that use root-anchored globs need no ignore entry', async () => {
    // tsc, vitest and knip are safe by construction rather than by an ignore
    // rule: their include globs are anchored at the repo root and never
    // ascend into a nested directory. Asserting the shape of those globs is
    // what stops someone "helpfully" rewriting one as `**/src/**` and
    // reintroducing the hole through a different tool.
    const { readFileSync } = await import('node:fs')
    const tsconfigApp = readFileSync(abs('tsconfig.app.json'), 'utf8')
    expect(JSON.parse(tsconfigApp).include).toEqual(['src'])

    const knip = readFileSync(abs('knip.jsonc'), 'utf8')
    for (const glob of knip.matchAll(/"(!?)(\*\*\/)?src\//g)) {
      expect(glob[2], `knip project glob "${glob[0]}" must be anchored at the repo root`).toBe(
        undefined,
      )
    }

    // Only the `include:` arrays — a coverage `exclude` of `**/*.test.ts` is
    // correct and must not be flagged, because widening an exclusion cannot
    // pull another session's files in.
    const vitestConfig = readFileSync(abs('vitest.config.ts'), 'utf8')
    const includeBlocks = [...vitestConfig.matchAll(/\binclude:\s*\[([^\]]*)\]/g)]
    expect(includeBlocks.length, 'no vitest include arrays found — did the config move?').toBe(3)
    for (const block of includeBlocks) {
      for (const glob of block[1].matchAll(/'([^']+)'/g)) {
        expect(
          glob[1].startsWith('**/'),
          `vitest include glob "${glob[1]}" must be anchored at the repo root`,
        ).toBe(false)
      }
    }
  })
})
