// Which files on this Mac the app may show, and how. Imported by server.mjs; it does nothing on import.
// A file is served only when its real path (symlinks resolved) sits under one of the allowed roots,
// it is a regular file of a type the app shows, and neither its name nor its folders are a secret's
// or a dependency tree's. Read-only.
import { readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join } from 'node:path'

export const FILE_LIMIT = 25 * 1024 * 1024
// Every file is sandboxed: no script runs and it never shares the app's origin, an HTML report included.
export const FILE_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; sandbox"
// A PDF keeps the same lock-down without the sandbox flag, which stops some browsers' PDF viewers.
export const PDF_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"
export const FILE_TYPES = {
  '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.json': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8', '.yaml': 'text/plain; charset=utf-8', '.diff': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
}
// A name that holds or may hold a credential: a word key, secret, token, credential, password or
// private (as a word between separators, so "keyboard" or "secretary" pass), a service account, a
// dotenv file, a key or certificate file, Terraform variables or state, or a tool's auth file.
const SECRET = [
  /(^|[^a-z])(keys?|secrets?|tokens?|credentials?|passwords?|passwd|private)([^a-z]|$)/i,
  /service[-_]?account/i,
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks|tfvars|tfstate)(\.json|\.backup)?$/i,
  /^(id_[a-z0-9]+(\.pub)?|\.netrc|\.npmrc|\.pypirc|\.git-credentials)$/i,
]
// Folders never served from: a repository's own, and dependency trees.
const SKIP_DIRS = new Set(['.git', 'node_modules'])

// A path's folders as a slug the way session folders under the temporary root are named (/a/b -> -a-b).
const slug = path => path.replace(/[^A-Za-z0-9]/g, '-')

/**
 * The allowed roots, each by its real path: MCAPP_FILE_ROOTS (absolute paths joined by ":") when set;
 * else the session folders of this portfolio's sessions under the temporary root (each named after
 * the folder its session ran in, which starts with the portfolio's own), and the portfolio's
 * _command/portfolio and fronts.
 */
export function fileRoots(env, portfolio, uid, tmpBase = '/private/tmp') {
  let named
  if (env.MCAPP_FILE_ROOTS) named = env.MCAPP_FILE_ROOTS.split(':').filter(Boolean)
  else if (!portfolio) named = []
  else {
    const sessions = join(tmpBase, `claude-${uid}`)
    let own = []
    try {
      own = readdirSync(sessions).filter(name => name.startsWith(slug(portfolio))).map(name => join(sessions, name))
    } catch {
      /* no sessions yet */
    }
    named = [...own, join(portfolio, '_command', 'portfolio'), join(portfolio, 'fronts')]
  }
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
  // Folder names compare without case: the Mac's disk does not tell .git from .GIT.
  if (real.split('/').some(part => SKIP_DIRS.has(part.toLowerCase())) || SECRET.some(re => re.test(basename(real)))) return { status: 404 }
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
  return { file: real, type, policy: type === 'application/pdf' ? PDF_POLICY : FILE_POLICY }
}
