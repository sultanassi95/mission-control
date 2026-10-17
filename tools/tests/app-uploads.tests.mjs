// Tests for tools/app/uploads.mjs: which files the app stores and under what type, and the
// upload folder's retention cap over a folder holding photos and documents together.
// Run: node --test tools/tests/app-uploads.tests.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, utimesSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { classify, prune, REFUSED } from '../app/uploads.mjs'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])
const WEBP = Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1')
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0x06, 0, 0x08, 0])
const text = s => Buffer.from(s, 'utf8')

test('each photo type and a PDF are stored by their own bytes, whatever name they came with', () => {
  assert.deepEqual(classify(JPEG, 'jpg'), { ext: 'jpg' })
  assert.deepEqual(classify(PNG, ''), { ext: 'png' })
  assert.deepEqual(classify(WEBP, 'webp'), { ext: 'webp' })
  assert.deepEqual(classify(PDF, 'pdf'), { ext: 'pdf' })
  assert.deepEqual(classify(JPEG, 'txt'), { ext: 'jpg' })
  assert.deepEqual(classify(PDF, 'md'), { ext: 'pdf' })
})

test('a text file is stored under the extension it was picked with once its bytes are text', () => {
  assert.deepEqual(classify(text('Firing schedule: Friday.\r\n\tGlaze: celadon\n'), 'txt'), { ext: 'txt' })
  assert.deepEqual(classify(text('# Kiln\n\n- Friday\n'), 'MD'), { ext: 'md' })
  assert.deepEqual(classify(text('day,kiln\nFriday,2\n'), 'csv'), { ext: 'csv' })
  assert.deepEqual(classify(text('{"kiln": 2, "day": "Friday", "note": "ümlaut é"}'), 'json'), { ext: 'json' })
})

test('a file of another type is refused, naming what the app accepts', () => {
  assert.deepEqual(classify(DOCX, 'docx'), { reason: REFUSED })
  assert.deepEqual(classify(text('plain words'), 'html'), { reason: REFUSED })
  assert.deepEqual(classify(text('plain words'), undefined), { reason: REFUSED })
  assert.equal(REFUSED, 'only photos (JPEG, PNG or WebP), PDF, or .txt, .md, .csv and .json files')
})

test('a text name over bytes that are not text, or a PDF name over other bytes, is refused with why', () => {
  assert.deepEqual(classify(DOCX, 'txt'), { reason: 'that .txt file holds binary data, not text' })
  assert.deepEqual(classify(Buffer.from([0x6b, 0xff, 0xfe, 0x6c]), 'md'), { reason: 'that .md file is not UTF-8 text' })
  assert.deepEqual(classify(text('{"kiln": '), 'json'), { reason: 'that .json file does not parse' })
  assert.deepEqual(classify(text('not a pdf'), 'pdf'), { reason: 'that file is not a PDF' })
  assert.deepEqual(classify(Buffer.alloc(0), 'txt'), { reason: 'that file is empty' })
})

test('the retention cap removes the oldest files first, photos and documents alike', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-uploads-'))
  try {
    const now = Date.now()
    const put = (name, ageMinutes, size = 4) => {
      writeFileSync(join(dir, name), Buffer.alloc(size, 1))
      const at = new Date(now - ageMinutes * 60_000)
      utimesSync(join(dir, name), at, at)
    }
    put('a00000000000000000000000.md', 8 * 24 * 60)
    put('b00000000000000000000000.jpg', 50)
    put('c00000000000000000000000.pdf', 40)
    put('d00000000000000000000000.csv', 30)
    put('e00000000000000000000000.png', 20)
    put('f00000000000000000000000.json', 10)

    const gone = prune(dir, { days: 7, files: 3, bytes: 1024 }, now)
    assert.deepEqual(gone.sort(), ['a00000000000000000000000.md', 'b00000000000000000000000.jpg', 'c00000000000000000000000.pdf'])
    assert.deepEqual(readdirSync(dir).sort(), ['d00000000000000000000000.csv', 'e00000000000000000000000.png', 'f00000000000000000000000.json'])

    // The byte cap counts from the newest: 4 + 4 fits in 9 bytes, the third file does not.
    assert.deepEqual(prune(dir, { days: 7, files: 100, bytes: 9 }, now), ['d00000000000000000000000.csv'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
