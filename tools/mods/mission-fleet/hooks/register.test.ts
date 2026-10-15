import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseArgs } from './register'

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

// A fake portfolio: one front with two project spokes, answered beneath the plugin.
const FILES: Record<string, string> = {
  '/p/_command/trackers/fronts.md': '# Fronts',
  '/p/_command/portfolio/fieldkit/_front.md': '# fieldkit hub',
  '/p/_command/portfolio/fieldkit/api/api.md': '---\nrepo: api\npath: fronts/fieldkit/api\n---',
  '/p/_command/portfolio/fieldkit/web/web.md': '---\nrepo: web\npath: fronts/fieldkit/web\n---',
}
const DIRS: Record<string, { name: string; kind: 'file' | 'dir'; size: number }[]> = {
  '/p/_command/portfolio/fieldkit': [
    { name: '_front.md', kind: 'file', size: 1 }, { name: 'api', kind: 'dir', size: 0 },
    { name: 'web', kind: 'dir', size: 0 }, { name: 'tasks', kind: 'dir', size: 0 },
  ],
  '/p/_command/portfolio/fieldkit/api': [{ name: 'api.md', kind: 'file', size: 1 }],
  '/p/_command/portfolio/fieldkit/web': [{ name: 'web.md', kind: 'file', size: 1 }],
}
// deno-lint-ignore no-explicit-any
const portfolio = (on: any) => {
  on('session.root', () => ({ value: '/p/fronts/somewhere' }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const text = FILES[e.path]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.list', (_$: unknown, e: { path: string }) => {
    const list = DIRS[e.path]
    return list ? { value: list } : { deny: `ENOENT ${e.path}` }
  })
}

// The kit strips agentId from a hook's spawn answer and does not pass the
// agent type through, so the staffed path and the type are proven live.
test('a front console runs as the controller type in the directory its projects share', async ($, on) => {
  portfolio(on)
  let seen: { name?: string; prompt?: string; model?: string; cwd?: string } = {}
  on('agent.spawn', (_$, e) => {
    seen = { name: e.name, prompt: e.prompt, model: e.model, cwd: e.cwd }
    return { model: 'sonnet', agentId: 'agent-1' }
  })
  const r = await run($, 'staff fieldkit --model sonnet')
  expect(seen.name).toBe('console-fieldkit')
  expect(seen.cwd).toBe('/p/fronts/fieldkit')
  expect(seen.prompt).toContain('Hub: /p/_command/portfolio/fieldkit/_front.md')
  expect(seen.prompt).toContain('/p/_command/portfolio/fieldkit/api/api.md')
  expect(seen.prompt).toContain('up to 4 sub-agents')
  expect(r.text).toContain('Could not staff FIELDKIT: no agent id returned')
})

test('a project console runs in that project\'s repo with its own call sign and budget', async ($, on) => {
  portfolio(on)
  let seen: { name?: string; cwd?: string; prompt?: string } = {}
  on('agent.spawn', (_$, e) => {
    seen = { name: e.name, cwd: e.cwd, prompt: e.prompt }
    return { deny: 'stop here' }
  })
  const r = await run($, 'staff fieldkit --project web --budget 2')
  expect(seen.name).toBe('console-fieldkit-web')
  expect(seen.cwd).toBe('/p/fronts/fieldkit/web')
  expect(seen.prompt).toContain('up to 2 sub-agents')
  expect(r.text).toContain('Could not staff FIELDKIT-WEB: stop here')
})

test('an unknown front or project, or a bad budget, is refused before anything spawns', async ($, on) => {
  portfolio(on)
  let spawns = 0
  on('agent.spawn', () => { spawns++; return { deny: 'unexpected' } })
  expect((await run($, 'staff ghost')).text).toContain('No front "ghost"')
  expect((await run($, 'staff fieldkit --project ghost')).text).toContain('No project "ghost" on front "fieldkit"')
  expect((await run($, 'staff fieldkit --budget 99')).text).toContain('--budget must be a whole number')
  expect(spawns).toBe(0)
})

