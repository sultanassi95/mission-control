import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import type { Console, PendingAdvisory, PollItem } from '../types'
import { parseArgs } from './register'

// The kit stamps origin and presentation on a command run, as a session does.
const run = ($: Engine, args: string) =>
  $.command.run({ command: 'console', args } as Parameters<Engine['command']['run']>[0])

// The founder typing the command at the prompt box.
const person = ($: Engine, args: string) =>
  $.command.run({ command: 'console', args, origin: { kind: 'composer' } } as Parameters<Engine['command']['run']>[0])

test('parses verbs, positional words and flags', () => {
  expect(parseArgs('staff fieldkit --model sonnet --cwd /tmp/x')).toEqual({
    verb: 'staff', rest: ['fieldkit'], flags: { model: 'sonnet', cwd: '/tmp/x' },
  })
  expect(parseArgs('call FIELDKIT read the hub')).toEqual({
    verb: 'call', rest: ['FIELDKIT', 'read', 'the', 'hub'], flags: {},
  })
  expect(parseArgs('')).toEqual({ verb: '', rest: [], flags: {} })
})

// A fake portfolio: one front with two project spokes, a second front, and a third whose folder is
// itself its repository (kiln's spoke path is fronts/kiln), answered beneath the plugin.
const FILES: Record<string, string> = {
  '/p/_command/trackers/fronts.md': '# Fronts',
  '/p/_command/portfolio/fieldkit/_front.md': '# fieldkit hub',
  '/p/_command/portfolio/fieldkit/api/api.md': '---\nrepo: api\npath: fronts/fieldkit/api\nremote: git@github.com:fieldkit-org/api.git\n---',
  '/p/_command/portfolio/fieldkit/web/web.md': '---\nrepo: web\npath: fronts/fieldkit/web\nremote: git@personal-github:FieldKit-Labs/web.git   (the partner key)\n---',
  '/p/_command/portfolio/shelf/_front.md': '# shelf hub',
  '/p/_command/portfolio/shelf/shelf.md': '---\nrepo: shelf\npath: fronts/shelf/shelf\nremote: git@github.com:shelf-co/shelf.git\n---',
  '/p/_command/portfolio/kiln/_front.md': '# kiln hub',
  '/p/_command/portfolio/kiln/kiln.md': '---\nrepo: kiln\npath: fronts/kiln\nremote: https://codeberg.org/kiln/kiln.git\n---',
}
const DIRS: Record<string, { name: string; kind: 'file' | 'dir'; size: number }[]> = {
  // Beside the three fronts: a folder whose name is no front's, one with no hub, and a file.
  '/p/_command/portfolio': [
    { name: 'fieldkit', kind: 'dir', size: 0 }, { name: 'kiln', kind: 'dir', size: 0 }, { name: 'shelf', kind: 'dir', size: 0 },
    { name: '_archive', kind: 'dir', size: 0 }, { name: 'drafts', kind: 'dir', size: 0 }, { name: 'README.md', kind: 'file', size: 1 },
  ],
  '/p/_command/portfolio/_archive': [{ name: '_front.md', kind: 'file', size: 1 }],
  '/p/_command/portfolio/drafts': [{ name: 'notes.md', kind: 'file', size: 1 }],
  '/p/_command/portfolio/kiln': [{ name: '_front.md', kind: 'file', size: 1 }, { name: 'kiln.md', kind: 'file', size: 1 }],
  '/p/_command/portfolio/fieldkit': [
    { name: '_front.md', kind: 'file', size: 1 }, { name: 'api', kind: 'dir', size: 0 },
    { name: 'web', kind: 'dir', size: 0 }, { name: 'tasks', kind: 'dir', size: 0 },
  ],
  '/p/_command/portfolio/fieldkit/api': [{ name: 'api.md', kind: 'file', size: 1 }],
  '/p/_command/portfolio/fieldkit/web': [{ name: 'web.md', kind: 'file', size: 1 }],
  '/p/_command/portfolio/shelf': [{ name: '_front.md', kind: 'file', size: 1 }, { name: 'shelf.md', kind: 'file', size: 1 }],
}
// With unlisted, the portfolio's own folder cannot be listed, as when its permissions shut a reader out.
// deno-lint-ignore no-explicit-any
const portfolio = (on: any, unlisted = false) => {
  on('session.root', () => ({ value: '/p/fronts/somewhere' }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const text = FILES[e.path]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.list', (_$: unknown, e: { path: string }) => {
    if (unlisted && e.path === '/p/_command/portfolio') return { deny: `EACCES ${e.path}` }
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

// A user-level /console skill makes the engine refuse the plugin's own command registration. That
// refusal must not stop the Controller type and the console tool from registering.
test('a refused console command still registers the controller type and the console tool', async ($, on) => {
  const registered: string[] = []
  const written: { path: string; text: string }[] = []
  on('command.register', () => ({ deny: '"/console" refused: it is the user\'s /console' }))
  // Answered as the engine answers: the registered type's and tool's full names.
  on('agent.register', (_$, e) => { registered.push(`agent:${e.name}`); return { value: { agent: `mission-fleet:${e.name}` } } })
  on('tool.register', (_$, e) => { registered.push(`tool:${e.name}`); return { value: { tool: `mcp__mission-fleet__${e.name}` } } })
  on('session.start', () => ({ cwd: '/p' }))
  on('session.root', () => ({ value: '/p' }))
  on('fs.read', (_$, e) => (e.path === '/p/_command/trackers/fronts.md' ? { value: '# Fronts' } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', (_$, e) => { written.push({ path: e.path, text: e.text }); return { value: undefined } })
  await $.session.start({ cwd: '/p' } as Parameters<Engine['session']['start']>[0])
  expect(registered).toContain('agent:controller')
  expect(registered).toContain('tool:console')
  const line = written.find(w => w.path === '/p/_command/fleet/audit.log')?.text ?? ''
  expect(line).toContain('session.start')
  expect(line).toContain('command.register')
  expect(line).toContain('refused: it is the user')
})

// The engine may list a plugin's tool behind ToolSearch; tool.describe's answer decides. Each test
// answers beneath the mod as the engine would when it defers a tool, before its first call on `$`.
const deferBeneath = (on: Parameters<TestBody>[1]) => on('tool.describe', (_$, e) => ({ description: e.description, isDeferred: true }))
const placement = ($: Engine, tool: string, description: string) =>
  $.tool.describe({ tool, description } as Parameters<Engine['tool']['describe']>[0])

test('the console tool stays in the prompt list where the engine would defer it', async ($, on) => {
  deferBeneath(on)
  const r = await placement($, 'mcp__mission-fleet__console', 'the console text')
  expect(r.isDeferred).toBe(false)
  expect(r.description).toBe('the console text')
})

// Another plugin's tool, and a name that only begins with the console tool's, keep the engine's placement.
test('another tool the engine defers stays deferred', async ($, on) => {
  deferBeneath(on)
  expect((await placement($, 'mcp__other__tool', 'other')).isDeferred).toBe(true)
  expect((await placement($, 'mcp__mission-fleet__consoles', 'consoles')).isDeferred).toBe(true)
})

test('a go through Flight\'s tool with a code the app never minted is refused', async ($, on) => {
  portfolio(on)
  const forged = await $.tool.call({ tool: 'mcp__mission-fleet__console', args: `go FI1 --code ${'f'.repeat(32)}` } as Parameters<Engine['tool']['call']>[0])
  expect(JSON.stringify(forged)).toContain('unknown, used or expired')
  expect(JSON.stringify(forged)).not.toContain('No poll item')
})

// ---- Undelivered decisions (MC-119) ----

// The refusal MI1's GO met on 2026-10-16, in part: written for the model, not for the founder.
const AUTO_MODE = 'The server-side auto mode classifier gave no verdict for SendMessage: the request that produced this action did not ask for one. Issue the action again once, as-is; if it is denied again, continue with other tasks and tell the user.'
const MC: Console = {
  callSign: 'MISSION-CONTROL', front: 'mission-control', name: 'console-mission-control', agentId: 'a1', cwd: '/p/fronts/mission-control',
  budget: 4, protectedBranches: [], model: 'opus', staffedAt: '2026-10-16T00:20:00.000Z', status: 'staffed',
}
const MI1: PollItem = {
  id: 'MI1', at: '2026-10-16T00:30:12.000Z', from: 'MISSION-CONTROL', kind: 'gate', title: 'approve the plan',
  detail: 'state: planned\nblocked on you: approve the plan', state: 'go', agentId: 'a1', decidedAt: '2026-10-16T00:37:00.000Z', undelivered: AUTO_MODE,
}
const OPEN: PollItem = { id: 'MI2', at: '2026-10-16T00:50:00.000Z', from: 'MISSION-CONTROL', kind: 'gate', title: 'merge the fix', detail: 'blocked on you: merge the fix', state: 'open', agentId: 'a1' }

// The fleet as a live session holds it, answered beneath the plugin until the plugin writes its own.
// deno-lint-ignore no-explicit-any
const seed = (on: any, values: { poll?: PollItem[]; consoles?: Console[]; pending?: PendingAdvisory[] }) => {
  on('state.get', async (_$: unknown, e: { plugin: string; key: string }, next: (e: unknown) => Promise<{ value?: { version: number } }>) => {
    const got = await next(e)
    const held = e.plugin === 'mission-fleet' ? values[e.key as keyof typeof values] : undefined
    return held !== undefined && got.value?.version === 0 ? { value: { value: held, version: 0 } } : got
  })
}

// Every poll the plugin writes, in order.
// deno-lint-ignore no-explicit-any
const pollWrites = (on: any) => {
  const seen: PollItem[][] = []
  on('state.set', (_$: unknown, e: { plugin: string; key: string; value: unknown }, next: (e: unknown) => unknown) => {
    if (e.plugin === 'mission-fleet' && e.key === 'poll') seen.push(e.value as PollItem[])
    return next(e)
  })
  return seen
}

// The lines the plugin appends to its audit log (the only audit.log in the fake portfolio).
// deno-lint-ignore no-explicit-any
const auditLines = (on: any) => {
  const lines: string[] = []
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (e.path.endsWith('/audit.log')) lines.push(...e.text.split('\n').filter(l => l !== '' && !l.startsWith('#')))
    return { value: undefined }
  })
  return lines
}

test('the poll the session holds is the one the console reads (the seed these tests stand on)', async ($, on) => {
  portfolio(on)
  seed(on, { poll: [OPEN], consoles: [MC] })
  expect((await person($, 'poll')).text).toContain('MI2  MISSION-CONTROL  gate: merge the fix')
})

test('retry sends an undelivered GO again to the Controller that raised it, and clears it once delivered', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  const polls = pollWrites(on)
  seed(on, { poll: [{ ...MI1, sentAt: '2026-10-16T00:40:00.000Z' }], consoles: [MC] })
  const sent: { to: string; text: string }[] = []
  on('session.send', (_$, e) => {
    sent.push({ to: JSON.stringify(e.to), text: e.text })
    return { isDelivered: true }
  })
  const r = await person($, 'retry MI1')
  expect(r.text).toContain('MI1: GO delivered to MISSION-CONTROL on retry.')
  expect(sent).toHaveLength(1)
  expect(sent[0]?.to).toContain('a1')
  expect(sent[0]?.text).toContain('GO from the founder on MI1.')
  expect(sent[0]?.text).toContain('It answers your report of 2026-10-16T00:30:')
  const after = polls.at(-1)?.find(p => p.id === 'MI1')
  expect(after?.state).toBe('go')
  expect(after?.undelivered).toBeUndefined()
  expect(after?.sentAt).toBeUndefined()
  expect(audit.join('\n')).toContain('\tgo\tMI1\ttold MISSION-CONTROL on retry')
})

test('a retry refused again keeps the decision undelivered, with the new reason in plain words', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  seed(on, { poll: [{ ...MI1, undelivered: 'no agent recorded for this item' }], consoles: [MC] })
  on('session.send', () => ({ isDelivered: false, reason: AUTO_MODE }))
  const r = await person($, 'retry MI1')
  expect(r.text).toContain('MI1: GO still not delivered to MISSION-CONTROL. Auto mode blocked the message.')
  expect(r.text).not.toContain('Issue the action again')
  const listed = (await person($, 'poll')).text
  expect(listed).toContain('MI1  MISSION-CONTROL: GO not delivered. Auto mode blocked the message.')
  expect(listed).not.toContain('No Controller was staffed')
  expect(audit.join('\n')).toContain('\tretry\tMI1\tNOT delivered: The server-side auto mode classifier')
})

test('retry sends nothing to a Controller that is no longer staffed, and says to staff the console again', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  seed(on, { poll: [MI1], consoles: [{ ...MC, status: 'stood-down' }] })
  let sends = 0
  on('session.send', () => {
    sends++
    return { isDelivered: true }
  })
  const r = await person($, 'retry MI1')
  expect(r.text).toMatch(/nothing was sent/)
  expect(r.text).toMatch(/staff the console again/i)
  expect(sends).toBe(0)
  expect(audit.join('\n')).toContain('\tretry\tMI1\tnot sent: the Controller that raised it is no longer staffed')
})

