// The Mission Control App's local server. Started by the mission-fleet mod
// (`/console app`), never on its own: it serves the app on 127.0.0.1 only,
// streams the fleet state to the browser, and hands the browser's actions to
// the mod as one JSON line each on stdout. Node standard library only.
//
// One server runs per Claude profile (work, personal, or any other). Each registers in
// ~/.mission-control/flights and also tries to hold the shared front-door port;
// whichever holds it serves the app and routes /p/<profile>/* to that profile's
// server, so the front door survives any one session closing.
//
// Security: every data request (/op, /events, /state.json, /flights.json, /p/*) needs either the
// shared app token (kept 0600 beside the registry, sent from the page's localStorage) or, through
// `tailscale serve`, the signed-in Tailscale identity of this Mac's owner (serve sets that header
// itself); the Host header must be loopback or a Tailscale name (DNS rebinding); a POST must come
// from this page's own origin (cross-site requests); the bridge endpoint takes the mod's own key.

import { createServer, request as httpRequest } from 'node:http'
import { readFile, watch } from 'node:fs/promises'
import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync, readdirSync, unlinkSync, linkSync, renameSync } from 'node:fs'
import { join, dirname, normalize, extname, basename } from 'node:path'
import { homedir } from 'node:os'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { FILE_MAX, TOO_LARGE, FILE_ROUTE, SERVED, classify, prune } from './uploads.mjs'

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
const BRIDGE_KEY = typeof secrets.key === 'string' ? secrets.key : ''
const FRONT_PORT = Number(process.env.MCAPP_PORT ?? 4777)
const OPS = new Set(['prompt', 'command', 'console', 'answer'])
const FORWARDED = new Set(['/op', '/events', '/state.json', '/upload'])
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' }

if (typeof secrets.token !== 'string' || secrets.token.length < 32 || BRIDGE_KEY.length < 32) {
  process.stderr.write('mcapp: a token and a bridge key (32+ chars each) are required as JSON on stdin\n')
  process.exit(2)
}

// The profile is the Claude config this session runs under: CLAUDE_PROFILE when the shell set it,
// else the config dir's name (~/.claude-personal -> personal), else the default config, work.
const PROFILE = (process.env.MCAPP_PROFILE || process.env.CLAUDE_PROFILE || basename(process.env.CLAUDE_CONFIG_DIR ?? '').replace(/^\.?claude-?/, '') || 'work').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'work'
const HOME = process.env.MCAPP_HOME || join(homedir(), '.mission-control')
const FLIGHTS = join(HOME, 'flights')
mkdirSync(FLIGHTS, { recursive: true, mode: 0o700 })
chmodSync(HOME, 0o700)
chmodSync(FLIGHTS, 0o700)

