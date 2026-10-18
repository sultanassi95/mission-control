// Tests for the app server's upload routes, over HTTP, the way the page calls them: two profile
// servers start on scratch folders, one holding the front door, and every request goes through it.
// Run: node --test tools/tests/app-upload-routes.tests.mjs
// MCAPP_SERVER=<path to a server.mjs> runs the same requests against another copy of the server.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SERVER = process.env.MCAPP_SERVER ?? fileURLToPath(new URL('../app/server.mjs', import.meta.url))
const TOKEN = 'routestokenroutestokenroutestoken01'
const KEY = 'routeskeyrouteskeyroutesKeyroutes01'
const FRONT = 42000 + Math.floor(Math.random() * 9000)
const ORIGIN = `http://127.0.0.1:${FRONT}`
const scratch = mkdtempSync(join(tmpdir(), 'mc-routes-'))
const STATE = join(scratch, 'state')
const UPLOADS = join(STATE, 'uploads')
const servers = []

// Starts one profile's server and waits for the lines it prints once it listens.
function start(profile, wanted) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MCAPP_PORT: String(FRONT), MCAPP_HOME: join(scratch, 'home'), MCAPP_PROFILE: profile, MCAPP_STATE_FILE: join(STATE, 'app-state.json') },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  servers.push(child)
  child.stdin.end(JSON.stringify({ token: TOKEN, key: KEY }))
  const seen = new Set()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${profile} server did not start: saw ${[...seen]}`)), 15_000)
    createInterface({ input: child.stdout }).on('line', l => {
      try {
        seen.add(JSON.parse(l).type)
      } catch {
        return
      }
      if (wanted.every(w => seen.has(w))) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.on('exit', code => reject(new Error(`${profile} server exited ${code}`)))
  })
}

const upload = (profile, body, ext) =>
  fetch(`${ORIGIN}/p/${profile}/upload`, { method: 'POST', headers: { 'x-mcapp-token': TOKEN, origin: ORIGIN, 'content-type': 'application/octet-stream', ...(ext ? { 'x-mcapp-ext': ext } : {}) }, body })
const fetchStored = (profile, id) => fetch(`${ORIGIN}/p/${profile}/upload/${id}`, { headers: { 'x-mcapp-token': TOKEN } })

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0x06, 0, 0x08, 0])

before(async () => {
  await start('work', ['ready', 'front'])
  await start('personal', ['ready'])
})

after(() => {
  for (const s of servers) s.kill('SIGTERM')
  rmSync(scratch, { recursive: true, force: true })
})

test('a PDF sent through the front door is stored as a PDF and served back as one', async () => {
  const r = await upload('work', PDF)
  assert.equal(r.status, 201, await r.clone().text())
  const { id, path } = await r.json()
  assert.match(id, /^[a-f0-9]{24}\.pdf$/)
  assert.equal(path, join(UPLOADS, id))
  assert.deepEqual(readFileSync(path), PDF)
  const back = await fetchStored('work', id)
  assert.equal(back.status, 200)
  assert.equal(back.headers.get('content-type'), 'application/pdf')
  assert.deepEqual(Buffer.from(await back.arrayBuffer()), PDF)
})

test("a Markdown file sent to another profile keeps its extension through the front door's forward", async () => {
  const r = await upload('personal', Buffer.from('# Kiln\n\nFriday\n'), 'md')
  assert.equal(r.status, 201, await r.clone().text())
  const { id, path } = await r.json()
  assert.match(id, /^[a-f0-9]{24}\.md$/)
  assert.ok(existsSync(path))
  const back = await fetchStored('personal', id)
  assert.equal(back.headers.get('content-type'), 'text/plain; charset=utf-8')
  assert.equal(await back.text(), '# Kiln\n\nFriday\n')
})

test('a photo named as a text file is stored as the photo it is', async () => {
  const r = await upload('work', JPEG, 'txt')
  assert.equal(r.status, 201)
  assert.match((await r.json()).id, /\.jpg$/)
})

test('a Word file is refused, and the answer names what the app accepts', async () => {
  const r = await upload('personal', DOCX, 'docx')
  assert.equal(r.status, 415)
  assert.equal(await r.text(), 'only photos (JPEG, PNG or WebP), PDF, or .txt, .md, .csv and .json files')
})

test('a file over 8 MB is refused at the front door and at the profile server alike', async () => {
  const big = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20)
  for (const profile of ['work', 'personal']) {
    const r = await upload(profile, big, 'txt')
    assert.equal(r.status, 413, profile)
    assert.equal(await r.text(), 'that file is over 8 MB', profile)
  }
})
