// Which branches count as a base for the repo a push runs in: the base_branch of the portfolio spoke
// whose path holds the repo, the branch origin's HEAD points at, and MC_GUARD_BASES (comma list).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

const git = (dir, args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}
export const currentBranch = dir => {
  const b = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return b && b !== 'HEAD' ? b : undefined
}
export const upstreamBranch = dir => {
  const u = git(dir, ['rev-parse', '--abbrev-ref', '@{upstream}'])
  return u ? u.slice(u.indexOf('/') + 1) : undefined
}

/** Names of the git aliases in dir's config whose command is a push (or a shell command that mentions one). */
export function pushAliases(dir) {
  const out = git(dir, ['config', '--get-regexp', '^alias\\.'])
  if (!out) return []
  return out.split('\n').map(l => /^alias\.(\S+)\s+(.*)$/.exec(l)).filter(m => m && /(^|[\s!;&|])push\b/.test(m[2])).map(m => m[1])
}

/** The branches a spoke's base_branch line protects: its first token, plus any branch with a slash it names (never a placeholder). */
export function protectedFromSpoke(line) {
  if (!line) return []
  const value = line.replace(/^["']|["']$/g, '').trim()
  const out = new Set()
  const first = value.split(/[\s,;]+/)[0]
  if (first && /^[A-Za-z0-9._/-]+$/.test(first) && first !== 'N/A') out.add(first)
  for (const m of value.matchAll(/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+/g)) {
    if (m[0] !== 'N/A' && !m[0].startsWith('origin/') && !m[0].includes('<')) out.add(m[0])
  }
  return [...out]
}

const field = (text, key) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text.split(/\n---/)[0] ?? '')?.[1]?.trim()

/** Spokes under <root>/_command/portfolio/<front>[/<project>]/*.md that declare a path and a base_branch. */
export function spokes(root) {
  const base = join(root, '_command', 'portfolio')
  const out = []
  const walk = (dir, depth) => {
    let names = []
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of names) {
      if (e.isDirectory() && depth < 2) walk(join(dir, e.name), depth + 1)
      else if (e.isFile() && e.name.endsWith('.md') && depth >= 1) {
        try {
          const text = readFileSync(join(dir, e.name), 'utf8').slice(0, 6000)
          const path = field(text, 'path')?.split(/\s+/)[0]
          const bases = protectedFromSpoke(field(text, 'base_branch'))
          if (path && bases.length) out.push({ path: isAbsolute(path) ? path : join(root, path), bases })
        } catch {
          /* unreadable spoke: skipped */
        }
      }
    }
  }
  if (existsSync(base)) walk(base, 0)
  return out
}

/** The extra protected names for the repo at dir. */
export function extraProtected(dir, root = process.env.CLAUDE_PROJECT_DIR ?? '') {
  const out = new Set((process.env.MC_GUARD_BASES ?? '').split(',').map(s => s.trim()).filter(Boolean))
  const head = git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head) out.add(head.slice(head.indexOf('/') + 1))
  const top = git(dir, ['rev-parse', '--show-toplevel'])
  if (top && root) for (const s of spokes(root)) if (top === s.path || top.startsWith(`${s.path}/`)) s.bases.forEach(b => out.add(b))
  return [...out]
}
