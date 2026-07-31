#!/usr/bin/env node
/**
 * Checkpoint: verify, then commit.
 *
 * Exists so that "commit only on green" is enforced by a script rather than by
 * an instruction an agent can forget. Usage:
 *
 *   npm run checkpoint -- "feat(core/theory): add interval inversion"
 *
 * With no message it derives a conventional-commit subject from the staged paths.
 */
import { execFileSync, spawnSync } from 'node:child_process'

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', shell: false, ...opts })

const say = (msg) => process.stdout.write(`${msg}\n`)

function git(...args) {
  return run('git', args).trim()
}

function fail(msg) {
  process.stderr.write(`\n✗ ${msg}\n`)
  process.exit(1)
}

// 1. Something to commit?
git('add', '-A')
const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean)
if (staged.length === 0) fail('nothing to commit')
say(`→ ${staged.length} file(s) staged`)

// 2. Green gate. This is the whole point of the script.
say('→ npm run verify')
const verify = spawnSync('npm', ['run', 'verify'], { stdio: 'inherit', shell: true })
if (verify.status !== 0) fail('verify failed — fix it before checkpointing (never --no-verify)')

// 3. Commit message.
const argMsg = process.argv.slice(2).join(' ').trim()
const message = argMsg || deriveMessage(staged)

function deriveMessage(files) {
  const scopes = new Set()
  for (const f of files) {
    const m = /^src\/(core|app|adapters|content)\/([^/]+)/.exec(f)
    if (m) scopes.add(`${m[1]}/${m[2]}`)
    else if (f.startsWith('src/')) scopes.add('src')
    else if (f.endsWith('.md')) scopes.add('docs')
    else scopes.add('build')
  }
  const scope = [...scopes].slice(0, 2).join(',')
  return `chore(${scope}): checkpoint ${files.length} file(s)`
}

const body = `${message}\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n`
run('git', ['commit', '-m', body])
say(`✓ committed: ${message}`)
say(git('log', '--oneline', '-1'))