test('retry never reaches a later Controller under the same call sign, and does not ask to staff one', async ($, on) => {
  portfolio(on)
  // Staffing a call sign again replaces its console entry, so only the new agent is on record.
  seed(on, { poll: [MI1], consoles: [{ ...MC, agentId: 'a2', staffedAt: '2026-10-16T01:00:00.000Z' }] })
  let sends = 0
  on('session.send', () => {
    sends++
    return { isDelivered: true }
  })
  const r = await person($, 'retry MI1')
  expect(r.text).toMatch(/nothing was sent/)
  expect(r.text).toContain('has been replaced')
  expect(r.text).not.toMatch(/staff the console again/i)
  expect(sends).toBe(0)
})

test('retry is the founder\'s: refused through Flight\'s tool without the app\'s code, answered when typed', async ($, on) => {
  portfolio(on)
  seed(on, { poll: [MI1], consoles: [MC] })
  expect((await run($, 'retry MI1')).text).toContain('founder')
  const viaTool = await $.tool.call({ tool: 'mcp__mission-fleet__console', args: 'retry MI1' } as Parameters<Engine['tool']['call']>[0])
  expect(JSON.stringify(viaTool)).toContain('founder')
  const forged = await $.tool.call({ tool: 'mcp__mission-fleet__console', args: `retry MI1 --code ${'e'.repeat(32)}` } as Parameters<Engine['tool']['call']>[0])
  expect(JSON.stringify(forged)).toContain('unknown, used or expired')
  expect((await person($, 'retry MI2')).text).toContain('No poll item MI2')
})

