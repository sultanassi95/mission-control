import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

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

// A user-level /console skill makes the engine refuse the plugin's own command registration. That
// refusal must not stop the Controller type and the console tool from registering.
test('a refused console command still registers the controller type and the console tool', async ($, on) => {
  const registered: string[] = []
  const written: { path: string; text: string }[] = []
  on('command.register', () => ({ deny: '"/console" refused: it is the user\'s /console' }))
  on('agent.register', (_$, e) => { registered.push(`agent:${e.name}`); return { value: undefined } })
  on('tool.register', (_$, e) => { registered.push(`tool:${e.name}`); return { value: undefined } })
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
  seed(on, { poll: [MI1, { ...MI1, id: 'KA1', from: 'KARNAK', agentId: 'k1', at: '2026-10-16T00:31:00.000Z' }], consoles: [MC, { ...MC, callSign: 'KARNAK', front: 'karnak', name: 'console-karnak', agentId: 'k1', status: 'stood-down' }] })
  const listed = (await person($, 'poll')).text ?? ''
  expect(listed).not.toContain('Issue the action again')
  const mi1 = listed.split('\n').find(l => l.includes('MI1')) ?? ''
  const ka1 = listed.split('\n').find(l => l.includes('KA1')) ?? ''
  expect(mi1).toContain('Auto mode blocked the message.')
  expect(mi1).toContain('/console retry MI1')
  expect(mi1).not.toMatch(/staff the console again/i)
  expect(ka1).toMatch(/staff the console again/i)
  expect(ka1).not.toContain('/console retry KA1')
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
const ADVISORY: PendingAdvisory = { id: 'p1', front: 'mission-control', text: 'Advisory from Flight: KARNAK reports a contract change: /v1 ids.', at: '2026-10-16T00:40:00.000Z' }

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
  expect(sent[0]?.text).toContain('KARNAK reports a contract change: /v1 ids.')
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
