// Tests for the app server's upload routes, over HTTP, the way the page calls them: the one server
// starts on a scratch home and every request goes to it.
// Run: node --test tools/tests/app-upload-routes.tests.mjs
// MCAPP_SERVER=<path to a server.mjs> runs the same requests against another copy of the server.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SERVER = process.env.MCAPP_SERVER ?? fileURLToPath(new URL('../app/server.mjs', import.meta.url))
const TOKEN = 'routestokenroutestokenroutestoken01'
const FRONT = 42000 + Math.floor(Math.random() * 9000)
const ORIGIN = `http://127.0.0.1:${FRONT}`
const scratch = mkdtempSync(join(tmpdir(), 'mc-routes-'))
const UPLOADS = join(scratch, 'uploads')
const servers = []

// Starts the app's one server on the scratch home and waits for its ready line.
function start() {
  mkdirSync(join(scratch, 'home'), { recursive: true })
  writeFileSync(join(scratch, 'home', 'app-token'), TOKEN, { mode: 0o600 })
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MCAPP_PORT: String(FRONT), MCAPP_HOME: join(scratch, 'home'), MCAPP_UPLOADS: UPLOADS },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  servers.push(child)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15_000)
    createInterface({ input: child.stdout }).on('line', l => {
      try {
        if (JSON.parse(l).type !== 'ready') return
      } catch {
        return
      }
      clearTimeout(timer)
      resolve()
    })
    child.on('exit', code => reject(new Error(`server exited ${code}`)))
  })
}

const upload = (body, ext) =>
  fetch(`${ORIGIN}/upload`, { method: 'POST', headers: { 'x-mcapp-token': TOKEN, origin: ORIGIN, 'content-type': 'application/octet-stream', ...(ext ? { 'x-mcapp-ext': ext } : {}) }, body })
const fetchStored = id => fetch(`${ORIGIN}/upload/${id}`, { headers: { 'x-mcapp-token': TOKEN } })

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0x06, 0, 0x08, 0])

before(async () => {
  await start()
})

after(() => {
  for (const s of servers) s.kill('SIGTERM')
  rmSync(scratch, { recursive: true, force: true })
})

test('a PDF is stored as a PDF and served back as one', async () => {
  const r = await upload(PDF)
  assert.equal(r.status, 201, await r.clone().text())
  const { id, path } = await r.json()
  assert.match(id, /^[a-f0-9]{24}\.pdf$/)
  assert.equal(path, join(UPLOADS, id))
  assert.deepEqual(readFileSync(path), PDF)
  const back = await fetchStored(id)
  assert.equal(back.status, 200)
  assert.equal(back.headers.get('content-type'), 'application/pdf')
  assert.deepEqual(Buffer.from(await back.arrayBuffer()), PDF)
})

test('a Markdown file keeps its extension', async () => {
  const r = await upload(Buffer.from('# Kiln\n\nFriday\n'), 'md')
  assert.equal(r.status, 201, await r.clone().text())
  const { id, path } = await r.json()
  assert.match(id, /^[a-f0-9]{24}\.md$/)
  assert.ok(existsSync(path))
  const back = await fetchStored(id)
  assert.equal(back.headers.get('content-type'), 'text/plain; charset=utf-8')
  assert.equal(await back.text(), '# Kiln\n\nFriday\n')
})

test('a photo named as a text file is stored as the photo it is', async () => {
  const r = await upload(JPEG, 'txt')
  assert.equal(r.status, 201)
  assert.match((await r.json()).id, /\.jpg$/)
})

test('a Word file is refused, and the answer names what the app accepts', async () => {
  const r = await upload(DOCX, 'docx')
  assert.equal(r.status, 415)
  assert.equal(await r.text(), 'only photos (JPEG, PNG or WebP), PDF, or .txt, .md, .csv and .json files')
})

test('a file over 8 MB is refused', async () => {
  const big = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20)
  const r = await upload(big, 'txt')
  assert.equal(r.status, 413)
  assert.equal(await r.text(), 'that file is over 8 MB')
})
