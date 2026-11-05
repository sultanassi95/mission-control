// The Mission Control App's local server: one per machine, on 127.0.0.1. It shows named terminal
// sessions (registered by tools/hooks/session-register.sh) by reading their transcripts, types into
// the ones that run in tmux, and serves shared files and uploads. Started by tools/console; node
// standard library only.
//
// Security: every data request (/sessions.json, /s/<name>/..., /upload, /file, /files.json) needs either
// the app token (kept 0600 in the app home, sent from the page's localStorage) or, through
// `tailscale serve`, the signed-in Tailscale identity of this Mac's owner (serve sets that header
// itself); the Host header must be loopback or a Tailscale name (DNS rebinding); a POST must come
// from this page's own origin (cross-site requests).

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync, unlinkSync, linkSync, renameSync, statSync } from 'node:fs'
import { join, dirname, normalize, extname } from 'node:path'
import { homedir } from 'node:os'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { FILE_MAX, TOO_LARGE, FILE_ROUTE, SERVED, classify, prune } from './uploads.mjs'
import { readShares, resolveFile } from './files.mjs'
import { capture, menuOf, paneAlive, sendKey, sendText } from './tmux.mjs'
import { cleanName, listSessions, messagesFrom, readSession } from './sessions.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(here, 'public')
const PORT = Number(process.env.MCAPP_PORT ?? 4777)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' }

// The app home: the token, the session registry, uploads and the share list. Private to this user.
const HOME = process.env.MCAPP_HOME || join(homedir(), '.mission-control')
const SESSIONS = join(HOME, 'sessions')
mkdirSync(SESSIONS, { recursive: true, mode: 0o700 })
chmodSync(HOME, 0o700)
chmodSync(SESSIONS, 0o700)

// One token for the machine. The first start writes it; deleting the file revokes it at the next start.
const TOKEN = (() => {
  const file = join(HOME, 'app-token')
  const read = () => (existsSync(file) ? readFileSync(file, 'utf8').trim() : '')
  // Written whole to a temp file and linked into place, so nothing ever reads a half-written token.
  if (read().length < 32) {
    const tmp = `${file}.${process.pid}`
    writeFileSync(tmp, randomBytes(24).toString('hex'), { mode: 0o600 })
    try {
      if (existsSync(file) && read().length < 32) unlinkSync(file)
      linkSync(tmp, file)
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    } finally {
      unlinkSync(tmp)
    }
  }
  chmodSync(file, 0o600)
  return read()
})()

const UPLOADS = process.env.MCAPP_UPLOADS || join(HOME, 'uploads')
// The portfolio this server was cloned into (the folder above tools/ that holds the instance folder), so a
// path the page finds relative to it can be made absolute. Empty in a bare clone.
const ROOT = dirname(dirname(here))
const PORTFOLIO = existsSync(join(ROOT, '_command')) ? ROOT : ''
// The share list (share.mjs, the /share skill writes it); read on each request, so a file shared or
// revoked counts at once. No list, nothing shared.
const SHARE_FILE = process.env.MCAPP_SHARE_FILE || join(HOME, 'shared-files.json')
const shares = () => readShares(SHARE_FILE)
mkdirSync(UPLOADS, { recursive: true, mode: 0o700 })
// Old uploads go, and the folder stays under its caps, oldest first (uploads.mjs); hourly and after each upload.
prune(UPLOADS)
setInterval(() => prune(UPLOADS), 3_600_000).unref()

const REGISTRY_FILE = join(HOME, 'server.json')
function unregister() {
  try {
    if (JSON.parse(readFileSync(REGISTRY_FILE, 'utf8')).pid === process.pid) unlinkSync(REGISTRY_FILE)
  } catch {
    /* already gone */
  }
}
process.on('exit', unregister)
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => process.exit(0))

// The tailnet owner's login and this Mac's own tailnet name, read once from the local Tailscale client.
// Either empty (Tailscale absent) leaves the token as the only way in.
const TAILNET = await new Promise(resolve => {
  const app = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
  execFile(existsSync(app) ? app : 'tailscale', ['status', '--json'], { timeout: 5000 }, (err, out) => {
    try {
      const st = JSON.parse(out)
      if (err) return resolve({ owner: '', host: '' })
      resolve({
        owner: String(st.User?.[String(st.Self?.UserID)]?.LoginName ?? '').toLowerCase(),
        host: String(st.Self?.DNSName ?? '').replace(/\.$/, '').toLowerCase(),
      })
    } catch {
      resolve({ owner: '', host: '' })
    }
  })
})

