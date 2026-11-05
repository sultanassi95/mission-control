// Typing into a session from the app, over a real tmux server on a private socket: text arrives as
// typed characters, a key answers a menu, and nothing the text holds runs as a command.
// Run: node --test tools/tests/app-tmux.test.mjs   (needs tmux)
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { menuOf } from '../app/tmux.mjs'

const CONSOLE = fileURLToPath(new URL('../console', import.meta.url))
const have = spawnSync('tmux', ['-V']).status === 0
const PORT = 42000 + Math.floor(Math.random() * 9000)
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'mc-tmux-')))
const HOME = join(scratch, 'home')
const LABEL = `mct${process.pid}`
const env = { ...process.env, MCAPP_HOME: HOME, MCAPP_PORT: String(PORT) }
const tm = (...a) => spawnSync('tmux', ['-L', LABEL, ...a], { encoding: 'utf8' })
let token = ''
let pane = ''
let socket = ''
const call = (path, { method = 'GET', body, headers } = {}) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'x-mcapp-token': token, ...(method === 'POST' ? { origin: `http://127.0.0.1:${PORT}`, 'content-type': 'application/json' } : {}), ...headers } })
const register = (name, extra) => {
  mkdirSync(join(HOME, 'sessions'), { recursive: true })
  writeFileSync(join(HOME, 'sessions', `${name}.json`), JSON.stringify({ name, session_id: `sid-${name}`, transcript_path: join(scratch, 'none.jsonl'), cwd: scratch, role: 'flight', pid: process.pid, at: 'now', ...extra }))
}
const screen = async () => (await (await call('/s/t1/screen')).json()).screen
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

before(() => {
  if (!have) return
  tm('new-session', '-d', '-s', 't1', '-x', '120', '-y', '30', '-c', scratch, 'cat')
  pane = tm('display-message', '-p', '-t', 't1', '#{pane_id}').stdout.trim()
  socket = tm('display-message', '-p', '-t', 't1', '#{socket_path}').stdout.trim()
  const panePid = Number(tm('display-message', '-p', '-t', 't1', '#{pane_pid}').stdout.trim())
  register('t1', { tmux_pane: pane, tmux_socket: socket, pid: panePid })
  register('plain', {})
  const r = spawnSync(process.execPath, [CONSOLE, 'app', '--code', 't1'], { env, encoding: 'utf8' })
  token = /\?t=([0-9a-f]+)/.exec(r.stdout)?.[1] ?? ''
})
after(() => {
  spawnSync(process.execPath, [CONSOLE, 'app', 'stop'], { env })
  tm('kill-server')
  rmSync(scratch, { recursive: true, force: true })
})

const t = have ? test : test.skip

t('console app --code launches claude in tmux session mc-<name>, registers it, and reuses it on the second call', async () => {
  // A stand-in for claude: registers itself the way the hook does, from inside the pane.
  const fake = join(scratch, 'fake-claude.sh')
  writeFileSync(fake, `#!/bin/bash\nmkdir -p "$MCAPP_HOME/sessions"\nsocket="\${TMUX%%,*}"\nprintf '{"name":"%s","session_id":"sid-%s","transcript_path":"/nonexistent","cwd":"%s","pid":%s,"tmux_pane":"%s","tmux_socket":"%s"}' "$2" "$2" "$PWD" "$$" "$TMUX_PANE" "$socket" > "$MCAPP_HOME/sessions/$2.json"\nexec sleep 60\n`, { mode: 0o755 })
  const launchEnv = { ...env, MCAPP_TMUX_SOCKET: LABEL, MCAPP_CLAUDE_CMD: `bash ${fake}` }
  const run = () => spawnSync(process.execPath, [CONSOLE, 'app', '--code', 'launched'], { env: launchEnv, encoding: 'utf8', cwd: scratch })
  const first = run()
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /Started claude -n launched in tmux session mc-launched/)
  assert.match(first.stdout, /\/s\/launched\//)
  assert.equal(tm('has-session', '-t', '=mc-launched').status, 0)
  const reg = JSON.parse((await import('node:fs')).readFileSync(join(HOME, 'sessions', 'launched.json'), 'utf8'))
  assert.match(reg.tmux_pane, /^%[0-9]+$/)
  assert.equal(reg.cwd, scratch)
  const second = run()
  assert.equal(second.status, 0, second.stderr)
  assert.doesNotMatch(second.stdout, /Started claude/, 'the running session is reused, not started again')
  assert.equal(tm('list-sessions', '-F', '#{session_name}').stdout.split('\n').filter(n => n === 'mc-launched').length, 1)
})

t('a message typed in the app reaches the pane', async () => {
  assert.ok(token, 'the app started')
  assert.equal((await call('/s/t1/send', { method: 'POST', body: { text: 'hello from the phone' } })).status, 202)
  assert.ok(await until(async () => (await screen()).includes('hello from the phone')))
})

