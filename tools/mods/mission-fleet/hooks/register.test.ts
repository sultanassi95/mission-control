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

test('checking off a to-do is the founder\'s: refused through Flight\'s tool, answered for a typed command', async ($, on) => {
  portfolio(on)
  const viaTool = await $.tool.call({ tool: 'mcp__mission-fleet__console', args: 'done FI1' } as Parameters<Engine['tool']['call']>[0])
  expect(JSON.stringify(viaTool)).toContain('founder')
  const typed = await $.command.run({ command: 'console', args: 'done FI1', origin: { kind: 'composer' } } as Parameters<Engine['command']['run']>[0])
  expect(typed.text).toContain('No poll item FI1')
  const unknown = await $.command.run({ command: 'console', args: 'done FI1', origin: { kind: 'sdk' } } as Parameters<Engine['command']['run']>[0])
  expect(unknown.text).toContain('founder')
  expect((await run($, 'poll')).text).toContain('Nothing is waiting on the founder')
  // The verbs that answered on the Poll are gone: Flight asks each question itself.
  for (const verb of ['go FI1', 'nogo FI1', 'decide FI1 1', 'retry FI1']) expect((await person($, verb)).text).toContain('Usage:')
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

test('a relayed op through Flight\'s tool with a code the app never minted is refused', async ($, on) => {
  portfolio(on)
  const forged = await $.tool.call({ tool: 'mcp__mission-fleet__console', args: `call FIELDKIT hi --code ${'f'.repeat(32)}` } as Parameters<Engine['tool']['call']>[0])
  expect(JSON.stringify(forged)).toContain('unknown, used or expired')
  expect(JSON.stringify(forged)).not.toContain('No staffed console')
})

// ---- The fleet's state, as tests seed and read it ----

const MC: Console = {
  callSign: 'MISSION-CONTROL', front: 'mission-control', name: 'console-mission-control', agentId: 'a1', cwd: '/p/fronts/mission-control',
  budget: 4, protectedBranches: [], model: 'opus', staffedAt: '2026-10-16T00:20:00.000Z', status: 'staffed',
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

// ---- Advisories held for a front (MC-122) ----

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

// ---- Decisions asked in Flight's chat (MC-125) ----

const ASKED_AT = '2026-10-18T09:12:00.000Z'
const Q7: PollItem = {
  id: 'MI7', at: ASKED_AT, from: 'MISSION-CONTROL', kind: 'question', title: 'Which branch should MC-136 build on?', detail: 'decisions:\n- Which branch should MC-136 build on? | ...', state: 'open', agentId: 'a1',
  options: [{ label: 'The epic branch', does: 'lands with MC-124\'s PR' }, { label: 'Its own branch off main', does: 'a separate PR after MC-124' }],
}
const Q8: PollItem = { ...Q7, id: 'MI8', title: 'Keep the old Poll for a week?', options: [{ label: 'Keep it', does: 'both views for a week' }, { label: 'Drop it', does: 'read-only from today' }] }
const TODO: PollItem = { ...Q7, id: 'MI9', kind: 'todo', title: 'Close PR #31 https://github.com/o/r/pull/31', options: undefined }
const TWO_DECISIONS = [
  'state: MC-136 planned',
  'shipped: nothing',
  'blocked on you: two decisions below',
  'next: build once answered',
  'decisions:',
  '- Which branch should MC-136 build on? | 1) The epic branch: lands with MC-124\'s PR | 2) Its own branch off main: a separate PR after MC-124',
  '- Keep the old Poll for a week? | 1) Keep it: both views for a week | 2) Drop it: read-only from today',
  'notes: the sweep found 0 hits',
  'for you to do:',
  '- Close PR #31 https://github.com/o/r/pull/31',
].join('\n')

// The session beneath the plugins, answering a turn's end as core does: register once per test, before
// the first reportEnds (the kit takes one handler per event).
// deno-lint-ignore no-explicit-any
const turnCore = (on: any) => on('turn.complete', (_$: Engine, e: { answer: string }) => ({ text: e.answer }))

// A Controller's turn ending with this answer, as the session reports it, then the recording it starts.
const reportEnds = async ($: Engine, clock: { settle: () => Promise<unknown> }, agentId: string, answer: string) => {
  await $.turn.complete({ agentId, answer, durationMs: 1, isAborted: false, turnId: `t-${answer.length}`, reason: 'answer' } as Parameters<Engine['turn']['complete']>[0])
  await clock.settle()
}

test('a report with two decisions, a note and a to-do opens two questions with their options and one to-do, and nothing for the note', async ($, on) => {
  portfolio(on)
  turnCore(on)
  const clock = mock.clock(on, { now: Date.parse(ASKED_AT) })
  const audit = auditLines(on)
  const polls = pollWrites(on)
  seed(on, { consoles: [MC] })
  await reportEnds($, clock, 'a1', TWO_DECISIONS)
  const items = polls.at(-1) ?? []
  expect(items.map(p => `${p.kind}: ${p.title}`)).toEqual([
    'question: Which branch should MC-136 build on?',
    'question: Keep the old Poll for a week?',
    'todo: Close PR #31 https://github.com/o/r/pull/31',
  ])
  expect(items[0]?.options).toEqual(Q7.options)
  expect(items[1]?.options).toEqual(Q8.options)
  expect(items.every(p => p.state === 'open' && p.agentId === 'a1' && p.from === 'MISSION-CONTROL')).toBe(true)
  expect(new Set(items.map(p => p.id)).size).toBe(3)
  const lines = audit.join('\n')
  expect(lines.split('\n').filter(l => l.includes('\tasked\t')).length).toBe(2)
  expect(lines).toContain('\ttodo\t')
  const listed = (await person($, 'poll')).text ?? ''
  expect(listed).toContain('question: Which branch should MC-136 build on?')
  expect(listed).toContain('2) Its own branch off main - a separate PR after MC-124')
  expect(listed).toContain('todo: Close PR #31')
  expect(listed).not.toContain('sweep found')
})

test('notes, contract none, a contract no front depends on and a nothing-like blocked line open nothing', async ($, on) => {
  portfolio(on)
  turnCore(on)
  const clock = mock.clock(on, { now: Date.parse(ASKED_AT) })
  const polls = pollWrites(on)
  seed(on, { consoles: [MC] })
  await reportEnds($, clock, 'a1', 'state: ok\nshipped: nothing\nblocked on you: nothing yet\nnext: wait\nnotes: fyi only\ncontract: none')
  await reportEnds($, clock, 'a1', 'state: ok\nblocked on you: none\nnext: wait\ncontract: the audit log gained a column')
  expect((polls.at(-1) ?? []).filter(p => p.state === 'open')).toEqual([])
  expect((await person($, 'poll')).text).toContain('Nothing is waiting on the founder')
})

test('a new report that lists one of two open questions again keeps it and replaces the other; a report with no decisions leaves both', async ($, on) => {
  portfolio(on)
  turnCore(on)
  const clock = mock.clock(on, { now: Date.parse(ASKED_AT) })
  const polls = pollWrites(on)
  seed(on, { poll: [Q7, Q8], consoles: [MC] })
  await reportEnds($, clock, 'a1', 'state: working\nblocked on you: nothing new\nnext: build')
  expect(polls.at(-1)?.filter(p => p.state === 'open').map(p => p.id) ?? ['MI7', 'MI8']).toEqual(['MI7', 'MI8'])
  await reportEnds($, clock, 'a1', 'state: still planned\ndecisions:\n- Which branch should MC-136 build on? | 1) The epic branch: lands with MC-124\'s PR | 2) Its own branch off main: a separate PR after MC-124\nnext: wait')
  const after = polls.at(-1) ?? []
  expect(after.filter(p => p.state === 'open').map(p => p.id)).toEqual(['MI7'])
  expect(after.find(p => p.id === 'MI8')?.state).toBe('superseded')
  expect(after).toHaveLength(2)
})

test('a report with only a to-do opens the to-do and leaves the open questions; its blocked line asks nothing', async ($, on) => {
  portfolio(on)
  turnCore(on)
  const clock = mock.clock(on, { now: Date.parse(ASKED_AT) })
  const audit = auditLines(on)
  const polls = pollWrites(on)
  seed(on, { poll: [Q7], consoles: [MC] })
  await reportEnds($, clock, 'a1', 'state: built\nshipped: nothing\nblocked on you: the to-do below\nnext: wait\nfor you to do:\n- Close PR #31 https://github.com/o/r/pull/31')
  const after = polls.at(-1) ?? []
  expect(after.filter(p => p.state === 'open').map(p => `${p.id} ${p.kind}`)).toEqual(['MI7 question', `${after.at(-1)?.id} todo`])
  expect(after.some(p => p.kind === 'gate')).toBe(false)
  expect(audit.join('\n')).not.toContain('\tasked\t')
})

test('a legacy blocked line replaces only an earlier one, never a question', async ($, on) => {
  portfolio(on)
  turnCore(on)
  const clock = mock.clock(on, { now: Date.parse(ASKED_AT) })
  const polls = pollWrites(on)
  const GATE: PollItem = { ...Q7, id: 'MI5', kind: 'gate', title: 'merge the old fix', options: undefined }
  seed(on, { poll: [GATE, Q7], consoles: [MC] })
  await reportEnds($, clock, 'a1', 'state: built\nblocked on you: merge the new fix\nnext: wait')
  const after = polls.at(-1) ?? []
  expect(after.filter(p => p.id === 'MI5' || p.id === 'MI7').map(p => `${p.id} ${p.state}`)).toEqual(['MI5 superseded', 'MI7 open'])
  expect(after.filter(p => p.state === 'open' && p.kind === 'gate').map(p => p.title)).toEqual(['merge the new fix'])
})

// ---- Flight asks the Controllers' questions itself (MC-163) ----

// Flight's own question as the engine raises it: one AskUserQuestion call, each header a poll item's id.
const ask = ($: Engine, questions: { header: string; question: string; options?: { label: string; description?: string }[] }[]) =>
  $.tool.call({ tool: 'AskUserQuestion', questions: questions.map(q => ({ multiSelect: false, options: [{ label: 'a' }, { label: 'b' }], ...q })) } as Parameters<Engine['tool']['call']>[0])
// The terminal dialog beneath the plugin, answering every question it is shown from `answers` (by question text).
// deno-lint-ignore no-explicit-any
const dialog = (on: any, answers: Record<string, string>) =>
  on('tool.call', (_$: unknown, e: { tool: string; questions?: unknown }) => (e.tool === 'AskUserQuestion' ? { result: { questions: e.questions, answers } } : { result: 'ok' }))
const Q7_ASKED = { header: 'MI7', question: 'Which branch should MC-136 build on?', options: [{ label: 'The epic branch' }, { label: 'Its own branch off main' }] }
const Q8_ASKED = { header: 'MI8', question: 'Keep the old Poll for a week?', options: [{ label: 'Keep it' }, { label: 'Drop it' }] }

test('a report\'s questions are put to Flight in one prompt, at most four, urgent first then oldest, each with its id and options', async ($, on) => {
  portfolio(on)
  turnCore(on)
  const clock = mock.clock(on, { now: Date.parse(ASKED_AT) })
  const polls = pollWrites(on)
  const prompts: { text: string }[] = []
  on('prompt.submit', (_$, e) => {
    prompts.push({ text: e.text })
    return { text: e.text }
  })
  seed(on, { consoles: [MC] })
  const five = ['state: planned', 'decisions:', ...['A', 'B', 'C', 'D'].map(k => `- Question ${k}? | 1) Yes: do ${k} | 2) No: skip ${k}`), '- urgent: Roll back the deploy? | 1) Yes: roll back | 2) No: keep it', 'next: wait'].join('\n')
  await reportEnds($, clock, 'a1', five)
  expect(prompts).toHaveLength(1)
  const text = prompts[0]?.text ?? ''
  expect(text).toContain('one AskUserQuestion call')
  expect(text).toContain('Do not send the answers yourself')
  const order = [...text.matchAll(/^id (\S+) \(MISSION-CONTROL(, urgent)?\): (.*)$/gm)].map(m => `${m[3]}${m[2] ? ' (urgent)' : ''}`)
  expect(order).toEqual(['Roll back the deploy? (urgent)', 'Question A?', 'Question B?', 'Question C?'])
  expect(text).toContain('  1) Yes: roll back')
  const after = polls.at(-1) ?? []
  expect(after.filter(p => p.askedAt).map(p => p.title)).toEqual(['Question A?', 'Question B?', 'Question C?', 'Roll back the deploy?'])
  expect(after.find(p => p.title === 'Question D?')?.askedAt).toBeUndefined()
})

test('a question that arrives while Flight works is put to it only once its turn ends', async ($, on) => {
  portfolio(on)
  turnCore(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const clock = mock.clock(on, { now: Date.parse(ASKED_AT) })
  const prompts: string[] = []
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  seed(on, { consoles: [MC] })
  await $.turn.start({ text: 'build MC-163', turnId: 'flight-1' } as Parameters<Engine['turn']['start']>[0])
  await reportEnds($, clock, 'a1', 'state: planned\ndecisions:\n- Ship it? | 1) Yes: ship | 2) No: wait\nnext: wait')
  expect(prompts).toEqual([])
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'flight-1', reason: 'answer' } as Parameters<Engine['turn']['complete']>[0])
  await clock.settle()
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('Ship it?')
})

test('Flight\'s question answered at the Mac reaches the Controller that asked it, and Flight is told', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  const polls = pollWrites(on)
  seed(on, { poll: [Q7, Q8], consoles: [MC, { ...MC, callSign: 'ACME', front: 'acme', name: 'console-acme', agentId: 'k1' }] })
  dialog(on, { [Q7.title]: 'Its own branch off main' })
  const sent: { to: string; text: string }[] = []
  on('session.send', (_$, e) => {
    sent.push({ to: JSON.stringify(e.to), text: e.text })
    return { isDelivered: true }
  })
  const r = await ask($, [Q7_ASKED, Q8_ASKED])
  expect(sent).toHaveLength(1)
  expect(sent[0]?.to).toContain('a1')
  expect(sent[0]?.text).toContain('The founder answered MI7: 2) Its own branch off main - a separate PR after MC-124.')
  expect(sent[0]?.text).not.toContain('Keep the old Poll')
  const after = polls.at(-1) ?? []
  expect(after.find(p => p.id === 'MI7')).toMatchObject({ state: 'answered', choice: 2 })
  expect(after.find(p => p.id === 'MI8')?.state).toBe('open')
  // Flight reads what became of each answer after the tool's result; the founder never sees it.
  expect(JSON.stringify(r)).toContain('MI7 (MISSION-CONTROL): answered 2) Its own branch off main, told MISSION-CONTROL.')
  expect(audit.join('\n')).toContain('\tanswered\tMI7\ttold MISSION-CONTROL')
})

test('an answer in the founder\'s own words is passed on as written', async ($, on) => {
  portfolio(on)
  seed(on, { poll: [Q7], consoles: [MC] })
  dialog(on, { [Q7.title]: 'neither: wait for MC-124 to merge' })
  const sent: string[] = []
  on('session.send', (_$, e) => {
    sent.push(e.text)
    return { isDelivered: true }
  })
  await ask($, [Q7_ASKED])
  expect(sent[0]).toContain('The founder answered MI7 in their own words: neither: wait for MC-124 to merge')
})

test('an answer that cannot reach its Controller is recorded, and Flight is told to relay it; nothing waits on a card', async ($, on) => {
  portfolio(on)
  const polls = pollWrites(on)
  seed(on, { poll: [Q7], consoles: [MC] })
  dialog(on, { [Q7.title]: 'The epic branch' })
  on('session.send', () => ({ isDelivered: false, reason: 'The server-side auto mode classifier gave no verdict for SendMessage' }))
  const r = await ask($, [Q7_ASKED])
  const said = JSON.stringify(r)
  expect(said).toContain('MI7 (MISSION-CONTROL): answered 1) The epic branch, but it did not reach MISSION-CONTROL: Auto mode blocked the message.')
  expect(said).toContain('/console call MISSION-CONTROL')
  const after = polls.at(-1) ?? []
  expect(after.find(p => p.id === 'MI7')?.state).toBe('answered')
  expect(JSON.stringify(after)).not.toContain('undelivered')
})

test('a legacy blocked line is asked as Go or No-go, and the answer goes to its Controller', async ($, on) => {
  portfolio(on)
  seed(on, { poll: [OPEN], consoles: [MC] })
  dialog(on, { 'merge the fix': 'No-go' })
  const sent: string[] = []
  on('session.send', (_$, e) => {
    sent.push(e.text)
    return { isDelivered: true }
  })
  const r = await ask($, [{ header: 'MI2', question: 'merge the fix', options: [{ label: 'Go' }, { label: 'No-go' }] }])
  expect(sent[0]).toContain('NO-GO from the founder on MI2.')
  expect(JSON.stringify(r)).toContain('MI2 (MISSION-CONTROL): NO-GO recorded, told MISSION-CONTROL.')
})

test('a question of Flight\'s own, with no Controller behind it, is answered as before and sends nothing', async ($, on) => {
  portfolio(on)
  seed(on, { poll: [Q7], consoles: [MC] })
  dialog(on, { 'Deploy now?': 'yes' })
  let sends = 0
  on('session.send', () => {
    sends++
    return { isDelivered: true }
  })
  const r = await ask($, [{ header: 'Deploy', question: 'Deploy now?' }])
  expect(sends).toBe(0)
  expect(JSON.stringify(r)).not.toContain('mission-fleet')
  expect(JSON.stringify(r)).toContain('yes')
})

test('a to-do checked off is told to the Controller that left it; a second Done is refused', async ($, on) => {
  portfolio(on)
  const polls = pollWrites(on)
  seed(on, { poll: [Q7, TODO], consoles: [MC] })
  const sent: { to: string; text: string }[] = []
  on('session.send', (_$, e) => {
    sent.push({ to: JSON.stringify(e.to), text: e.text })
    return { isDelivered: true }
  })
  expect((await person($, 'done MI7')).text).toContain('MI7 is not a to-do')
  expect((await person($, 'done MI9')).text).toBe('MI9 done; MISSION-CONTROL was told.')
  expect(sent).toHaveLength(1)
  expect(sent[0]?.to).toContain('a1')
  expect(sent[0]?.text).toBe('The founder checked off your to-do MI9: Close PR #31 https://github.com/o/r/pull/31')
  expect(polls.at(-1)?.find(p => p.id === 'MI9')?.state).toBe('done')
  expect((await person($, 'done MI9')).text).toContain('MI9 is already closed: done')
  expect(sent).toHaveLength(1)
})

test('dismiss-gate closes an open question with nothing sent', async ($, on) => {
  portfolio(on)
  const polls = pollWrites(on)
  seed(on, { poll: [Q7], consoles: [MC] })
  let sends = 0
  on('session.send', () => {
    sends++
    return { isDelivered: true }
  })
  expect((await person($, 'dismiss-gate MI7')).text).toBe('MI7 dismissed. Nothing was sent to MISSION-CONTROL.')
  expect(polls.at(-1)?.find(p => p.id === 'MI7')?.state).toBe('dismissed')
  expect((await person($, 'dismiss-gate MI7')).text).toContain('MI7 is already closed: dismissed')
  expect(sends).toBe(0)
})

test('what Flight is told comes as context lines, kept beside core\'s result', async ($, on) => {
  portfolio(on)
  seed(on, { poll: [Q7], consoles: [MC] })
  dialog(on, { [Q7.title]: 'The epic branch' })
  on('session.send', () => ({ isDelivered: true }))
  const r = (await ask($, [Q7_ASKED])) as { result?: { answers?: Record<string, string> }; context?: unknown }
  expect(Array.isArray(r.context)).toBe(true)
  expect((r.context as string[]).join('\n')).toContain('MI7 (MISSION-CONTROL): answered 1) The epic branch, told MISSION-CONTROL.')
  expect(r.result?.answers).toEqual({ [Q7.title]: 'The epic branch' })
})

test('words typed on a Go or No-go question are passed on as words, never as a GO', async ($, on) => {
  portfolio(on)
  const polls = pollWrites(on)
  seed(on, { poll: [OPEN], consoles: [MC] })
  dialog(on, { 'merge the fix': 'no, not before the release' })
  const sent: string[] = []
  on('session.send', (_$, e) => {
    sent.push(e.text)
    return { isDelivered: true }
  })
  await ask($, [{ header: 'MI2', question: 'merge the fix', options: [{ label: 'Go' }, { label: 'No-go' }] }])
  expect(sent[0]).toContain('The founder answered MI2 in their own words: no, not before the release')
  expect(sent[0]).not.toContain('GO from the founder')
  expect(polls.at(-1)?.find(p => p.id === 'MI2')).toMatchObject({ state: 'answered', choice: 0 })
})

test('an answer to a question replaced while it was on screen is never dropped: it is audited and told to Flight', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  seed(on, { poll: [{ ...Q7, state: 'superseded' }], consoles: [MC] })
  dialog(on, { [Q7.title]: 'The epic branch' })
  let sends = 0
  on('session.send', () => {
    sends++
    return { isDelivered: true }
  })
  const r = await ask($, [Q7_ASKED])
  expect(sends).toBe(0)
  expect(JSON.stringify(r)).toContain('The answer to MI7 (\\"The epic branch\\") reached no Controller: MI7 is superseded (MISSION-CONTROL).')
  expect(audit.join('\n')).toContain('\task\tMI7\tanswer matched no open item: MI7 is superseded (MISSION-CONTROL)')
})

