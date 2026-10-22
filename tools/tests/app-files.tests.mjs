// Tests for the app server's /file route and the share list behind it: nothing on the Mac is
// reachable from the phone until it is shared, one file at a time, with tools/app/share.mjs (the
// /share skill). The server starts on a scratch folder (MCAPP_SHARE_FILE names its share list),
// files are shared and revoked by running the real script, and every request goes over HTTP the
// way the page or a tapped link makes it.
// Run: node --test tools/tests/app-files.tests.mjs
// MCAPP_SERVER=<path to a server.mjs> runs the same requests against another copy of the server.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SERVER = process.env.MCAPP_SERVER ?? fileURLToPath(new URL('../app/server.mjs', import.meta.url))
const SHARE = fileURLToPath(new URL('../app/share.mjs', import.meta.url))
const TOKEN = 'filestokenfilestokenfilestoken0001'
const KEY = 'fileskeyfileskeyfileskeyfileskey01'
const FRONT = 42000 + Math.floor(Math.random() * 9000)
const ORIGIN = `http://127.0.0.1:${FRONT}`
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'mc-files-')))
const ROOT = join(scratch, 'root')
const OUTSIDE = join(scratch, 'outside')
const LIST = join(scratch, 'state', 'shared-files.json')
const DIR = join(ROOT, 'tasks', 'MC-1')
let server

