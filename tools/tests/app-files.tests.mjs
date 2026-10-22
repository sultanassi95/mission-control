// Tests for the app server's /file route: a file a session wrote on the Mac, opened from the phone.
// The server starts on a scratch folder whose allowed roots are named in MCAPP_FILE_ROOTS, and every
// request goes over HTTP the way the page or a tapped link makes it.
// Run: node --test tools/tests/app-files.tests.mjs
// MCAPP_SERVER=<path to a server.mjs> runs the same requests against another copy of the server.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SERVER = process.env.MCAPP_SERVER ?? fileURLToPath(new URL('../app/server.mjs', import.meta.url))
const TOKEN = 'filestokenfilestokenfilestoken0001'
const KEY = 'fileskeyfileskeyfileskeyfileskey01'
const FRONT = 42000 + Math.floor(Math.random() * 9000)
const ORIGIN = `http://127.0.0.1:${FRONT}`
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'mc-files-')))
const ROOT = join(scratch, 'root')
const OUTSIDE = join(scratch, 'outside')
let server

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
before(async () => {
  mkdirSync(join(ROOT, 'tasks', 'MC-1', 'evidence'), { recursive: true })
  mkdirSync(join(ROOT, 'repo', '.git'), { recursive: true })
  mkdirSync(OUTSIDE, { recursive: true })
  writeFileSync(join(ROOT, 'tasks', 'MC-1', 'report.md'), '# Report\n\n1. done\n  - sub\n')
  writeFileSync(join(ROOT, 'tasks', 'MC-1', 'evidence', 'shot.png'), PNG)
  writeFileSync(join(ROOT, 'tasks', 'MC-1', 'page.html'), '<script>parent.document.title = "owned"</script><p>report</p>')
  writeFileSync(join(ROOT, 'tasks', 'MC-1', 'notes.txt'), 'plain notes')
  writeFileSync(join(ROOT, 'tasks', 'MC-1', 'doc.pdf'), '%PDF-1.4\n%%EOF\n')
  writeFileSync(join(ROOT, 'tasks', 'MC-1', 'data.bin'), Buffer.from([0, 1, 2]))
  writeFileSync(join(ROOT, 'repo', '.env'), 'SECRET=1')
  writeFileSync(join(ROOT, 'repo', '.git', 'config'), '[core]')
  writeFileSync(join(OUTSIDE, 'secret.txt'), 'outside the roots')
  symlinkSync(join(OUTSIDE, 'secret.txt'), join(ROOT, 'tasks', 'escape.txt'))
  server = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MCAPP_PORT: String(FRONT), MCAPP_HOME: join(scratch, 'home'), MCAPP_PROFILE: 'work', MCAPP_STATE_FILE: join(scratch, 'state', 'app-state.json'), MCAPP_FILE_ROOTS: ROOT },
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

test('a file under an allowed root is served with its type, read-only and sandboxed', async () => {
  const cases = [
    ['tasks/MC-1/report.md', 'text/markdown; charset=utf-8', '# Report'],
    ['tasks/MC-1/notes.txt', 'text/plain; charset=utf-8', 'plain notes'],
    ['tasks/MC-1/page.html', 'text/html; charset=utf-8', '<p>report</p>'],
    ['tasks/MC-1/doc.pdf', 'application/pdf', '%PDF'],
  ]
  for (const [rel, type, start] of cases) {
    const r = await get(join(ROOT, rel))
    assert.equal(`${rel} ${r.status}`, `${rel} 200`)
    assert.equal(r.headers.get('content-type'), type)
    assert.match(r.headers.get('content-security-policy') ?? '', /\bsandbox\b/)
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
    assert.ok((await r.text()).includes(start), rel)
  }
  const png = await get(join(ROOT, 'tasks/MC-1/evidence/shot.png'))
  assert.equal(png.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), PNG)
})

test('an HTML report cannot run script against the app: its policy sandboxes it without scripts or same-origin', async () => {
  const csp = (await get(join(ROOT, 'tasks/MC-1/page.html'))).headers.get('content-security-policy') ?? ''
  assert.match(csp, /sandbox(;|$)/)
  assert.doesNotMatch(csp, /allow-scripts|allow-same-origin/)
  assert.match(csp, /default-src 'none'/)
})

test('a HEAD answers whether the link should show, without the body', async () => {
  const r = await get(join(ROOT, 'tasks/MC-1/report.md'), { method: 'HEAD' })
  assert.equal(r.status, 200)
  assert.equal(await r.text(), '')
  assert.equal((await get(join(ROOT, 'tasks/MC-1/missing.md'), { method: 'HEAD' })).status, 404)
})

test('anything outside the roots, a .. escape, a symlink out, a secret, a folder or a missing file is a 404', async () => {
  for (const path of [
    join(OUTSIDE, 'secret.txt'),
    `${ROOT}/tasks/../../outside/secret.txt`,
    `${ROOT}/tasks/MC-1/../report-x/../../tasks/MC-1/report.md`,
    join(ROOT, 'tasks', 'escape.txt'),
    join(ROOT, 'repo', '.env'),
    join(ROOT, 'repo', '.git', 'config'),
    join(ROOT, 'tasks'),
    join(ROOT, 'tasks', 'MC-1', 'missing.md'),
    'tasks/MC-1/report.md',
    '/etc/hosts',
    '',
  ]) {
    const r = await get(path)
    assert.equal(`${path} -> ${r.status}`, `${path} -> 404`)
    assert.doesNotMatch(await r.text(), /outside the roots|SECRET|\[core\]/)
  }
})

test('a type the app does not show is refused rather than guessed', async () => {
  assert.equal((await get(join(ROOT, 'tasks/MC-1/data.bin'))).status, 415)
})

test('the file route needs the owner\'s token or tailnet identity like every data route', async () => {
  assert.equal((await get(join(ROOT, 'tasks/MC-1/report.md'), { token: '' })).status, 401)
  assert.equal((await get(join(ROOT, 'tasks/MC-1/report.md'), { token: 'not-the-token-not-the-token-000000' })).status, 401)
  const roots = await fetch(`${ORIGIN}/files.json`)
  assert.equal(roots.status, 401)
})

test('the page learns the roots, and a profile path reaches the same files', async () => {
  const r = await fetch(`${ORIGIN}/files.json`, { headers: { 'x-mcapp-token': TOKEN } })
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { roots: [ROOT] })
  assert.equal((await get(join(ROOT, 'tasks/MC-1/report.md'), { prefix: '/p/work' })).status, 200)
  assert.equal((await get(join(ROOT, 'tasks/MC-1/report.md'), { prefix: '/p/other' })).status, 200)
})
