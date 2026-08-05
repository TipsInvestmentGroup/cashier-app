#!/usr/bin/env node
/**
 * Pre-commit guard: keep the daily-cashier-report template's two mirrored
 * copies identical.
 *
 *   A) docs/daily-cashier-report-skill.md        — this repo (version-controlled)
 *   B) ../claude-skills/daily-cashier-report/SKILL.md — the invokable Claude skill
 *      (lives OUTSIDE the repo, in the user's local skills folder)
 *
 * The two files intentionally differ by ONE thing: a per-file "sync note"
 * block right after the frontmatter, each pointing at the other. This script
 * strips that block from both and compares the remaining shared content.
 *
 * Behaviour:
 *   - Only runs when copy A is staged (so unrelated commits aren't blocked).
 *   - If copy B is absent (fresh clone, CI, another machine) it SKIPS — the
 *     external file simply isn't there to compare, which is not an error.
 *   - If the shared content differs, it fails the commit with a clear diff hint.
 *
 * Run manually any time with:  node scripts/check-skill-sync.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url))) // <repo>/scripts -> <repo>
const REPO_COPY = join(root, 'docs', 'daily-cashier-report-skill.md')
const SKILL_COPY = join(root, '..', 'claude-skills', 'daily-cashier-report', 'SKILL.md')
const REPO_COPY_REL = 'docs/daily-cashier-report-skill.md'

const isHook = process.argv.includes('--hook')

// In hook mode, only bother when the repo copy is actually staged.
if (isHook) {
  try {
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' })
      .split('\n').map((s) => s.trim())
    if (!staged.includes(REPO_COPY_REL)) process.exit(0)
  } catch {
    // If we can't ask git what's staged, fall through and just run the check.
  }
}

if (!existsSync(SKILL_COPY)) {
  console.log('[skill-sync] skill copy not present on this machine — skipping sync check.')
  process.exit(0)
}
if (!existsSync(REPO_COPY)) {
  console.log('[skill-sync] repo copy not found — skipping.')
  process.exit(0)
}

/**
 * Normalise for comparison: LF line endings, and drop the sync-note block
 * (the `<!-- SYNC ... -->` marker line plus the `>`-quoted lines that follow
 * it). Everything else — frontmatter, prose, the embedded HTML template — must
 * match byte-for-byte after this.
 */
function normalise(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('<!-- SYNC')) {
      // skip the marker and the contiguous blockquote run that follows it
      let j = i + 1
      while (j < lines.length && lines[j].startsWith('>')) j++
      i = j - 1
      continue
    }
    out.push(line.replace(/\s+$/, '')) // trim trailing whitespace
  }
  // collapse the blank-line run left where the block was removed, so the two
  // files line up regardless of exactly how many blanks surrounded each note
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const a = normalise(readFileSync(REPO_COPY, 'utf8'))
const b = normalise(readFileSync(SKILL_COPY, 'utf8'))

if (a === b) {
  console.log('[skill-sync] OK — the two report-template copies match.')
  process.exit(0)
}

// Report the first divergence to make the fix obvious.
const al = a.split('\n')
const bl = b.split('\n')
let n = 0
while (n < al.length && n < bl.length && al[n] === bl[n]) n++

console.error('\n[skill-sync] ✗ The daily-cashier-report template copies have DIVERGED.\n')
console.error('  Repo copy : ' + REPO_COPY_REL)
console.error('  Skill copy: ../claude-skills/daily-cashier-report/SKILL.md')
console.error('\n  First difference (shared content, sync-note block ignored):')
console.error('    line ' + (n + 1) + ' repo : ' + JSON.stringify(al[n] ?? '<missing>'))
console.error('    line ' + (n + 1) + ' skill: ' + JSON.stringify(bl[n] ?? '<missing>'))
console.error('\n  Apply the same change to BOTH files, then re-stage. To bypass once (not')
console.error('  recommended): git commit --no-verify\n')
process.exit(1)