// The /share skill, as the founder or Flight runs it: exit status and what it printed.
const share = (...args) => {
  const r = spawnSync(process.execPath, [SHARE, ...args], { env: { ...process.env, MCAPP_SHARE_FILE: LIST }, encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
before(async () => {
  mkdirSync(join(DIR, 'evidence'), { recursive: true })
  mkdirSync(join(ROOT, 'repo', '.git'), { recursive: true })
  mkdirSync(OUTSIDE, { recursive: true })
  writeFileSync(join(DIR, 'report.md'), '# Report\n\n1. done\n  - sub\n')
  writeFileSync(join(DIR, 'unshared.md'), '# not shared')
  writeFileSync(join(DIR, 'evidence', 'shot.png'), PNG)
  writeFileSync(join(DIR, 'page.html'), '<script>parent.document.title = "owned"</script><p>report</p>')
  writeFileSync(join(DIR, 'notes.txt'), 'plain notes')
  writeFileSync(join(DIR, 'doc.pdf'), '%PDF-1.4\n%%EOF\n')
  writeFileSync(join(DIR, 'data.bin'), Buffer.from([0, 1, 2]))
  writeFileSync(join(ROOT, 'repo', '.env'), 'SECRET=1')
  writeFileSync(join(ROOT, 'repo', '.git', 'notes.md'), '# repo folder')
  writeFileSync(join(OUTSIDE, 'secret.txt'), 'outside the share list')
  symlinkSync(join(OUTSIDE, 'secret.txt'), join(DIR, 'escape.txt'))
  for (const f of ['report.md', 'evidence/shot.png', 'page.html', 'notes.txt', 'doc.pdf']) assert.equal(share(join(DIR, f)).status, 0, f)
  server = spawn(process.execPath, [SERVER], {
    // MCAPP_FILE_ROOTS was this route's first control; it is set here to show it opens nothing now.
    env: { ...process.env, MCAPP_PORT: String(FRONT), MCAPP_HOME: join(scratch, 'home'), MCAPP_PROFILE: 'work', MCAPP_STATE_FILE: join(scratch, 'state', 'app-state.json'), MCAPP_SHARE_FILE: LIST, MCAPP_FILE_ROOTS: ROOT },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  server.stdin.end(JSON.stringify({ token: TOKEN, key: KEY }))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15_000)
    const seen = new Set()
    createInterface({ input: server.stdout }).on('line', l => {
      try {
        seen.add(JSON.parse(l).type)
      } catch {
        return
      }
      if (seen.has('ready') && seen.has('front')) {
        clearTimeout(timer)
        resolve()
      }
    })
    server.on('exit', code => reject(new Error(`server exited ${code}`)))
  })
})

after(() => {
  server?.kill('SIGTERM')
  rmSync(scratch, { recursive: true, force: true })
})

const get = (path, { token = TOKEN, method = 'GET', prefix = '' } = {}) =>
  fetch(`${ORIGIN}${prefix}/file?path=${encodeURIComponent(path)}`, { method, headers: token ? { 'x-mcapp-token': token } : {} })
const status = async path => `${path.slice(scratch.length)} -> ${(await get(path)).status}`

test('nothing is reachable by default: a file in a folder the route once allowed is a 404 until it is shared', async () => {
  assert.equal(await status(join(DIR, 'unshared.md')), `${join(DIR, 'unshared.md').slice(scratch.length)} -> 404`)
  assert.equal(await status(join(OUTSIDE, 'secret.txt')), `${join(OUTSIDE, 'secret.txt').slice(scratch.length)} -> 404`)
})

test('a shared file is served; revoked, it is a 404 again; shared again, it is back', async () => {
  const path = join(DIR, 'unshared.md')
  const shared = share(path)
  assert.equal(shared.status, 0, shared.out)
  assert.match(shared.out, /view\.html#/)
  assert.equal((await get(path)).status, 200)
  const revoked = share('--revoke', path)
  assert.equal(revoked.status, 0, revoked.out)
  assert.equal((await get(path)).status, 404)
  assert.equal(share(path).status, 0)
  assert.equal((await get(path)).status, 200)
  share('--revoke', path)
})

test('--list prints each shared file, and the list lives in the share file, not the repo', () => {
  const listed = share('--list')
  assert.equal(listed.status, 0)
  for (const f of ['report.md', 'page.html', 'doc.pdf']) assert.match(listed.out, new RegExp(join(DIR, f).replace(/[/.]/g, '\\$&')))
  assert.ok(JSON.parse(readFileSync(LIST, 'utf8')).files.some(f => f.path === join(DIR, 'report.md')))
})

test('the skill refuses to share a symlink, a folder, a missing file, a type the app does not show, or anything that may hold a credential', () => {
  for (const [path, why] of [
    [join(DIR, 'escape.txt'), 'symlink'],
    [DIR, 'not a file'],
    [join(DIR, 'missing.md'), 'not a file'],
    [join(DIR, 'data.bin'), 'does not show'],
    [join(ROOT, 'repo', '.env'), 'credential'],
    [join(ROOT, 'repo', '.git', 'notes.md'), 'credential'],
    ['relative/path.md', 'absolute'],
  ]) {
    const r = share(path)
    assert.notEqual(r.status, 0, `${path}: ${r.out}`)
    assert.match(r.out, new RegExp(why), path)
  }
})

test('a shared file that changes is served as it is now; one that moves, or whose path now resolves elsewhere, is a 404', async () => {
  const path = join(DIR, 'live.md')
  writeFileSync(path, '# first')
  assert.equal(share(path).status, 0)
  writeFileSync(path, '# second')
  assert.equal(await (await get(path)).text(), '# second')
  renameSync(path, join(DIR, 'moved.md'))
  assert.equal((await get(path)).status, 404)
  assert.equal((await get(join(DIR, 'moved.md'))).status, 404)
  // Put back as a symlink to a file outside: the shared path now resolves elsewhere.
  symlinkSync(join(OUTSIDE, 'secret.txt'), path)
  assert.equal((await get(path)).status, 404)
  assert.equal((await get(join(OUTSIDE, 'secret.txt'))).status, 404)
  unlinkSync(path)
})

test('a credential on the list by hand is still refused: the name and folder rules stay a second layer', async () => {
  const list = JSON.parse(readFileSync(LIST, 'utf8'))
  const env = join(ROOT, 'repo', '.env')
  const git = join(ROOT, 'repo', '.git', 'notes.md')
  writeFileSync(LIST, JSON.stringify({ files: [...list.files, { path: env, at: 'x' }, { path: git, at: 'x' }] }))
  try {
    assert.equal((await get(env)).status, 404)
    assert.equal((await get(git)).status, 404)
  } finally {
    writeFileSync(LIST, JSON.stringify(list))
  }
})

test('a shared file is served with its type, read-only and locked down; HTML is sandboxed with no scripts', async () => {
  const cases = [
    ['report.md', 'text/markdown; charset=utf-8', '# Report'],
    ['notes.txt', 'text/plain; charset=utf-8', 'plain notes'],
    ['page.html', 'text/html; charset=utf-8', '<p>report</p>'],
    ['doc.pdf', 'application/pdf', '%PDF'],
  ]
  for (const [rel, type, start] of cases) {
    const r = await get(join(DIR, rel))
    assert.equal(`${rel} ${r.status}`, `${rel} 200`)
    assert.equal(r.headers.get('content-type'), type)
    const csp = r.headers.get('content-security-policy') ?? ''
    assert.match(csp, /default-src 'none'/)
    if (type === 'application/pdf') assert.doesNotMatch(csp, /sandbox/)
    else assert.match(csp, /sandbox$/)
    assert.doesNotMatch(csp, /allow-scripts|allow-same-origin/)
    assert.ok((await r.text()).includes(start), rel)
  }
  const png = await get(join(DIR, 'evidence/shot.png'))
  assert.equal(png.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), PNG)
})

test('every file response, HEAD included, refuses other sites, referrers and sniffing; HEAD has no body', async () => {
  for (const method of ['GET', 'HEAD']) {
    const r = await get(join(DIR, 'report.md'), { method })
    assert.equal(r.status, 200, method)
    assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin', method)
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer', method)
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', method)
    if (method === 'HEAD') assert.equal(await r.text(), '')
  }
  assert.equal((await get(join(DIR, 'missing.md'), { method: 'HEAD' })).status, 404)
})

test('a .. in the path is a 404 even when it lands on a shared file', async () => {
  assert.equal((await get(`${DIR}/evidence/../report.md`)).status, 404)
  assert.equal((await get('')).status, 404)
})

test('the file route needs the owner\'s token or tailnet identity like every data route, under any profile path', async () => {
  assert.equal((await get(join(DIR, 'report.md'), { token: '' })).status, 401)
  assert.equal((await get(join(DIR, 'report.md'), { token: 'not-the-token-not-the-token-000000' })).status, 401)
  assert.equal((await fetch(`${ORIGIN}/files.json`)).status, 401)
  assert.equal((await get(join(DIR, 'report.md'), { prefix: '/p/work' })).status, 200)
  assert.equal((await get(join(DIR, 'report.md'), { prefix: '/p/other' })).status, 200)
})

// ---- A file opened as itself takes a single-use ticket, never the token ----

const ticketFor = (path, { token = TOKEN, origin = ORIGIN } = {}) =>
  fetch(`${ORIGIN}/file-ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-mcapp-token': token } : {}), ...(origin ? { origin } : {}) }, body: JSON.stringify({ path }) })

test('a ticket opens its one shared file once, with no token in the URL, and is refused after', async () => {
  const r = await ticketFor(join(DIR, 'page.html'))
  assert.equal(r.status, 200)
  const { ticket } = await r.json()
  assert.match(ticket, /^[a-f0-9]{32}$/)
  const first = await fetch(`${ORIGIN}/file?ticket=${ticket}`)
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('referrer-policy'), 'no-referrer')
  assert.match(first.headers.get('content-security-policy') ?? '', /sandbox$/)
  assert.equal((await fetch(`${ORIGIN}/file?ticket=${ticket}`)).status, 404)
  assert.equal((await fetch(`${ORIGIN}/file?ticket=${'0'.repeat(32)}`)).status, 404)
})

test('a ticket is issued only to the owner, from the app\'s own origin, for a shared file', async () => {
  assert.equal((await ticketFor(join(DIR, 'page.html'), { token: '' })).status, 401)
  assert.equal((await ticketFor(join(DIR, 'page.html'), { origin: 'https://evil.example' })).status, 403)
  assert.equal((await ticketFor(join(DIR, 'unshared.md'))).status, 404)
  assert.equal((await ticketFor(join(OUTSIDE, 'secret.txt'))).status, 404)
})