t('quotes, $(...), backticks, semicolons and newlines arrive as typed characters and run nothing', async () => {
  const marker = join(scratch, 'PWNED')
  const text = `a'b"c $(touch ${marker}) \`touch ${marker}\` ; touch ${marker} #\nsecond line\\n end`
  assert.equal((await call('/s/t1/send', { method: 'POST', body: { text } })).status, 202)
  const got = await until(async () => {
    const s = await screen()
    return s.includes('second line') && s
  })
  assert.ok(got, 'the text arrived')
  assert.ok(got.includes(`a'b"c $(touch ${marker}) \`touch ${marker}\` ; touch ${marker} #`), 'first line literal')
  assert.match(got, /(^|\n)second line\\n end/, 'second line starts its own line, its backslash-n kept as text')
  assert.equal(existsSync(marker), false, 'no command ran')
})

t('a menu key reaches the pane; a key off the allow-list is refused', async () => {
  assert.equal((await call('/s/t1/key', { method: 'POST', body: { key: '2' } })).status, 202)
  assert.ok(await until(async () => /(^|\n)2/.test(await screen())))
  for (const key of ['rm', 'C-c', '10', '; ls']) assert.equal((await call('/s/t1/key', { method: 'POST', body: { key } })).status, 400, key)
  assert.equal((await call('/s/t1/send', { method: 'POST', body: { text: '' } })).status, 400)
  assert.equal((await call('/s/t1/send', { method: 'POST', body: { text: 'x'.repeat(8001) } })).status, 400)
})

t('without the token it is 401, from another origin 403', async () => {
  assert.equal((await call('/s/t1/send', { method: 'POST', body: { text: 'x' }, headers: { 'x-mcapp-token': 'wrong' } })).status, 401)
  assert.equal((await call('/s/t1/send', { method: 'POST', body: { text: 'nope-foreign' }, headers: { origin: 'https://evil.example' } })).status, 403)
  assert.equal((await call('/s/t1/screen', { headers: { 'x-mcapp-token': 'wrong' } })).status, 401)
  assert.equal((await screen()).includes('nope-foreign'), false)
})

t('a session not in tmux is 409 with the way to reopen it; an unknown one is 404', async () => {
  const r = await call('/s/plain/send', { method: 'POST', body: { text: 'x' } })
  assert.equal(r.status, 409)
  assert.match(await r.text(), /tools\/console app --code plain/)
  assert.equal((await call('/s/nobody/screen')).status, 404)
})

t('a session whose pane is gone is 410', async () => {
  register('gone', { tmux_pane: '%987', tmux_socket: socket })
  assert.equal((await call('/s/gone/screen')).status, 410)
  register('badsock', { tmux_pane: pane, tmux_socket: join(scratch, 'not-a-socket') })
  assert.equal((await call('/s/badsock/screen')).status, 410, 'a path that is not a tmux socket is never handed to tmux')
})

t('a pane that exists but does not hold the session process is 410, and concurrent sends do not mix', async () => {
  // The same pane, registered with a pid that is not in it: the id was reused by something else.
  register('stale', { tmux_pane: pane, tmux_socket: socket, pid: process.pid })
  assert.equal((await call('/s/stale/screen')).status, 410)
  assert.equal((await call('/s/stale/send', { method: 'POST', body: { text: 'must-not-arrive' } })).status, 410)
  assert.equal((await screen()).includes('must-not-arrive'), false)
  // Two sends at once each arrive whole.
  await Promise.all(['alpha-one-text', 'beta-two-text'].map(text => call('/s/t1/send', { method: 'POST', body: { text } })))
  assert.ok(await until(async () => { const s = await screen(); return s.includes('alpha-one-text') && s.includes('beta-two-text') }))
})

t('control characters are stripped: an escape sequence cannot end the paste early', async () => {
  assert.equal((await call('/s/t1/send', { method: 'POST', body: { text: 'brk-a\u001b[201~brk-b' } })).status, 202)
  assert.ok(await until(async () => (await screen()).includes('brk-a[201~brk-b')))
  assert.equal((await call('/s/t1/send', { method: 'POST', body: { text: '\u001b\u0003' } })).status, 502)
})

test('menuOf reads a numbered menu, its question and the option under the cursor', () => {
  const m = menuOf(['  Bash command', '    git push origin main', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and don\'t ask again for git commands', '   3. No, and tell Claude what to do differently (esc)', '', ' Esc to cancel'].join('\n'))
  assert.equal(m.question, 'Do you want to proceed?')
  assert.deepEqual(m.options.map(o => o.key), ['1', '2', '3'])
  assert.equal(m.selected, '1')
  assert.equal(m.options[2].label, 'No, and tell Claude what to do differently (esc)')
  assert.equal(menuOf('just a prompt\n❯ \n'), null)
  assert.equal(menuOf('1. only one option'), null)
  assert.equal(menuOf('Here is my plan:\n1. refactor\n2. test\n\n❯ \n'), null, 'a plain numbered reply has no cursor on an option')
})
