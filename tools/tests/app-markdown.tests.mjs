// Tests for tools/app/public/md.js: how a table in Flight's reply is marked up for a narrow screen.
// Run: node --test tools/tests/app-markdown.tests.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// md.js is a browser script that sets window.mcMarkdown; it runs here against a plain window object.
const source = readFileSync(new URL('../app/public/md.js', import.meta.url), 'utf8')
const window = {}
new Function('window', source)(window)
const md = window.mcMarkdown

const TABLE = [
  '| Front | Ticket | Next |',
  '|---|---|---|',
  '| mission-control | MC-162 | claude plugin test on c0ff0b5 |',
  '| shelf | SH-318 | rotate the Supabase service key |',
].join('\n')

test('a table scrolls in its own box, which a keyboard can reach and a screen reader names', () => {
  const html = md(TABLE)
  assert.match(html, /<div class="md-table" tabindex="0" role="region" aria-label="Table, scrolls sideways when it is wider than the screen">/)
})

test('a short cell keeps to one line and a long one wraps: the long cells are marked, the short ones are not', () => {
  const html = md(TABLE)
  const cells = [...html.matchAll(/<td( class="long")?>([^<]*)<\/td>/g)].map(m => `${m[1] ? 'long' : 'short'}: ${m[2]}`)
  assert.deepEqual(cells, [
    'short: mission-control', 'short: MC-162', 'long: claude plugin test on c0ff0b5',
    'short: shelf', 'short: SH-318', 'long: rotate the Supabase service key',
  ])
  // Headers are never long: a column's name stays on one line.
  assert.doesNotMatch(html, /<th class=/)
})

test('a cell is escaped before it is marked up, long or short', () => {
  const html = md('| a | b |\n|---|---|\n| <b>x</b> | <script>alert(1)</script> and more words than twenty-four |')
  assert.match(html, /<td>&lt;b&gt;x&lt;\/b&gt;<\/td>/)
  assert.match(html, /<td class="long">&lt;script&gt;alert\(1\)&lt;\/script&gt; and more words than twenty-four<\/td>/)
})

// ---- Nested lists (MC-171) ----

// The report seen on 2026-10-22, in the shape it arrived: a numbered list with indented sub-items.
const REPORT = [
  '1. Shipped: the ingest fix',
  '2. Waiting on you:',
  '  - Rotate the staging tokens',
  '  - Review #259',
  '3. In progress: the worker budget',
].join('\n')

test('an indented list inside a numbered item nests in that item, and the outer numbering carries on after it', () => {
  assert.equal(md(REPORT), '<ol><li>Shipped: the ingest fix</li><li>Waiting on you:<ul><li>Rotate the staging tokens</li><li>Review #259</li></ul></li><li>In progress: the worker budget</li></ol>')
})

test('each nested list keeps its own type and numbering, to any depth, in every pairing', () => {
  assert.equal(md('1. a\n   1. a1\n   2. a2\n2. b'), '<ol><li>a<ol><li>a1</li><li>a2</li></ol></li><li>b</li></ol>')
  assert.equal(md('- a\n  1. a1\n  2. a2\n- b'), '<ul><li>a<ol><li>a1</li><li>a2</li></ol></li><li>b</li></ul>')
  assert.equal(md('- a\n  - a1\n    - a1x\n- b'), '<ul><li>a<ul><li>a1<ul><li>a1x</li></ul></li></ul></li><li>b</li></ul>')
  assert.equal(md('1. a\n  - a1\n    1. deep\n2. b'), '<ol><li>a<ul><li>a1<ol><li>deep</li></ol></li></ul></li><li>b</li></ol>')
})

test('a continuation line joins its own item, and a shallower item closes the nested list', () => {
  assert.equal(md('1. a\n  - a1 starts\n    and goes on\n2. b'), '<ol><li>a<ul><li>a1 starts and goes on</li></ul></li><li>b</li></ol>')
  assert.equal(md('- a\n    - deep\n  - middle\n- b'), '<ul><li>a<ul><li>deep</li><li>middle</li></ul></li><li>b</li></ul>')
})

test('a numbered list that starts past 1 keeps its start, at the top and nested', () => {
  assert.equal(md('3. c\n4. d'), '<ol start="3"><li>c</li><li>d</li></ol>')
  assert.equal(md('- a\n  5. e\n  6. f'), '<ul><li>a<ol start="5"><li>e</li><li>f</li></ol></li></ul>')
})

test('list text is escaped before it is marked up, nested or not', () => {
  assert.equal(md('- <b>x</b>\n  - <script>y</script>'), '<ul><li>&lt;b&gt;x&lt;/b&gt;<ul><li>&lt;script&gt;y&lt;/script&gt;</li></ul></li></ul>')
})

test('a one-space slip is not a nested list; a 0 or ) marker keeps its start; a paragraph after a nested list is a paragraph', () => {
  assert.equal(md('1. a\n 2. b'), '<ol><li>a</li><li>b</li></ol>')
  assert.equal(md('0. z\n1. y'), '<ol start="0"><li>z</li><li>y</li></ol>')
  assert.equal(md('3) c\n4) d'), '<ol start="3"><li>c</li><li>d</li></ol>')
  assert.equal(md('- a\n  - b\nAfter.'), '<ul><li>a<ul><li>b</li></ul></li></ul><p>After.</p>')
})