const emit = obj => process.stdout.write(`${JSON.stringify(obj)}\n`)
function same(a, b) {
  if (typeof a !== 'string') return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function hostAllowed(host, port) {
  if (!host) return false
  const name = host.replace(/:\d+$/, '').toLowerCase()
  if ((name === '127.0.0.1' || name === 'localhost') && host.endsWith(`:${port}`)) return true
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(name)
}

// The token lives in the page's localStorage (scoped to scheme, host and port, unlike a cookie,
// which every localhost port would receive) and comes back as a header, or as ?t= for the
// EventSource, which cannot set headers.
// A request through `tailscale serve` carries the viewer's Tailscale login, which serve sets and
// overwrites (a client-sent value does not survive it, checked live 2026-10-15); Funnel requests carry none.
function tailnetOwner(req) {
  const host = String(req.headers.host ?? '').toLowerCase()
  // Only this Mac's own tailnet name; a local process can still set both headers, but it can already read the token.
  return TAILNET.owner !== '' && TAILNET.host !== '' && host === TAILNET.host && String(req.headers['tailscale-user-login'] ?? '').toLowerCase() === TAILNET.owner
}

function authorised(req, url) {
  return tailnetOwner(req) || same(req.headers['x-mcapp-token'], TOKEN) || same(url.searchParams.get('t') ?? undefined, TOKEN)
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    ...headers,
  })
  res.end(body)
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', c => {
      size += c.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
  const file = normalize(join(PUBLIC, rel))
  if (!file.startsWith(PUBLIC + '/') || !existsSync(file)) return send(res, 404, 'not found')
  const body = await readFile(file)
  send(res, 200, body, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  })
}

