import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { controllerBrief, parseArgs } from './register'

// The kit stamps origin and presentation on a command run, as a session does.
const run = ($: Engine, args: string) =>
  $.command.run({ command: 'console', args } as Parameters<Engine['command']['run']>[0])

test('parses verbs, positional words and flags', () => {
  expect(parseArgs('staff fieldkit --model sonnet --cwd /tmp/x')).toEqual({
    verb: 'staff', rest: ['fieldkit'], flags: { model: 'sonnet', cwd: '/tmp/x' },
  })
  expect(parseArgs('call FIELDKIT read the hub')).toEqual({
    verb: 'call', rest: ['FIELDKIT', 'read', 'the', 'hub'], flags: {},
  })
  expect(parseArgs('')).toEqual({ verb: '', rest: [], flags: {} })
})

test('the controller brief binds the front and the four-line status check', () => {
  const brief = controllerBrief('fieldkit', 'FIELDKIT')
  expect(brief).toContain('_command/portfolio/fieldkit/_front.md')
  for (const line of ['state:', 'shipped:', 'blocked on you:', 'next:']) expect(brief).toContain(line)
  expect(brief).toContain('Do not merge anything')
})

// The kit strips agentId from a hook's spawn answer (only core starts an
// agent), so the staffed path past spawn is proven by the live run instead.
test('staff spawns a named controller with the front brief and the requested model', async ($, on) => {
  let seen: { name?: string; prompt?: string; model?: string; cwd?: string } = {}
  on('agent.spawn', (_$, e) => {
    seen = { name: e.name, prompt: e.prompt, model: e.model, cwd: e.cwd }
    return { model: 'sonnet', agentId: 'agent-1' }
  })
  const r = await run($, 'staff fieldkit --model sonnet --cwd /tmp/w')
  expect(seen.name).toBe('console-fieldkit')
  expect(seen.prompt).toContain('staffed on the FIELDKIT console')
  expect(seen.model).toBe('sonnet')
  expect(seen.cwd).toBe('/tmp/w')
  expect(r.text).toContain('Could not staff FIELDKIT: no agent id returned')
})

test('an empty fleet lists nothing, and call or stand-down on an unknown sign is refused', async $ => {
  expect((await run($, 'list')).text).toContain('No consoles staffed')
  expect((await run($, 'call GHOST hi')).text).toContain('No staffed console GHOST')
  expect((await run($, 'stand-down GHOST')).text).toContain('No staffed console GHOST')
  expect((await run($, '')).text).toContain('Usage:')
})

test('a refused spawn is reported, not recorded', async ($, on) => {
  on('agent.spawn', () => ({ deny: 'over budget' }))
  const r = await run($, 'staff shelf')
  expect(r.text).toContain('Could not staff SHELF: over budget')
})

test('a flag without a value is an error, not a silent default', async $ => {
  expect(parseArgs('staff fieldkit --model').error).toBe('--model needs a value.')
  expect(parseArgs('staff --model --cwd x').error).toBe('--model needs a value.')
  expect((await run($, 'staff fieldkit --model')).text).toContain('--model needs a value.')
})

test('front names and models are validated before anything spawns', async ($, on) => {
  let spawns = 0
  on('agent.spawn', () => { spawns++; return { deny: 'unexpected' } })
  expect((await run($, 'staff ../../etc')).text).toContain('is not a front name')
  expect((await run($, 'staff fieldkit --model gpt')).text).toContain('--model must be one of')
  expect(spawns).toBe(0)
})

test('a refused spawn releases the reservation, so the next staff tries again', async ($, on) => {
  let spawns = 0
  on('agent.spawn', () => { spawns++; return { deny: 'over budget' } })
  expect((await run($, 'staff shelf')).text).toContain('Could not staff SHELF: over budget')
  expect((await run($, 'staff shelf')).text).toContain('Could not staff SHELF: over budget')
  expect(spawns).toBe(2)
})