test('a send that throws is told to Flight as not delivered, and the rest of the batch is still delivered', async ($, on) => {
  portfolio(on)
  seed(on, { poll: [Q7, Q8], consoles: [MC] })
  dialog(on, { [Q7.title]: 'The epic branch', [Q8.title]: 'Drop it' })
  let n = 0
  on('session.send', () => {
    n++
    if (n === 1) throw new Error('socket closed')
    return { isDelivered: true }
  })
  const said = JSON.stringify(await ask($, [Q7_ASKED, Q8_ASKED]))
  expect(said).toContain('MI7 (MISSION-CONTROL): answered 1) The epic branch, but it did not reach MISSION-CONTROL')
  expect(said).toContain('MI8 (MISSION-CONTROL): answered 2) Drop it, told MISSION-CONTROL.')
})

test('a prompt the engine drops leaves its questions unmarked, so they are put to Flight again', async ($, on) => {
  portfolio(on)
  turnCore(on)
  const clock = mock.clock(on, { now: Date.parse(ASKED_AT) })
  const polls = pollWrites(on)
  const audit = auditLines(on)
  on('prompt.submit', () => ({ drop: 'a settings hook blocked it' }))
  seed(on, { consoles: [MC] })
  await reportEnds($, clock, 'a1', 'state: planned\ndecisions:\n- Ship it? | 1) Yes: ship | 2) No: wait\nnext: wait')
  const shipIt = polls.at(-1)?.find(p => p.title === 'Ship it?')
  expect(shipIt?.state).toBe('open')
  expect(shipIt?.askedAt).toBeUndefined()
  expect(audit.join('\n')).toContain('NOT put to Flight, the prompt was dropped: a settings hook blocked it')
})

