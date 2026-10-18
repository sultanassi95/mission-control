// Tests for tools/app/public/transcript.js: what the founder typed, read back from Flight's
// transcript, so a sent message shows once, as typed, with each file it carried.
// Run: node --test tools/tests/app-transcript.tests.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// transcript.js is a browser script that sets window.mcTranscript; it runs here against a plain window object.
const source = readFileSync(new URL('../app/public/transcript.js', import.meta.url), 'utf8')
const window = {}
new Function('window', source)(window)
const { typed, same, since, waiting, attachments, line, safeName } = window.mcTranscript
// One sent message against the transcript: true once it has left the queue.
const arrived = (q, said, lastOp) => waiting([{ sent: true, before: [], ...q }], said, lastOp).length === 0

// How the engine records a slash command the app ran (the form the founder saw on his phone).
const TAGS = '<command-message>epic-flow</command-message>\n<command-name>/epic-flow</command-name>\n<command-args>--auto MC-1</command-args>'

// The fleet's relay prompt, built from the mod's own template so a change to its wording fails here.
const register = readFileSync(new URL('../mods/mission-fleet/hooks/register.ts', import.meta.url), 'utf8')
const template = /const prompt = `(From the Mission Control App[^`]*)`/.exec(register)?.[1]
const relayPrompt = (args, code) => template.replaceAll('\\n', '\n').replaceAll('${args}', args).replaceAll('${code}', code)
// What the fleet answers when it hands an op on to Flight (runAppOp and relayToFlight in the same file).
const handoffs = [...register.matchAll(/(?:result = |return )'(Sent to Flight[^']*)'/g)].map(m => m[1])

const UPLOADS = '/srv/mc/state/uploads'
const PHOTO_1 = `[Photo from the app: ${UPLOADS}/0123456789abcdef01234567.jpg - open it with Read]`
const PHOTO_2 = `[Photo from the app: ${UPLOADS}/89abcdef0123456789abcdef.png - open it with Read]`
const DOC = `[Document from the app: ${UPLOADS}/fedcba9876543210fedcba98.pdf (kiln schedule.pdf) - open it with Read]`

test('a plain prompt reads as typed', () => {
  assert.equal(typed('kiln test'), 'kiln test')
})

test('a prompt the plugin framed reads without the frame', () => {
  const framed = 'The mission-fleet plugin sent a message:\nkiln test\n\nThis is how Claude Code surfaces a prompt a plugin submits, as a user message.'
  assert.equal(typed(framed), 'kiln test')
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

test("the fleet's relay prompt reads as the console command, without its one-time code", () => {
  assert.ok(template, 'the relay prompt template is in register.ts')
  assert.equal(typed(relayPrompt('staff fieldkit', '0f1e2d3c4b5a69788796a5b4c3d2e1f0')), '/console staff fieldkit')
})

test('a queued command matches its transcript copy with the spaces the fleet collapsed', () => {
  assert.equal(same('/epic-flow --auto  MC-1', typed(TAGS)), true)
  assert.equal(same('/epic-flow\n--auto MC-1', typed(TAGS)), true)
  assert.equal(same('/epic-flow --auto MC-2', typed(TAGS)), false)
})

test('a queued console command matches the relay prompt it became', () => {
  assert.equal(same('/console staff fieldkit', typed(relayPrompt('staff fieldkit', 'aa'))), true)
})

test('a console message written over several lines reads back whole from its relay prompt', () => {
  const args = 'call FIELDKIT first line\nsecond line --code abc'
  assert.equal(typed(relayPrompt(args, '0f1e')), `/console ${args}`)
})

test('a queued prompt waits for its transcript copy, whatever the fleet answered on the way', () => {
  const q = { text: 'kiln test\n\nsecond paragraph', op: 4 }
  assert.equal(arrived(q, [], { id: 4, text: 'Sent to Flight.' }), false)
  assert.equal(arrived(q, ['kiln test', '/console list'], { id: 4, text: 'Sent to Flight.' }), false)
  assert.equal(arrived(q, ['kiln test\n\nsecond paragraph'], { id: 4, text: 'Sent to Flight.' }), true)
})

test('a queued slash command leaves once its tags arrive, or once the fleet has run it', () => {
  const q = { text: '/epic-flow --auto  MC-1', op: 5 }
  assert.equal(arrived(q, [typed(TAGS)], null), true)
  assert.equal(arrived(q, [], { id: 5, text: '/epic-flow ran.' }), true)
  assert.equal(arrived(q, [], { id: 3, text: '/epic-flow ran.' }), false)
  assert.equal(arrived({ ...q, op: 0 }, [], { id: 0, text: '/epic-flow ran.' }), false)
})

test('a console command the fleet answers itself leaves on its result; one handed to Flight waits for the transcript', () => {
  assert.deepEqual(handoffs, ['Sent to Flight; it runs once Flight is free.', 'Sent to Flight.'])
  assert.equal(arrived({ text: '/console list', op: 6 }, [], { id: 6, text: 'No consoles staffed.' }), true)
  const staff = { text: '/console staff fieldkit', op: 7 }
  for (const text of handoffs) assert.equal(arrived(staff, [], { id: 7, text }), false, text)
  assert.equal(arrived(staff, [typed(relayPrompt('staff fieldkit', 'ab12'))], { id: 7, text: handoffs[0] }), true)
})

test('an older identical message in the transcript never clears a new one', () => {
  const q = { text: '/briefing', op: 9, before: ['/briefing', 'yes'] }
  assert.equal(arrived(q, ['/briefing', 'yes'], { id: 8, text: 'Sent to Flight.' }), false)
  assert.equal(arrived(q, ['/briefing', 'yes', typed('<command-name>/briefing</command-name>')], null), true)
})

test('the transcript window drops its oldest messages and a copy arriving meanwhile still counts', () => {
  assert.equal(since(['a', 'b', 'yes'], ['b', 'yes', 'c']), 2)
  assert.equal(since(['a', 'b'], ['x']), 0)
  assert.equal(since([], ['x']), 0)
  const q = { text: 'yes', before: ['a', 'b', 'yes'] }
  assert.equal(arrived(q, ['b', 'yes', 'c'], null), false)
  assert.equal(arrived(q, ['b', 'yes', 'c', 'yes'], null), true)
})

test('two identical queued messages leave one for one', () => {
  const first = { id: 1, sent: true, text: 'ok', before: ['hi'] }
  const second = { id: 2, sent: true, text: 'ok', before: ['hi'] }
  assert.deepEqual(waiting([first, second], ['hi', 'ok'], null).map(q => q.id), [2])
  assert.deepEqual(waiting([first, second], ['hi', 'ok', 'ok'], null).map(q => q.id), [])
})

test('a message still sending is kept whatever the transcript holds', () => {
  assert.equal(waiting([{ sent: false, text: 'ok', before: [] }], ['ok'], null).length, 1)
})

test("the fleet's answer showing when a message was sent is not its answer, as after a server restart", () => {
  const q = { text: '/console list', op: 12, lastAt: '2026-10-17T10:00:00.000Z' }
  assert.equal(arrived(q, [], { id: 12, text: 'No consoles staffed.', at: '2026-10-17T10:00:00.000Z' }), false)
  assert.equal(arrived(q, [], { id: 12, text: 'No consoles staffed.', at: '2026-10-17T10:05:00.000Z' }), true)
})

test('a queued prompt with attachments matches its transcript copy', () => {
  const text = `kiln test\n\n${PHOTO_1}\n${DOC}`
  assert.equal(same(text, typed(text)), true)
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