function handler(port) {
  return async (req, res) => {
    if (!hostAllowed(req.headers.host, port)) return send(res, 421, 'host not allowed')
    let url
    try {
      url = new URL(req.url ?? '/', 'http://app.invalid')
    } catch {
      return send(res, 400, 'bad request')
    }

    // /s/<name>/ is one session's page; it carries no secrets, its data routes below need the token.
    if (req.method === 'GET' && /^\/s\/[^/]+$/.test(url.pathname)) return send(res, 302, '', { Location: `${url.pathname}/` })
    if (req.method === 'GET' && /^\/s\/[^/]+\/$/.test(url.pathname)) return serveStatic(res, '/session.html').then(() => undefined, () => send(res, 500, 'error'))
    // The page and its scripts carry no secrets and are public; every data endpoint needs the token.
    const isData = url.pathname === '/sessions.json' || /^\/s\/[^/]+\/(state\.json|events|screen|send|key)$/.test(url.pathname) || url.pathname === '/upload' || url.pathname.startsWith('/upload/') || url.pathname === '/file' || url.pathname === '/file-ticket' || url.pathname === '/files.json'
    if (req.method === 'GET' && !isData) return serveStatic(res, url.pathname).then(() => undefined, () => send(res, 500, 'error'))
    // A file opened as itself (a PDF, an HTML report) comes with a single-use ticket instead of the token, so no URL carries the token.
    if (url.pathname === '/file' && url.searchParams.has('ticket') && req.method === 'GET') return serveTicket(res, url.searchParams.get('ticket'))
    if (!authorised(req, url)) return send(res, 401, 'token required: open the URL the console printed')

    if (req.method === 'POST') {
      const origin = req.headers.origin
      const expected = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
      const tailnet = origin && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(origin) && new URL(origin).host === req.headers.host
      if (!origin || (!expected.includes(origin) && !tailnet)) return send(res, 403, 'foreign origin')
    }

    if (url.pathname === '/sessions.json') {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed')
      return send(res, 200, JSON.stringify({ sessions: listSessions(SESSIONS).map(({ name, cwd, role, alive, tmux_pane }) => ({ name, cwd, role, alive, tmux: tmux_pane !== '' })) }), { 'Content-Type': 'application/json' })
    }
    const drive = /^\/s\/([^/]+)\/(screen|send|key)$/.exec(url.pathname)
    if (drive) return driveSession(req, res, drive[1], drive[2])
    const sess = /^\/s\/([^/]+)\/(state\.json|events)$/.exec(url.pathname)
    if (sess) {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed')
      const known = sessionState(sess[1])
      if (!known) return send(res, 404, `no session named ${sess[1].slice(0, 41)}: start it with claude -n <name>, or run /console app --code <name> inside it`)
      if (sess[2] === 'state.json') return send(res, 200, JSON.stringify(known), { 'Content-Type': 'application/json' })
      return streamSession(req, res, sess[1])
    }

    if (req.method === 'POST' && url.pathname === '/upload') return receiveUpload(req, res)
    if (req.method === 'POST' && url.pathname === '/file-ticket') return issueTicket(req, res)
    if (req.method === 'POST') return send(res, 404, 'not found')

    if (url.pathname === '/file' && (req.method === 'GET' || req.method === 'HEAD')) return serveFile(req, res, url.searchParams.get('path'))
    if (req.method !== 'GET') return send(res, 405, 'method not allowed')
    if (url.pathname === '/files.json') return send(res, 200, JSON.stringify(PORTFOLIO ? { portfolio: PORTFOLIO } : {}), { 'Content-Type': 'application/json' })
    const stored = FILE_ROUTE.exec(url.pathname)
    if (stored) {
      const file = join(UPLOADS, `${stored[1]}.${stored[2]}`)
      if (!existsSync(file)) return send(res, 404, 'that file is gone')
      // Ids are random and a stored file never changes, so the phone may keep it rather than refetch on every repaint.
      return send(res, 200, await readFile(file), { 'Content-Type': SERVED[stored[2]], 'Cache-Control': 'private, max-age=604800, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox" })
    }
    return send(res, 404, 'not found')
  }
}

// The session's terminal, for sessions that run in tmux: what is on its screen (and the numbered menu
// on it, a permission prompt or a question), text typed into it, and one menu key pressed.
async function driveSession(req, res, name, what) {
  if (what === 'screen' ? req.method !== 'GET' : req.method !== 'POST') return send(res, 405, 'method not allowed')
  const e = readSession(SESSIONS, name)
  if (!e || cleanName(name) !== name) return send(res, 404, `no session named ${name.slice(0, 41)}`)
  if (!e.tmux_pane) return send(res, 409, `this session is not running in tmux, so the app can only read it. Reopen it with: node tools/console app --code ${e.name}`)
  const target = { pane: e.tmux_pane, socket: e.tmux_socket, pid: e.pid }
  if (!e.alive || !(await paneAlive(target))) return send(res, 410, 'this session has ended')
  try {
    if (what === 'screen') {
      const screen = await capture(target)
      return send(res, 200, JSON.stringify({ screen, menu: menuOf(screen) }), { 'Content-Type': 'application/json' })
    }
    let body
    try {
      body = JSON.parse(await readBody(req, 16 * 1024))
    } catch {
      return send(res, 400, 'bad json')
    }
    if (what === 'send') {
      if (typeof body?.text !== 'string' || body.text.length === 0 || body.text.length > 8000) return send(res, 400, 'send is {text}, 1 to 8000 characters')
      await sendText(target, body.text)
    } else {
      if (typeof body?.key !== 'string') return send(res, 400, 'key is {key}')
      await sendKey(target, body.key)
    }
    return send(res, 202, '{}', { 'Content-Type': 'application/json' })
  } catch (err) {
    return send(res, err.message === 'key not allowed' ? 400 : 502, err.message === 'key not allowed' ? 'key not allowed' : 'tmux did not take that')
  }
}

// One session as the app shows it: who it is, whether its process still runs, and its last messages.
// null when no session of that name is registered.
const bound = new Set()
// A transcript is re-read only when its size or mtime changed, so open streams cost a stat per second.
const msgCache = new Map()
function cachedMessages(file) {
  let key = ''
  try {
    const st = statSync(file)
    key = `${st.size}:${st.mtimeMs}`
  } catch {
    return []
  }
  const hit = msgCache.get(file)
  if (hit?.key === key) return hit.messages
  const messages = messagesFrom(file, TOKEN)
  msgCache.set(file, { key, messages })
  if (msgCache.size > 64) msgCache.delete(msgCache.keys().next().value)
  return messages
}
function sessionState(name) {
  const e = readSession(SESSIONS, name)
  if (!e || cleanName(name) !== name) return null
  const key = `${e.name} ${e.session_id}`
  if (!bound.has(key)) {
    bound.add(key)
    process.stderr.write(`session bound ${e.name} ${e.session_id}\n`)
  }
  return {
    session: { name: e.name, session_id: e.session_id, cwd: e.cwd, role: e.role, started: e.at, alive: e.alive, tmux: e.tmux_pane !== '' },
    messages: cachedMessages(e.transcript_path),
  }
}

// The session's state as an event stream: sent at once, then again whenever the transcript or the
// session's liveness changes (checked each second; a transcript is a file, not an event source).
function streamSession(req, res, name) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
  let last = ''
  const push = () => {
    const st = sessionState(name)
    const body = JSON.stringify(st ?? { gone: true })
    if (body !== last) {
      last = body
      res.write(`data: ${body}\n\n`)
    }
  }
  push()
  const poll = setInterval(push, 1000)
  const ping = setInterval(() => res.write(': ping\n\n'), 20000)
  res.on('close', () => {
    clearInterval(poll)
    clearInterval(ping)
  })
}

// A file a session wrote on this Mac, read-only, when it lies under an allowed root (files.mjs).
// Every refusal of a path is the same 404, so a request learns nothing about a path it may not read.
async function serveFile(req, res, requested) {
  const got = resolveFile(requested, shares())
  if (!got.file) return send(res, got.status, got.status === 415 ? 'not a file the app shows' : got.status === 413 ? 'that file is too large to show' : 'not found')
  // The length is the bytes read, so a file still being written is never sent short or long.
  const body = await readFile(got.file)
  return send(res, 200, req.method === 'HEAD' ? '' : body, fileHeaders(got, body.length))
}

// What every file response carries besides send()'s own: its type and length, its lock-down policy,
// and a resource policy so no other site can load it, even from the owner's own tailnet device.
const fileHeaders = (got, length) => ({ 'Content-Type': got.type, 'Content-Length': String(length), 'Content-Security-Policy': got.policy, 'Cross-Origin-Resource-Policy': 'same-origin' })

// Single-use tickets for opening one file as itself, by ticket: the file's path and when it was issued.
const tickets = new Map()
const TICKET_TTL = 60_000

async function issueTicket(req, res) {
  let path
  try {
    path = JSON.parse(await readBody(req, 8 * 1024))?.path
  } catch {
    return send(res, 400, 'bad json')
  }
  const got = resolveFile(path, shares())
  if (!got.file) return send(res, got.status, 'not found')
  const now = Date.now()
  for (const [k, t] of tickets) if (now - t.at > TICKET_TTL) tickets.delete(k)
  const ticket = randomBytes(16).toString('hex')
  tickets.set(ticket, { path: got.file, at: now })
  return send(res, 200, JSON.stringify({ ticket }), { 'Content-Type': 'application/json' })
}

// A ticket opens its one file once, within a minute; the file is checked against the roots again.
async function serveTicket(res, ticket) {
  const t = tickets.get(String(ticket))
  tickets.delete(String(ticket))
  if (!t || Date.now() - t.at > TICKET_TTL) return send(res, 404, 'that link has been used or has expired; open the file again from the app')
  const got = resolveFile(t.path, shares())
  if (!got.file) return send(res, got.status, 'not found')
  const body = await readFile(got.file)
  return send(res, 200, body, fileHeaders(got, body.length))
}

// Stores one file from the app. Its type comes from its own bytes (uploads.mjs, classify); a text
// file's extension, which bytes cannot tell, comes from the x-mcapp-ext header the page sends.
async function receiveUpload(req, res) {
  if (Number(req.headers['content-length'] ?? 0) > FILE_MAX) {
    send(res, 413, TOO_LARGE, { Connection: 'close' })
    req.resume()
    return
  }
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > FILE_MAX) {
      // Answer, then drain the rest, so the client reads the 413 instead of a reset connection.
      send(res, 413, TOO_LARGE, { Connection: 'close' })
      req.resume()
      return
    }
    chunks.push(c)
  }
  const body = Buffer.concat(chunks)
  const { ext, reason } = classify(body, req.headers['x-mcapp-ext'])
  if (!ext) return send(res, 415, reason)
  const id = randomBytes(12).toString('hex')
  const file = join(UPLOADS, `${id}.${ext}`)
  writeFileSync(file, body, { mode: 0o600 })
  prune(UPLOADS)
  return send(res, 201, JSON.stringify({ id: `${id}.${ext}`, path: file }), { 'Content-Type': 'application/json' })
}


function serve(port, onReady, onError) {
  const server = createServer()
  const handle = handler(port)
  server.on('request', (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'error')
      else res.end()
    })
  })
  server.once('error', onError)
  server.listen(port, '127.0.0.1', () => onReady(server))
}

process.on('unhandledRejection', err => process.stderr.write(`mcapp: unhandled ${String(err).slice(0, 200)}\n`))
process.on('uncaughtException', err => process.stderr.write(`mcapp: uncaught ${String(err).slice(0, 200)}\n`))

// One server per machine: a second start finds the port taken and says so.
serve(
  PORT,
  () => {
    const tmp = `${REGISTRY_FILE}.${process.pid}`
    writeFileSync(tmp, JSON.stringify({ port: PORT, pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 })
    renameSync(tmp, REGISTRY_FILE)
    emit({ type: 'ready', port: PORT })
  },
  err => {
    process.stderr.write(err.code === 'EADDRINUSE' ? `mcapp: port ${PORT} is taken: the app is already running (tools/console app stop), or set MCAPP_PORT\n` : `mcapp: ${err.message}\n`)
    process.exit(err.code === 'EADDRINUSE' ? 3 : 1)
  },
)