test('dismiss-gate clears an undelivered decision without sending anything, and the audit says so', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  const polls = pollWrites(on)
  seed(on, { poll: [MI1], consoles: [MC] })
  let sends = 0
  on('session.send', () => {
    sends++
    return { isDelivered: true }
  })
  const r = await person($, 'dismiss-gate MI1')
  expect(r.text).toContain('MI1 dismissed')
  expect(sends).toBe(0)
  const after = polls.at(-1)?.find(p => p.id === 'MI1')
  expect(after?.state).toBe('dismissed')
  expect(after?.undelivered).toBe(AUTO_MODE)
  expect(audit.join('\n')).toContain('\tdismissed\tMI1\tundelivered decision cleared, nothing sent')
  expect((await person($, 'poll')).text).not.toContain('MI1')
  expect((await person($, 'dismiss-gate MI1')).text).toContain('MI1 is already closed: dismissed.')
  expect((await person($, 'retry MI1')).text).toContain('MI1 has no undelivered decision to retry')
})

test('dismiss-gate still refuses a decision that was delivered', async ($, on) => {
  portfolio(on)
  const delivered: PollItem = { ...MI1 }
  delete delivered.undelivered
  seed(on, { poll: [delivered], consoles: [MC] })
  expect((await person($, 'dismiss-gate MI1')).text).toContain('MI1 is already closed: go.')
  expect((await person($, 'retry MI1')).text).toContain('MI1 has no undelivered decision to retry')
})

test('the poll says in plain words why a decision was not delivered, and to staff the console only when it is gone', async ($, on) => {
  portfolio(on)
  seed(on, { poll: [MI1, { ...MI1, id: 'AC1', from: 'ACME', agentId: 'k1', at: '2026-10-16T00:31:00.000Z' }], consoles: [MC, { ...MC, callSign: 'ACME', front: 'acme', name: 'console-acme', agentId: 'k1', status: 'stood-down' }] })
  const listed = (await person($, 'poll')).text ?? ''
  expect(listed).not.toContain('Issue the action again')
  const mi1 = listed.split('\n').find(l => l.includes('MI1')) ?? ''
  const ac1 = listed.split('\n').find(l => l.includes('AC1')) ?? ''
  expect(mi1).toContain('Auto mode blocked the message.')
  expect(mi1).toContain('/console retry MI1')
  expect(mi1).not.toMatch(/staff the console again/i)
  expect(ac1).toMatch(/staff the console again/i)
  expect(ac1).not.toContain('/console retry AC1')
})