// One token for every profile's server, so the Mac's link survives the front door changing hands.
// The first server writes it; the rest read it. Deleting the file revokes it at the next start.
const TOKEN = (() => {
  const file = join(HOME, 'app-token')
  const read = () => (existsSync(file) ? readFileSync(file, 'utf8').trim() : '')
  // Written whole to a temp file and linked into place, so no server ever reads a half-written token.
  if (read().length < 32) {
    const tmp = `${file}.${process.pid}`
    writeFileSync(tmp, secrets.token, { mode: 0o600 })
    try {
      // Only a short (corrupt) file is replaced; one another server just wrote stays.
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

// Each profile keeps its own fallback state file; one shared path let two profiles overwrite each other.
const STATE_FILE = process.env.MCAPP_STATE_FILE ? join(dirname(process.env.MCAPP_STATE_FILE), `app-state-${PROFILE}.json`) : ''
// Uploads sit inside the portfolio beside the state file, where the session can Read them without a new permission.
const UPLOADS = process.env.MCAPP_STATE_FILE ? join(dirname(process.env.MCAPP_STATE_FILE), 'uploads') : join(HOME, 'uploads')
mkdirSync(UPLOADS, { recursive: true, mode: 0o700 })
// Old uploads go, and the folder stays under its caps, oldest first (uploads.mjs); hourly and after each upload.
prune(UPLOADS)
setInterval(() => prune(UPLOADS), 3_600_000).unref()

const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}
function flights() {
  const out = []
  for (const f of readdirSync(FLIGHTS)) {
    if (!f.endsWith('.json')) continue
    try {
      const e = JSON.parse(readFileSync(join(FLIGHTS, f), 'utf8'))
      if (typeof e.profile !== 'string' || !Number.isInteger(e.port) || !Number.isInteger(e.pid)) continue
      // A dead server's entry is removed as soon as it is seen, before its pid can be reused.
      if (alive(e.pid)) out.push(e)
      else dropStale(e)
    } catch {
      /* a file mid-write or malformed is skipped this round */
    }
  }
  return out.sort((a, b) => a.profile.localeCompare(b.profile))
}

// One Flight per profile: two would fight over the same login's state.
const holder = flights().find(e => e.profile === PROFILE && e.pid !== process.pid)
if (holder) {
  process.stdout.write(`${JSON.stringify({ type: 'refused', reason: `the ${PROFILE} profile already has an app server (pid ${holder.pid}); /console app stop in that session first` })}\n`)
  process.exit(3)
}
const REGISTRY_FILE = join(FLIGHTS, `${PROFILE}.json`)
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

let state = { at: null, fleet: null }
// Answers to Flight's questions, held until the plugin's long-poll collects them.
const answers = new Map()
const answerWaiters = new Map()
function putAnswer(id, value) {
  answers.set(id, value)
  for (const wake of answerWaiters.get(id) ?? []) wake()
  answerWaiters.delete(id)
}
const cleanAnswer = v => {
  if (!v || typeof v.id !== 'string' || !/^[a-f0-9]{8,32}$/.test(v.id) || !v.answers || typeof v.answers !== 'object') return null
  const out = {}
  for (const [q, a] of Object.entries(v.answers)) if (typeof a === 'string' && q.length <= 2000 && a.length <= 4000) out[q] = a
  return Object.keys(out).length ? { id: v.id, answers: out } : null
}
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

    // The plugin waits here for the answer to Flight's question (15 s rounds), or posts one typed at the Mac.
    if (url.pathname === '/bridge/answer') {
      if (req.method !== 'POST' || !same(req.headers['x-bridge-key'], BRIDGE_KEY)) return send(res, 403, 'forbidden')
      const id = url.searchParams.get('id')
      if (!id) {
        const got = cleanAnswer(JSON.parse((await readBody(req)) || 'null'))
        if (!got) return send(res, 400, 'bad answer')
        putAnswer(got.id, { answers: got.answers })
        return send(res, 204, '')
      }
      const take = () => {
        const got = answers.get(id)
        answers.delete(id)
        return send(res, 200, JSON.stringify(got), { 'Content-Type': 'application/json' })
      }
      if (answers.has(id)) return take()
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 15_000)
        const wake = () => {
          clearTimeout(timer)
          resolve()
        }
        answerWaiters.set(id, [...(answerWaiters.get(id) ?? []), wake])
        res.on('close', wake)
      })
      if (res.writableEnded || res.destroyed) return
      return answers.has(id) ? take() : send(res, 204, '')
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
    const isData = url.pathname === '/op' || url.pathname === '/events' || url.pathname === '/state.json' || url.pathname === '/flights.json' || url.pathname === '/upload' || url.pathname.startsWith('/upload/') || url.pathname.startsWith('/p/')
    if (req.method === 'GET' && !isData) return serveStatic(res, url.pathname).then(() => undefined, () => send(res, 500, 'error'))
    if (!authorised(req, url)) return send(res, 401, 'token required: open the URL /console app printed')

    if (req.method === 'POST') {
      const origin = req.headers.origin
      const expected = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
      const tailnet = origin && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(origin) && new URL(origin).host === req.headers.host
      if (!origin || (!expected.includes(origin) && !tailnet)) return send(res, 403, 'foreign origin')
    }

    if (url.pathname === '/flights.json') {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed')
      return send(res, 200, JSON.stringify(await flightsSummary()), { 'Content-Type': 'application/json' })
    }

    // /p/<profile>/<path>: this server's own profile is answered here, any other is forwarded to its server.
    let path = url.pathname
    const routed = /^\/p\/([a-z0-9-]+)(\/.*)$/.exec(path)
    if (routed) {
      const [, profile, rest] = routed
      if (profile !== PROFILE) {
        // Only the three data routes cross to another profile, and only by GET or POST.
        if (!FORWARDED.has(rest) && !FILE_ROUTE.test(rest)) return send(res, 404, 'not found')
        if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, 'method not allowed')
        const target = flights().find(e => e.profile === profile)
        if (!target) return send(res, 404, `no ${profile} Flight is running`)
        return forward(req, res, target.port, rest, target)
      }
      path = rest
    }

    if (req.method === 'POST' && path === '/upload') return receiveUpload(req, res)
    if (req.method === 'POST') {
      if (path !== '/op') return send(res, 404, 'not found')
      let op
      try {
        op = JSON.parse(await readBody(req))
      } catch {
        return send(res, 400, 'bad json')
      }
      if (!op || !OPS.has(op.op) || typeof op.text !== 'string' || op.text.length === 0 || op.text.length > 8000) return send(res, 400, 'op must be {op: prompt|command|console|answer, text}')
      if (op.op === 'answer') {
        let got = null
        try {
          got = cleanAnswer(JSON.parse(op.text))
        } catch {
          /* not JSON */
        }
        if (!got) return send(res, 400, 'an answer is {id, answers}')
        putAnswer(got.id, { answers: got.answers })
        return send(res, 202, JSON.stringify({ answered: got.id }), { 'Content-Type': 'application/json' })
      }
      const id = ++opSeq
      emit({ type: 'op', id, op: op.op, text: op.text, at: new Date().toISOString() })
      return send(res, 202, JSON.stringify({ id }), { 'Content-Type': 'application/json' })
    }

    if (req.method !== 'GET') return send(res, 405, 'method not allowed')
    if (path === '/events') {
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
    if (path === '/state.json') return send(res, 200, JSON.stringify(state), { 'Content-Type': 'application/json' })
    const stored = FILE_ROUTE.exec(path)
    if (stored) {
      const file = join(UPLOADS, `${stored[1]}.${stored[2]}`)
      if (!existsSync(file)) return send(res, 404, 'that file is gone')
      // Ids are random and a stored file never changes, so the phone may keep it rather than refetch on every repaint.
      return send(res, 200, await readFile(file), { 'Content-Type': SERVED[stored[2]], 'Cache-Control': 'private, max-age=604800, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox" })
    }
    return send(res, 404, 'not found')
  }
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

// Forwards an already-authorised request to another profile's server on loopback, carrying the
// shared token and that server's own origin; the response (an event stream included) is piped back.
function forward(req, res, port, path, entry) {
  const headers = { host: `127.0.0.1:${port}`, 'x-mcapp-token': TOKEN, accept: req.headers.accept ?? '*/*' }
  if (req.method === 'POST') {
    headers.origin = `http://127.0.0.1:${port}`
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']
    // A text file's extension travels as a header; without it the other profile's server refuses the file.
    if (req.headers['x-mcapp-ext']) headers['x-mcapp-ext'] = req.headers['x-mcapp-ext']
  }
  const upstream = httpRequest({ host: '127.0.0.1', port, method: req.method, path, headers }, up => {
    if (res.headersSent) return up.resume()
    res.writeHead(up.statusCode ?? 502, { 'cache-control': 'no-store', ...up.headers, 'x-content-type-options': 'nosniff' })
    up.pipe(res)
    // A server that dies mid-stream never ends its response; end ours so the browser reconnects.
    up.on('close', () => res.writableEnded || res.end())
  })
  upstream.on('error', err => {
    if (err.code === 'ECONNREFUSED') dropStale(entry)
    return res.headersSent ? res.end() : send(res, 502, 'that Flight did not answer')
  })
  res.on('close', () => upstream.destroy())
  // The front door holds the file size limit itself, so a body without a length still ends in a 413, not a 502.
  if (path === '/upload') {
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > FILE_MAX && !res.headersSent) {
        send(res, 413, TOO_LARGE, { Connection: 'close' })
        upstream.destroy()
        req.unpipe(upstream)
        req.resume()
      }
    })
  }
  req.pipe(upstream)
}

