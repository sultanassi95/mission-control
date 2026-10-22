// Which files on this Mac the app may show, and how. Imported by server.mjs; it does nothing on import.
// A file is served only when its real path (symlinks resolved) sits under one of the allowed roots,
// it is a regular file of a type the app shows, and its name is not a secret's. Read-only.
import { realpathSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join } from 'node:path'

export const FILE_LIMIT = 25 * 1024 * 1024
// Every file is sandboxed: no script runs and it never shares the app's origin, an HTML report included.
export const FILE_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; sandbox"
export const FILE_TYPES = {
  '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.json': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8', '.yaml': 'text/plain; charset=utf-8', '.diff': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
}
// Names that hold credentials, and a repository's own folder, are never served whatever root holds them.
const SECRET = /^(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore)|id_[a-z0-9]+(\.pub)?|\.netrc|\.npmrc|\.pypirc|credentials(\.json)?)$/i

/**
 * The allowed roots, each by its real path: MCAPP_FILE_ROOTS (absolute paths joined by ":") when set,
 * else this user's session scratchpads, the portfolio's _command/portfolio and its fronts.
 */
export function fileRoots(env, portfolio, uid) {
  const named = env.MCAPP_FILE_ROOTS
    ? env.MCAPP_FILE_ROOTS.split(':').filter(Boolean)
    : [`/private/tmp/claude-${uid}`, ...(portfolio ? [join(portfolio, '_command', 'portfolio'), join(portfolio, 'fronts')] : [])]
  const real = []
  for (const r of named) {
    if (!isAbsolute(r)) continue
    try {
      const p = realpathSync(r)
      if (statSync(p).isDirectory() && !real.includes(p)) real.push(p)
    } catch {
      /* a root that does not exist yet serves nothing */
    }
  }
  return real
}

/** The file a request names, or why not: { file, type, size } or { status }. Only absolute paths are taken. */
export function resolveFile(requested, roots) {
  const path = String(requested ?? '')
  if (!path || !isAbsolute(path) || path.includes('\0') || path.split('/').includes('..')) return { status: 404 }
  let real
  try {
    real = realpathSync(path)
  } catch {
    return { status: 404 }
  }
  if (!roots.some(r => real.startsWith(`${r}/`))) return { status: 404 }
  if (real.split('/').includes('.git') || SECRET.test(basename(real))) return { status: 404 }
  let st
  try {
    st = statSync(real)
  } catch {
    return { status: 404 }
  }
  if (!st.isFile()) return { status: 404 }
  const type = FILE_TYPES[extname(real).toLowerCase()]
  if (!type) return { status: 415 }
  if (st.size > FILE_LIMIT) return { status: 413 }
  return { file: real, type, size: st.size }
}