test('an empty fleet lists nothing, and call or stand-down on an unknown sign is refused', async $ => {
  expect((await run($, 'list')).text).toContain('No consoles staffed')
  expect((await run($, 'call GHOST hi')).text).toContain('No staffed console GHOST')
  expect((await run($, 'stand-down GHOST')).text).toContain('No staffed console GHOST')
  expect((await run($, '')).text).toContain('Usage:')
})

test('a refused spawn is reported, not recorded', async ($, on) => {
  portfolio(on)
  on('agent.spawn', () => ({ deny: 'over budget' }))
  const r = await run($, 'staff fieldkit')
  expect(r.text).toContain('Could not staff FIELDKIT: over budget')
})

test('a flag without a value is an error, not a silent default', async $ => {
  expect(parseArgs('staff fieldkit --model').error).toBe('--model needs a value.')
  expect(parseArgs('staff --model --cwd x').error).toBe('--model needs a value.')
  expect((await run($, 'staff fieldkit --model')).text).toContain('--model needs a value.')
})

test('front names and models are validated before anything spawns', async ($, on) => {
  portfolio(on)
  let spawns = 0
  on('agent.spawn', () => { spawns++; return { deny: 'unexpected' } })
  expect((await run($, 'staff ../../etc')).text).toContain('is not a front or project name')
  expect((await run($, 'staff fieldkit --model gpt')).text).toContain('--model must be one of')
  expect(spawns).toBe(0)
})

test('a refused spawn releases the reservation, so the next staff tries again', async ($, on) => {
  portfolio(on)
  let spawns = 0
  on('agent.spawn', () => { spawns++; return { deny: 'over budget' } })
  expect((await run($, 'staff fieldkit')).text).toContain('Could not staff FIELDKIT: over budget')
  expect((await run($, 'staff fieldkit')).text).toContain('Could not staff FIELDKIT: over budget')
  expect(spawns).toBe(2)
})

test('retune and effort input is validated, and an unknown console is refused', async ($, on) => {
  portfolio(on)
  let spawns = 0
  on('agent.spawn', () => { spawns++; return { deny: 'unexpected' } })
  expect((await run($, 'staff fieldkit --effort huge')).text).toContain('--effort must be one of low, medium, high, xhigh, max')
  expect(spawns).toBe(0)
  expect((await run($, 'retune GHOST opus high')).text).toContain('No staffed console GHOST')
})

test('dismiss on an unknown console is refused like stand-down', async $ => {
  expect((await run($, 'dismiss GHOST')).text).toContain('No staffed console GHOST')
})

test('a controller-type spawn that does not come from the console is refused', async ($, on) => {
  let reached = false
  on('agent.spawn', () => { reached = true; return { model: 'sonnet' } })
  const r = await $.agent.spawn({ prompt: 'hi', subagentType: 'mission-fleet:controller' } as Parameters<Engine['agent']['spawn']>[0])
  expect(r.deny).toBe('Controllers are staffed only through /console staff.')
  expect(reached).toBe(false)
})

test('go and no-go are the founder\'s: refused through Flight\'s tool, answered for a typed command', async ($, on) => {
  portfolio(on)
  const viaTool = await $.tool.call({ tool: 'mcp__mission-fleet__console', args: 'go FI1' } as Parameters<Engine['tool']['call']>[0])
  expect(JSON.stringify(viaTool)).toContain('founder')
  const typed = await $.command.run({ command: 'console', args: 'go FI1', origin: { kind: 'composer' } } as Parameters<Engine['command']['run']>[0])
  expect(typed.text).toContain('No poll item FI1')
  const unknown = await $.command.run({ command: 'console', args: 'go FI1', origin: { kind: 'sdk' } } as Parameters<Engine['command']['run']>[0])
  expect(unknown.text).toContain('founder')
  expect((await run($, 'go FI1')).text).toContain('founder')
  expect((await run($, 'poll')).text).toContain('Nothing is waiting on the founder')
})

test('the app is the founder\'s to start: refused through Flight\'s tool', async $ => {
  const viaTool = await $.tool.call({ tool: 'mcp__mission-fleet__console', args: 'app' } as Parameters<Engine['tool']['call']>[0])
  expect(JSON.stringify(viaTool)).toContain('founder')
})
