// The app's attachment types and limits are written in three places that run apart: the page
// (public/app.js and the picker in public/index.html), the page's transcript module (public/transcript.js)
// and the server (uploads.mjs, server.mjs). They must agree, or the page offers a file the server refuses,
// or the server stores one the page cannot open.
// Run: node --test tools/tests/app-attachment-types.tests.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { FILE_MAX, FILE_ROUTE, REFUSED, SERVED } from '../app/uploads.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const window = {}
new Function('window', read('../app/public/transcript.js'))(window)
const { PHOTO_EXTS, DOC_EXTS } = window.mcTranscript
const app = read('../app/public/app.js')
const html = read('../app/public/index.html')
const server = read('../app/server.mjs')
const register = read('../mods/mission-fleet/hooks/register.ts')

test('the page, its transcript module and the server name the same file types', () => {
  assert.deepEqual([...PHOTO_EXTS, ...DOC_EXTS].sort(), Object.keys(SERVED).sort())
  // The page's photo and document lists split the server's types where the server does: images are photos.
  assert.deepEqual([...PHOTO_EXTS].sort(), Object.keys(SERVED).filter(e => SERVED[e].startsWith('image/')).sort())
  const opens = /const OPENS_AS = \{([^}]*)\}/.exec(app)?.[1]
  assert.ok(opens, 'OPENS_AS is in app.js')
  assert.deepEqual([...opens.matchAll(/(\w+):/g)].map(m => m[1]).sort(), [...DOC_EXTS].sort())
  for (const ext of Object.keys(SERVED)) assert.ok(FILE_ROUTE.test(`/upload/0123456789abcdef01234567.${ext}`), `the file route serves .${ext}`)
  const accept = /accept="([^"]*)"/.exec(html)?.[1]?.split(',') ?? []
  assert.deepEqual(accept.sort(), ['image/*', ...DOC_EXTS.map(e => `.${e}`)].sort(), 'the picker offers photos and the document types, nothing else')
  const pageRefusal = /'only photos, PDF, or [^']*'/.exec(app)?.[0]
  assert.ok(pageRefusal, "the page's refusal is in app.js")
  for (const ext of DOC_EXTS) {
    const named = ext === 'pdf' ? 'PDF' : `.${ext}`
    assert.ok(pageRefusal.includes(named), `the page's refusal names ${named}`)
    assert.ok(REFUSED.includes(named), `the server's refusal names ${named}`)
  }
})

test('the page and the server hold the same limits', () => {
  assert.match(app, new RegExp(`file: ${FILE_MAX / 1048576} \\* 1024 \\* 1024`), "the page's per-file limit is the server's")
})

test("the page's text limit fits the /op route and the transcript the page reads back", () => {
  const limit = Number(/const TEXT_MAX = (\d+)\b/.exec(app)?.[1])
  assert.ok(limit > 0, 'TEXT_MAX is in app.js')
  const route = Number(/op\.text\.length > (\d+)/.exec(server)?.[1])
  assert.ok(route > 0, 'the /op route caps the text')
  assert.ok(limit <= route, `TEXT_MAX ${limit} is within the /op route's ${route}`)
  // The fleet sends each transcript message cut to its first N characters; a prompt is recorded inside the
  // engine's frame (the form app-transcript.tests.mjs reads back), so the frame counts against N.
  const kept = Number(/clean\.length > (\d+) \? `\$\{clean\.slice\(0, \1\)\}/.exec(register)?.[1])
  assert.ok(kept > 0, 'the snapshot cuts a transcript message (register.ts)')
  const frame = 'The mission-fleet plugin sent a message:\n'.length + '\n\nThis is how Claude Code surfaces a prompt a plugin submits, as a user message.'.length
  assert.ok(limit + frame <= kept, `TEXT_MAX ${limit} plus the ${frame}-character frame is within the ${kept} the transcript keeps`)
})
