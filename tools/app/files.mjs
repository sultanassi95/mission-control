// Which files on this Mac the app may show, and how. Imported by server.mjs and share.mjs; it does
// nothing on import. Nothing is reachable by default: a file is served only when it is on the share
// list (written by share.mjs, the /share skill), by its real path, and it is still that regular file
// now. The name and folder rules below are a second layer: a credential is refused even if listed.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'

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
// A name that holds or may hold a credential, whatever the file: a dotenv file, a key or certificate
// file, Terraform variables or state, a tool's auth file, a service account or a Firebase admin key.
const SECRET = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks|tfvars|tfstate)(\.json|\.backup)?$/i,
  /^(id_[a-z0-9]+(\.pub)?|\.netrc|\.npmrc|\.pypirc|\.git-credentials)$/i,
  /service[-_]?account|adminsdk/i,
]
// A data file (where credentials live, unlike a report) whose name holds a credential word anywhere,
// camelCase included: apiKey.json, authtoken.txt, db-password.yml.
const DATA = new Set(['.json', '.txt', '.yml', '.yaml', '.log', '.csv'])
const SECRET_WORD = /key|secret|token|credential|passw|private/i
// Folders never served from: a repository's own, dependency trees, and folders that keep credentials.
const SKIP_DIRS = /^(\.git|node_modules|\.?secrets?|\.aws|\.ssh|\.gnupg|\.config|gcloud|launch|credentials)$/i

// The app's own home folder (its token and profile registry).
const APP_HOME_DIR = /^[.]mission-control$/i

/** Why a real path may never be shown, or '' when it may: a credential's name or folder (case-blind, as the Mac's disk is). */
function credentialReason(real) {
  const name = basename(real)
  const parts = real.split('/').slice(0, -1)
  // The instance's own state (the share list, the app's state, its uploads) and the app's home are never shown.
  if (parts.some((part, i) => (part.toLowerCase() === '_command' && parts[i + 1]?.toLowerCase() === 'fleet') || APP_HOME_DIR.test(part))) return "it is the instance's own state"
  if (parts.some(part => SKIP_DIRS.test(part))) return 'it is inside a folder that keeps credentials or a repository'
  if (SECRET.some(re => re.test(name)) || (DATA.has(extname(name).toLowerCase()) && SECRET_WORD.test(name))) return 'its name says it may hold a credential'
  return ''
}

/**
 * A path as the disk spells it, symlinks resolved and letter case the disk's own; for a path that no
 * longer exists, its folder resolved and its name kept (so a gone file can still be revoked by name).
 */
export function canonical(path) {
  try {
    return realpathSync.native(path)
  } catch {
    try {
      return join(realpathSync.native(dirname(path)), basename(path))
    } catch {
      return path
    }
  }
}

/** The share list: the real paths of the shared files, from the list file (none when it is missing or unreadable). */
export function readShares(listFile) {
  if (!listFile) return []
  try {
    const files = JSON.parse(readFileSync(listFile, 'utf8')).files
    return Array.isArray(files) ? files.filter(f => typeof f?.path === 'string') : []
  } catch {
    return []
  }
}

/**
 * The file a request names, or why not: { file, type, policy } or { status }. It is served only when
 * the path, resolved now, is a shared file's real path: a shared file that changed is served as it is
 * now; one that moved, or whose path now resolves somewhere else (a symlink put in its place), is not.
 */
export function resolveFile(requested, shares) {
  const path = String(requested ?? '')
  if (!path || !isAbsolute(path) || path.includes('\0') || path.split('/').includes('..')) return { status: 404 }
  let real
  try {
    real = realpathSync.native(path)
  } catch {
    return { status: 404 }
  }
  if (!shares.some(s => s.path === real) || credentialReason(real)) return { status: 404 }
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

/** Why a path cannot be shared, or its real path: { real } or { reason }. */
export function shareable(path) {
  if (!isAbsolute(path)) return { reason: 'give the file\'s absolute path' }
  if (path.split('/').includes('..')) return { reason: 'a path with .. is not shared; give the file\'s own path' }
  let real
  let st
  try {
    if (lstatSync(path).isSymbolicLink()) return { reason: 'that is a symlink; share the file it points to' }
    real = realpathSync.native(path)
    st = statSync(real)
  } catch {
    return { reason: 'that is not a file on this Mac' }
  }
  if (!st.isFile()) return { reason: 'that is not a file (a folder is never shared)' }
  const why = credentialReason(real)
  if (why) return { reason: `${why} (credential rule)` }
  if (!FILE_TYPES[extname(real).toLowerCase()]) return { reason: `the app does not show ${extname(real) || 'files without an extension'}` }
  if (st.size > FILE_LIMIT) return { reason: 'that file is over 25 MB' }
  return { real }
}

/** Writes the share list whole, owner-only, so a reader never sees half a file. */
export function writeShares(listFile, files) {
  if (!existsSync(dirname(listFile))) mkdirSync(dirname(listFile), { recursive: true, mode: 0o700 })
  const tmp = `${listFile}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ files }, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, listFile)
}