test('a question from a Controller that has stood down is not put to Flight; it stays listed', async ($, on) => {
  portfolio(on)
  turnCore(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const clock = mock.clock(on, { now: Date.parse(ASKED_AT) })
  const prompts: string[] = []
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  seed(on, { poll: [Q7], consoles: [{ ...MC, status: 'stood-down' }] })
  await $.turn.start({ text: 'hi', turnId: 'flight-2' } as Parameters<Engine['turn']['start']>[0])
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'flight-2', reason: 'answer' } as Parameters<Engine['turn']['complete']>[0])
  await clock.settle()
  expect(prompts).toEqual([])
  expect((await person($, 'poll')).text).toContain('MI7  MISSION-CONTROL  question: Which branch should MC-136 build on?')
})

test('a stored poll is migrated at session start: an undelivered or held answer is open again and put to Flight, none dropped', async ($, on) => {
  portfolio(on)
  const written: { path: string; text: string }[] = []
  const prompts: string[] = []
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('agent.register', (_$, e) => ({ value: { agent: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
  on('session.start', () => ({ cwd: '/p' }))
  on('fs.write', (_$, e) => { written.push({ path: e.path, text: e.text }); return { value: undefined } })
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  const polls = pollWrites(on)
  const stored = [
    { ...OPEN, id: 'MI2' },
    { ...OPEN, id: 'MI3', state: 'go', choice: 1, decidedAt: '2026-10-16T00:58:00.000Z', undelivered: 'auto mode' },
    { ...Q7, id: 'MI4', state: 'answered', choice: 2, decidedAt: '2026-10-16T00:58:00.000Z', held: '2026-10-16T00:58:00.000Z' },
    { ...TODO, id: 'MI5' },
    { ...Q8, id: 'MI6', state: 'answered', choice: 1, decidedAt: '2026-10-16T00:59:00.000Z' },
  ] as PollItem[]
  seed(on, { poll: stored, consoles: [MC] })
  await $.session.start({ cwd: '/p' } as Parameters<Engine['session']['start']>[0])
  const after = polls.find(list => list.some(p => p.id === 'MI3' && p.state === 'open')) ?? []
  expect(after.map(p => `${p.id} ${p.state}`)).toEqual(['MI2 open', 'MI3 open', 'MI4 open', 'MI5 open', 'MI6 answered'])
  const line = written.filter(w => w.path.endsWith('/audit.log')).map(w => w.text).join('\n')
  expect(line).toContain('\tpoll\tmigrate\topen 2 -> 4; reopened MI3, MI4; items 5 -> 5')
  expect(prompts.join('\n')).toContain('id MI3 (MISSION-CONTROL)')
  expect(prompts.join('\n')).toContain('id MI4 (MISSION-CONTROL)')
})

// ---- The shell's own directory (MC-168, MC-155) ----

// The engine moving a fleet agent's shell, as its CwdChanged event reports it.
const moved = ($: Engine, agentId: string, to: string) =>
  $.classic.CwdChanged({ old_cwd: '/p', new_cwd: to, agent_id: agentId } as Parameters<Engine['classic']['CwdChanged']>[0])

test('a Controller\'s call the engine stripped of its cd to the shell\'s own directory is pinned where the shell is', async ($, on) => {
  portfolio(on)
  const audit = auditLines(on)
  seed(on, { consoles: [FK] })
  on('agent.list', () => ({ value: [] }))
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('classic.CwdChanged', () => ({}))
  // Before any move is known, an unpinned call is refused, as before.
  const before = await bashBy($, 'gh pr list --limit 1')
  expect(before.decision).toBe('deny')
  expect(before.reason).toContain('Pin the repo')
  await moved($, 'f1', '/p/fronts/fieldkit')
  expect((await bashBy($, 'gh pr list --limit 1')).decision).toBe('allow')
  expect((await bashBy($, 'git status')).decision).toBe('allow')
  expect(audit.join('\n')).toContain('\tguard\tFIELDKIT\tcontroller Bash pinned by the shell directory /p/fronts/fieldkit')
  // A cd on the line moves the shell again, so its start pins nothing.
  expect((await bashBy($, 'cd /tmp; git status')).reason).toContain('Pin the repo')
  // Another agent's move is not this one's.
  await moved($, 'other', '/p/fronts/shelf')
  expect((await bashBy($, 'gh pr list --limit 1')).decision).toBe('allow')
  // A shell outside the console is refused by where it is.
  await moved($, 'f1', '/p/_command/portfolio/fieldkit')
  const outside = await bashBy($, 'gh pr list --limit 1')
  expect(outside.decision).toBe('deny')
  expect(outside.reason).toContain('/p/_command/portfolio/fieldkit is outside your console\'s directory (/p/fronts/fieldkit)')
})
