// Named terminal sessions in the app, end to end on scratch folders: the hook registers each session
// from a real hook payload, tools/console starts the one server, and the server answers per name.
// Run: node --test tools/tests/app-sessions.test.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const TOOLS = fileURLToPath(new URL('..', import.meta.url))
const HOOK = join(TOOLS, 'hooks', 'session-register.sh')
const CONSOLE = join(TOOLS, 'console')
const PORT = 42000 + Math.floor(Math.random() * 9000)
const scratch = mkdtempSync(join(tmpdir(), 'mc-sessions-'))
const HOME = join(scratch, 'home')
// No test here may start a real tmux or claude: the launch path is tested in app-tmux.test.mjs on a private socket.
const env = { ...process.env, MCAPP_HOME: HOME, MCAPP_PORT: String(PORT), MCAPP_TMUX: join(scratch, 'no-tmux') }

const line = (type, text, extra = {}) => JSON.stringify({ type, message: { role: type, content: type === 'user' ? text : [{ type: 'text', text }] }, ...extra })
const transcript = (name, lines) => {
  const f = join(scratch, `${name}.jsonl`)
  writeFileSync(f, lines.join('\n') + '\n')
  return f
}
// What Claude Code hands a hook (probed live 2026-11-04): session_id, transcript_path, cwd, session_title.
const register = (payload, event = 'SessionStart') => spawnSync('bash', [HOOK], { input: JSON.stringify({ hook_event_name: event, ...payload }), env, encoding: 'utf8' })
const consoleRun = args => spawnSync(process.execPath, [CONSOLE, ...args], { env, encoding: 'utf8' })
let token = ''
const get = (path, headers = { 'x-mcapp-token': token }) => fetch(`http://127.0.0.1:${PORT + 1}${path}`, { headers })

before(() => {
  mkdirSync(HOME, { recursive: true })
  const a = transcript('alpha', [line('user', 'alpha question'), line('assistant', 'alpha answer'), line('assistant', 'side chain', { isSidechain: true })])
  const b = transcript('beta', [line('user', 'beta question'), line('assistant', 'beta answer')])
  assert.equal(register({ session_id: 'sid-alpha', transcript_path: a, cwd: '/work/a', session_title: 'alpha' }).status, 0)
  assert.equal(register({ session_id: 'sid-beta', transcript_path: b, cwd: '/work/b', session_title: 'Beta' }).status, 0)
})
after(() => {
  consoleRun(['app', 'stop'])
  rmSync(scratch, { recursive: true, force: true })
})

test('the hook writes one registry file per name, private, from the payload', () => {
  const f = join(HOME, 'sessions', 'alpha.json')
  const e = JSON.parse(readFileSync(f, 'utf8'))
  assert.equal(e.session_id, 'sid-alpha')
  assert.equal(e.cwd, '/work/a')
  assert.ok(Number.isInteger(e.pid) && e.pid > 0)
  assert.equal(statSync(f).mode & 0o777, 0o600)
  // The title's case is folded into the file and URL name.
  assert.equal(JSON.parse(readFileSync(join(HOME, 'sessions', 'beta.json'), 'utf8')).session_id, 'sid-beta')
})

test('a session started without -n is bound by the /console app --code prompt', () => {
  const t = transcript('gamma', [line('user', 'hi')])
  assert.equal(register({ session_id: 'sid-gamma', transcript_path: t, cwd: '/work/g' }).status, 0)
  assert.throws(() => readFileSync(join(HOME, 'sessions', 'gamma.json')), /ENOENT/, 'no title and no command: nothing is registered')
  assert.equal(register({ session_id: 'sid-gamma', transcript_path: t, cwd: '/work/g', prompt: '/console app --code Gamma' }, 'UserPromptSubmit').status, 0)
  assert.equal(JSON.parse(readFileSync(join(HOME, 'sessions', 'gamma.json'), 'utf8')).session_id, 'sid-gamma')
})

