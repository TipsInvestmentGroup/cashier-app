#!/usr/bin/env node
/**
 * Runs from the `prepare` npm lifecycle (i.e. after every `npm install`) to
 * point git at the repo's tracked hooks directory.
 *
 * Heavily guarded so it can NEVER break an install or a build:
 *   - skips in CI / Vercel (no commits happen there, so hooks are pointless);
 *   - skips when this isn't a git work tree (e.g. a source tarball / Docker
 *     build context without a .git dir);
 *   - skips if it's already configured (idempotent, quiet);
 *   - swallows every error and always exits 0.
 */
import { execFileSync } from 'node:child_process'

function git(args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
}

try {
  if (process.env.CI || process.env.VERCEL) {
    process.exit(0) // never configure hooks in automated build environments
  }
  if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
    process.exit(0) // not a git checkout — nothing to wire up
  }
  const current = (() => { try { return git(['config', '--local', 'core.hooksPath']) } catch { return '' } })()
  if (current === '.githooks') {
    process.exit(0) // already set — stay quiet
  }
  git(['config', 'core.hooksPath', '.githooks'])
  console.log('[setup-hooks] git core.hooksPath -> .githooks (pre-commit checks active)')
} catch {
  // git missing, or any other failure — do not disturb the install.
}
process.exit(0)
