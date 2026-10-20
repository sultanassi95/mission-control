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