test('a GO that is refused frees its card at once, so Retry is offered without waiting out the app\'s hold', async ($, on) => {
  portfolio(on)
  const polls = pollWrites(on)
  seed(on, { poll: [{ ...OPEN, sentAt: '2026-10-16T00:55:00.000Z' }], consoles: [MC] })
  on('session.send', () => ({ isDelivered: false, reason: AUTO_MODE }))
  const r = await person($, 'go MI2')
  expect(r.text).toContain('MI2: GO recorded, but NOT delivered to MISSION-CONTROL. Auto mode blocked the message.')
  expect(r.text).not.toContain('Issue the action again')
  const after = polls.at(-1)?.find(p => p.id === 'MI2')
  expect(after?.state).toBe('go')
  expect(after?.undelivered).toBe(AUTO_MODE)
  expect(after?.sentAt).toBeUndefined()
})

test('every undelivered decision is listed, not only the newest three', async ($, on) => {
  portfolio(on)
  const ids = ['MI1', 'MI3', 'MI4', 'MI5']
  seed(on, { poll: ids.map((id, k) => ({ ...MI1, id, at: `2026-10-16T00:3${k}:00.000Z` })), consoles: [MC] })
  const listed = (await person($, 'poll')).text ?? ''
  for (const id of ids) expect(listed).toContain(`  ${id}  MISSION-CONTROL: GO not delivered.`)
})

// ---- Held decisions (MC-122) ----

// MI2's Controller, a1, after it was dismissed.
const DOWN: Console = { ...MC, status: 'stood-down' }
// The call sign staffed again: a2 is the next MISSION-CONTROL Controller.
const NEXT: Console = { ...MC, agentId: 'a2', staffedAt: '2026-10-16T01:00:00.000Z' }
const HELD: PollItem = { ...OPEN, state: 'go', decidedAt: '2026-10-16T00:58:00.000Z', held: '2026-10-16T00:58:00.000Z' }
const ADVISORY: PendingAdvisory = { id: 'p1', front: 'mission-control', text: 'Advisory from Flight: ACME reports a contract change: /v1 ids.', at: '2026-10-16T00:40:00.000Z' }

// Every value the plugin writes under each given state key, in order. One handler records them all:
// the kit loads a test's hooks only when each event has a single handler, so this never runs beside pollWrites.
// deno-lint-ignore no-explicit-any
const writes = (on: any, ...keys: string[]) => {
  const seen = new Map<string, unknown[]>(keys.map(k => [k, []]))
  on('state.set', (_$: unknown, e: { plugin: string; key: string; value: unknown }, next: (e: unknown) => unknown) => {
    if (e.plugin === 'mission-fleet') seen.get(e.key)?.push(e.value)
    return next(e)
  })
  return seen
}

test('a GO for the Controller that raised the gate, still staffed, goes to it and is not held', async ($, on) => {
  portfolio(on)
  const polls = pollWrites(on)
  seed(on, { poll: [OPEN], consoles: [MC] })
  const to: string[] = []
  on('session.send', (_$, e) => {
    to.push(JSON.stringify(e.to))
    return { isDelivered: true }
  })
  const r = await person($, 'go MI2')
  expect(to).toHaveLength(1)
  expect(to[0]).toContain('a1')
  expect(r.text).toContain('MI2: GO recorded, told MISSION-CONTROL.')
  expect(polls.at(-1)?.find(p => p.id === 'MI2')?.held).toBeUndefined()
})

test('a GO for a Controller that is stood down is held, nothing is sent, and the poll says so', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  const polls = pollWrites(on)
  seed(on, { poll: [OPEN], consoles: [DOWN] })
  let sends = 0
  on('session.send', () => {
    sends++
    return { isDelivered: true }
  })
  const r = await person($, 'go MI2')
  expect(sends).toBe(0)
  expect(r.text).toContain('MI2: GO recorded and held for the next MISSION-CONTROL Controller')
  const after = polls.at(-1)?.find(p => p.id === 'MI2')
  expect(after?.state).toBe('go')
  expect(after?.held).toBeTruthy()
  expect(after?.undelivered).toBeUndefined()
  expect(audit.join('\n')).toContain('\theld\tMI2\tfor MISSION-CONTROL')
  const listed = (await person($, 'poll')).text ?? ''
  expect(listed).toContain('Held for the next Controller')
  expect(listed).toContain('  MI2  MISSION-CONTROL: GO held')
})

test('a held GO goes once to the Controller staffed now under that call sign, with its report and the held advisories', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  const seen = writes(on, 'poll', 'pending')
  const polls = seen.get('poll') as PollItem[][]
  const pendings = seen.get('pending') as PendingAdvisory[][]
  seed(on, { poll: [OPEN], consoles: [NEXT], pending: [ADVISORY] })
  const sent: { to: string; text: string }[] = []
  on('session.send', (_$, e) => {
    sent.push({ to: JSON.stringify(e.to), text: e.text })
    return { isDelivered: true }
  })
  const r = await person($, 'go MI2 ship it')
  expect(sent).toHaveLength(1)
  expect(sent[0]?.to).toContain('a2')
  expect(sent[0]?.to).not.toContain('a1')
  expect(sent[0]?.text).toContain('GO on MI2: ship it')
  expect(sent[0]?.text).toContain('blocked on you: merge the fix')
  expect(sent[0]?.text).toContain('ACME reports a contract change: /v1 ids.')
  expect(r.text).toContain('MI2: GO recorded and handed to the MISSION-CONTROL Controller staffed now')
  const after = polls.at(-1)?.find(p => p.id === 'MI2')
  expect(after?.state).toBe('go')
  expect(after?.held).toBeUndefined()
  expect(after?.undelivered).toBeUndefined()
  expect(pendings.at(-1)).toEqual([])
  const lines = audit.join('\n')
  expect(lines).toContain('\theld\tMI2\tfor MISSION-CONTROL')
  expect(lines).toContain('\theld\tMI2\tdelivered to MISSION-CONTROL')
})

