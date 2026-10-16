// Tests for tools/app/public/badge.js: the call-sign marker Flight leads a message with becomes the
// badges at the top of its bubble, and a call sign is drawn as a chip in its Controller's colour.
// Run: node --test tools/tests/app-badge.tests.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// badge.js is a browser script that sets window.mcBadge; it runs here against a plain window object.
const source = readFileSync(new URL('../app/public/badge.js', import.meta.url), 'utf8')
const window = {}
new Function('window', source)(window)
const { parse, slotClass, chip, label } = window.mcBadge

const KNOWN = new Set(['MISSION-CONTROL', 'FIELDKIT', 'FIELDKIT-API'])
const read = text => parse(text, KNOWN)
const plain = text => ({ signs: [], text })

test('a first line that is one call sign in bold becomes its badge, and the line leaves the text', () => {
  assert.deepEqual(read('**FIELDKIT**\nBoth of its PRs are green.'), { signs: ['FIELDKIT'], text: 'Both of its PRs are green.' })
})

test('two call signs joined by a middle dot become two badges, in the order written', () => {
  assert.deepEqual(read('**MISSION-CONTROL · FIELDKIT**\nBoth wait on you.'), { signs: ['MISSION-CONTROL', 'FIELDKIT'], text: 'Both wait on you.' })
  assert.deepEqual(read('**FIELDKIT·MISSION-CONTROL**\nx'), { signs: ['FIELDKIT', 'MISSION-CONTROL'], text: 'x' })
})

test('each call sign in its own bold run, joined by a middle dot, reads the same', () => {
  assert.deepEqual(read('**MISSION-CONTROL** · **FIELDKIT-API**\nBoth wait on you.'), { signs: ['MISSION-CONTROL', 'FIELDKIT-API'], text: 'Both wait on you.' })
})

test('a message with no marker has no badge and keeps its text', () => {
  const text = 'Good morning. Three consoles are staffed.\n\n**FIELDKIT** is green.'
  assert.deepEqual(read(text), plain(text))
})

test('the same-line form keeps the rest of the line as the first line of the text', () => {
  assert.deepEqual(read('**FIELDKIT** PR #12 is green.\nNext: the merge.'), { signs: ['FIELDKIT'], text: 'PR #12 is green.\nNext: the merge.' })
})

test('a colon right after the call signs leaves with them', () => {
  assert.deepEqual(read('**FIELDKIT**: merged.'), { signs: ['FIELDKIT'], text: 'merged.' })
  assert.deepEqual(read('**MISSION-CONTROL · FIELDKIT** : both green'), { signs: ['MISSION-CONTROL', 'FIELDKIT'], text: 'both green' })
})

test('a bold first word that names no Controller stays text', () => {
  const text = '**Heads up** the build is red.'
  assert.deepEqual(read(text), plain(text))
})

test('a group with one name that is not a known call sign stays text, the known ones included', () => {
  const text = '**FIELDKIT · SHELF**\nSHELF is not staffed.'
  assert.deepEqual(read(text), plain(text))
  const runs = '**FIELDKIT** · **SHELF**\nx'
  assert.deepEqual(read(runs), plain(runs))
})

test('a call sign is matched as the fleet spells it, so a lower-case name stays text', () => {
  const text = '**fieldkit**\nx'
  assert.deepEqual(read(text), plain(text))
})

test('the marker counts only on the first line, and only at its start', () => {
  const second = 'Status:\n**FIELDKIT**\nx'
  assert.deepEqual(read(second), plain(second))
  const later = 'Update for **FIELDKIT**: green.'
  assert.deepEqual(read(later), plain(later))
})

test('blank lines before the marker are skipped, and Windows line ends read the same', () => {
  assert.deepEqual(read('\n  \n**FIELDKIT**\nx'), { signs: ['FIELDKIT'], text: 'x' })
  assert.deepEqual(read('**FIELDKIT**\r\nx\r\ny'), { signs: ['FIELDKIT'], text: 'x\ny' })
})

