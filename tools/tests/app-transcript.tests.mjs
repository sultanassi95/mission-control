// Tests for tools/app/public/transcript.js: what the founder typed, read back from a session's
// transcript, as typed, with each file it carried.
// Run: node --test tools/tests/app-transcript.tests.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// transcript.js is a browser script that sets window.mcTranscript; it runs here against a plain window object.
const source = readFileSync(new URL('../app/public/transcript.js', import.meta.url), 'utf8')
const window = {}
new Function('window', source)(window)
const { typed, attachments, line, safeName } = window.mcTranscript

// How the engine records a slash command the app ran (the form the founder saw on his phone).
const TAGS = '<command-message>epic-flow</command-message>\n<command-name>/epic-flow</command-name>\n<command-args>--auto MC-1</command-args>'

const UPLOADS = '/srv/mc/state/uploads'
const PHOTO_1 = `[Photo from the app: ${UPLOADS}/0123456789abcdef01234567.jpg - open it with Read]`
const PHOTO_2 = `[Photo from the app: ${UPLOADS}/89abcdef0123456789abcdef.png - open it with Read]`
const DOC = `[Document from the app: ${UPLOADS}/fedcba9876543210fedcba98.pdf (kiln schedule.pdf) - open it with Read]`

test('a plain prompt reads as typed', () => {
  assert.equal(typed('kiln test'), 'kiln test')
})

test("the engine's command tags read as the slash command typed", () => {
  assert.equal(typed(TAGS), '/epic-flow --auto MC-1')
})

test('command tags in another order, with a running note and no arguments, read the same way', () => {
  assert.equal(typed('<command-name>/epic-flow</command-name> <command-message>epic-flow is running…</command-message>'), '/epic-flow')
  assert.equal(typed('<command-args>MC-1</command-args><command-name>review</command-name>'), '/review MC-1')
})

test('text that only mentions a command tag stays as written', () => {
  const text = 'the log shows <command-name>/epic-flow</command-name> twice'
  assert.equal(typed(text), text)
})

test('several attachments come back in order, each kind with its name', () => {
  const { body, files } = attachments(`kiln test\n\n${PHOTO_1}\n${PHOTO_2}\n${DOC}`)
  assert.equal(body, 'kiln test')
  assert.deepEqual(
    files.map(f => [f.kind, f.id, f.name]),
    [
      ['photo', '0123456789abcdef01234567.jpg', ''],
      ['photo', '89abcdef0123456789abcdef.png', ''],
      ['document', 'fedcba9876543210fedcba98.pdf', 'kiln schedule.pdf'],
    ],
  )
  assert.equal(files[2].path, `${UPLOADS}/fedcba9876543210fedcba98.pdf`)
})

test('a photo line from before several attachments still reads', () => {
  const { body, files } = attachments(`A photo for you.\n\n${PHOTO_1}`)
  assert.equal(body, 'A photo for you.')
  assert.deepEqual(files.map(f => f.id), ['0123456789abcdef01234567.jpg'])
})

test('a line that pairs a photo with a document type, or the reverse, is text, not a file', () => {
  const docAsPhoto = `[Document from the app: ${UPLOADS}/0123456789abcdef01234567.jpg (x.jpg) - open it with Read]`
  const photoAsDoc = `[Photo from the app: ${UPLOADS}/fedcba9876543210fedcba98.pdf - open it with Read]`
  assert.deepEqual(attachments(`hi\n\n${docAsPhoto}`).files, [])
  assert.deepEqual(attachments(`hi\n\n${photoAsDoc}`).files, [])
  assert.deepEqual(attachments(`hi\n\n${PHOTO_1}\n${DOC}`).files.map(f => f.kind), ['photo', 'document'])
})

test('an attachment line in the middle of the text is left as text', () => {
  const text = `${PHOTO_1}\nwhat do you make of this line?`
  assert.deepEqual(attachments(text), { body: text, files: [] })
})

test('a line names a document by a one-line name and reads back as itself', () => {
  assert.equal(safeName('kiln (draft) [v2]\nnotes.md'), 'kiln draft v2 notes.md')
  assert.equal(safeName('\u0007'), '')
  assert.equal(safeName('x'.repeat(200)).length, 80)
  const doc = { kind: 'document', path: `${UPLOADS}/fedcba9876543210fedcba98.md`, name: 'kiln (draft).md' }
  const photo = { kind: 'photo', path: `${UPLOADS}/0123456789abcdef01234567.jpg` }
  const { body, files } = attachments(`hi\n\n${line(photo)}\n${line(doc)}`)
  assert.equal(body, 'hi')
  assert.deepEqual(files.map(f => [f.kind, f.name]), [['photo', ''], ['document', 'kiln draft.md']])
})