test('the hook never fails a session: a payload it cannot read exits 0 and writes nothing', () => {
  const r = register({ session_id: '', transcript_path: '', session_title: 'zed' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  assert.throws(() => readFileSync(join(HOME, 'sessions', 'zed.json')), /ENOENT/)
})

test('console app --code starts the one server and prints the link; a second name reuses it', () => {
  const a = consoleRun(['app', '--code', 'alpha'])
  assert.equal(a.status, 0, a.stderr)
  const url = /http:\/\/127\.0\.0\.1:(\d+)\/s\/alpha\/\?t=([0-9a-f]+)/.exec(a.stdout)
  assert.ok(url, a.stdout)
  assert.equal(Number(url[1]), PORT + 1)
  token = url[2]
  const b = consoleRun(['app', '--code', 'beta'])
  assert.equal(b.status, 0, b.stderr)
  assert.match(b.stdout, new RegExp(`:${PORT + 1}/s/beta/`))
  assert.doesNotMatch(b.stdout + b.stderr, /already has an app server/)
  const log = readFileSync(join(HOME, 'server.log'), 'utf8')
  assert.equal(log.split('\n').filter(l => l.includes('"type":"ready"')).length, 1, 'one server, started once')
})

test('console app --code for a name nothing runs under launches it (here: refused, no tmux)', () => {
  const r = consoleRun(['app', '--code', 'nobody'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /tmux is not installed/)
})

test('console list prints every session with its liveness and folder', () => {
  const r = consoleRun(['list'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^alpha\talive\tflight\t\/work\/a$/m)
  assert.match(r.stdout, /^beta\talive\tflight\t\/work\/b$/m)
})

test('/s/<name>/state.json holds only that session\'s messages', async () => {
  const a = await (await get('/s/alpha/state.json')).json()
  assert.equal(a.session.name, 'alpha')
  assert.equal(a.session.session_id, 'sid-alpha')
  assert.equal(a.session.alive, true)
  assert.deepEqual(a.messages.map(m => m.text), ['alpha question', 'alpha answer'])
  const b = await (await get('/s/beta/state.json')).json()
  assert.equal(b.session.name, 'beta')
  assert.deepEqual(b.messages.map(m => m.text), ['beta question', 'beta answer'])
})

test('an unknown or malformed name is a 404 with a plain reason, never a 500', async () => {
  // A valid-looking entry one folder above sessions/ must not be reachable through a traversal name.
  writeFileSync(join(HOME, 'outside.json'), JSON.stringify({ session_id: 'x', transcript_path: join(scratch, 'alpha.jsonl'), pid: process.pid }))
  for (const name of ['nobody', '..%2Foutside', '..%2F..%2Fetc%2Fpasswd', 'A%20B', 'x'.repeat(80)]) {
    const r = await get(`/s/${name}/state.json`)
    assert.equal(r.status, 404, name)
    assert.match(await r.text(), /no session named/)
  }
})

test('every session data route needs the token; the page itself does not', async () => {
  assert.equal((await get('/s/alpha/state.json', {})).status, 401)
  assert.equal((await get('/sessions.json', {})).status, 401)
  const page = await get('/s/alpha/', {})
  assert.equal(page.status, 200)
  assert.match(await page.text(), /session\.js/)
})

test('/sessions.json lists the registered sessions', async () => {
  const r = await (await get('/sessions.json')).json()
  assert.deepEqual(r.sessions.map(s => s.name).filter(n => n !== 'gamma'), ['alpha', 'beta'])
})

test('the events stream sends the session at once and again when its transcript grows', async () => {
  const ctl = new AbortController()
  const r = await fetch(`http://127.0.0.1:${PORT + 1}/s/beta/events?t=${token}`, { signal: ctl.signal })
  assert.equal(r.status, 200)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let seen = ''
  // One read stays outstanding across waits, so a chunk that lands after a timeout is not dropped.
  let pending = null
  const until = async (needle, ms) => {
    const end = Date.now() + ms
    while (!seen.includes(needle) && Date.now() < end) {
      pending ??= reader.read()
      const got = await Promise.race([pending, new Promise(res => setTimeout(() => res(null), 500))])
      if (got) {
        pending = null
        if (got.value) seen += dec.decode(got.value)
      }
    }
    return seen.includes(needle)
  }
  assert.ok(await until('beta answer', 3000), 'first event carries the transcript')
  writeFileSync(join(scratch, 'beta.jsonl'), line('assistant', 'beta follow-up') + '\n', { flag: 'a' })
  assert.ok(await until('beta follow-up', 5000), 'a later event carries the new message')
  ctl.abort()
})

test('the server logs the bind once per session', () => {
  const log = readFileSync(join(HOME, 'server.log'), 'utf8')
  assert.equal(log.split('\n').filter(l => l === 'session bound alpha sid-alpha').length, 1)
  assert.match(log, /^session bound beta sid-beta$/m)
})