test('a call sign named twice gives one badge', () => {
  assert.deepEqual(read('**FIELDKIT · FIELDKIT**\nx'), { signs: ['FIELDKIT'], text: 'x' })
})

test('the marker alone leaves an empty text', () => {
  assert.deepEqual(read('**FIELDKIT**'), { signs: ['FIELDKIT'], text: '' })
})

test('a dot after the call signs that does not lead to another bold run is not a marker', () => {
  const text = '**FIELDKIT** · merged'
  assert.deepEqual(read(text), plain(text))
})

test('headings, italics and an empty group are not the marker', () => {
  for (const text of ['## FIELDKIT\nx', '*FIELDKIT*\nx', '***FIELDKIT***\nx', '**FIELDKIT ·  · MISSION-CONTROL**\nx', '****\nx']) assert.deepEqual(read(text), plain(text))
})

test('a bold call sign that runs into a word or a mark is not a marker', () => {
  for (const text of ["**FIELDKIT**'s PRs are green.", '**FIELDKIT**ish x', '**FIELDKIT**.\nx', '**FIELDKIT***\nx']) assert.deepEqual(read(text), plain(text))
})

test('a hyphen after the call signs leaves with them, as a colon does', () => {
  assert.deepEqual(read('**FIELDKIT** - merged'), { signs: ['FIELDKIT'], text: 'merged' })
  assert.deepEqual(read('**FIELDKIT** -5 tests failed'), { signs: ['FIELDKIT'], text: '-5 tests failed' })
})

test('bold call signs side by side read as one marker, while every name in the next run is known', () => {
  assert.deepEqual(read('**MISSION-CONTROL** **FIELDKIT**\nx'), { signs: ['MISSION-CONTROL', 'FIELDKIT'], text: 'x' })
  assert.deepEqual(read('**FIELDKIT** **Heads up**: the build is red.'), { signs: ['FIELDKIT'], text: '**Heads up**: the build is red.' })
})

test('a call sign takes the colour class of its slot, slot-1 to slot-8, and none for anything else', () => {
  assert.equal(slotClass({ FIELDKIT: 0 }, 'FIELDKIT'), ' slot-1')
  assert.equal(slotClass({ FIELDKIT: 7 }, 'FIELDKIT'), ' slot-8')
  for (const slots of [{ FIELDKIT: 8 }, { FIELDKIT: -1 }, { FIELDKIT: 1.5 }, { FIELDKIT: '3' }, { FIELDKIT: null }, {}, undefined]) assert.equal(slotClass(slots, 'FIELDKIT'), '')
  assert.equal(slotClass({}, 'constructor'), '')
})

test('a chip escapes its call sign and wears its colour', () => {
  assert.equal(chip('FIELDKIT', { FIELDKIT: 2 }), '<span class="call slot-3">FIELDKIT</span>')
  assert.equal(chip('<img src=x onerror=alert(1)>', {}), '<span class="call">&lt;img src=x onerror=alert(1)&gt;</span>')
})

test('a badged label reads FLIGHT, about each call sign; with none it is FLIGHT alone', () => {
  assert.equal(label([], {}), 'FLIGHT')
  assert.equal(
    label(['MISSION-CONTROL', 'FIELDKIT'], { 'MISSION-CONTROL': 0 }),
    'FLIGHT<span class="visually-hidden">, about </span><span class="call slot-1">MISSION-CONTROL</span><span class="visually-hidden">, </span><span class="call">FIELDKIT</span>',
  )
})

test('with no call sign known, nothing is a badge; the names may come as a list', () => {
  assert.deepEqual(parse('**FIELDKIT**\nx', new Set()), plain('**FIELDKIT**\nx'))
  assert.deepEqual(parse('**FIELDKIT**\nx', undefined), plain('**FIELDKIT**\nx'))
  assert.deepEqual(parse('**FIELDKIT**\nx', ['FIELDKIT']), { signs: ['FIELDKIT'], text: 'x' })
  assert.deepEqual(parse(undefined, KNOWN), plain(''))
})