// A registered port that refuses connections belongs to a server that died without cleaning up
// (a crash or SIGKILL); its entry goes, so its pid or port being reused later cannot inherit it.
function dropStale(entry) {
  const file = join(FLIGHTS, `${entry.profile}.json`)
  try {
    const now = JSON.parse(readFileSync(file, 'utf8'))
    if (now.pid === entry.pid && now.port === entry.port) unlinkSync(file)
  } catch {
    /* already gone or replaced */
  }
}

// Every live profile with what the switcher shows: items waiting on the founder (open gates not
// yet sent to Flight, and go/no-go decisions that never reached a Controller) and whether Flight
// is working. The count is named gates for the client, which reads it as "N waiting".
async function flightsSummary() {
  const waiting = p => (p.state === 'open' && !(p.sentAt && Date.now() - Date.parse(p.sentAt) <= 10 * 60_000)) || (Boolean(p.undelivered) && (p.state === 'go' || p.state === 'no-go'))
  const summarise = s => ({ busy: Boolean(s?.fleet?.flight?.busy), gates: (s?.fleet?.poll ?? []).filter(waiting).length })
  return Promise.all(
    flights().map(async e => {
      if (e.profile === PROFILE) return { profile: e.profile, self: true, ...summarise(state) }
      try {
        const r = await fetch(`http://127.0.0.1:${e.port}/state.json`, { headers: { 'x-mcapp-token': TOKEN }, signal: AbortSignal.timeout(1500) })
        return { profile: e.profile, self: false, ...summarise(r.ok ? await r.json() : null), ...(r.ok ? {} : { unreachable: true }) }
      } catch (err) {
        if (err?.cause?.code === 'ECONNREFUSED') dropStale(e)
        return { profile: e.profile, self: false, busy: false, gates: 0, unreachable: true }
      }
    }),
  )
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

// This profile's own server: the first free port above the front door's.
function listen(port, tries = 20) {
  serve(
    port,
    () => {
      const tmp = `${REGISTRY_FILE}.${process.pid}`
      writeFileSync(tmp, JSON.stringify({ profile: PROFILE, port, pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 })
      renameSync(tmp, REGISTRY_FILE)
      emit({ type: 'ready', port, profile: PROFILE, token: TOKEN, tokenFile: join(HOME, 'app-token'), stateFile: STATE_FILE })
      holdFrontDoor()
    },
    err => {
      if (err.code === 'EADDRINUSE' && tries > 0) listen(port + 1, tries - 1)
      else {
        process.stderr.write(`mcapp: ${err.message}\n`)
        process.exit(1)
      }
    },
  )
}

// Whoever holds the front door serves every profile; the others keep trying, so when its session
// ends one of them takes over within a few seconds.
function holdFrontDoor() {
  serve(
    FRONT_PORT,
    () => emit({ type: 'front', port: FRONT_PORT }),
    () => setTimeout(holdFrontDoor, 3000),
  )
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

listen(FRONT_PORT + 1)
void watchStateFile()
