// Named terminal sessions, as the app sees them. Imported by server.mjs and tools/console; it does
// nothing on import. A session is one JSON file under <home>/sessions/<name>.json, written by
// tools/hooks/session-register.sh from the hook payload Claude Code hands every session
// (session_id, transcript_path, cwd, and session_title, the name `claude -n` gave it).
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,40}$/
export const TAIL_BYTES = 4 * 1024 * 1024
export const KEEP = 40

/** A session name as a file and URL segment: lower case, anything else becomes a dash. '' when nothing is left. */
export function cleanName(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 41).replace(/[-.]+$/, '')
  return NAME_RE.test(s) ? s : ''
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

/** One registry entry, or null when the name is not valid, the file is missing or it is not a session. */
export function readSession(dir, name, alive = pidAlive) {
  const n = cleanName(name)
  if (!n || n !== name) return null
  try {
    const e = JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf8'))
    if (typeof e.session_id !== 'string' || typeof e.transcript_path !== 'string') return null
    return { name: n, session_id: e.session_id, transcript_path: e.transcript_path, cwd: String(e.cwd ?? ''), role: String(e.role ?? 'flight'), pid: Number.isInteger(e.pid) ? e.pid : 0, tmux_pane: String(e.tmux_pane ?? ''), at: String(e.at ?? ''), alive: alive(e.pid) }
  } catch {
    return null
  }
}

export function listSessions(dir, alive = pidAlive) {
  let files = []
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  return files.filter(f => f.endsWith('.json')).map(f => readSession(dir, f.slice(0, -5), alive)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
}

// The app's own link carries its token: never send it back into a page.
export function redact(text, secret) {
  let out = secret ? text.split(secret).join('<token>') : text
  out = out.replace(/([?&]t=)[0-9a-f]{16,}/gi, '$1<token>').replace(/\b[0-9a-f]{48}\b/gi, '<token>')
  return out
}

const textOf = content => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
}

/** The last KEEP messages of a transcript, as {role, text}: what the founder typed and what the session said. */
export function messagesFrom(file, secret = '') {
  let text = ''
  try {
    const size = statSync(file).size
    const start = Math.max(0, size - TAIL_BYTES)
    const fd = openSync(file, 'r')
    try {
      const buf = Buffer.alloc(size - start)
      readSync(fd, buf, 0, buf.length, start)
      text = buf.toString('utf8')
    } finally {
      closeSync(fd)
    }
    // A tail starts mid-line: its first line is partial and goes.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)
  } catch {
    return []
  }
  const out = []
  for (const line of text.split('\n')) {
    if (!line) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain || e.isMeta) continue
    const t = textOf(e.message?.content).trim()
    if (!t) continue
    const clean = redact(t, secret)
    out.push({ role: e.type, text: clean.length > 6000 ? `${clean.slice(0, 6000)}\n…` : clean })
  }
  return out.slice(-KEEP)
}
