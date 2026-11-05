// tools/spend.mjs: tokens per agent and model, summed from session transcripts.
// Run: node --test tools/tests/spend.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { aggregate, report } from '../spend.mjs'

const SPEND = fileURLToPath(new URL('../spend.mjs', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'mc-spend-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const call = (id, model, u, at = '2026-11-05T10:00:00Z') => JSON.stringify({ type: 'assistant', timestamp: at, uuid: `u-${id}-${Math.random()}`, message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: u[0], output_tokens: u[1], cache_read_input_tokens: u[2], cache_creation_input_tokens: u[3] } } })
const user = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })

// A session with two models in the main file (one response written twice, as a two-block response is) and one subagent.
const SID = '11111111-2222-3333-4444-555555555555'
const proj = join(scratch, 'projects', '-work')
mkdirSync(join(proj, SID, 'subagents'), { recursive: true })
const main = join(proj, `${SID}.jsonl`)
writeFileSync(main, [user, call('m1', 'model-big', [10, 100, 1000, 50]), call('m1', 'model-big', [10, 100, 1000, 50]), call('m2', 'model-big', [20, 200, 2000, 0]), call('m3', 'model-small', [5, 7, 11, 13]), JSON.stringify({ type: 'assistant', message: { id: 'syn', model: '<synthetic>', usage: { input_tokens: 99, output_tokens: 99 } } })].join('\n') + '\n')
writeFileSync(join(proj, SID, 'subagents', 'agent-aa.jsonl'), [call('s1', 'model-small', [1, 2, 3, 4]), call('s2', 'model-small', [1, 2, 3, 4])].join('\n') + '\n')
writeFileSync(join(proj, SID, 'subagents', 'agent-aa.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'look around' }))

test('a fixture with two models and one subagent gives the expected lines', () => {
  const s = aggregate(main)
  const by = Object.fromEntries(s.lines.map(l => [`${l.label}/${l.model}`, l]))
  assert.deepEqual(Object.keys(by).sort(), ['look around/model-small', 'main session/model-big', 'main session/model-small'])
  // m1 counts once although its line is written twice; the synthetic placeholder is not a call.
  assert.deepEqual([by['main session/model-big'].calls, by['main session/model-big'].input, by['main session/model-big'].output, by['main session/model-big'].cacheRead, by['main session/model-big'].cacheWrite], [2, 30, 300, 3000, 50])
  assert.deepEqual([by['main session/model-small'].calls, by['main session/model-small'].input, by['main session/model-small'].output, by['main session/model-small'].cacheRead, by['main session/model-small'].cacheWrite], [1, 5, 7, 11, 13])
  assert.deepEqual([by['look around/model-small'].calls, by['look around/model-small'].input], [2, 2])
  assert.equal(by['look around/model-small'].type, 'Explore')
})

test('the report names every agent, each model, and a total that adds up', () => {
  const text = report(aggregate(main))
  assert.match(text, /\| look around \| Explore \| model-small \| 2 \| 2 \| 6 \| 8 \| 4 \|/)
  assert.match(text, /\| model-small \| 3 \| 7 \| 17 \| 21 \| 11 \|/)
  assert.match(text, /\| \*\*total\*\* \| 5 \| 37 \| 3,017 \| 71 \| 311 \|/)
})

test('the CLI reads a session by id from MCSPEND_PROJECTS and lists recent sessions', () => {
  const env = { ...process.env, MCSPEND_PROJECTS: join(scratch, 'projects'), MCAPP_HOME: join(scratch, 'nohome') }
  const one = spawnSync(process.execPath, [SPEND, '--session', SID.slice(0, 8)], { env, encoding: 'utf8' })
  assert.equal(one.status, 0, one.stderr)
  assert.match(one.stdout, /session 11111111/)
  assert.match(one.stdout, /\| main session \| main \| model-big \| 2 \| 30 \|/)
  const list = spawnSync(process.execPath, [SPEND, '--sessions'], { env, encoding: 'utf8' })
  assert.match(list.stdout, /11111111  5 calls  3,436 tokens  3 lines/)
  const none = spawnSync(process.execPath, [SPEND, '--session', 'ffffffff'], { env, encoding: 'utf8' })
  assert.equal(none.status, 1)
  assert.match(none.stderr, /No transcript found/)
})
