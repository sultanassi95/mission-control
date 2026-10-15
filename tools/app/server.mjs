// The Mission Control App's local server. Started by the mission-fleet mod
// (`/console app`), never on its own: it serves the app on 127.0.0.1 only,
// streams the fleet state to the browser, and hands the browser's actions to
// the mod as one JSON line each on stdout. Node standard library only.
//
// Security: every data request (/op, /events, /state.json) needs either the per-start token (read
// from stdin, sent from the page's localStorage) or, through `tailscale serve`, the signed-in
// Tailscale identity of this Mac's owner (serve sets that header itself); the Host header must be loopback
// or a Tailscale name (DNS rebinding); a POST must come from this page's own
// origin (cross-site requests); the bridge endpoint takes the mod's own key.

import { createServer } from 'node:http'
import { readFile, watch } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, normalize, extname } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(here, 'public')
// The token and the bridge key arrive on stdin, never in the environment (which other local processes can read).
const secrets = await new Promise(resolve => {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', d => (raw += d))
  process.stdin.on('end', () => {
    try {
      resolve(JSON.parse(raw))
    } catch {
      resolve({})
    }
  })
})
const TOKEN = typeof secrets.token === 'string' ? secrets.token : ''
const BRIDGE_KEY = typeof secrets.key === 'string' ? secrets.key : ''
const STATE_FILE = process.env.MCAPP_STATE_FILE ?? ''
const START_PORT = Number(process.env.MCAPP_PORT ?? 4777)
const OPS = new Set(['prompt', 'command', 'console'])
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' }

if (TOKEN.length < 32 || BRIDGE_KEY.length < 32) {
  process.stderr.write('mcapp: a token and a bridge key (32+ chars each) are required as JSON on stdin\n')
  process.exit(2)
}

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

let state = { at: null, fleet: null }
const clients = new Set()
let opSeq = 0

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

function broadcast() {
  const data = `data: ${JSON.stringify(state)}\n\n`
  for (const c of clients) c.write(data)
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
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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

    // The mod pushes state here with its own key; the browser never can.
    if (url.pathname === '/bridge/state') {
      if (req.method !== 'POST' || !same(req.headers['x-bridge-key'], BRIDGE_KEY)) return send(res, 403, 'forbidden')
      try {
        state = { at: new Date().toISOString(), fleet: JSON.parse(await readBody(req, 4 * 1024 * 1024)) }
        broadcast()
        return send(res, 204, '')
      } catch {
        return send(res, 400, 'bad state')
      }
    }

    // The page and its scripts carry no secrets and are public; every data endpoint needs the token.
    const isData = url.pathname === '/op' || url.pathname === '/events' || url.pathname === '/state.json'
    if (req.method === 'GET' && !isData) return serveStatic(res, url.pathname).then(() => undefined, () => send(res, 500, 'error'))
    if (!authorised(req, url)) return send(res, 401, 'token required: open the URL /console app printed')

    if (req.method === 'POST') {
      const origin = req.headers.origin
      const expected = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
      const tailnet = origin && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(origin) && new URL(origin).host === req.headers.host
      if (!origin || (!expected.includes(origin) && !tailnet)) return send(res, 403, 'foreign origin')
      if (url.pathname !== '/op') return send(res, 404, 'not found')
      let op
      try {
        op = JSON.parse(await readBody(req))
      } catch {
        return send(res, 400, 'bad json')
      }
      if (!op || !OPS.has(op.op) || typeof op.text !== 'string' || op.text.length === 0 || op.text.length > 8000) return send(res, 400, 'op must be {op: prompt|command|console, text}')
      const id = ++opSeq
      emit({ type: 'op', id, op: op.op, text: op.text, at: new Date().toISOString() })
      return send(res, 202, JSON.stringify({ id }), { 'Content-Type': 'application/json' })
    }

    if (req.method !== 'GET') return send(res, 405, 'method not allowed')
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify(state)}\n\n`)
      clients.add(res)
      const ping = setInterval(() => res.write(': ping\n\n'), 20000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(res)
      })
      return
    }
    if (url.pathname === '/state.json') return send(res, 200, JSON.stringify(state), { 'Content-Type': 'application/json' })
    return send(res, 404, 'not found')
  }
}

function listen(port, tries = 20) {
  const server = createServer()
  const handle = handler(port)
  server.on('request', (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'error')
      else res.end()
    })
  })
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && tries > 0) listen(port + 1, tries - 1)
    else {
      process.stderr.write(`mcapp: ${err.message}\n`)
      process.exit(1)
    }
  })
  server.listen(port, '127.0.0.1', () => emit({ type: 'ready', port }))
}

// The file fallback: if the mod cannot reach loopback over http, it writes the state to a file.
async function watchStateFile() {
  if (!STATE_FILE) return
  const load = async () => {
    try {
      state = { at: new Date().toISOString(), fleet: JSON.parse(await readFile(STATE_FILE, 'utf8')) }
      broadcast()
    } catch {
      /* the file is written whole by the mod; a partial read is retried on the next event */
    }
  }
  await load()
  const name = STATE_FILE.slice(STATE_FILE.lastIndexOf('/') + 1)
  try {
    // Watch the folder, not the file: the file appears only once the mod falls back to it.
    for await (const ev of watch(dirname(STATE_FILE))) if (ev.filename === name) await load()
  } catch {
    /* the folder is missing: the http bridge still works */
  }
}

process.on('unhandledRejection', err => process.stderr.write(`mcapp: unhandled ${String(err).slice(0, 200)}\n`))
process.on('uncaughtException', err => process.stderr.write(`mcapp: uncaught ${String(err).slice(0, 200)}\n`))

listen(START_PORT)
void watchStateFile()
