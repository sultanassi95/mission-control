// Tests for tools/app/public/view.js, the file viewer: it runs here against stand-ins for the page,
// and every URL it asks for or navigates to is recorded, so a token in any of them is caught.
// Run: node --test tools/tests/app-viewer.tests.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const SOURCE = readFileSync(new URL('../app/public/view.js', import.meta.url), 'utf8')
const TOKEN = 'secrettokensecrettokensecrettoken0'

// Runs view.js once for this file and host, with the server answering as /file and /file-ticket do.
async function view(path, type, hostname = '127.0.0.1') {
  const urls = []
  const elements = {}
  const el = id => (elements[id] ??= { id, textContent: '', innerHTML: '', focus() {}, replaceChildren() {} })
  const window = { addEventListener() {}, mcMarkdown: s => s }
  const document = { getElementById: el, createElement: () => ({}), title: '' }
  const location = { hash: `#${encodeURIComponent(path)}`, hostname, replace: u => urls.push(`navigate ${u}`) }
  const localStorage = { getItem: () => TOKEN }
  const fetch = async (url, init = {}) => {
    urls.push(`${init.method ?? 'GET'} ${url}`)
    if (url === '/file-ticket') return { ok: true, status: 200, json: async () => ({ ticket: 'a'.repeat(32) }), headers: { get: () => 'application/json' } }
    return { ok: true, status: 200, headers: { get: h => (h.toLowerCase() === 'content-type' ? type : null) }, text: async () => 'body', blob: async () => new Blob(['x']) }
  }
  const URL = { createObjectURL: () => 'blob:x' }
  new Function('window', 'document', 'location', 'localStorage', 'fetch', 'URL', SOURCE)(window, document, location, localStorage, fetch, URL)
  await new Promise(r => setTimeout(r, 20))
  return urls
}

test('no URL the viewer requests or opens carries the token, for any kind of file, on this Mac or over the tailnet', async () => {
  for (const [path, type] of [['/r/report.md', 'text/markdown; charset=utf-8'], ['/r/page.html', 'text/html; charset=utf-8'], ['/r/doc.pdf', 'application/pdf'], ['/r/shot.png', 'image/png'], ['/r/notes.txt', 'text/plain; charset=utf-8']]) {
    for (const host of ['127.0.0.1', 'mac.tail1234.ts.net']) {
      const urls = await view(path, type, host)
      assert.ok(urls.length > 0, `${path} on ${host} asked for nothing`)
      for (const u of urls) assert.ok(!u.includes(TOKEN), `${path} on ${host}: ${u}`)
    }
  }
})

test('a PDF or an HTML report opens as itself through a single-use ticket', async () => {
  for (const [path, type] of [['/r/page.html', 'text/html; charset=utf-8'], ['/r/doc.pdf', 'application/pdf']]) {
    const urls = await view(path, type)
    assert.ok(urls.includes('POST /file-ticket'), urls.join('\n'))
    assert.ok(urls.includes(`navigate /file?ticket=${'a'.repeat(32)}`), urls.join('\n'))
  }
})