test('a GO decided while another hand-over is still sending reaches the Controller staffed now once, and so does that one', async ($, on) => {
  portfolio(on)
  const polls = pollWrites(on)
  const MI3: PollItem = { ...OPEN, id: 'MI3', at: '2026-10-16T00:51:00.000Z', title: 'tag the release', detail: 'blocked on you: tag the release' }
  seed(on, { poll: [OPEN, MI3], consoles: [NEXT] })
  const sent: string[] = []
  let second: ReturnType<typeof person> | undefined
  on('session.send', async (_$, e) => {
    sent.push(e.text)
    // The second GO is decided while the first hand-over's message is still on its way.
    if (!second) {
      second = person($, 'go MI3')
      await second
    }
    return { isDelivered: true }
  })
  const first = await person($, 'go MI2')
  const other = await second
  expect(sent.filter(t => t.includes('GO on MI2')).length).toBe(1)
  expect(sent.filter(t => t.includes('GO on MI3')).length).toBe(1)
  expect(first.text).toContain('MI2: GO recorded and handed to the MISSION-CONTROL Controller staffed now')
  expect(other?.text).toContain('MI3: GO recorded and handed to the MISSION-CONTROL Controller staffed now')
  for (const id of ['MI2', 'MI3']) {
    const after = polls.at(-1)?.find(p => p.id === id)
    expect(after?.state).toBe('go')
    expect(after?.held).toBeUndefined()
  }
})

test('a held GO the Controller staffed now cannot receive becomes undelivered, and the poll says it was replaced', async ($, on) => {
  portfolio(on)
  const polls = pollWrites(on)
  seed(on, { poll: [OPEN], consoles: [NEXT] })
  const to: string[] = []
  on('session.send', (_$, e) => {
    to.push(JSON.stringify(e.to))
    return { isDelivered: false, reason: AUTO_MODE }
  })
  const r = await person($, 'go MI2')
  expect(to).toHaveLength(1)
  expect(to[0]).toContain('a2')
  expect(r.text).toContain('NOT delivered')
  expect(r.text).toContain('Auto mode blocked the message.')
  const after = polls.at(-1)?.find(p => p.id === 'MI2')
  expect(after?.state).toBe('go')
  expect(after?.held).toBeUndefined()
  expect(after?.undelivered).toBe(AUTO_MODE)
  const listed = (await person($, 'poll')).text ?? ''
  expect(listed).toContain('  MI2  MISSION-CONTROL: GO not delivered.')
  expect(listed).toContain('has been replaced')
})

test('dismiss-gate clears a held decision with nothing sent, and the audit says so', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  const polls = pollWrites(on)
  seed(on, { poll: [HELD], consoles: [DOWN] })
  let sends = 0
  on('session.send', () => {
    sends++
    return { isDelivered: true }
  })
  const r = await person($, 'dismiss-gate MI2')
  expect(r.text).toContain('MI2 dismissed: the held GO is cleared.')
  expect(sends).toBe(0)
  expect(polls.at(-1)?.find(p => p.id === 'MI2')?.state).toBe('dismissed')
  expect(audit.join('\n')).toContain('\tdismissed\tMI2\theld decision cleared, nothing sent')
  expect((await person($, 'poll')).text).not.toContain('MI2')
})

test('an item raised before agent ids were recorded is held when nothing is staffed under its call sign', async ($, on) => {
  portfolio(on)
  const polls = pollWrites(on)
  seed(on, { poll: [{ ...OPEN, agentId: '' }], consoles: [DOWN] })
  let sends = 0
  on('session.send', () => {
    sends++
    return { isDelivered: true }
  })
  const r = await person($, 'go MI2')
  expect(sends).toBe(0)
  expect(r.text).toContain('held for the next MISSION-CONTROL Controller')
  const after = polls.at(-1)?.find(p => p.id === 'MI2')
  expect(after?.held).toBeTruthy()
  expect(after?.undelivered).toBeUndefined()
})

// ---- Clones and whole call text (MC-126, MC-135) ----

// A staffed FIELDKIT Controller, its record as staffing writes it: its front's folder, and every front the portfolio has.
const FK: Console = {
  callSign: 'FIELDKIT', front: 'fieldkit', name: 'console-fieldkit', agentId: 'f1', cwd: '/p/fronts/fieldkit', budget: 4, protectedBranches: [],
  cloneHome: '/p/fronts/fieldkit', cloneFronts: ['fieldkit', 'kiln', 'shelf'], model: 'opus', staffedAt: '2026-10-16T09:00:00.000Z', status: 'staffed',
}
// The record of a console staffed before clones were allowed: no folder or fronts on it.
const legacy = (c: Console): Console => {
  const old = { ...c }
  delete old.cloneHome
  delete old.cloneFronts
  return old
}
// The record of a console staffed while a clone came only from its spokes' owners into its own front: the owners, and no fronts.
const ownFrontOnly = (c: Console): Console => ({ ...legacy(c), cloneHome: c.cloneHome, cloneOwners: ['fieldkit-labs', 'fieldkit-org'] } as Console)

