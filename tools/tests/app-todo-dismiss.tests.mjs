// Tests for the to-do card's two actions, Dismiss and Done: the card offers both, each sends its own
// console text, and the real server hands that text to the fleet exactly as the page sent it.
// What the fleet then does with each (Done tells the Controller, Dismiss tells no one) is proven in
// register.test.ts, which feeds these same lines to the plugin.
// Run: node --test tools/tests/app-todo-dismiss.tests.mjs
// MCAPP_SERVER=<path to a server.mjs> runs the same requests against another copy of the server.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SERVER = process.env.MCAPP_SERVER ?? fileURLToPath(new URL('../app/server.mjs', import.meta.url))
const APP = readFileSync(new URL('../app/public/app.js', import.meta.url), 'utf8')
const TOKEN = 'todostokentodostokentodostoken0001'
const KEY = 'todoskeytodoskeytodoskeytodoskey01'
const FRONT = 42000 + Math.floor(Math.random() * 9000)
const ORIGIN = `http://127.0.0.1:${FRONT}`
const scratch = mkdtempSync(join(tmpdir(), 'mc-todos-'))
const lines = []
let server

before(async () => {
  server = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MCAPP_PORT: String(FRONT), MCAPP_HOME: join(scratch, 'home'), MCAPP_PROFILE: 'work', MCAPP_STATE_FILE: join(scratch, 'state', 'app-state.json') },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  server.stdin.end(JSON.stringify({ token: TOKEN, key: KEY }))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15_000)
    createInterface({ input: server.stdout }).on('line', l => {
      let msg
      try {
        msg = JSON.parse(l)
      } catch {
        return
      }
      lines.push(msg)
      if (lines.some(m => m.type === 'ready') && lines.some(m => m.type === 'front')) {
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

// The console text each card action sends, read from the click handler: case '<action>': await send('console', `<text>`).
function sentFor(action) {
  const m = new RegExp(`case '${action}': await send\\('console', \`([^\`]*)\`\\)`).exec(APP)
  return m?.[1]
}

// The op the page posts, as app.js's post() builds it.
const post = (text, token = TOKEN) =>
  fetch(`${ORIGIN}/p/work/op`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mcapp-token': token, origin: ORIGIN }, body: JSON.stringify({ op: 'console', text }) })

async function emitted(id) {
  for (let i = 0; i < 100; i++) {
    const hit = lines.find(m => m.type === 'op' && m.id === id)
    if (hit) return hit
    await new Promise(r => setTimeout(r, 20))
  }
  return undefined
}

test('the to-do card offers Dismiss beside Done, each on its own action', () => {
  const card = /function todoCard\(p\) \{([\s\S]*?)\n {2}\}/.exec(APP)?.[1] ?? ''
  assert.match(card, /data-a="tododismiss" data-v="\$\{esc\(p\.id\)\}"/)
  assert.match(card, /data-a="tododone" data-v="\$\{esc\(p\.id\)\}"/)
  assert.match(card, /class="btnrow two"/)
  assert.equal(sentFor('tododismiss'), 'dismiss-gate ${v}')
  assert.equal(sentFor('tododone'), 'done ${v}')
})

test('the server hands the fleet each action\'s text exactly as the page sent it', async () => {
  for (const [action, id] of [['tododismiss', 'MI9'], ['tododone', 'MI10']]) {
    const text = sentFor(action).replace('${v}', id)
    const r = await post(text)
    assert.equal(r.status, 202, await r.clone().text())
    const { id: opId } = await r.json()
    const line = await emitted(opId)
    assert.deepEqual({ type: line?.type, op: line?.op, text: line?.text }, { type: 'op', op: 'console', text })
  }
})

test('an op without the token reaches nothing', async () => {
  const before = lines.filter(m => m.type === 'op').length
  const r = await post('dismiss-gate MI9', 'not-the-token')
  assert.equal(r.status, 401)
  await new Promise(r => setTimeout(r, 100))
  assert.equal(lines.filter(m => m.type === 'op').length, before)
})