test('staffing again replaces a stood-down record with one carrying its front\'s folder and the portfolio\'s fronts, for a front and a project console', async ($, on) => {
  portfolio(on)
  // FIELDKIT was staffed before clones were allowed, then stood down.
  seed(on, { consoles: [{ ...legacy(FK), status: 'stood-down' }] })
  const seen = writes(on, 'consoles')
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)
    return { deny: 'stop here' }
  })
  expect((await run($, 'staff fieldkit')).text).toContain('Could not staff FIELDKIT: stop here')
  expect((await run($, 'staff fieldkit --project web')).text).toContain('Could not staff FIELDKIT-WEB: stop here')
  expect((await run($, 'staff kiln')).text).toContain('Could not staff KILN: stop here')
  // The kit strips a spawn's agentId, so the record is read from the reservation the staffing wrote.
  const written = seen.get('consoles') as Console[][]
  // The reservation is the first write: the stood-down record is replaced, never kept beside it.
  expect(written[0]?.filter(c => c.callSign === 'FIELDKIT').map(c => c.status)).toEqual(['staffing'])
  const reserved = written.flat().filter(c => c.status === 'staffing')
  const front = reserved.find(c => c.callSign === 'FIELDKIT')
  const web = reserved.find(c => c.callSign === 'FIELDKIT-WEB')
  const kiln = reserved.find(c => c.callSign === 'KILN')
  // Every portfolio folder with a hub is a front; _archive (no front's name), drafts (no hub) and README.md are not.
  expect(front?.cloneFronts).toEqual(['fieldkit', 'kiln', 'shelf'])
  expect(front?.cloneHome).toBe('/p/fronts/fieldkit')
  expect(web?.cloneFronts).toEqual(['fieldkit', 'kiln', 'shelf'])
  expect(web?.cloneHome).toBe('/p/fronts/fieldkit')
  expect(web?.cwd).toBe('/p/fronts/fieldkit/web')
  // A front whose folder is its repository is staffed with clones like any other.
  expect(kiln?.cwd).toBe('/p/fronts/kiln')
  expect(kiln?.cloneHome).toBe('/p/fronts/kiln')
  expect(kiln?.cloneFronts).toEqual(['fieldkit', 'kiln', 'shelf'])
  // Each Controller reads the clone rule in its staffing order, not first in a refusal.
  expect(prompts).toHaveLength(3)
  for (const [k, home] of [[0, '/p/fronts/fieldkit'], [1, '/p/fronts/fieldkit'], [2, '/p/fronts/kiln']] as const) {
    const line = prompts[k]?.split('\n').find(l => l.startsWith('Clones: ')) ?? `no clone line in order ${k}`
    expect(line).toContain('any repository URL (https://, http://, ssh://, git+ssh://, ssh+git://, git:// or USER@HOST:PATH)')
    expect(line).toContain('one level under a front\'s folder, /p/fronts/<front>/<repo>, for fieldkit, kiln, shelf')
    expect(line).toContain(`\`cd ${home} && git clone <url>\``)
    expect(line).toContain('Refused: a remote helper (HELPER::), a file:// or local-path source, this Mac as the host (localhost, 127.x.x.x, 0.x.x.x) or a host written as a number other than a.b.c.d, a host or user starting with -, a folder starting with ., a .. after a folder name in the destination, a landing anywhere else')
  }
})
test('a console\'s own front stays on its record when the portfolio\'s folder cannot be listed', async ($, on) => {
  portfolio(on, true)
  const seen = writes(on, 'consoles')
  on('agent.spawn', () => ({ deny: 'stop here' }))
  expect((await run($, 'staff shelf')).text).toContain('Could not staff SHELF: stop here')
  const reserved = (seen.get('consoles') as Console[][]).flat().find(c => c.callSign === 'SHELF' && c.status === 'staffing')
  expect(reserved?.cloneHome).toBe('/p/fronts/shelf')
  expect(reserved?.cloneFronts).toEqual(['shelf'])
})
// A Bash call in a Controller's own loop, decided by the tool.check chain as a session decides it.
const bashBy = ($: Engine, command: string, agentId = 'f1') => $.tool.check({ tool: 'Bash', input: { command }, agentId } as Parameters<Engine['tool']['check']>[0])

test('the tool.check hook judges a staffed Controller\'s clone by the folder and fronts on its record', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  seed(on, { consoles: [FK] })
  on('agent.list', () => ({ value: [] }))
  // Beneath the plugin everything is allowed, so a deny is the fleet guard's own.
  on('tool.check', () => ({ decision: 'allow' as const }))
  // The instrument: the hook decides this call as the FIELDKIT Controller's.
  const stash = await bashBy($, 'cd /p/fronts/fieldkit && git stash')
  expect(stash.decision).toBe('deny')
  expect(stash.reason).toContain('never stashes')
  // A third party's repository into its own front, and repositories into other fronts, pinned to either folder.
  expect((await bashBy($, 'cd /p/fronts/fieldkit && git clone --depth 1 https://gitlab.com/maps-team/tiles.git')).decision).toBe('allow')
  expect((await bashBy($, 'cd /p/fronts/fieldkit && git clone git@github.com:fieldkit-org/api.git /p/fronts/shelf/api')).decision).toBe('allow')
  expect((await bashBy($, 'cd /p/fronts/shelf && git clone git@github.com:shelf-co/shelf.git')).decision).toBe('allow')
  // kiln's folder is its repository; a clone into it is allowed all the same.
  expect((await bashBy($, 'cd /p/fronts/kiln && git clone https://codeberg.org/kiln/glaze.git')).decision).toBe('allow')
  const upload = await bashBy($, 'cd /p/fronts/fieldkit && git clone -u x git@github.com:fieldkit-org/api.git')
  expect(upload.decision).toBe('deny')
  expect(upload.reason).toContain('-u is not an allowed clone option')
  const ghost = await bashBy($, 'cd /p/fronts/fieldkit && git clone git@github.com:fieldkit-org/api.git /p/fronts/ghost/api')
  expect(ghost.decision).toBe('deny')
  expect(ghost.reason).toContain('ghost is not a front this console was staffed with (fieldkit, kiln, shelf)')
  const flat = await bashBy($, 'cd /p/fronts/fieldkit && git clone git@github.com:fieldkit-org/api.git /p/fronts/shelf')
  expect(flat.decision).toBe('deny')
  expect(flat.reason).toContain('it would land in /p/fronts/shelf; a clone lands one level under a front\'s folder, here /p/fronts/shelf/api')
  const local = await bashBy($, 'cd /p/fronts/fieldkit && git clone /p/fronts/shelf/shelf')
  expect(local.decision).toBe('deny')
  expect(local.reason).toContain('/p/fronts/shelf/shelf is a local path')
  expect(audit.join('\n')).toContain('\tguard\tFIELDKIT\tcontroller Bash denied: A Controller clones only into a front\'s folder, one level down (fronts/<front>/<repo>): -u is not an allowed clone option')
})

test('a Controller whose front\'s folder is its repository clones there and into other fronts like any other', async ($, on) => {
  portfolio(on)
  const KN: Console = { ...FK, callSign: 'KILN', front: 'kiln', name: 'console-kiln', agentId: 'k1', cwd: '/p/fronts/kiln', cloneHome: '/p/fronts/kiln' }
  seed(on, { consoles: [KN] })
  on('agent.list', () => ({ value: [] }))
  on('tool.check', () => ({ decision: 'allow' as const }))
  // The instrument: an ordinary git call in its folder passes as the KILN Controller's.
  expect((await bashBy($, 'cd /p/fronts/kiln && git status', 'k1')).decision).toBe('allow')
  expect((await bashBy($, 'cd /p/fronts/kiln && git clone https://codeberg.org/kiln/glaze.git', 'k1')).decision).toBe('allow')
  expect((await bashBy($, 'cd /p/fronts/kiln && git clone https://codeberg.org/kiln/glaze.git /p/fronts/fieldkit/glaze', 'k1')).decision).toBe('allow')
  // A folder inside its repository is two levels under the front's folder, and no folder a clone runs from.
  const deep = await bashBy($, 'cd /p/fronts/kiln && git clone https://codeberg.org/kiln/glaze.git src/glaze', 'k1')
  expect(deep.decision).toBe('deny')
  expect(deep.reason).toContain('it would land in /p/fronts/kiln/src/glaze;')
  const inside = await bashBy($, 'cd /p/fronts/kiln/src && git clone https://codeberg.org/kiln/glaze.git ../../fieldkit/glaze', 'k1')
  expect(inside.decision).toBe('deny')
  expect(inside.reason).toContain('it runs from /p/fronts/kiln/src, a folder inside one a clone may run from, where a link could carry it elsewhere; pin it to a front\'s folder by its full path: `cd /p/fronts/kiln && git clone https://codeberg.org/kiln/glaze.git`')
})

test('a Controller staffed when a clone landed only in its own front keeps cloning there, from any repository', async ($, on) => {
  portfolio(on)
  seed(on, { consoles: [ownFrontOnly(FK)] })
  on('agent.list', () => ({ value: [] }))
  on('tool.check', () => ({ decision: 'allow' as const }))
  expect((await bashBy($, 'cd /p/fronts/fieldkit && git clone https://gitlab.com/maps-team/tiles.git')).decision).toBe('allow')
  const away = await bashBy($, 'cd /p/fronts/fieldkit && git clone https://gitlab.com/maps-team/tiles.git /p/fronts/shelf/tiles')
  expect(away.decision).toBe('deny')
  expect(away.reason).toContain('shelf is not a front this console was staffed with (fieldkit)')
})

test('a Controller staffed before clones were allowed is refused a clone until it is stood down and staffed again', async ($, on) => {
  portfolio(on)
  seed(on, { consoles: [legacy(FK)] })
  on('agent.list', () => ({ value: [] }))
  on('tool.check', () => ({ decision: 'allow' as const }))
  expect((await bashBy($, 'cd /p/fronts/fieldkit && git status')).decision).toBe('allow')
  const r = await bashBy($, 'cd /p/fronts/fieldkit && git clone git@github.com:fieldkit-org/api.git')
  expect(r.decision).toBe('deny')
  expect(r.reason).toContain('this console was staffed before clones were allowed: it can clone once it is stood down and staffed again')
})

test('a call message is taken whole, so double-dash words and new lines reach the Controller as written', async ($, on) => {
  portfolio(on)
  seed(on, { consoles: [FK] })
  const sent: { to: string; text: string }[] = []
  on('session.send', (_$, e) => {
    sent.push({ to: JSON.stringify(e.to), text: e.text })
    return { isDelivered: true }
  })
  expect((await run($, 'call FIELDKIT clone it with --depth 1 --single-branch, then\nreport back')).text).toContain('Called FIELDKIT.')
  expect(sent[0]?.to).toContain('f1')
  expect(sent[0]?.text).toBe('clone it with --depth 1 --single-branch, then\nreport back')
  expect((await run($, 'call FIELDKIT use --single-branch')).text).toContain('Called FIELDKIT.')
  expect(sent[1]?.text).toBe('use --single-branch')
  expect((await run($, 'call FIELDKIT')).text).toContain('Usage:')
  expect(sent).toHaveLength(2)
})

test('a GO or NO-GO note is taken whole, double-dash words included', async ($, on) => {
  portfolio(on)
  const MI3: PollItem = { ...OPEN, id: 'MI3', at: '2026-10-16T00:51:00.000Z', title: 'tag the release', detail: 'blocked on you: tag the release' }
  seed(on, { poll: [OPEN, MI3], consoles: [MC] })
  const sent: string[] = []
  on('session.send', (_$, e) => {
    sent.push(e.text)
    return { isDelivered: true }
  })
  expect((await person($, 'go MI2 ship it, clone with --depth 1 --no-tags')).text).toContain('MI2: GO recorded, told MISSION-CONTROL.')
  expect(sent[0]).toContain('GO from the founder on MI2: ship it, clone with --depth 1 --no-tags')
  expect((await person($, 'no-go MI3 not yet: --single-branch first')).text).toContain('MI3: NO-GO recorded, told MISSION-CONTROL.')
  expect(sent[1]).toContain('NO-GO from the founder on MI3: not yet: --single-branch first')
})

// ---- Call-sign colours (MC-129) ----

// The plugin's store, answered from memory beneath the plugin, with each value the plugin sets, in order.
// deno-lint-ignore no-explicit-any
const storeOf = (on: any, initial: Record<string, unknown> = {}) => {
  const held: Record<string, unknown> = { ...initial }
  const sets: { key: string; value: unknown }[] = []
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: held[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    held[e.key] = e.value
    sets.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  return sets
}
// The colour maps the plugin keeps, in order.
const slotWrites = (sets: { key: string; value: unknown }[]) => sets.filter(s => s.key === 'callSignSlots').map(s => s.value as Record<string, number>)
// Staffed long before any staffing a test runs, so the reservation it writes comes after.
const EARLY = '2026-01-01T00:00:00.000Z'
const SH: Console = { ...FK, callSign: 'SHELF', front: 'shelf', name: 'console-shelf', agentId: 's1', cwd: '/p/fronts/shelf/shelf', cloneHome: '/p/fronts/shelf', staffedAt: EARLY }

test('staffing gives the new console a colour no staffed console holds, and keeps it in the plugin store', async ($, on) => {
  portfolio(on)
  seed(on, { consoles: [FK] })
  const sets = storeOf(on, { callSignSlots: { FIELDKIT: 0 } })
  on('agent.spawn', () => ({ deny: 'stop here' }))
  expect((await run($, 'staff shelf')).text).toContain('Could not staff SHELF: stop here')
  // The kit strips a spawn's agentId, so the colour is the one the staffing's reservation was given.
  const kept = slotWrites(sets).at(-1)
  expect(kept?.FIELDKIT).toBe(0)
  expect(kept?.SHELF).toBe(1)
})

test('a call sign staffed again keeps its colour, and a staffed console that had none is given one', async ($, on) => {
  portfolio(on)
  // SHELF was staffed before colours were kept; FIELDKIT stood down remembering 3.
  seed(on, { consoles: [SH, { ...FK, status: 'stood-down' }] })
  const sets = storeOf(on, { callSignSlots: { FIELDKIT: 3 } })
  on('agent.spawn', () => ({ deny: 'stop here' }))
  expect((await run($, 'staff fieldkit')).text).toContain('Could not staff FIELDKIT: stop here')
  expect(slotWrites(sets).at(-1)).toEqual({ FIELDKIT: 3, SHELF: 0 })
})

test('a call sign whose remembered colour a console staffed earlier holds is given a free one', async ($, on) => {
  portfolio(on)
  seed(on, { consoles: [{ ...FK, staffedAt: EARLY }] })
  const sets = storeOf(on, { callSignSlots: { FIELDKIT: 2, SHELF: 2 } })
  on('agent.spawn', () => ({ deny: 'stop here' }))
  expect((await run($, 'staff shelf')).text).toContain('Could not staff SHELF: stop here')
  expect(slotWrites(sets).at(-1)).toEqual({ FIELDKIT: 2, SHELF: 0 })
})

test('the console tool tells Flight the marker that badges a message with its Controllers', async ($, on) => {
  let description = ''
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('agent.register', (_$, e) => ({ value: { agent: e.name } }))
  on('tool.register', (_$, e) => {
    if (e.name === 'console') description = e.description
    return { value: { tool: e.name } }
  })
  on('session.start', () => ({ cwd: '/p' }))
  on('session.root', () => ({ value: '/p' }))
  on('fs.read', (_$, e) => (e.path === '/p/_command/trackers/fronts.md' ? { value: '# Fronts' } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', () => ({ value: undefined }))
  await $.session.start({ cwd: '/p' } as Parameters<Engine['session']['start']>[0])
  expect(description).toContain('/console staff <front>')
  expect(description).toContain('**<CALL-SIGN>**, or **<CALL-SIGN> · <CALL-SIGN>** for several')
  expect(description).toContain('Write no marker when you speak for yourself.')
})

test('a colour map the store cannot read is never written over, and the staffing goes on', async ($, on) => {
  portfolio(on)
  seed(on, { consoles: [FK] })
  const keys: string[] = []
  on('store.get', () => ({ deny: 'store offline' }))
  on('store.set', (_$, e) => {
    keys.push(e.key)
    return { value: undefined }
  })
  const audit = auditLines(on)
  on('agent.spawn', () => ({ deny: 'stop here' }))
  expect((await run($, 'staff shelf')).text).toContain('Could not staff SHELF: stop here')
  expect(keys).not.toContain('callSignSlots')
  expect(audit.join('\n')).toContain('\tslots\tSHELF\tnot kept: ')
})

test('the app is sent each call sign\'s colour with the fleet, as the store keeps it', async ($, on) => {
  portfolio(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-16T10:00:00.000Z') })
  // FIELDKIT was staffed before colours were kept; SHELF, staffed after it, remembers 4.
  seed(on, { consoles: [{ ...FK, staffedAt: EARLY }, { ...SH, staffedAt: '2026-01-02T00:00:00.000Z' }] })
  const held: Record<string, unknown> = { callSignSlots: { SHELF: 4 } }
  // The standing app setting reads as off, so no supervisor restarts the server the test stops.
  on('store.get', (_$, e) => ({ value: e.key === 'appAlways' ? false : held[e.key] }))
  on('store.set', (_$, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  on('agent.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/p/tools/mods/mission-fleet\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  // The app server as the plugin starts it: ready at once, then running until the test ends it.
  let end: () => void = () => undefined
  const ended = new Promise<void>(resolve => (end = resolve))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: '{"type":"ready","port":4999,"profile":"demo"}\n' }
    await ended
    return { value: { code: 0, signal: null } }
  })
  const pushed: string[] = []
  on('http.fetch', (_$, e) => {
    if (e.url.endsWith('/bridge/state')) pushed.push(String(e.init?.body ?? ''))
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  try {
    expect((await person($, 'app')).text).toContain('Mission Control App')
    await clock.settle()
    expect(pushed.length).toBeGreaterThan(0)
    expect(JSON.parse(pushed[0]!).slots).toEqual({ FIELDKIT: 0, SHELF: 4 })
    expect(held.callSignSlots).toEqual({ FIELDKIT: 0, SHELF: 4 })
  } finally {
    end()
    await person($, 'app stop')
    // Lets the push loop's wait and the start's timeout run out, so nothing outlives the test.
    await clock.advance(10_000)
  }
})
